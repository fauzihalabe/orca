import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { randomUUID } from 'node:crypto'
import { mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { ipcMain, type WebContents } from 'electron'
import {
  CREW_CANVAS_BRIDGE_DESCRIPTOR_DIRECTORY,
  crewCanvasBridgeDescriptorFilename,
  type CrewCanvasBridgeDescriptor
} from '../shared/crew-canvas'
import type { OrcaRuntimeService } from './runtime/orca-runtime'
import { CrewCanvasBroker, type CrewCanvasBridgePayload } from './crew-canvas-broker'

// Crew bridge — the local HTTP endpoint agent CLIs call to talk to each other.
// An agent runs plain `curl` (taught in its spawn preamble) → this server → the
// renderer owns the node→pty map and delivers the message into the target
// agent's terminal, then streams back what the target produced. No daemons,
// no cloud: 127.0.0.1 only, random port + node-scoped token. Agents survive
// main-process restarts, so each one discovers the current endpoint through an
// atomically refreshed descriptor in Orca's user-data directory.

type BridgeState = {
  port: number
  token: string
  ready: Promise<void>
  getMainWindow: () => { webContents: WebContents } | null
  agentTokens: Map<string, string>
  descriptorDirectory: string
  broker: CrewCanvasBroker
}

let state: BridgeState | null = null
const pendingReplies = new Map<string, { resolve: (text: string) => void; timer: NodeJS.Timeout }>()

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = ''
    req.on('data', (chunk) => {
      body += chunk
      if (body.length > 512 * 1024) {
        req.destroy()
        reject(new Error('body too large'))
      }
    })
    req.on('end', () => resolve(body))
    req.on('error', reject)
  })
}

function sendJson(res: ServerResponse, status: number, value: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify(value))
}

function ensureAgentToken(current: BridgeState, agentId: string): string {
  const existing = current.agentTokens.get(agentId)
  if (existing) {
    return existing
  }
  const token = randomUUID()
  current.agentTokens.set(agentId, token)
  return token
}

function writeAgentBridgeDescriptor(current: BridgeState, agentId: string): void {
  if (current.port <= 0 || !agentId.trim()) {
    return
  }
  const token = ensureAgentToken(current, agentId)
  const descriptor = {
    version: 1,
    agentId,
    port: current.port,
    token,
    mainProcessId: process.pid,
    issuedAt: Date.now()
  } satisfies CrewCanvasBridgeDescriptor
  mkdirSync(current.descriptorDirectory, { recursive: true, mode: 0o700 })
  const path = join(current.descriptorDirectory, crewCanvasBridgeDescriptorFilename(agentId))
  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`
  try {
    writeFileSync(temporaryPath, JSON.stringify(descriptor), { encoding: 'utf8', mode: 0o600 })
    renameSync(temporaryPath, path)
  } finally {
    rmSync(temporaryPath, { force: true })
  }
}

function persistedAgentIds(broker: CrewCanvasBroker): string[] {
  const ids = new Set<string>()
  for (const tab of Object.values(broker.getState().tabs)) {
    for (const node of tab.graph.nodes) {
      if (node.data.kind === 'agent') {
        ids.add(node.id)
      }
    }
  }
  return [...ids]
}

function refreshPersistedAgentBridgeDescriptors(current: BridgeState): void {
  for (const agentId of persistedAgentIds(current.broker)) {
    try {
      writeAgentBridgeDescriptor(current, agentId)
    } catch (error) {
      console.warn('[crew-canvas] could not refresh agent bridge descriptor:', error)
    }
  }
}

export function startCrewBridge(
  getMainWindow: () => { webContents: WebContents } | null,
  options: { statePath?: string; getRuntime?: () => OrcaRuntimeService | null } = {}
): { port: number; token: string } {
  if (state) {
    return { port: state.port, token: state.token }
  }
  const token = randomUUID()
  let resolveReady!: () => void
  let rejectReady!: (error: unknown) => void
  const ready = new Promise<void>((resolve, reject) => {
    resolveReady = resolve
    rejectReady = reject
  })
  const agentTokens = new Map<string, string>()
  const forwardToRenderer = (payload: CrewCanvasBridgePayload): Promise<string> => {
    const win = state?.getMainWindow()
    if (!win || win.webContents.isDestroyed()) {
      return Promise.reject(new Error('crew window unavailable'))
    }
    const requestId = payload.requestId || randomUUID()
    const reply = new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        pendingReplies.delete(requestId)
        reject(new Error('Canvas request timed out waiting for the renderer'))
      }, 180_000)
      pendingReplies.set(requestId, { resolve, timer })
    })
    win.webContents.send('crew:ask', { ...payload, requestId })
    return reply
  }
  const statePath = options.statePath ?? '/tmp/orca-crew-canvas-state.json'
  const broker = new CrewCanvasBroker({
    statePath,
    getRuntime: options.getRuntime ?? (() => null),
    forwardToRenderer,
    getMainWebContents: () => state?.getMainWindow()?.webContents ?? null
  })
  options.getRuntime?.()?.setCrewCanvasRequestHandler((payload) => broker.handle(payload))
  const server = createServer((req, res) => {
    void (async () => {
      const suppliedToken = req.headers['x-crew-token']
      const tokenValue = Array.isArray(suppliedToken) ? suppliedToken[0] : suppliedToken
      const agentId = tokenValue
        ? [...agentTokens.entries()].find(([, value]) => value === tokenValue)?.[0]
        : undefined
      if (!tokenValue || (!agentId && tokenValue !== token)) {
        sendJson(res, 401, { error: 'unauthorized' })
        return
      }
      if (req.method === 'POST' && (req.url === '/ask' || req.url === '/tool')) {
        const body = await readBody(req)
        let parsed: {
          from?: string
          to?: string
          message?: string
          tool?: string
          args?: Record<string, unknown>
        }
        try {
          parsed = JSON.parse(body)
        } catch {
          sendJson(res, 400, { error: 'invalid json' })
          return
        }
        const isAsk = req.url === '/ask'
        if (isAsk && (!parsed.to || !parsed.message)) {
          sendJson(res, 400, { error: 'to and message are required' })
          return
        }
        if (!isAsk && !parsed.tool) {
          sendJson(res, 400, { error: 'tool is required' })
          return
        }
        if (agentId && parsed.from && parsed.from !== agentId) {
          sendJson(res, 403, { error: 'agent identity does not match the Canvas credential' })
          return
        }
        const requestId = randomUUID()
        const payload: CrewCanvasBridgePayload = {
          requestId,
          from: agentId ?? parsed.from ?? 'unknown',
          to: parsed.to,
          message: parsed.message,
          tool: isAsk ? 'ask' : parsed.tool,
          args: parsed.args ?? {}
        }
        try {
          const response = await broker.handle(payload)
          sendJson(res, 200, { ok: true, response })
        } catch (error) {
          sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) })
        }
        return
      }
      sendJson(res, 404, { error: 'not found' })
    })().catch((error) => {
      sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) })
    })
  })
  state = {
    port: 0,
    token,
    ready,
    getMainWindow,
    agentTokens,
    descriptorDirectory: join(dirname(statePath), CREW_CANVAS_BRIDGE_DESCRIPTOR_DIRECTORY),
    broker
  }
  server.once('error', rejectReady)
  server.once('listening', () => {
    const address = server.address()
    if (state && typeof address === 'object' && address) {
      state.port = address.port
      refreshPersistedAgentBridgeDescriptors(state)
    }
    resolveReady()
  })
  server.listen(0, '127.0.0.1')

  ipcMain.removeHandler('crew:bridge-info')
  ipcMain.handle(
    'crew:bridge-info',
    async (
      _event,
      args?: { nodeId?: string }
    ): Promise<{ port: number; token: string; agentId?: string } | null> => {
      const current = state
      if (!current) {
        return null
      }
      try {
        // Do not expose port 0 while the ephemeral listener is still binding.
        // Canvas agents request this immediately after their native session is
        // spawned, so returning early makes their first bridge call fail with
        // ECONNREFUSED and falsely looks like an empty Canvas graph.
        await current.ready
      } catch {
        return null
      }
      if (state !== current || current.port <= 0) {
        return null
      }
      const nodeId = typeof args?.nodeId === 'string' ? args.nodeId.trim() : ''
      if (!nodeId) {
        // Kept for older terminals during an in-place update. New Canvas agents
        // always request a node-scoped credential below.
        return { port: current.port, token: current.token }
      }
      const scopedToken = ensureAgentToken(current, nodeId)
      try {
        writeAgentBridgeDescriptor(current, nodeId)
      } catch (error) {
        console.warn('[crew-canvas] could not write agent bridge descriptor:', error)
      }
      return { port: current.port, token: scopedToken, agentId: nodeId }
    }
  )
  ipcMain.removeHandler('crew:canvas-state')
  ipcMain.handle('crew:canvas-state', () => state?.broker.getState() ?? null)
  ipcMain.removeHandler('crew:canvas-sync')
  ipcMain.handle(
    'crew:canvas-sync',
    (
      _event,
      args: { tabId: string; worktreeId?: string | null; graph: unknown; baseRevision: number }
    ) => {
      const current = state
      if (!current) {
        return { accepted: false, conflict: true, state: broker.getState() }
      }
      const result = current.broker.syncTab(args)
      if (result.accepted) {
        // A restored native terminal may exist before its Canvas tab reaches
        // main. Refresh after every accepted graph sync so that terminal can
        // immediately discover this main process's live bridge.
        refreshPersistedAgentBridgeDescriptors(current)
      }
      return result
    }
  )
  ipcMain.removeHandler('crew:canvas-remove')
  ipcMain.handle(
    'crew:canvas-remove',
    (_event, args: { tabId: string; baseRevision: number }) =>
      state?.broker.removeTab(args) ?? { accepted: false, conflict: true, state: broker.getState() }
  )
  // Temp-file handoff for the orchestrate flow: the CLI inside the coordinator
  // terminal writes JSON here; the renderer listener reads it back through main.
  ipcMain.handle(
    'crew:read-temp-file',
    async (_event, args: { path: string; deleteAfter?: boolean }) => {
      const { readFile, unlink } = await import('node:fs/promises')
      const path = String(args?.path ?? '')
      if (!path.startsWith('/tmp/') && !path.startsWith('/var/folders/')) {
        throw new Error('path outside temp area')
      }
      const content = await readFile(path, 'utf8')
      if (content.length > 512 * 1024) {
        throw new Error('temp file too large')
      }
      if (args?.deleteAfter) {
        await unlink(path).catch(() => {})
      }
      return content
    }
  )
  ipcMain.on('crew:ask:reply', (_event, args: { requestId: string; text: string }) => {
    const pending = pendingReplies.get(args.requestId)
    if (!pending) {
      return
    }
    clearTimeout(pending.timer)
    pendingReplies.delete(args.requestId)
    pending.resolve(args.text)
  })

  return { port: 0, token }
}

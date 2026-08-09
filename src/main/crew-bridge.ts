import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { randomUUID } from 'node:crypto'
import { ipcMain, type WebContents } from 'electron'

// Crew bridge — the local HTTP endpoint agent CLIs call to talk to each other.
// An agent runs plain `curl` (taught in its spawn preamble) → this server → the
// renderer owns the node→pty map and delivers the message into the target
// agent's terminal, then streams back what the target produced. No daemons,
// no cloud: 127.0.0.1 only, random port + per-boot token.

type BridgeState = {
  port: number
  token: string
  getMainWindow: () => { webContents: WebContents } | null
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

export function startCrewBridge(getMainWindow: () => { webContents: WebContents } | null): {
  port: number
  token: string
} {
  if (state) {
    return { port: state.port, token: state.token }
  }
  const token = randomUUID()
  const server = createServer((req, res) => {
    void (async () => {
      if (req.headers['x-crew-token'] !== token) {
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
        const win = state?.getMainWindow()
        if (!win) {
          sendJson(res, 503, { error: 'crew window unavailable' })
          return
        }
        const requestId = randomUUID()
        const reply = new Promise<string>((resolve, reject) => {
          const timer = setTimeout(() => {
            pendingReplies.delete(requestId)
            reject(new Error('ask timed out waiting for the agent turn'))
          }, 180_000)
          pendingReplies.set(requestId, { resolve, timer })
        })
        win.webContents.send('crew:ask', {
          requestId,
          from: parsed.from ?? 'unknown',
          to: parsed.to,
          message: parsed.message,
          tool: isAsk ? 'ask' : parsed.tool,
          args: parsed.args ?? {}
        })
        try {
          const text = await reply
          sendJson(res, 200, { ok: true, response: text })
        } catch (error) {
          sendJson(res, 504, { error: error instanceof Error ? error.message : String(error) })
        }
        return
      }
      sendJson(res, 404, { error: 'not found' })
    })().catch((error) => {
      sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) })
    })
  })
  server.listen(0, '127.0.0.1')
  server.on('listening', () => {
    const address = server.address()
    if (state && typeof address === 'object' && address) {
      state.port = address.port
    }
  })

  ipcMain.handle('crew:bridge-info', () =>
    state ? { port: state.port, token: state.token } : null
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

  state = { port: 0, token, getMainWindow }
  return { port: 0, token }
}

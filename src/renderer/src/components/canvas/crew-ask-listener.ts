import { useCrewCanvas } from './canvas-store'
import { agentPtyOf, agentTerminalOf } from './agent-registry'
import { runBrowserTool } from './crew-ask-browser'
import { describeCapabilities, spawnConnectedNode } from './crew-ask-spawn'
import { orchestrateFromCanvas } from './crew-ask-orchestrate'
import { terminalRun } from './crew-ask-terminal'
import { wrapTerminalBracketedPasteText } from '../terminal-pane/terminal-bracketed-paste'
import type { CrewCanvasNode } from './canvas-store'

// Same wire shape as Orca's native agent-prompt delivery: bracketed-paste
// payload, a settle pause so the TUI ingests it, then the submit byte.
const AGENT_PROMPT_SUBMIT_DELAY_MS = 500

// Only these data keys cross the spawn boundary — the agent never sets cwd,
// sizes or raw node internals from the bridge.
function sanitizeSpawnArgs(kind: string, args: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  if (typeof args.label === 'string' && args.label.trim()) {
    out.label = args.label.trim()
  }
  if (kind === 'agent') {
    const agentKind = String(args.agentKind ?? 'claude')
    out.agentKind = ['claude', 'codex', 'kimi'].includes(agentKind) ? agentKind : 'claude'
    if (typeof args.role === 'string' && args.role.trim()) {
      out.role = args.role.trim()
    }
  }
  if (kind === 'browser' && typeof args.url === 'string' && args.url.trim()) {
    out.url = args.url.trim()
  }
  if (kind === 'note' && typeof args.text === 'string') {
    out.text = args.text
  }
  return out
}

// Crew tools — the agent-facing capabilities of the canvas. An agent calls
// the bridge (curl taught in its spawn preamble); the bridge forwards here;
// this dispatcher enforces THE EDGE AS THE PERMISSION: a tool only runs
// against a node directly connected to the calling agent. Nodes live across
// every canvas tab, so lookups aggregate all tabs.

const HARD_CAP_MS = 150_000

type AskPayload = {
  requestId: string
  from: string
  to?: string
  message?: string
  tool?: string
  args?: Record<string, unknown>
}

type LocatedNode = { node: CrewCanvasNode; tabId: string }

let installed = false

export function installCrewAskListener(): void {
  if (installed) {
    return
  }
  installed = true
  window.api.crew.onAsk((payload) => {
    void dispatch(payload)
  })
}

async function dispatch(payload: AskPayload): Promise<void> {
  const reply = (text: string) =>
    window.api.crew.sendAskReply({ requestId: payload.requestId, text })
  try {
    reply(await route(payload))
  } catch (error) {
    reply(`erro: ${error instanceof Error ? error.message : String(error)}`)
  }
}

function everyNode(): LocatedNode[] {
  return Object.entries(useCrewCanvas.getState().canvases).flatMap(([tabId, graph]) =>
    graph.nodes.map((node) => ({ node, tabId }))
  )
}

function findAgentNode(label: string): LocatedNode | undefined {
  const matches = everyNode().filter(
    ({ node }) =>
      node.data.kind === 'agent' &&
      String(node.data.label ?? node.data.agentKind ?? '').toLowerCase() ===
        label.trim().toLowerCase()
  )
  if (matches.length <= 1) {
    return matches[0]
  }
  // Why: labels collide across canvases (two "claude" in different tabs, dead
  // nodes in the unmounted global view). Only a spawned agent — live PTY in
  // the registry — can answer, so it wins the address.
  return matches.find(({ node }) => agentPtyOf(node.id) !== null) ?? matches[0]
}

// Nodes of a given kind directly connected to `nodeId` within its own tab.
function connectedOfKind(nodeId: string, kind: string): LocatedNode[] {
  const home = everyNode().find(({ node }) => node.id === nodeId)
  if (!home) {
    return []
  }
  const graph = useCrewCanvas.getState().canvases[home.tabId]
  if (!graph) {
    return []
  }
  return graph.edges
    .filter((e) => e.source === nodeId || e.target === nodeId)
    .map((e) => graph.nodes.find((n) => n.id === (e.source === nodeId ? e.target : e.source)))
    .filter((n): n is CrewCanvasNode => Boolean(n) && n!.data.kind === kind)
    .map((node) => ({ node, tabId: home.tabId }))
}

async function route(payload: AskPayload): Promise<string> {
  const tool = payload.tool ?? 'ask'
  const args = payload.args ?? {}

  if (tool === 'graph') {
    return JSON.stringify(
      Object.entries(useCrewCanvas.getState().canvases).map(([tabId, graph]) => ({
        tabId,
        nodes: graph.nodes.map((n) => ({
          id: n.id,
          kind: n.data.kind,
          label: n.data.label ?? n.data.agentKind ?? n.data.kind
        })),
        edges: graph.edges.map((e) => ({ source: e.source, target: e.target }))
      }))
    )
  }

  const caller = findAgentNode(payload.from)
  if (!caller) {
    return `erro: agente chamador "${payload.from}" não encontrado no canvas`
  }

  if (tool === 'capabilities') {
    const graph = useCrewCanvas.getState().canvases[caller.tabId]
    return describeCapabilities(caller.node, graph?.edges ?? [], graph?.nodes ?? [])
  }

  if (tool.endsWith('.spawn')) {
    const kind = tool.slice(0, -'.spawn'.length)
    return spawnConnectedNode(caller.node, caller.tabId, kind, sanitizeSpawnArgs(kind, args))
  }

  if (tool === 'orchestrate') {
    return orchestrateFromCanvas(caller.node, caller.tabId, args)
  }

  if (tool === 'ask') {
    return askPeer(
      payload.from,
      payload.to ?? String(args.to ?? ''),
      payload.message ?? String(args.message ?? '')
    )
  }

  if (tool.startsWith('browser.')) {
    const browser = connectedOfKind(caller.node.id, 'browser')[0]
    if (!browser) {
      return 'erro: nenhum navegador conectado a você — peça ao usuário pra ligar uma linha'
    }
    return runBrowserTool(browser.node.id, tool, args)
  }

  if (tool.startsWith('note.')) {
    const note = connectedOfKind(caller.node.id, 'note')[0]
    if (!note) {
      return 'erro: nenhuma nota conectada a você'
    }
    if (tool === 'note.read') {
      return String(note.node.data.text ?? '(nota vazia)')
    }
    if (tool === 'note.write') {
      const text = String(args.text ?? '')
      useCrewCanvas.getState().updateNodeData(note.tabId, note.node.id, { text })
      return `nota atualizada (${text.length} chars)`
    }
    return `erro: tool desconhecida ${tool}`
  }

  if (tool.startsWith('todo.')) {
    const todo = connectedOfKind(caller.node.id, 'todo')[0]
    if (!todo) {
      return 'erro: nenhum todo conectado a você'
    }
    return todoTool(todo.tabId, todo.node.id, tool, args)
  }

  if (tool === 'terminal.run') {
    const terminal = connectedOfKind(caller.node.id, 'terminal')[0]
    if (!terminal) {
      return 'erro: nenhum terminal conectado a você'
    }
    return terminalRun(terminal.node.id, String(args.command ?? ''))
  }

  return `erro: tool desconhecida "${tool}"`
}

async function askPeer(from: string, to: string, message: string): Promise<string> {
  const target = findAgentNode(to)
  if (!target) {
    return `erro: nenhum agente chamado "${to}" no canvas`
  }
  const ptyId = agentPtyOf(target.node.id)
  const term = agentTerminalOf(target.node.id)
  if (!ptyId || !term) {
    return `erro: o agente "${to}" não tem terminal vivo (respawn ou aguarde o boot)`
  }

  // Native agent-prompt delivery (same wire format as Orca's own agent
  // terminals): bracketed-paste payload, settle pause, then the submit byte.
  window.api.pty.write(ptyId, wrapTerminalBracketedPasteText(`[mensagem de ${from}] ${message}`))
  await new Promise((resolve) => setTimeout(resolve, AGENT_PROMPT_SUBMIT_DELAY_MS))
  window.api.pty.write(ptyId, '\r')

  const readScreen = (): string => {
    const lines: string[] = []
    const buffer = term.buffer.active
    for (let i = buffer.length - 1; i >= 0 && lines.length < 80; i--) {
      const text = buffer.getLine(i)?.translateToString(true).trimEnd() ?? ''
      if (text.trim().length > 0) {
        lines.unshift(text)
      }
    }
    return lines.join('\n')
  }
  const marker = `[mensagem de ${from}]`
  const tailFromMarker = (screen: string): string => {
    const at = screen.lastIndexOf(marker)
    return at >= 0 ? screen.slice(at + marker.length) : screen
  }

  let last = ''
  let stable = 0
  const started = Date.now()
  while (Date.now() - started < HARD_CAP_MS) {
    await new Promise((resolve) => setTimeout(resolve, 700))
    const current = tailFromMarker(readScreen())
    if (current === last) {
      stable += 1
    } else {
      stable = 0
      last = current
    }
    if (stable >= 4 && Date.now() - started > 2500) {
      break
    }
  }
  const cleaned = last
    .split('\n')
    .filter((line) => {
      const t = line.trim()
      return t.length > 0 && t !== '❯' && !t.startsWith('[mensagem de')
    })
    .join('\n')
    .trim()
  return cleaned.length > 0 ? cleaned : '(o agente não produziu saída neste turno)'
}

function todoTool(
  tabId: string,
  nodeId: string,
  tool: string,
  args: Record<string, unknown>
): string {
  const graph = useCrewCanvas.getState().canvases[tabId]
  const node = graph?.nodes.find((n) => n.id === nodeId)
  type Item = { id: string; text: string; done: boolean }
  const items = (node?.data.items as Item[] | undefined) ?? []
  if (tool === 'todo.list') {
    if (items.length === 0) {
      return '(todo vazio)'
    }
    return items.map((i) => `${i.done ? '[x]' : '[ ]'} ${i.id.slice(0, 8)} ${i.text}`).join('\n')
  }
  if (tool === 'todo.add') {
    const text = String(args.text ?? '').trim()
    if (!text) {
      return 'erro: text obrigatório'
    }
    const next = [...items, { id: crypto.randomUUID(), text, done: false }]
    useCrewCanvas.getState().updateNodeData(tabId, nodeId, { items: next })
    return `adicionado (${next.length} itens)`
  }
  if (tool === 'todo.toggle') {
    const prefix = String(args.itemId ?? '')
    const item = items.find((i) => i.id.startsWith(prefix))
    if (!item) {
      return `erro: item "${prefix}" não encontrado (use o prefixo do todo.list)`
    }
    const next = items.map((i) => (i.id === item.id ? { ...i, done: !i.done } : i))
    useCrewCanvas.getState().updateNodeData(tabId, nodeId, { items: next })
    return `${item.done ? 'reaberto' : 'concluído'}: ${item.text}`
  }
  return `erro: tool desconhecida ${tool}`
}

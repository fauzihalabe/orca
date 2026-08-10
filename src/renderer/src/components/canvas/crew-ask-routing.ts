import { useCrewCanvas } from './canvas-store'
import { runBrowserTool } from './crew-ask-browser'
import { describeCapabilities, spawnConnectedNode } from './crew-ask-spawn'
import { orchestrateFromCanvas } from './crew-ask-orchestrate'
import { terminalRun } from './crew-ask-terminal'
import {
  nativeRuntimeResult,
  runSimulatorTool,
  selectBrowserForNetwork,
  timerTool
} from './crew-ask-native'
import { askPeer } from './crew-ask-peer'
import { todoTool } from './crew-ask-todo'
import { connectedOfKind, findAgentNode, type LocatedNode } from './crew-ask-graph'

export type AskPayload = {
  requestId: string
  from: string
  to?: string
  message?: string
  tool?: string
  args?: Record<string, unknown>
}

export async function dispatchCrewAsk(payload: AskPayload): Promise<void> {
  const reply = (text: string) =>
    window.api.crew.sendAskReply({ requestId: payload.requestId, text })
  try {
    reply(await route(payload))
  } catch (error) {
    reply(`erro: ${error instanceof Error ? error.message : String(error)}`)
  }
}

// Only these data keys cross the spawn boundary — the agent never sets cwd,
// sizes or raw node internals from the bridge.
export function sanitizeSpawnArgs(
  kind: string,
  args: Record<string, unknown>
): Record<string, unknown> {
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
  if (kind === 'simulator') {
    for (const key of ['device', 'deviceUdid']) {
      if (typeof args[key] === 'string' && args[key].trim()) {
        out[key] = args[key]
      }
    }
  }
  return out
}

function selectConnectedNode(
  caller: LocatedNode,
  kind: string,
  args: Record<string, unknown>
): LocatedNode | undefined {
  const connected = connectedOfKind(caller.node.id, kind)
  const requestedId = typeof args.nodeId === 'string' ? args.nodeId.trim() : ''
  if (requestedId) {
    return connected.find(({ node }) => node.id === requestedId)
  }
  return connected.length === 1 ? connected[0] : undefined
}

function connectedNodeError(
  caller: LocatedNode,
  kind: string,
  args: Record<string, unknown>,
  noun: string
): string | null {
  const connected = connectedOfKind(caller.node.id, kind)
  const requestedId = typeof args.nodeId === 'string' ? args.nodeId.trim() : ''
  if (requestedId && !connected.some(({ node }) => node.id === requestedId)) {
    return `erro: o node ${requestedId} não é um ${noun} conectado a você`
  }
  if (connected.length === 0) {
    return `erro: nenhum ${noun} conectado a você — peça ao usuário pra ligar uma linha`
  }
  if (connected.length > 1 && !requestedId) {
    const ids = connected.map(({ node }) => node.id).join(', ')
    return `erro: há ${connected.length} ${noun}s conectados; informe args.nodeId (um dos: ${ids})`
  }
  return null
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
    const error = connectedNodeError(caller, 'browser', args, 'navegador')
    if (error) {
      return error
    }
    const browser = selectConnectedNode(caller, 'browser', args)!
    return runBrowserTool(browser.node.id, tool, args)
  }

  if (tool.startsWith('network.')) {
    const error = connectedNodeError(caller, 'network', args, 'network')
    if (error) {
      return error
    }
    const network = selectConnectedNode(caller, 'network', args)!
    const browser = selectBrowserForNetwork(network, args, connectedOfKind)
    if (!browser) {
      return 'erro: o network precisa estar conectado a um browser para observar o tráfego'
    }
    if (!['network.read', 'network.snapshot', 'network.list'].includes(tool)) {
      return `erro: tool desconhecida ${tool}`
    }
    return nativeRuntimeResult(
      'browser.network',
      {
        page:
          typeof browser.node.data.browserPageId === 'string' &&
          browser.node.data.browserPageId.trim().length > 0
            ? browser.node.data.browserPageId
            : `canvas-${browser.node.id}`,
        limit: typeof args.limit === 'number' ? args.limit : 100
      },
      'erro no network nativo'
    )
  }

  if (tool.startsWith('simulator.')) {
    const error = connectedNodeError(caller, 'simulator', args, 'simulador')
    if (error) {
      return error
    }
    const simulator = selectConnectedNode(caller, 'simulator', args)!
    return runSimulatorTool(simulator.node, tool, args)
  }

  if (tool.startsWith('note.')) {
    const error = connectedNodeError(caller, 'note', args, 'nota')
    if (error) {
      return error
    }
    const note = selectConnectedNode(caller, 'note', args)!
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
    const error = connectedNodeError(caller, 'todo', args, 'todo')
    if (error) {
      return error
    }
    const todo = selectConnectedNode(caller, 'todo', args)!
    return todoTool(todo.tabId, todo.node.id, tool, args)
  }

  if (tool === 'terminal.run') {
    const error = connectedNodeError(caller, 'terminal', args, 'terminal')
    if (error) {
      return error
    }
    const terminal = selectConnectedNode(caller, 'terminal', args)!
    return terminalRun(terminal.node.id, String(args.command ?? ''))
  }

  if (tool.startsWith('timer.')) {
    const error = connectedNodeError(caller, 'timer', args, 'timer')
    if (error) {
      return error
    }
    const timer = selectConnectedNode(caller, 'timer', args)!
    return timerTool(timer.tabId, timer.node.id, tool, args)
  }

  return `erro: tool desconhecida "${tool}"`
}

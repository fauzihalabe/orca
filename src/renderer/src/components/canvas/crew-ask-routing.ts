import { useCrewCanvas } from './canvas-store'
import { spawnConnectedNode } from './crew-ask-spawn'

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

async function route(payload: AskPayload): Promise<string> {
  const tool = payload.tool ?? 'ask'
  const args = payload.args ?? {}
  const canvases = useCrewCanvas.getState().canvases
  const callers = Object.entries(canvases).flatMap(([tabId, graph]) =>
    graph.nodes
      .filter((node) => {
        if (node.data.kind !== 'agent') {
          return false
        }
        if (node.id === payload.from) {
          return true
        }
        const requested = payload.from.trim().toLowerCase()
        return [node.data.label, node.data.role, node.data.agentKind]
          .map((value) =>
            String(value ?? '')
              .trim()
              .toLowerCase()
          )
          .includes(requested)
      })
      .map((node) => ({ node, tabId }))
  )
  const exact = callers.filter(({ node }) => node.id === payload.from)
  const caller = exact.length === 1 ? exact[0] : callers.length === 1 ? callers[0] : undefined
  if (!caller) {
    return `erro: agente chamador "${payload.from}" não encontrado no canvas`
  }

  if (tool.endsWith('.spawn')) {
    const kind = tool.slice(0, -'.spawn'.length)
    const preferredNodeId =
      typeof args.nativeReuseNodeId === 'string' ? args.nativeReuseNodeId : undefined
    return spawnConnectedNode(
      caller.node,
      caller.tabId,
      kind,
      sanitizeSpawnArgs(kind, args),
      preferredNodeId
    )
  }
  return `erro: a operação "${tool}" deve ser executada pelo runtime nativo do Orca`
}

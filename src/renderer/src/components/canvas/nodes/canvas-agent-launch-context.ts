import { getCrewCanvas, type CrewCanvasNode, type CrewCanvasNodeData } from '../canvas-store'
import type { PeerInfo } from './agent-command'

export type CanvasAgentLaunchNodeData = CrewCanvasNodeData & {
  cliSessionId?: string
  cliResumeCommand?: string
  providerSession?: unknown
  agentLaunchConfig?: unknown
  linearIssueId?: string
  paneKey?: string
  mirrorTabId?: string
  mirrorLeafId?: string
  mirrorWorktreeId?: string
  canvasWorktreeId?: string
  ptySessionId?: string
}

function connectedNodes(tabId: string, nodeId: string): CrewCanvasNode[] {
  const graph = getCrewCanvas(tabId)
  return graph.edges.flatMap((edge) => {
    if (edge.source !== nodeId && edge.target !== nodeId) {
      return []
    }
    const connectedNodeId = edge.source === nodeId ? edge.target : edge.source
    const node = graph.nodes.find((candidate) => candidate.id === connectedNodeId)
    return node ? [node] : []
  })
}

async function resolveLinearContext(
  linearIssueId: string | undefined
): Promise<string | undefined> {
  if (!linearIssueId) {
    return undefined
  }
  try {
    const issue = await window.api.linear.getIssue({ id: linearIssueId })
    if (!issue) {
      return undefined
    }
    return (
      `Issue Linear linkada a você: ${issue.identifier} — ${issue.title} (estado: ${issue.state.name})\n` +
      `${issue.url}\n${issue.description?.trim() ? `${issue.description.trim()}\n` : ''}` +
      `Ao trabalhar nela, atualize-a pela CLI do Orca (já no PATH): \`orca linear\` — comente o progresso e mova o estado ao concluir.`
    )
  } catch {
    return undefined
  }
}

export async function resolveCanvasAgentLaunchContext(tabId: string, nodeId: string) {
  const linked = connectedNodes(tabId, nodeId)
  const fresh = getCrewCanvas(tabId).nodes.find((node) => node.id === nodeId)?.data as
    | CanvasAgentLaunchNodeData
    | undefined
  return {
    bridge: await window.api.crew.getBridgeInfo({ nodeId }),
    peers: linked
      .filter((node) => node.data.kind === 'agent')
      .map(
        (node): PeerInfo => ({
          label: String(node.data.label ?? node.data.agentKind ?? 'agente'),
          role: String(node.data.role ?? '')
        })
      ),
    connectedNotes: linked
      .filter((node) => node.data.kind === 'note' && String(node.data.text ?? '').trim().length > 0)
      .map((node) => String(node.data.text)),
    connectedKinds: [...new Set(linked.map((node) => String(node.data.kind)))],
    connectedBrowserPageIds: linked
      .filter((node) => node.data.kind === 'browser')
      .map((node) => {
        const pageId = node.data.browserPageId
        return typeof pageId === 'string' && pageId.trim().length > 0 ? pageId : `canvas-${node.id}`
      }),
    fresh,
    linearContext: await resolveLinearContext(fresh?.linearIssueId)
  }
}

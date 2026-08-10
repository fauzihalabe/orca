import { useCrewCanvas } from './canvas-store'
import { agentPtyOf } from './agent-registry'
import type { CrewCanvasNode } from './canvas-store'

export type LocatedNode = { node: CrewCanvasNode; tabId: string }

function everyNode(): LocatedNode[] {
  return Object.entries(useCrewCanvas.getState().canvases).flatMap(([tabId, graph]) =>
    graph.nodes.map((node) => ({ node, tabId }))
  )
}

export function findAgentNode(labelOrId: string): LocatedNode | undefined {
  const normalized = labelOrId.trim()
  const exactId = everyNode().find(
    ({ node }) => node.data.kind === 'agent' && node.id === normalized
  )
  if (exactId) {
    return exactId
  }
  const matches = everyNode().filter(
    ({ node }) =>
      node.data.kind === 'agent' &&
      String(node.data.label ?? node.data.agentKind ?? '').toLowerCase() ===
        normalized.toLowerCase()
  )
  if (matches.length <= 1) {
    return matches[0]
  }
  // Labels collide across canvases. Only a spawned agent — live PTY in the
  // registry — can answer, so it wins the address.
  return matches.find(({ node }) => agentPtyOf(node.id) !== null) ?? matches[0]
}

// Nodes of a given kind directly connected to `nodeId` within its own tab.
export function connectedOfKind(nodeId: string, kind: string): LocatedNode[] {
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

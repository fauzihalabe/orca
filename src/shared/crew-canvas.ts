/**
 * The transport shape of a Canvas graph.
 *
 * This deliberately does not import React Flow. The main process keeps this
 * representation as the durable capability graph, while the renderer maps it
 * to/from React Flow nodes. Keeping the wire type here prevents the permission
 * boundary from depending on a renderer-only package.
 */

export type CrewCanvasNodeSnapshot = {
  id: string
  type?: string
  position?: { x: number; y: number }
  width?: number
  height?: number
  data: Record<string, unknown>
  [key: string]: unknown
}

/**
 * React Flow adds gesture/measurement fields while a node is moving or being
 * resized. They are renderer-local state and must never survive a restart.
 */
export function withoutCrewCanvasTransientNodeState(
  value: CrewCanvasNodeSnapshot
): CrewCanvasNodeSnapshot {
  const node: CrewCanvasNodeSnapshot = { ...value, data: { ...value.data } }
  delete node.selected
  delete node.dragging
  delete node.resizing
  delete node.measured
  return node
}

export type CrewCanvasEdgeSnapshot = {
  id?: string
  source: string
  target: string
  type?: string
  data?: Record<string, unknown>
  [key: string]: unknown
}

/** Selection and the one-shot connection animation belong only to this paint. */
export function withoutCrewCanvasTransientEdgeState(
  value: CrewCanvasEdgeSnapshot
): CrewCanvasEdgeSnapshot {
  const edge: CrewCanvasEdgeSnapshot = {
    ...value,
    data: value.data ? { ...value.data } : undefined
  }
  delete edge.selected
  if (edge.data) {
    delete edge.data.newborn
    if (Object.keys(edge.data).length === 0) {
      delete edge.data
    }
  }
  return edge
}

export type CrewCanvasGraphSnapshot = {
  nodes: CrewCanvasNodeSnapshot[]
  edges: CrewCanvasEdgeSnapshot[]
  viewport?: { x: number; y: number; zoom: number }
  edgeStyle?: string
}

export type CrewCanvasTabSnapshot = {
  tabId: string
  worktreeId: string | null
  graph: CrewCanvasGraphSnapshot
}

export type CrewCanvasPersistedState = {
  version: 1
  revision: number
  tabs: Record<string, CrewCanvasTabSnapshot>
}

export type CrewCanvasSyncResult =
  | { accepted: true; revision: number }
  | { accepted: false; conflict: true; state: CrewCanvasPersistedState }

export type CrewCanvasUpdateEvent = {
  state: CrewCanvasPersistedState
  reason: 'hydrate' | 'mutation' | 'conflict'
}

/**
 * One agent request admitted by the persisted Canvas capability graph.
 *
 * The native runtime RPC transports this shape; the broker resolves the
 * caller's live edges before dispatching any node action.
 */
export type CrewCanvasRuntimeRequest = {
  requestId: string
  from: string
  to?: string
  message?: string
  tool?: string
  args?: Record<string, unknown>
}

export type CrewCanvasBridgeDescriptor = {
  version: 1
  agentId: string
  port: number
  token: string
  mainProcessId: number
  issuedAt: number
}

export const CREW_CANVAS_BRIDGE_DESCRIPTOR_DIRECTORY = 'agent-bridges'

/**
 * Stable filename for the live bridge descriptor of one Canvas agent.
 *
 * Canvas agents can outlive Electron's main process because their PTY belongs
 * to the Orca daemon. The descriptor path therefore stays stable while its
 * port and credential are atomically refreshed after every app restart.
 */
export function crewCanvasBridgeDescriptorFilename(agentId: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < agentId.length; index += 1) {
    hash ^= agentId.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  const safePrefix = agentId.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 80) || 'agent'
  return `${safePrefix}-${(hash >>> 0).toString(16).padStart(8, '0')}.json`
}

export const EMPTY_CREW_CANVAS_STATE: CrewCanvasPersistedState = {
  version: 1,
  revision: 0,
  tabs: {}
}

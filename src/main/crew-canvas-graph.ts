import type {
  CrewCanvasEdgeSnapshot,
  CrewCanvasGraphSnapshot,
  CrewCanvasNodeSnapshot,
  CrewCanvasPersistedState,
  CrewCanvasTabSnapshot
} from '../shared/crew-canvas'
import {
  EMPTY_CREW_CANVAS_STATE,
  withoutCrewCanvasTransientEdgeState,
  withoutCrewCanvasTransientNodeState
} from '../shared/crew-canvas'

const MAX_NODES_PER_TAB = 256
const MAX_EDGES_PER_TAB = 512
const MAX_GRAPH_BYTES = 8 * 1024 * 1024
const CANVAS_NODE_KINDS = new Set([
  'agent',
  'browser',
  'terminal',
  'simulator',
  'network',
  'note',
  'todo',
  'timer'
])

export type LocatedCanvasNode = {
  node: CrewCanvasNodeSnapshot
  tab: CrewCanvasTabSnapshot
}

export function isCrewCanvasRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

export function cloneCrewCanvasValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

export function crewCanvasText(value: unknown): string {
  return typeof value === 'string' ? value : String(value ?? '')
}

export function crewCanvasJson(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value ?? null)
}

export function isValidCrewCanvasId(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= 240
}

function sanitizeNode(value: unknown): CrewCanvasNodeSnapshot | null {
  if (
    !isCrewCanvasRecord(value) ||
    !isValidCrewCanvasId(value.id) ||
    !isCrewCanvasRecord(value.data)
  ) {
    return null
  }
  const node = withoutCrewCanvasTransientNodeState(
    cloneCrewCanvasValue(value) as CrewCanvasNodeSnapshot
  )
  if (typeof node.data.kind !== 'string' || !CANVAS_NODE_KINDS.has(node.data.kind)) {
    return null
  }
  if (node.position && (!Number.isFinite(node.position.x) || !Number.isFinite(node.position.y))) {
    return null
  }
  return node
}

function sanitizeEdge(value: unknown): CrewCanvasEdgeSnapshot | null {
  if (
    !isCrewCanvasRecord(value) ||
    !isValidCrewCanvasId(value.source) ||
    !isValidCrewCanvasId(value.target) ||
    value.source === value.target
  ) {
    return null
  }
  return withoutCrewCanvasTransientEdgeState(cloneCrewCanvasValue(value) as CrewCanvasEdgeSnapshot)
}

export function sanitizeCrewCanvasGraph(value: unknown): CrewCanvasGraphSnapshot {
  if (!isCrewCanvasRecord(value)) {
    throw new Error('Canvas graph must be an object')
  }
  const rawNodes = Array.isArray(value.nodes) ? value.nodes : []
  const rawEdges = Array.isArray(value.edges) ? value.edges : []
  if (rawNodes.length > MAX_NODES_PER_TAB || rawEdges.length > MAX_EDGES_PER_TAB) {
    throw new Error('Canvas graph exceeds the node or edge limit')
  }
  const nodes = rawNodes.map(sanitizeNode)
  if (nodes.some((node) => node === null)) {
    throw new Error('Canvas graph contains an invalid node')
  }
  const nodeIds = new Set(nodes.map((node) => node!.id))
  if (nodeIds.size !== nodes.length) {
    throw new Error('Canvas graph contains duplicate node ids')
  }
  const edges = rawEdges.map(sanitizeEdge)
  if (edges.some((edge) => edge === null)) {
    throw new Error('Canvas graph contains an invalid edge')
  }
  const edgeKeys = new Set<string>()
  for (const edge of edges) {
    if (!nodeIds.has(edge!.source) || !nodeIds.has(edge!.target)) {
      throw new Error('Canvas graph contains an edge to a missing node')
    }
    const key = [edge!.source, edge!.target].sort().join('\0')
    if (edgeKeys.has(key)) {
      throw new Error('Canvas graph contains duplicate connections')
    }
    const sourceKind = String(nodes.find((node) => node!.id === edge!.source)!.data.kind)
    const targetKind = String(nodes.find((node) => node!.id === edge!.target)!.data.kind)
    const pairAllowed =
      sourceKind === 'agent' ||
      targetKind === 'agent' ||
      (sourceKind === 'browser' && targetKind === 'network') ||
      (sourceKind === 'network' && targetKind === 'browser')
    if (!pairAllowed) {
      throw new Error(`Canvas connection ${edge!.source} → ${edge!.target} is not allowed`)
    }
    edgeKeys.add(key)
  }
  const graph = {
    nodes: nodes as CrewCanvasNodeSnapshot[],
    edges: edges as CrewCanvasEdgeSnapshot[],
    viewport: isCrewCanvasRecord(value.viewport)
      ? {
          x: Number(value.viewport.x) || 0,
          y: Number(value.viewport.y) || 0,
          zoom: Number(value.viewport.zoom) || 1
        }
      : { x: 0, y: 0, zoom: 1 },
    edgeStyle: typeof value.edgeStyle === 'string' ? value.edgeStyle : 'lineit'
  } satisfies CrewCanvasGraphSnapshot
  if (Buffer.byteLength(JSON.stringify(graph), 'utf8') > MAX_GRAPH_BYTES) {
    throw new Error('Canvas graph is too large')
  }
  return graph
}

export function parseCrewCanvasState(value: unknown): CrewCanvasPersistedState {
  if (!isCrewCanvasRecord(value) || value.version !== 1 || !isCrewCanvasRecord(value.tabs)) {
    return cloneCrewCanvasValue(EMPTY_CREW_CANVAS_STATE)
  }
  const tabs: Record<string, CrewCanvasTabSnapshot> = {}
  for (const [tabId, rawTab] of Object.entries(value.tabs)) {
    if (!isValidCrewCanvasId(tabId) || !isCrewCanvasRecord(rawTab)) {
      continue
    }
    try {
      tabs[tabId] = {
        tabId,
        worktreeId: typeof rawTab.worktreeId === 'string' ? rawTab.worktreeId : null,
        graph: sanitizeCrewCanvasGraph(rawTab.graph)
      }
    } catch {
      // One corrupt tab must not make every other Canvas unavailable.
    }
  }
  return {
    version: 1,
    revision: Number.isInteger(value.revision) ? Number(value.revision) : 0,
    tabs
  }
}

export function crewCanvasNodeLabel(node: CrewCanvasNodeSnapshot): string {
  return crewCanvasText(
    node.data.label ??
      node.data.title ??
      (node.data.kind === 'agent' ? node.data.role : undefined) ??
      node.data.agentKind ??
      node.data.kind
  )
}

export function crewCanvasAgentAliases(node: CrewCanvasNodeSnapshot): string[] {
  return [node.id, node.data.label, node.data.role, node.data.agentKind]
    .map((value) => crewCanvasText(value).trim().toLowerCase())
    .filter(Boolean)
}

export function crewCanvasNodeTools(kind: string): string[] {
  const tools: Record<string, string[]> = {
    agent: ['canvas_ask', 'orchestrate'],
    browser: [
      'browser.snapshot',
      'browser.screenshot',
      'browser.navigate',
      'browser.back',
      'browser.forward',
      'browser.reload',
      'browser.click',
      'browser.fill',
      'browser.type',
      'browser.hover',
      'browser.drag',
      'browser.scroll',
      'browser.keypress',
      'browser.eval',
      'browser.wait',
      'browser.console',
      'browser.network',
      'browser.viewport',
      'browser.pdf',
      'browser.download',
      'browser.upload'
    ],
    terminal: ['terminal.read', 'terminal.send', 'terminal.run'],
    simulator: [
      'simulator.ax',
      'simulator.tap',
      'simulator.gesture',
      'simulator.type',
      'simulator.button',
      'simulator.rotate',
      'simulator.exec',
      'simulator.logcat',
      'simulator.install',
      'simulator.launch',
      'simulator.permissions'
    ],
    network: ['network.read', 'network.snapshot', 'network.list'],
    note: ['note.read', 'note.write'],
    todo: ['todo.list', 'todo.add', 'todo.toggle'],
    timer: ['timer.read', 'timer.start', 'timer.pause', 'timer.stop', 'timer.reset']
  }
  return tools[kind] ?? []
}

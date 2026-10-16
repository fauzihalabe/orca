import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { useMemo } from 'react'
import type { Edge, Node, Viewport } from '@xyflow/react'
import { closeCanvasTerminalMirror } from './nodes/canvas-agent-session'
import { closeCanvasBrowserMirror } from './nodes/canvas-browser-session'

// Crew canvas state — one graph PER CANVAS TAB (keyed by tabId, so each worktree
// tab owns an independent surface). The 'default' key backs the global
// TopLevelView canvas. Everything the bridge and nodes read flows from here.

export type CrewCanvasNodeData = {
  kind: 'agent' | 'browser' | 'terminal' | 'simulator' | 'network' | 'note' | 'todo' | 'timer'
  [key: string]: unknown
}

export type CrewCanvasNode = Node<CrewCanvasNodeData>

export type CrewEdgeStyle = 'lineit' | 'fine' | 'dash'

export type CrewCanvasGraph = {
  nodes: CrewCanvasNode[]
  edges: Edge[]
  viewport: Viewport
  edgeStyle: CrewEdgeStyle
}

const EMPTY_GRAPH: CrewCanvasGraph = {
  nodes: [],
  edges: [],
  viewport: { x: 0, y: 0, zoom: 1 },
  edgeStyle: 'lineit'
}

type CrewCanvasState = {
  canvases: Record<string, CrewCanvasGraph>
  setGraph: (tabId: string, nodes: CrewCanvasNode[], edges: Edge[]) => void
  addNode: (tabId: string, node: CrewCanvasNode) => void
  removeElements: (tabId: string, nodeIds: string[], edgeIds: string[]) => void
  updateNodeData: (tabId: string, nodeId: string, patch: Record<string, unknown>) => void
  resizeNode: (tabId: string, nodeId: string, size: { width: number; height: number }) => void
  setEdgeStyle: (tabId: string, style: CrewEdgeStyle) => void
  setViewport: (tabId: string, viewport: Viewport) => void
  removeCanvas: (tabId: string) => void
}

let removeCanvasFromMain: ((tabId: string) => void) | null = null
let syncCanvasToMain: ((tabId: string, graph: CrewCanvasGraph) => void) | null = null

export function registerCrewCanvasMainRemoval(handler: (tabId: string) => void): void {
  removeCanvasFromMain = handler
}

export function registerCrewCanvasMainSync(
  handler: (tabId: string, graph: CrewCanvasGraph) => void
): void {
  syncCanvasToMain = handler
}

function publishGraphChange(tabId: string): void {
  const graph = useCrewCanvas.getState().canvases[tabId]
  if (graph) {
    syncCanvasToMain?.(tabId, graph)
  }
}

function patchGraph(
  canvases: Record<string, CrewCanvasGraph>,
  tabId: string,
  patch: Partial<CrewCanvasGraph>
): Record<string, CrewCanvasGraph> {
  const current = canvases[tabId] ?? EMPTY_GRAPH
  return { ...canvases, [tabId]: { ...current, ...patch } }
}

function closeRemovedNodeMirrors(previous: CrewCanvasNode[], next: CrewCanvasNode[]): void {
  const nextIds = new Set(next.map((node) => node.id))
  for (const node of previous) {
    if ((node.data.kind === 'agent' || node.data.kind === 'terminal') && !nextIds.has(node.id)) {
      closeCanvasTerminalMirror(node.data)
    }
    if (node.data.kind === 'browser' && !nextIds.has(node.id)) {
      closeCanvasBrowserMirror(node.data)
    }
  }
}

export const useCrewCanvas = create<CrewCanvasState>()(
  persist(
    (set) => ({
      canvases: {},
      setGraph: (tabId, nodes, edges) => {
        const previous = useCrewCanvas.getState().canvases[tabId]?.nodes ?? []
        closeRemovedNodeMirrors(previous, nodes)
        set((s) => ({ canvases: patchGraph(s.canvases, tabId, { nodes, edges }) }))
        publishGraphChange(tabId)
      },
      addNode: (tabId, node) => {
        set((s) => {
          const current = s.canvases[tabId] ?? EMPTY_GRAPH
          return {
            canvases: patchGraph(s.canvases, tabId, { nodes: [...current.nodes, node] })
          }
        })
        publishGraphChange(tabId)
      },
      removeElements: (tabId, nodeIds, edgeIds) => {
        const current = useCrewCanvas.getState().canvases[tabId] ?? EMPTY_GRAPH
        const nextNodes = current.nodes.filter((n) => !nodeIds.includes(n.id))
        closeRemovedNodeMirrors(current.nodes, nextNodes)
        set((s) => ({
          canvases: patchGraph(s.canvases, tabId, {
            nodes: nextNodes,
            edges: current.edges.filter(
              (e) =>
                !edgeIds.includes(e.id) &&
                !nodeIds.includes(e.source) &&
                !nodeIds.includes(e.target)
            )
          })
        }))
        publishGraphChange(tabId)
      },
      updateNodeData: (tabId, nodeId, patch) => {
        set((s) => {
          const current = s.canvases[tabId] ?? EMPTY_GRAPH
          return {
            canvases: patchGraph(s.canvases, tabId, {
              nodes: current.nodes.map((n) =>
                n.id === nodeId ? { ...n, data: { ...n.data, ...patch } } : n
              )
            })
          }
        })
        publishGraphChange(tabId)
      },
      resizeNode: (tabId, nodeId, size) => {
        set((s) => {
          const current = s.canvases[tabId] ?? EMPTY_GRAPH
          return {
            canvases: patchGraph(s.canvases, tabId, {
              nodes: current.nodes.map((n) => (n.id === nodeId ? { ...n, ...size } : n))
            })
          }
        })
        publishGraphChange(tabId)
      },
      setEdgeStyle: (tabId, edgeStyle) => {
        set((s) => ({ canvases: patchGraph(s.canvases, tabId, { edgeStyle }) }))
        publishGraphChange(tabId)
      },
      setViewport: (tabId, viewport) => {
        set((s) => ({ canvases: patchGraph(s.canvases, tabId, { viewport }) }))
        publishGraphChange(tabId)
      },
      // Why: closing the canvas tab drops its persisted graph and retires the
      // native Orca mirror tabs. The Canvas xterm is only a viewport; native
      // tab retirement owns PTY teardown.
      removeCanvas: (tabId) => {
        const current = useCrewCanvas.getState().canvases[tabId]
        if (!current) {
          return
        }
        for (const node of current.nodes) {
          if (node.data.kind === 'agent' || node.data.kind === 'terminal') {
            closeCanvasTerminalMirror(node.data)
          }
          if (node.data.kind === 'browser') {
            closeCanvasBrowserMirror(node.data)
          }
        }
        removeCanvasFromMain?.(tabId)
        set((s) => {
          if (!s.canvases[tabId]) {
            return s
          }
          const canvases = { ...s.canvases }
          delete canvases[tabId]
          return { canvases }
        })
      }
    }),
    {
      name: 'crew-canvas',
      // Migrate the pre-tabs single-graph shape into the 'default' canvas.
      migrate: (persisted) => {
        const value = persisted as Record<string, unknown> | undefined
        if (value && !value.canvases && Array.isArray(value.nodes)) {
          return {
            canvases: {
              default: {
                nodes: value.nodes ?? [],
                edges: value.edges ?? [],
                viewport: value.viewport ?? EMPTY_GRAPH.viewport,
                edgeStyle: value.edgeStyle ?? 'lineit'
              }
            }
          } as unknown as CrewCanvasState
        }
        return persisted as CrewCanvasState
      },
      version: 1
    }
  )
)

/** Read one tab's graph (never undefined). */
export function getCrewGraph(tabId: string): CrewCanvasGraph {
  return useCrewCanvas.getState().canvases[tabId] ?? EMPTY_GRAPH
}

/** Every graph across tabs — the bridge/listener aggregate over these. */
export function allCrewGraphs(): CrewCanvasGraph[] {
  return Object.values(useCrewCanvas.getState().canvases)
}

/** A tab-scoped view: the graph plus every action pre-bound to that tab. */
export type CrewCanvasTabStore = CrewCanvasGraph & {
  setGraph: (nodes: CrewCanvasNode[], edges: Edge[]) => void
  addNode: (node: CrewCanvasNode) => void
  removeElements: (nodeIds: string[], edgeIds: string[]) => void
  updateNodeData: (nodeId: string, patch: Record<string, unknown>) => void
  resizeNode: (nodeId: string, size: { width: number; height: number }) => void
  setEdgeStyle: (style: CrewEdgeStyle) => void
  setViewport: (viewport: Viewport) => void
}

function boundActions(tabId: string): Omit<CrewCanvasTabStore, keyof CrewCanvasGraph> {
  const s = useCrewCanvas.getState()
  return {
    setGraph: (nodes, edges) => s.setGraph(tabId, nodes, edges),
    addNode: (node) => s.addNode(tabId, node),
    removeElements: (nodeIds, edgeIds) => s.removeElements(tabId, nodeIds, edgeIds),
    updateNodeData: (nodeId, patch) => s.updateNodeData(tabId, nodeId, patch),
    resizeNode: (nodeId, size) => s.resizeNode(tabId, nodeId, size),
    setEdgeStyle: (style) => s.setEdgeStyle(tabId, style),
    setViewport: (viewport) => s.setViewport(tabId, viewport)
  }
}

function tabStoreOf(tabId: string): CrewCanvasTabStore {
  const g = useCrewCanvas.getState().canvases[tabId] ?? EMPTY_GRAPH
  return { ...g, ...boundActions(tabId) }
}

/** Non-reactive tab store (effects, spawns, listeners). */
export function getCrewCanvas(tabId: string): CrewCanvasTabStore {
  return tabStoreOf(tabId)
}

/** Reactive tab store — selector runs over the graph + bound actions. */
export function useCrewCanvasTab<T>(tabId: string, selector: (s: CrewCanvasTabStore) => T): T {
  // Bind actions once, then subscribe to the selector RESULT rather than the
  // whole graph. Browser/terminal nodes that only need an action must not
  // rerender their native surface for every unrelated drag or edge animation.
  const actions = useMemo(() => boundActions(tabId), [tabId])
  return useCrewCanvas((s) => selector({ ...(s.canvases[tabId] ?? EMPTY_GRAPH), ...actions }))
}

// Debug/e2e handle — lets devtools-driving tests address the store directly.
if (typeof window !== 'undefined') {
  ;(window as unknown as { __crewCanvas: typeof useCrewCanvas }).__crewCanvas = useCrewCanvas
}

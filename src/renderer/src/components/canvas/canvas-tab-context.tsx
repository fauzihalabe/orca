import { createContext, useContext, useMemo, type ReactNode } from 'react'
import {
  getCrewGraph,
  useCrewCanvas,
  type CrewCanvasNode,
  type CrewEdgeStyle
} from './canvas-store'
import type { Edge, Viewport } from '@xyflow/react'

// Which canvas tab + worktree a component tree belongs to. Every node/tool
// reads its graph through this — that's what makes each canvas tab an
// independent surface rooted at its own worktree directory.
type CanvasTabInfo = {
  tabId: string
  worktreeId: string | null
  worktreePath: string | null
}

const DEFAULT_INFO: CanvasTabInfo = { tabId: 'default', worktreeId: null, worktreePath: null }

const CanvasTabContext = createContext<CanvasTabInfo>(DEFAULT_INFO)

export function CanvasTabProvider({
  tabId,
  worktreeId,
  worktreePath,
  children
}: {
  tabId: string
  worktreeId?: string | null
  worktreePath?: string | null
  children: ReactNode
}) {
  const value = useMemo(
    () => ({ tabId, worktreeId: worktreeId ?? null, worktreePath: worktreePath ?? null }),
    [tabId, worktreeId, worktreePath]
  )
  return <CanvasTabContext.Provider value={value}>{children}</CanvasTabContext.Provider>
}

export function useCanvasTab(): CanvasTabInfo {
  return useContext(CanvasTabContext)
}

/** The reactive graph slice of the current tab. */
export function useCanvasGraph() {
  const { tabId } = useCanvasTab()
  return useCrewCanvas((s) => s.canvases[tabId]) ?? getCrewGraph(tabId)
}

/** Store actions pre-bound to the current tab. */
export function useCanvasActions() {
  const { tabId } = useCanvasTab()
  return useMemo(() => {
    const s = useCrewCanvas.getState()
    return {
      setGraph: (nodes: CrewCanvasNode[], edges: Edge[]) => s.setGraph(tabId, nodes, edges),
      addNode: (node: CrewCanvasNode) => s.addNode(tabId, node),
      removeElements: (nodeIds: string[], edgeIds: string[]) =>
        s.removeElements(tabId, nodeIds, edgeIds),
      updateNodeData: (nodeId: string, patch: Record<string, unknown>) =>
        s.updateNodeData(tabId, nodeId, patch),
      resizeNode: (nodeId: string, size: { width: number; height: number }) =>
        s.resizeNode(tabId, nodeId, size),
      setEdgeStyle: (style: CrewEdgeStyle) => s.setEdgeStyle(tabId, style),
      setViewport: (viewport: Viewport) => s.setViewport(tabId, viewport)
    }
  }, [tabId])
}

/** Non-reactive read of the current tab's graph (for effects/spawns). */
export function useCanvasGraphReader() {
  const { tabId } = useCanvasTab()
  return useMemo(() => () => getCrewGraph(tabId), [tabId])
}

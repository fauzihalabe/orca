import type { Edge } from '@xyflow/react'
import type {
  CrewCanvasGraphSnapshot,
  CrewCanvasPersistedState,
  CrewCanvasSyncResult,
  CrewCanvasUpdateEvent
} from '../../../../shared/crew-canvas'
import {
  withoutCrewCanvasTransientEdgeState,
  withoutCrewCanvasTransientNodeState
} from '../../../../shared/crew-canvas'
import {
  useCrewCanvas,
  registerCrewCanvasMainRemoval,
  type CrewCanvasGraph,
  type CrewCanvasNode,
  type CrewEdgeStyle
} from './canvas-store'

const EMPTY_VIEWPORT = { x: 0, y: 0, zoom: 1 }

// The renderer's localStorage copy is a fast UI cache. The main process owns
// the authoritative capability graph, including the revision used to reject
// stale writes from a second renderer or from a recovered window.
let mainRevision = 0
let mainHydration: Promise<void> | null = null
let applyingMainState = false
let mainUpdateInstalled = false
const mainGraphFingerprints = new Map<string, string>()
const pendingMainSyncs = new Map<string, { worktreeId: string | null; graph: CrewCanvasGraph }>()
const mainSyncQueues = new Map<string, Promise<void>>()

function graphForMain(graph: CrewCanvasGraph): CrewCanvasGraphSnapshot {
  return {
    nodes: graph.nodes.map((node) => withoutCrewCanvasTransientNodeState(node)),
    edges: graph.edges.map((edge) => withoutCrewCanvasTransientEdgeState(edge)),
    viewport: { ...graph.viewport },
    edgeStyle: graph.edgeStyle
  }
}

function applyMainState(state: CrewCanvasPersistedState): void {
  applyingMainState = true
  try {
    const canvases = Object.fromEntries(
      Object.entries(state.tabs).map(([tabId, tab]) => [
        tabId,
        {
          nodes: tab.graph.nodes.map(withoutCrewCanvasTransientNodeState) as CrewCanvasNode[],
          edges: tab.graph.edges.map(withoutCrewCanvasTransientEdgeState) as Edge[],
          viewport: tab.graph.viewport ?? EMPTY_VIEWPORT,
          edgeStyle: (tab.graph.edgeStyle as CrewEdgeStyle) ?? 'lineit'
        }
      ])
    )
    useCrewCanvas.setState({ canvases })
    mainGraphFingerprints.clear()
    for (const [tabId, tab] of Object.entries(state.tabs)) {
      mainGraphFingerprints.set(tabId, JSON.stringify(tab.graph))
    }
    mainRevision = state.revision
  } finally {
    applyingMainState = false
  }
}

function canvasApiAvailable(): boolean {
  return typeof window !== 'undefined' && Boolean(window.api?.crew?.getCanvasState)
}

async function syncTabToMain(
  tabId: string,
  worktreeId: string | null,
  graph: CrewCanvasGraph
): Promise<void> {
  if (!canvasApiAvailable() || applyingMainState) {
    return
  }
  const wireGraph = graphForMain(graph)
  const fingerprint = JSON.stringify(wireGraph)
  if (mainGraphFingerprints.get(tabId) === fingerprint) {
    return
  }
  const result: CrewCanvasSyncResult = await window.api.crew.syncCanvas({
    tabId,
    worktreeId,
    graph: wireGraph,
    baseRevision: mainRevision
  })
  if (result.accepted) {
    mainRevision = result.revision
    mainGraphFingerprints.set(tabId, fingerprint)
  } else {
    applyMainState(result.state)
  }
}

/** Hydrate the durable main-process graph once per renderer lifetime. */
export function hydrateCrewCanvasFromMain(): Promise<void> {
  if (mainHydration || !canvasApiAvailable()) {
    return mainHydration ?? Promise.resolve()
  }
  mainHydration = (async () => {
    const persisted = await window.api.crew.getCanvasState()
    if (persisted && (persisted.revision > 0 || Object.keys(persisted.tabs).length > 0)) {
      applyMainState(persisted)
      return
    }

    // First upgrade from the old renderer-only persistence: seed every local
    // graph before the first live Canvas edit, then let the main file take over.
    const local = useCrewCanvas.getState().canvases
    for (const [tabId, graph] of Object.entries(local)) {
      if (applyingMainState) {
        break
      }
      await syncTabToMain(tabId, null, graph)
    }
  })().catch((error) => {
    // A missing bridge must not make the visual Canvas unusable. The next tab
    // effect can retry a normal sync after the app has finished booting.
    console.warn('[crew-canvas] main graph hydration failed:', error)
  })
  return mainHydration
}

/** Sync a tab after a React Flow change, preserving the main revision fence. */
export async function syncCrewCanvasTab(
  tabId: string,
  worktreeId: string | null,
  graph: CrewCanvasGraph
): Promise<void> {
  // React Flow can emit several changes during one drag/type burst. Serialize
  // them per tab and keep only the newest graph so a stale revision response
  // cannot overwrite a newer user edit.
  pendingMainSyncs.set(tabId, { worktreeId, graph })
  if (mainSyncQueues.has(tabId)) {
    return mainSyncQueues.get(tabId)!
  }
  const job = (async () => {
    await hydrateCrewCanvasFromMain()
    while (pendingMainSyncs.has(tabId)) {
      const next = pendingMainSyncs.get(tabId)!
      pendingMainSyncs.delete(tabId)
      await syncTabToMain(tabId, next.worktreeId, next.graph)
    }
  })()
  mainSyncQueues.set(tabId, job)
  try {
    await job
  } finally {
    if (mainSyncQueues.get(tabId) === job) {
      mainSyncQueues.delete(tabId)
    }
  }
}

export function removeCrewCanvasFromMain(tabId: string): void {
  if (!canvasApiAvailable()) {
    return
  }
  void window.api.crew
    .removeCanvas({ tabId, baseRevision: mainRevision })
    .then((result) => {
      if (result.accepted) {
        mainRevision = result.revision
        mainGraphFingerprints.delete(tabId)
      } else {
        applyMainState(result.state)
      }
    })
    .catch((error) => {
      console.warn('[crew-canvas] failed to remove durable tab:', error)
    })
}

registerCrewCanvasMainRemoval(removeCrewCanvasFromMain)

/** Install push updates emitted by main-owned note/todo/timer mutations. */
export function installCrewCanvasMainUpdates(): void {
  if (mainUpdateInstalled || !canvasApiAvailable()) {
    return
  }
  mainUpdateInstalled = true
  window.api.crew.onCanvasUpdate((event: CrewCanvasUpdateEvent) => {
    if (event.state.revision >= mainRevision) {
      applyMainState(event.state)
    }
  })
}

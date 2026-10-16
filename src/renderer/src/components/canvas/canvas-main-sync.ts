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
  registerCrewCanvasMainSync,
  type CrewCanvasGraph,
  type CrewCanvasNode,
  type CrewEdgeStyle
} from './canvas-store'
import { mergeCrewCanvasGraphs } from './canvas-graph-three-way-merge'

const EMPTY_VIEWPORT = { x: 0, y: 0, zoom: 1 }

function emptyGraph(): CrewCanvasGraph {
  return { nodes: [], edges: [], viewport: EMPTY_VIEWPORT, edgeStyle: 'lineit' }
}

// The renderer's localStorage copy is a fast UI cache. The main process owns
// the authoritative capability graph, including the revision used to reject
// stale writes from a second renderer or from a recovered window.
let mainRevision = 0
let mainHydration: Promise<void> | null = null
let applyingMainState = false
let mainUpdateInstalled = false
const mainGraphFingerprints = new Map<string, string>()
type PendingMainSync = {
  worktreeId: string | null
  baseGraph: CrewCanvasGraph
  graph: CrewCanvasGraph
}

const pendingMainSyncs = new Map<string, PendingMainSync>()
const pendingMainRemovals = new Set<string>()
const canvasWorktreeIds = new Map<string, string | null>()
const mainGraphs = new Map<string, CrewCanvasGraph>()
let mainSyncQueue: Promise<void> | null = null

function graphFingerprint(worktreeId: string | null, graph: CrewCanvasGraphSnapshot): string {
  return JSON.stringify({ worktreeId, graph })
}

function graphForMain(graph: CrewCanvasGraph): CrewCanvasGraphSnapshot {
  return {
    nodes: graph.nodes.map((node) => withoutCrewCanvasTransientNodeState(node)),
    edges: graph.edges.map((edge) => withoutCrewCanvasTransientEdgeState(edge)),
    viewport: { ...graph.viewport },
    edgeStyle: graph.edgeStyle
  }
}

function graphFromMain(graph: CrewCanvasGraphSnapshot): CrewCanvasGraph {
  return {
    nodes: graph.nodes.map(withoutCrewCanvasTransientNodeState) as CrewCanvasNode[],
    edges: graph.edges.map(withoutCrewCanvasTransientEdgeState) as Edge[],
    viewport: graph.viewport ?? EMPTY_VIEWPORT,
    edgeStyle: (graph.edgeStyle as CrewEdgeStyle) ?? 'lineit'
  }
}

function applyMainState(state: CrewCanvasPersistedState): void {
  applyingMainState = true
  try {
    const canvases: Record<string, CrewCanvasGraph> = Object.fromEntries(
      Object.entries(state.tabs).map(([tabId, tab]) => [tabId, graphFromMain(tab.graph)])
    )
    for (const [tabId, pending] of pendingMainSyncs) {
      const mainGraph = canvases[tabId]
      if (mainGraph) {
        pending.graph = mergeCrewCanvasGraphs(pending.baseGraph, pending.graph, mainGraph)
      }
      canvases[tabId] = pending.graph
    }
    for (const tabId of pendingMainRemovals) {
      delete canvases[tabId]
    }
    useCrewCanvas.setState({ canvases })
    mainGraphFingerprints.clear()
    mainGraphs.clear()
    for (const [tabId, tab] of Object.entries(state.tabs)) {
      mainGraphFingerprints.set(tabId, graphFingerprint(tab.worktreeId, tab.graph))
      mainGraphs.set(tabId, graphFromMain(tab.graph))
    }
    mainRevision = state.revision
  } finally {
    applyingMainState = false
  }
}

function canvasApiAvailable(): boolean {
  return typeof window !== 'undefined' && Boolean(window.api?.crew?.getCanvasState)
}

async function syncTabToMain(tabId: string): Promise<PendingMainSync | null> {
  if (!canvasApiAvailable() || applyingMainState) {
    return null
  }
  while (true) {
    const pending = pendingMainSyncs.get(tabId)
    if (!pending) {
      return null
    }
    const wireGraph = graphForMain(pending.graph)
    const fingerprint = graphFingerprint(pending.worktreeId, wireGraph)
    if (mainGraphFingerprints.get(tabId) === fingerprint) {
      return pending
    }
    const result: CrewCanvasSyncResult = await window.api.crew.syncCanvas({
      tabId,
      worktreeId: pending.worktreeId,
      graph: wireGraph,
      baseRevision: mainRevision
    })
    if (result.accepted) {
      mainRevision = result.revision
      mainGraphFingerprints.set(tabId, fingerprint)
      mainGraphs.set(tabId, graphFromMain(wireGraph))
      return pending
    }
    applyMainState(result.state)
  }
}

async function removeTabFromMain(tabId: string): Promise<void> {
  if (!canvasApiAvailable()) {
    return
  }
  while (true) {
    const result = await window.api.crew.removeCanvas({ tabId, baseRevision: mainRevision })
    if (result.accepted) {
      mainRevision = result.revision
      mainGraphFingerprints.delete(tabId)
      return
    }
    applyMainState(result.state)
  }
}

async function processPendingMainSyncs(): Promise<void> {
  await hydrateCrewCanvasFromMain()
  while (pendingMainRemovals.size > 0 || pendingMainSyncs.size > 0) {
    const removal = pendingMainRemovals.values().next().value as string | undefined
    if (removal) {
      await removeTabFromMain(removal)
      pendingMainRemovals.delete(removal)
      continue
    }
    const nextEntry = pendingMainSyncs.entries().next().value as
      | [string, PendingMainSync]
      | undefined
    if (!nextEntry) {
      continue
    }
    const [tabId] = nextEntry
    const synced = await syncTabToMain(tabId)
    if (synced && pendingMainSyncs.get(tabId) === synced) {
      pendingMainSyncs.delete(tabId)
    }
  }
}

function startMainSyncWorker(): Promise<void> {
  if (mainSyncQueue) {
    return mainSyncQueue
  }
  let failed = false
  const job = processPendingMainSyncs().catch((error) => {
    failed = true
    console.warn('[crew-canvas] main graph synchronization failed:', error)
  })
  mainSyncQueue = job
  void job.then(() => {
    if (mainSyncQueue === job) {
      mainSyncQueue = null
      if (!failed && (pendingMainRemovals.size > 0 || pendingMainSyncs.size > 0)) {
        void startMainSyncWorker()
      }
    }
  })
  return job
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
      const baseGraph = mainGraphs.get(tabId) ?? emptyGraph()
      pendingMainSyncs.set(tabId, { worktreeId: null, baseGraph, graph })
      const synced = await syncTabToMain(tabId)
      if (synced && pendingMainSyncs.get(tabId) === synced) {
        pendingMainSyncs.delete(tabId)
      }
    }
  })().catch((error) => {
    // A missing bridge must not make the visual Canvas unusable. The next tab
    // effect can retry a normal sync after the app has finished booting.
    console.warn('[crew-canvas] main graph hydration failed:', error)
  })
  return mainHydration
}

export function registerCrewCanvasTabScope(tabId: string, worktreeId: string | null): void {
  canvasWorktreeIds.set(tabId, worktreeId)
}

export function removeCrewCanvasFromMain(tabId: string): void {
  if (!canvasApiAvailable()) {
    return
  }
  pendingMainSyncs.delete(tabId)
  pendingMainRemovals.add(tabId)
  void startMainSyncWorker()
}

registerCrewCanvasMainRemoval(removeCrewCanvasFromMain)
registerCrewCanvasMainSync((tabId, graph) => {
  const worktreeId = canvasWorktreeIds.get(tabId) ?? null
  const current = pendingMainSyncs.get(tabId)
  const baseGraph = current?.baseGraph ?? mainGraphs.get(tabId) ?? emptyGraph()
  pendingMainSyncs.set(tabId, { worktreeId, baseGraph, graph })
  void startMainSyncWorker()
})

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

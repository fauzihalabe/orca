import type { Edge } from '@xyflow/react'
import {
  acquireBrowserAutomationVisibilityAfterPaint,
  releaseBrowserAutomationVisibility
} from '@/components/browser-pane/browser-automation-visibility'
import { registeredWebContentsIds } from '@/components/browser-pane/webview-registry'
import { useAppStore } from '@/store'
import {
  CREW_CANVAS_NODE_SIZES,
  findCrewCanvasSpawnPosition
} from '../../../../shared/crew-canvas-node-placement'
import { useCrewCanvas, type CrewCanvasNode, type CrewCanvasNodeData } from './canvas-store'
import {
  canvasBrowserPageId,
  canvasBrowserWorkspaceId,
  waitForNativeBrowserSessionHydration
} from './nodes/canvas-browser-session'
import { waitForCanvasBrowserRegistration } from './nodes/canvas-browser-registration'

// Agent-driven node creation: the agent asks, the node appears next to it on
// its own canvas tab, already wired by an edge — the line is what unlocks the
// corresponding tools, so spawn and permission are the same act.

type SpawnableKind = Extract<
  CrewCanvasNodeData['kind'],
  'agent' | 'browser' | 'simulator' | 'network' | 'note' | 'todo' | 'timer'
>

const AGENT_SPAWNABLE_KINDS: readonly SpawnableKind[] = [
  'agent',
  'browser',
  'simulator',
  'network',
  'note',
  'todo',
  'timer'
]

function isSpawnableKind(kind: string): kind is SpawnableKind {
  return AGENT_SPAWNABLE_KINDS.includes(kind as SpawnableKind)
}

function connectedBrowserNodes(
  caller: CrewCanvasNode,
  nodes: CrewCanvasNode[],
  edges: Edge[]
): CrewCanvasNode[] {
  const connectedIds = new Set(
    edges.flatMap((edge) => {
      if (edge.source === caller.id) {
        return [edge.target]
      }
      if (edge.target === caller.id) {
        return [edge.source]
      }
      return []
    })
  )
  return nodes.filter((node) => connectedIds.has(node.id) && node.data.kind === 'browser')
}

function canvasWorktreeId(tabId: string): string | null {
  const state = useAppStore.getState()
  for (const [worktreeId, tabs] of Object.entries(state.unifiedTabsByWorktree)) {
    if (tabs.some((tab) => tab.id === tabId || tab.entityId === tabId)) {
      return worktreeId
    }
  }
  return null
}

function normalizedBrowserUrl(value: unknown): string {
  const trimmed = typeof value === 'string' ? value.trim() : ''
  if (!trimmed) {
    return 'about:blank'
  }
  return /^[a-z][a-z\d+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`
}

function nullableBrowserIdentity(value: unknown): string | null | undefined {
  if (value === null) {
    return null
  }
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

async function prepareConnectedBrowser(
  browser: CrewCanvasNode,
  tabId: string,
  data: Record<string, unknown>,
  reused: boolean
): Promise<string> {
  await waitForNativeBrowserSessionHydration()
  const graphStore = useCrewCanvas.getState()
  let state = useAppStore.getState()
  const workspaceId =
    typeof browser.data.browserWorkspaceId === 'string' && browser.data.browserWorkspaceId.trim()
      ? browser.data.browserWorkspaceId.trim()
      : canvasBrowserWorkspaceId(browser.id)
  const requestedPageId =
    typeof browser.data.browserPageId === 'string' && browser.data.browserPageId.trim()
      ? browser.data.browserPageId.trim()
      : canvasBrowserPageId(browser.id)
  const requestedUrl =
    typeof data.url === 'string' && data.url.trim() ? normalizedBrowserUrl(data.url) : null
  const restoredUrl = normalizedBrowserUrl(browser.data.url)
  const restoredProfileId = nullableBrowserIdentity(browser.data.browserSessionProfileId)
  const restoredPartition = nullableBrowserIdentity(browser.data.browserSessionPartition)
  let workspace = Object.values(state.browserTabsByWorktree)
    .flat()
    .find((candidate) => candidate.id === workspaceId)
  const worktreeId = workspace?.worktreeId ?? canvasWorktreeId(tabId)
  if (!workspace && worktreeId) {
    workspace = state.createBrowserTab(worktreeId, requestedUrl ?? restoredUrl, {
      id: workspaceId,
      pageId: requestedPageId,
      activate: false,
      title: 'Canvas Browser',
      ...(restoredProfileId !== undefined ? { sessionProfileId: restoredProfileId } : {}),
      ...(restoredPartition !== undefined ? { sessionPartition: restoredPartition } : {})
    })
    state = useAppStore.getState()
  }
  if (!workspace) {
    return `erro: browser conectado ${browser.id} ainda não publicou seu workspace nativo`
  }
  const pages = state.browserPagesByWorkspace[workspace.id] ?? []
  const page =
    pages.find((candidate) => candidate.id === requestedPageId) ??
    pages.find((candidate) => candidate.id === workspace.activePageId) ??
    pages[0]
  const pageId = page?.id ?? requestedPageId
  const url = requestedUrl ?? page?.url ?? workspace.url ?? restoredUrl
  if (requestedUrl && page?.url !== requestedUrl) {
    state.setBrowserPageUrl(pageId, requestedUrl)
  }
  graphStore.updateNodeData(tabId, browser.id, {
    browserWorkspaceId: workspace.id,
    browserPageId: pageId,
    browserSessionProfileId: workspace.sessionProfileId ?? null,
    browserSessionPartition: workspace.sessionPartition ?? null,
    url
  })
  const visibilityToken = await acquireBrowserAutomationVisibilityAfterPaint(pageId)
  if (!visibilityToken) {
    return JSON.stringify({ nodeId: browser.id, browserPageId: pageId, reused, ready: false })
  }
  const ready = await waitForCanvasBrowserRegistration({
    pageId,
    workspaceId: workspace.id,
    worktreeId: workspace.worktreeId,
    sessionProfileId: workspace.sessionProfileId
  })
  if (ready) {
    window.setTimeout(() => releaseBrowserAutomationVisibility(visibilityToken), 30_000)
  } else {
    releaseBrowserAutomationVisibility(visibilityToken)
  }
  return JSON.stringify({ nodeId: browser.id, browserPageId: pageId, reused, ready })
}

export async function spawnConnectedNode(
  caller: CrewCanvasNode,
  tabId: string,
  kind: string,
  data: Record<string, unknown>,
  preferredNodeId?: string
): Promise<string> {
  if (!isSpawnableKind(kind)) {
    return `erro: não sei spawnar "${kind}" (válidos: ${AGENT_SPAWNABLE_KINDS.join(', ')})`
  }
  const store = useCrewCanvas.getState()
  const graph = store.canvases[tabId]
  if (!graph) {
    return 'erro: canvas da sua aba não encontrado'
  }
  if (kind === 'browser') {
    const preferred = preferredNodeId
      ? graph.nodes.find((node) => node.id === preferredNodeId && node.data.kind === 'browser')
      : undefined
    const existing =
      preferred ??
      connectedBrowserNodes(caller, graph.nodes, graph.edges).sort((left, right) => {
        if (left.id === preferredNodeId) {
          return -1
        }
        if (right.id === preferredNodeId) {
          return 1
        }
        const leftPageId =
          typeof left.data.browserPageId === 'string'
            ? left.data.browserPageId
            : canvasBrowserPageId(left.id)
        const rightPageId =
          typeof right.data.browserPageId === 'string'
            ? right.data.browserPageId
            : canvasBrowserPageId(right.id)
        return (
          Number(registeredWebContentsIds.has(rightPageId)) -
          Number(registeredWebContentsIds.has(leftPageId))
        )
      })[0]
    if (existing) {
      return prepareConnectedBrowser(existing, tabId, data, true)
    }
  }
  const id = crypto.randomUUID()
  const size = CREW_CANVAS_NODE_SIZES[kind]
  const node: CrewCanvasNode = {
    id,
    type: kind,
    position: findCrewCanvasSpawnPosition(caller, graph.nodes, size),
    width: size.width,
    height: size.height,
    data: { kind, ...data }
  }
  const edge: Edge = {
    id: crypto.randomUUID(),
    source: caller.id,
    target: id,
    type: 'crew'
  }
  store.addNode(tabId, node)
  const current = useCrewCanvas.getState().canvases[tabId]
  useCrewCanvas.getState().setGraph(tabId, current.nodes, [...current.edges, edge])
  const label = String(data.label ?? data.agentKind ?? kind)
  if (kind === 'browser') {
    return prepareConnectedBrowser(node, tabId, data, false)
  }
  return `spawnado: ${kind} "${label}" conectado a você (id ${id}).`
}

import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { WebContents } from 'electron'
import type {
  CrewCanvasEdgeSnapshot,
  CrewCanvasNodeSnapshot,
  CrewCanvasPersistedState,
  CrewCanvasSyncResult,
  CrewCanvasUpdateEvent
} from '../shared/crew-canvas'
import { EMPTY_CREW_CANVAS_STATE } from '../shared/crew-canvas'
import {
  cloneCrewCanvasValue,
  crewCanvasAgentAliases,
  crewCanvasNodeLabel,
  crewCanvasText,
  isValidCrewCanvasId,
  type LocatedCanvasNode,
  parseCrewCanvasState,
  sanitizeCrewCanvasGraph
} from './crew-canvas-graph'

export class CrewCanvasStateStore {
  private state: CrewCanvasPersistedState
  private writeChain: Promise<void> = Promise.resolve()

  constructor(
    private readonly statePath: string,
    private readonly getMainWebContents: () => WebContents | null
  ) {
    this.state = this.load()
  }

  getState(): CrewCanvasPersistedState {
    return cloneCrewCanvasValue(this.state)
  }

  syncTab(args: {
    tabId: string
    worktreeId?: string | null
    graph: unknown
    baseRevision: number
  }): CrewCanvasSyncResult {
    if (!isValidCrewCanvasId(args.tabId)) {
      throw new Error('Canvas tab id is required')
    }
    if (!Number.isInteger(args.baseRevision) || args.baseRevision < 0) {
      throw new Error('Canvas base revision is invalid')
    }
    if (args.baseRevision !== this.state.revision) {
      return { accepted: false, conflict: true, state: this.getState() }
    }
    this.state = {
      version: 1,
      revision: this.state.revision + 1,
      tabs: {
        ...this.state.tabs,
        [args.tabId]: {
          tabId: args.tabId,
          worktreeId: typeof args.worktreeId === 'string' ? args.worktreeId : null,
          graph: sanitizeCrewCanvasGraph(args.graph)
        }
      }
    }
    this.persist()
    return { accepted: true, revision: this.state.revision }
  }

  removeTab(args: { tabId: string; baseRevision: number }): CrewCanvasSyncResult {
    if (!isValidCrewCanvasId(args.tabId)) {
      throw new Error('Canvas tab id is required')
    }
    if (!Number.isInteger(args.baseRevision) || args.baseRevision < 0) {
      throw new Error('Canvas base revision is invalid')
    }
    if (args.baseRevision !== this.state.revision) {
      return { accepted: false, conflict: true, state: this.getState() }
    }
    if (!(args.tabId in this.state.tabs)) {
      return { accepted: true, revision: this.state.revision }
    }
    const tabs = { ...this.state.tabs }
    delete tabs[args.tabId]
    this.state = { version: 1, revision: this.state.revision + 1, tabs }
    this.persist()
    return { accepted: true, revision: this.state.revision }
  }

  graphSummary(): unknown {
    return {
      revision: this.state.revision,
      tabs: Object.values(this.state.tabs).map((tab) => ({
        tabId: tab.tabId,
        worktreeId: tab.worktreeId,
        nodes: tab.graph.nodes.map((node) => ({
          id: node.id,
          kind: crewCanvasText(node.data.kind),
          label: crewCanvasNodeLabel(node)
        })),
        edges: tab.graph.edges.map((edge) => ({
          id: edge.id,
          source: edge.source,
          target: edge.target
        }))
      }))
    }
  }

  findAgent(labelOrId: string): LocatedCanvasNode | undefined {
    const normalized = labelOrId.trim().toLowerCase()
    if (!normalized) {
      return undefined
    }
    const matches = this.allNodes().filter(
      ({ node }) => node.data.kind === 'agent' && crewCanvasAgentAliases(node).includes(normalized)
    )
    return matches.length === 1 ? matches[0] : undefined
  }

  allNodes(): LocatedCanvasNode[] {
    return Object.values(this.state.tabs).flatMap((tab) =>
      tab.graph.nodes.map((node) => ({ node, tab }))
    )
  }

  browserPageId(nodeId: string): string {
    const located = this.allNodes().find(({ node }) => node.id === nodeId)
    return (
      (located ? crewCanvasText(located.node.data.browserPageId).trim() : '') || `canvas-${nodeId}`
    )
  }

  browserWorktreeId(nodeId: string): string | undefined {
    const located = this.allNodes().find(({ node }) => node.id === nodeId)
    return (located ? crewCanvasText(located.tab.worktreeId).trim() : '') || undefined
  }

  connected(caller: LocatedCanvasNode): LocatedCanvasNode[] {
    const ids = new Set<string>()
    for (const edge of caller.tab.graph.edges) {
      if (edge.source === caller.node.id) {
        ids.add(edge.target)
      }
      if (edge.target === caller.node.id) {
        ids.add(edge.source)
      }
    }
    return caller.tab.graph.nodes
      .filter((node) => ids.has(node.id))
      .map((node) => ({ node, tab: caller.tab }))
  }

  hasEdge(caller: LocatedCanvasNode, targetId: string): boolean {
    return caller.tab.graph.edges.some(
      (edge) =>
        (edge.source === caller.node.id && edge.target === targetId) ||
        (edge.target === caller.node.id && edge.source === targetId)
    )
  }

  selectConnected(
    caller: LocatedCanvasNode,
    kind: string,
    args: Record<string, unknown>,
    noun: string
  ): LocatedCanvasNode | string {
    return this.selectConnectedFrom(caller, kind, args.nodeId, noun)
  }

  selectConnectedFrom(
    caller: LocatedCanvasNode,
    kind: string,
    requestedId: unknown,
    noun: string
  ): LocatedCanvasNode | string {
    const connected = this.connected(caller).filter(({ node }) => node.data.kind === kind)
    const id = typeof requestedId === 'string' ? requestedId.trim() : ''
    if (id) {
      return (
        connected.find(({ node }) => node.id === id) ??
        `erro: o node ${id} não é um ${noun} conectado a você`
      )
    }
    if (connected.length === 0) {
      return `erro: nenhum ${noun} conectado a você — peça ao usuário pra ligar uma linha`
    }
    if (connected.length > 1) {
      return `erro: há ${connected.length} ${noun}s conectados; informe args.nodeId (um dos: ${connected.map(({ node }) => node.id).join(', ')})`
    }
    return connected[0]!
  }

  mutateNode(located: LocatedCanvasNode, patch: Record<string, unknown>): CrewCanvasNodeSnapshot {
    const node = this.state.tabs[located.tab.tabId]?.graph.nodes.find(
      (candidate) => candidate.id === located.node.id
    )
    if (!node) {
      throw new Error('Canvas node disappeared')
    }
    node.data = { ...node.data, ...patch }
    this.state = { ...this.state, revision: this.state.revision + 1 }
    this.persist()
    this.emitUpdate('mutation')
    return node
  }

  addConnectedNode(
    caller: LocatedCanvasNode,
    node: CrewCanvasNodeSnapshot,
    edge: CrewCanvasEdgeSnapshot
  ): LocatedCanvasNode {
    const tab = this.state.tabs[caller.tab.tabId]
    if (!tab?.graph.nodes.some((candidate) => candidate.id === caller.node.id)) {
      throw new Error('Canvas caller disappeared')
    }
    const graph = sanitizeCrewCanvasGraph({
      ...tab.graph,
      nodes: [...tab.graph.nodes, node],
      edges: [...tab.graph.edges, edge]
    })
    const nextTab = { ...tab, graph }
    this.state = {
      ...this.state,
      revision: this.state.revision + 1,
      tabs: { ...this.state.tabs, [tab.tabId]: nextTab }
    }
    this.persist()
    this.emitUpdate('mutation')
    const added = graph.nodes.find((candidate) => candidate.id === node.id)
    if (!added) {
      throw new Error('Canvas node was rejected')
    }
    return { node: added, tab: nextTab }
  }

  private load(): CrewCanvasPersistedState {
    try {
      return existsSync(this.statePath)
        ? parseCrewCanvasState(JSON.parse(readFileSync(this.statePath, 'utf8')))
        : cloneCrewCanvasValue(EMPTY_CREW_CANVAS_STATE)
    } catch (error) {
      console.warn('[crew-canvas] could not load persisted graph:', error)
      return cloneCrewCanvasValue(EMPTY_CREW_CANVAS_STATE)
    }
  }

  private persist(): void {
    const snapshot = JSON.stringify(this.state)
    this.writeChain = this.writeChain
      .then(() => {
        mkdirSync(dirname(this.statePath), { recursive: true })
        const temporary = join(
          dirname(this.statePath),
          `.${this.statePath.split('/').pop() ?? 'canvas'}.${randomUUID()}.tmp`
        )
        writeFileSync(temporary, snapshot, { encoding: 'utf8', mode: 0o600 })
        renameSync(temporary, this.statePath)
      })
      .catch((error) => console.warn('[crew-canvas] could not persist graph:', error))
  }

  private emitUpdate(reason: CrewCanvasUpdateEvent['reason']): void {
    const webContents = this.getMainWebContents()
    if (!webContents || webContents.isDestroyed()) {
      return
    }
    webContents.send('crew:canvas-update', {
      state: this.getState(),
      reason
    } satisfies CrewCanvasUpdateEvent)
  }
}

/* oxlint-disable max-lines -- Canvas authorization and native dispatch are one main-process capability boundary. */
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { WebContents } from 'electron'
import type {
  CrewCanvasEdgeSnapshot,
  CrewCanvasGraphSnapshot,
  CrewCanvasNodeSnapshot,
  CrewCanvasPersistedState,
  CrewCanvasRuntimeRequest,
  CrewCanvasSyncResult,
  CrewCanvasTabSnapshot,
  CrewCanvasUpdateEvent
} from '../shared/crew-canvas'
import {
  EMPTY_CREW_CANVAS_STATE,
  withoutCrewCanvasTransientEdgeState,
  withoutCrewCanvasTransientNodeState
} from '../shared/crew-canvas'
import type { OrcaRuntimeService } from './runtime/orca-runtime'
import { RpcDispatcher } from './runtime/rpc/dispatcher'

const MAX_NODES_PER_TAB = 256
const MAX_EDGES_PER_TAB = 512
const MAX_GRAPH_BYTES = 8 * 1024 * 1024
const MAX_TEXT_BYTES = 512 * 1024
const NATIVE_REQUEST_TIMEOUT_MS = 150_000
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

export type CrewCanvasBridgePayload = CrewCanvasRuntimeRequest

type LocatedNode = {
  node: CrewCanvasNodeSnapshot
  tab: CrewCanvasTabSnapshot
}

type BrokerOptions = {
  statePath: string
  getRuntime: () => OrcaRuntimeService | null
  forwardToRenderer: (payload: CrewCanvasBridgePayload) => Promise<string>
  getMainWebContents: () => WebContents | null
}

type TodoItem = { id: string; text: string; done: boolean }

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : String(value ?? '')
}

function jsonResult(value: unknown): string {
  if (typeof value === 'string') {
    return value
  }
  return JSON.stringify(value ?? null)
}

function graphSize(graph: CrewCanvasGraphSnapshot): number {
  return Buffer.byteLength(JSON.stringify(graph), 'utf8')
}

function validId(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= 240
}

function sanitizeNode(value: unknown): CrewCanvasNodeSnapshot | null {
  if (!isRecord(value) || !validId(value.id) || !isRecord(value.data)) {
    return null
  }
  const node = withoutCrewCanvasTransientNodeState(clone(value) as CrewCanvasNodeSnapshot)
  const data = node.data
  if (typeof data.kind !== 'string' || !CANVAS_NODE_KINDS.has(data.kind)) {
    return null
  }
  if (node.position && (!Number.isFinite(node.position.x) || !Number.isFinite(node.position.y))) {
    return null
  }
  return node
}

function sanitizeEdge(value: unknown): CrewCanvasEdgeSnapshot | null {
  if (!isRecord(value) || !validId(value.source) || !validId(value.target)) {
    return null
  }
  if (value.source === value.target) {
    return null
  }
  return withoutCrewCanvasTransientEdgeState(clone(value) as CrewCanvasEdgeSnapshot)
}

function sanitizeGraph(value: unknown): CrewCanvasGraphSnapshot {
  if (!isRecord(value)) {
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
    const pairAllowsCapability =
      sourceKind === 'agent' ||
      targetKind === 'agent' ||
      (sourceKind === 'browser' && targetKind === 'network') ||
      (sourceKind === 'network' && targetKind === 'browser')
    if (!pairAllowsCapability) {
      throw new Error(`Canvas connection ${edge!.source} → ${edge!.target} is not allowed`)
    }
    edgeKeys.add(key)
  }
  const graph = {
    nodes: nodes as CrewCanvasNodeSnapshot[],
    edges: edges as CrewCanvasEdgeSnapshot[],
    viewport: isRecord(value.viewport)
      ? {
          x: Number(value.viewport.x) || 0,
          y: Number(value.viewport.y) || 0,
          zoom: Number(value.viewport.zoom) || 1
        }
      : { x: 0, y: 0, zoom: 1 },
    edgeStyle: typeof value.edgeStyle === 'string' ? value.edgeStyle : 'lineit'
  } satisfies CrewCanvasGraphSnapshot
  if (graphSize(graph) > MAX_GRAPH_BYTES) {
    throw new Error('Canvas graph is too large')
  }
  return graph
}

function parseState(value: unknown): CrewCanvasPersistedState {
  if (!isRecord(value) || value.version !== 1 || !isRecord(value.tabs)) {
    return clone(EMPTY_CREW_CANVAS_STATE)
  }
  const tabs: Record<string, CrewCanvasTabSnapshot> = {}
  for (const [tabId, rawTab] of Object.entries(value.tabs)) {
    if (!validId(tabId) || !isRecord(rawTab)) {
      continue
    }
    try {
      tabs[tabId] = {
        tabId,
        worktreeId: typeof rawTab.worktreeId === 'string' ? rawTab.worktreeId : null,
        graph: sanitizeGraph(rawTab.graph)
      }
    } catch {
      // A corrupt tab must not make every other Canvas unavailable after restart.
    }
  }
  return {
    version: 1,
    revision: Number.isInteger(value.revision) ? Number(value.revision) : 0,
    tabs
  }
}

function nodeLabel(node: CrewCanvasNodeSnapshot): string {
  return text(
    node.data.label ??
      node.data.title ??
      (node.data.kind === 'agent' ? node.data.role : undefined) ??
      node.data.agentKind ??
      node.data.kind
  )
}

function agentAliases(node: CrewCanvasNodeSnapshot): string[] {
  return [node.id, node.data.label, node.data.role, node.data.agentKind]
    .map((value) => text(value).trim().toLowerCase())
    .filter(Boolean)
}

function nodeTools(kind: string): string[] {
  switch (kind) {
    case 'agent':
      return ['canvas_ask', 'orchestrate']
    case 'browser':
      return [
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
      ]
    case 'terminal':
      return ['terminal.run']
    case 'simulator':
      return [
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
      ]
    case 'network':
      return ['network.read', 'network.snapshot', 'network.list']
    case 'note':
      return ['note.read', 'note.write']
    case 'todo':
      return ['todo.list', 'todo.add', 'todo.toggle']
    case 'timer':
      return ['timer.read', 'timer.start', 'timer.pause', 'timer.stop', 'timer.reset']
    default:
      return []
  }
}

export class CrewCanvasBroker {
  private readonly options: BrokerOptions
  private state: CrewCanvasPersistedState
  private writeChain: Promise<void> = Promise.resolve()

  constructor(options: BrokerOptions) {
    this.options = options
    this.state = this.load(options.statePath)
  }

  getState(): CrewCanvasPersistedState {
    return clone(this.state)
  }

  syncTab(args: {
    tabId: string
    worktreeId?: string | null
    graph: unknown
    baseRevision: number
  }): CrewCanvasSyncResult {
    if (!validId(args.tabId)) {
      throw new Error('Canvas tab id is required')
    }
    if (!Number.isInteger(args.baseRevision) || args.baseRevision < 0) {
      throw new Error('Canvas base revision is invalid')
    }
    if (args.baseRevision !== this.state.revision) {
      return { accepted: false, conflict: true, state: this.getState() }
    }
    const graph = sanitizeGraph(args.graph)
    this.state = {
      version: 1,
      revision: this.state.revision + 1,
      tabs: {
        ...this.state.tabs,
        [args.tabId]: {
          tabId: args.tabId,
          worktreeId: typeof args.worktreeId === 'string' ? args.worktreeId : null,
          graph
        }
      }
    }
    this.persist()
    return { accepted: true, revision: this.state.revision }
  }

  removeTab(args: { tabId: string; baseRevision: number }): CrewCanvasSyncResult {
    if (!validId(args.tabId)) {
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

  async handle(payload: CrewCanvasBridgePayload): Promise<string> {
    const tool = payload.tool ?? 'ask'
    const args = payload.args ?? {}
    if (tool === 'graph') {
      return JSON.stringify(this.graphSummary())
    }

    const caller = this.findAgent(payload.from)
    if (!caller) {
      return `erro: agente chamador "${payload.from}" não encontrado no canvas`
    }
    if (tool === 'capabilities') {
      return JSON.stringify(this.capabilities(caller))
    }
    if (tool === 'ask') {
      const target = this.findAgent(payload.to ?? text(args.to))
      if (!target) {
        return `erro: nenhum agente chamado "${payload.to ?? text(args.to)}" no canvas`
      }
      if (!this.hasEdge(caller, target.node.id)) {
        return 'erro: o agente de destino não está conectado a você'
      }
      return this.options.forwardToRenderer(payload)
    }
    if (tool === 'orchestrate' || tool.endsWith('.spawn')) {
      // Creation and formal Orca orchestration still need the renderer's live
      // UI/PTY registry, but admission is performed here before forwarding.
      return this.options.forwardToRenderer(payload)
    }

    if (tool.startsWith('browser.')) {
      const browser = this.selectConnected(caller, 'browser', args, 'navegador')
      if (typeof browser === 'string') {
        return browser
      }
      return this.browserTool(browser.node.id, tool, args)
    }
    if (tool.startsWith('network.')) {
      const network = this.selectConnected(caller, 'network', args, 'network')
      if (typeof network === 'string') {
        return network
      }
      const browser = this.selectConnectedFrom(network, 'browser', args.browserNodeId, 'browser')
      if (typeof browser === 'string') {
        return browser ===
          'erro: nenhum browser conectado a você — peça ao usuário pra ligar uma linha'
          ? 'erro: o network precisa estar conectado a um browser para observar o tráfego'
          : browser
      }
      if (!['network.read', 'network.snapshot', 'network.list'].includes(tool)) {
        return `erro: tool desconhecida ${tool}`
      }
      return this.nativeCall(
        'browser.network',
        {
          page: this.browserPageId(browser.node.id),
          limit: typeof args.limit === 'number' ? args.limit : 100
        },
        'erro no network nativo'
      )
    }
    if (tool.startsWith('simulator.')) {
      const simulator = this.selectConnected(caller, 'simulator', args, 'simulador')
      if (typeof simulator === 'string') {
        return simulator
      }
      const command = tool.slice('simulator.'.length)
      const worktree = text(simulator.node.data.runtimeWorktreeId)
      if (!worktree) {
        return 'erro: o simulador ainda não está associado a um worktree ativo'
      }
      const params: Record<string, unknown> = { ...args, worktree }
      delete params.nodeId
      delete params.deviceUdid
      if (!params.device && simulator.node.data.deviceUdid) {
        params.device = simulator.node.data.deviceUdid
      }
      return this.nativeCall(`emulator.${command}`, params, 'erro no simulador nativo')
    }
    if (tool.startsWith('note.')) {
      const note = this.selectConnected(caller, 'note', args, 'nota')
      if (typeof note === 'string') {
        return note
      }
      return this.noteTool(note, tool, args)
    }
    if (tool.startsWith('todo.')) {
      const todo = this.selectConnected(caller, 'todo', args, 'todo')
      if (typeof todo === 'string') {
        return todo
      }
      return this.todoTool(todo, tool, args)
    }
    if (tool.startsWith('timer.')) {
      const timer = this.selectConnected(caller, 'timer', args, 'timer')
      if (typeof timer === 'string') {
        return timer
      }
      return this.timerTool(timer, tool, args)
    }
    if (tool === 'terminal.run') {
      const terminal = this.selectConnected(caller, 'terminal', args, 'terminal')
      if (typeof terminal === 'string') {
        return terminal
      }
      return this.options.forwardToRenderer(payload)
    }
    return `erro: tool desconhecida "${tool}"`
  }

  private load(path: string): CrewCanvasPersistedState {
    try {
      if (!existsSync(path)) {
        return clone(EMPTY_CREW_CANVAS_STATE)
      }
      return parseState(JSON.parse(readFileSync(path, 'utf8')))
    } catch (error) {
      console.warn('[crew-canvas] could not load persisted graph:', error)
      return clone(EMPTY_CREW_CANVAS_STATE)
    }
  }

  private persist(): void {
    const snapshot = JSON.stringify(this.state)
    const path = this.options.statePath
    this.writeChain = this.writeChain
      .then(() => {
        mkdirSync(dirname(path), { recursive: true })
        const tempPath = join(
          dirname(path),
          `.${path.split('/').pop() ?? 'canvas'}.${randomUUID()}.tmp`
        )
        writeFileSync(tempPath, snapshot, { encoding: 'utf8', mode: 0o600 })
        renameSync(tempPath, path)
      })
      .catch((error) => {
        console.warn('[crew-canvas] could not persist graph:', error)
      })
  }

  private emitUpdate(reason: CrewCanvasUpdateEvent['reason']): void {
    const webContents = this.options.getMainWebContents()
    if (!webContents || webContents.isDestroyed()) {
      return
    }
    webContents.send('crew:canvas-update', {
      state: this.getState(),
      reason
    } satisfies CrewCanvasUpdateEvent)
  }

  private graphSummary(): unknown {
    return {
      revision: this.state.revision,
      tabs: Object.values(this.state.tabs).map((tab) => ({
        tabId: tab.tabId,
        worktreeId: tab.worktreeId,
        nodes: tab.graph.nodes.map((node) => ({
          id: node.id,
          kind: text(node.data.kind),
          label: nodeLabel(node)
        })),
        edges: tab.graph.edges.map((edge) => ({
          id: edge.id,
          source: edge.source,
          target: edge.target
        }))
      }))
    }
  }

  private capabilities(caller: LocatedNode): unknown {
    return {
      agent: { id: caller.node.id, label: nodeLabel(caller.node), tabId: caller.tab.tabId },
      revision: this.state.revision,
      policy: {
        todo: {
          requiredForMultiStepWork: true,
          minimumActions: 2,
          workflow: ['todo.spawn-if-missing', 'todo.list', 'todo.add-once', 'todo.toggle-on-done']
        }
      },
      connections: this.connected(caller).map(({ node }) => ({
        id: node.id,
        kind: text(node.data.kind),
        label: nodeLabel(node),
        tools: nodeTools(text(node.data.kind)),
        page: node.data.kind === 'browser' ? this.browserPageId(node.id) : undefined
      }))
    }
  }

  private findAgent(labelOrId: string): LocatedNode | undefined {
    const normalized = labelOrId.trim().toLowerCase()
    if (!normalized) {
      return undefined
    }
    const all = this.allNodes().filter(({ node }) => node.data.kind === 'agent')
    const matches = all.filter(({ node }) => agentAliases(node).includes(normalized))
    return matches.length === 1 ? matches[0] : undefined
  }

  private allNodes(): LocatedNode[] {
    return Object.values(this.state.tabs).flatMap((tab) =>
      tab.graph.nodes.map((node) => ({ node, tab }))
    )
  }

  private browserPageId(nodeId: string): string {
    const located = this.allNodes().find(({ node }) => node.id === nodeId)
    const configured = located ? text(located.node.data.browserPageId).trim() : ''
    return configured || `canvas-${nodeId}`
  }

  private browserWorktreeId(nodeId: string): string | undefined {
    const located = this.allNodes().find(({ node }) => node.id === nodeId)
    const worktreeId = located ? text(located.tab.worktreeId).trim() : ''
    return worktreeId || undefined
  }

  private connected(caller: LocatedNode): LocatedNode[] {
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

  private hasEdge(caller: LocatedNode, targetId: string): boolean {
    return caller.tab.graph.edges.some(
      (edge) =>
        (edge.source === caller.node.id && edge.target === targetId) ||
        (edge.target === caller.node.id && edge.source === targetId)
    )
  }

  private selectConnected(
    caller: LocatedNode,
    kind: string,
    args: Record<string, unknown>,
    noun: string
  ): LocatedNode | string {
    const requestedId = typeof args.nodeId === 'string' ? args.nodeId.trim() : ''
    return this.selectConnectedFrom(caller, kind, requestedId, noun)
  }

  private selectConnectedFrom(
    caller: LocatedNode,
    kind: string,
    requestedId: unknown,
    noun: string
  ): LocatedNode | string {
    const connected = this.connected(caller).filter(({ node }) => node.data.kind === kind)
    const id = typeof requestedId === 'string' ? requestedId.trim() : ''
    if (id) {
      const selected = connected.find(({ node }) => node.id === id)
      return selected ?? `erro: o node ${id} não é um ${noun} conectado a você`
    }
    if (connected.length === 0) {
      return `erro: nenhum ${noun} conectado a você — peça ao usuário pra ligar uma linha`
    }
    if (connected.length > 1) {
      return `erro: há ${connected.length} ${noun}s conectados; informe args.nodeId (um dos: ${connected.map(({ node }) => node.id).join(', ')})`
    }
    return connected[0]!
  }

  private async browserTool(
    nodeId: string,
    tool: string,
    args: Record<string, unknown>
  ): Promise<string> {
    const page = this.browserPageId(nodeId)
    const worktree = this.browserWorktreeId(nodeId)
    const target = worktree ? { page, worktree } : { page }
    const { nodeId: _nodeId, selector, js, ...nativeArgs } = args
    void _nodeId
    if (tool === 'browser.navigate') {
      const url = text(args.url).trim()
      return url
        ? this.nativeCall('browser.goto', { ...target, url }, 'erro no navegador')
        : 'erro: url obrigatória'
    }
    if (tool === 'browser.read' || tool === 'browser.snapshot') {
      return this.nativeCall('browser.snapshot', target, 'erro no navegador')
    }
    if (tool === 'browser.eval') {
      const expression = text(args.expression ?? js)
      return expression
        ? this.nativeCall('browser.eval', { ...target, expression }, 'erro no navegador')
        : 'erro: expression/js obrigatório'
    }
    if (tool === 'browser.click' || tool === 'browser.fill') {
      const element = text(args.element ?? args.ref).trim()
      if (element) {
        return this.nativeCall(
          tool === 'browser.click' ? 'browser.click' : 'browser.fill',
          tool === 'browser.click'
            ? { ...target, element }
            : { ...target, element, value: text(args.value) },
          'erro no navegador'
        )
      }
      const css = text(selector).trim()
      if (!css) {
        return 'erro: element ou selector obrigatório'
      }
      const expression =
        tool === 'browser.click'
          ? `(() => { const el = document.querySelector(${JSON.stringify(css)}); if (!el) return 'not-found'; el.scrollIntoView({block:'center'}); el.click(); return 'clicked' })()`
          : `(() => { const el = document.querySelector(${JSON.stringify(css)}); if (!el) return 'not-found'; el.focus(); el.value = ${JSON.stringify(text(args.value))}; el.dispatchEvent(new Event('input', {bubbles:true})); el.dispatchEvent(new Event('change', {bubbles:true})); return 'filled' })()`
      const result = await this.nativeCall(
        'browser.eval',
        { ...target, expression },
        'erro no navegador'
      )
      if (result === 'not-found') {
        return `erro: ${css} não encontrado`
      }
      return tool === 'browser.click' ? `clicado ${css}` : `preenchido ${css}`
    }
    if (tool === 'browser.network') {
      return this.nativeCall(
        'browser.network',
        { ...target, limit: args.limit ?? 100 },
        'erro no navegador'
      )
    }
    return this.nativeCall(tool, { ...nativeArgs, ...target }, 'erro no navegador')
  }

  private async nativeCall(
    method: string,
    params: Record<string, unknown>,
    prefix: string
  ): Promise<string> {
    const runtime = this.options.getRuntime()
    if (!runtime) {
      return `${prefix}: runtime nativo indisponível`
    }
    try {
      let timeout: ReturnType<typeof setTimeout> | undefined
      const response = await Promise.race([
        new RpcDispatcher({ runtime }).dispatch({
          id: `canvas-${randomUUID()}`,
          authToken: 'desktop-canvas',
          method,
          params
        }),
        new Promise<never>((_, reject) => {
          timeout = setTimeout(
            () => reject(new Error('native runtime timeout')),
            NATIVE_REQUEST_TIMEOUT_MS
          )
          timeout.unref?.()
        })
      ]).finally(() => {
        if (timeout) {
          clearTimeout(timeout)
        }
      })
      if (response.ok !== true) {
        const error = isRecord(response.error) ? response.error.message : response.error
        throw new Error(text(error || `runtime method ${method} failed`))
      }
      return jsonResult(response.result)
    } catch (error) {
      return `${prefix}: ${error instanceof Error ? error.message : String(error)}`
    }
  }

  private mutateNode(located: LocatedNode, patch: Record<string, unknown>): CrewCanvasNodeSnapshot {
    const tab = this.state.tabs[located.tab.tabId]
    if (!tab) {
      throw new Error('Canvas tab disappeared')
    }
    const node = tab.graph.nodes.find((candidate) => candidate.id === located.node.id)
    if (!node) {
      throw new Error('Canvas node disappeared')
    }
    node.data = { ...node.data, ...patch }
    this.state = { ...this.state, revision: this.state.revision + 1 }
    this.persist()
    this.emitUpdate('mutation')
    return node
  }

  private noteTool(node: LocatedNode, tool: string, args: Record<string, unknown>): string {
    if (tool === 'note.read') {
      return text(node.node.data.text) || '(nota vazia)'
    }
    if (tool === 'note.write') {
      const value = text(args.text)
      if (Buffer.byteLength(value, 'utf8') > MAX_TEXT_BYTES) {
        return 'erro: nota excede o limite de tamanho'
      }
      this.mutateNode(node, { text: value })
      return `nota atualizada (${value.length} chars)`
    }
    return `erro: tool desconhecida ${tool}`
  }

  private todoTool(node: LocatedNode, tool: string, args: Record<string, unknown>): string {
    const items = Array.isArray(node.node.data.items)
      ? (node.node.data.items as TodoItem[]).filter(
          (item) => isRecord(item) && validId(item.id) && typeof item.text === 'string'
        )
      : []
    if (tool === 'todo.list') {
      return JSON.stringify(items)
    }
    if (tool === 'todo.add') {
      const value = text(args.text).trim()
      if (!value) {
        return 'erro: text obrigatório'
      }
      const next = [...items, { id: randomUUID(), text: value, done: false }]
      this.mutateNode(node, { items: next })
      return JSON.stringify(next.at(-1))
    }
    if (tool === 'todo.toggle') {
      const itemId = text(args.itemId ?? args.id)
      const item = items.find((candidate) => candidate.id === itemId)
      if (!item) {
        return `erro: item ${itemId} não encontrado`
      }
      const next = items.map((candidate) =>
        candidate.id === itemId ? { ...candidate, done: !candidate.done } : candidate
      )
      this.mutateNode(node, { items: next })
      return JSON.stringify(next.find((candidate) => candidate.id === itemId))
    }
    return `erro: tool desconhecida ${tool}`
  }

  private timerTool(node: LocatedNode, tool: string, args: Record<string, unknown>): string {
    const now = Date.now()
    const endAt = typeof node.node.data.endAt === 'number' ? node.node.data.endAt : undefined
    const stored = typeof node.node.data.remainingMs === 'number' ? node.node.data.remainingMs : 0
    const running = typeof endAt === 'number' && endAt > now
    const remainingMs = running ? Math.max(0, endAt! - now) : Math.max(0, stored)
    if (tool === 'timer.read') {
      return JSON.stringify({ nodeId: node.node.id, running, remainingMs })
    }
    if (tool === 'timer.start') {
      const duration =
        typeof args.ms === 'number'
          ? args.ms
          : typeof args.minutes === 'number'
            ? args.minutes * 60_000
            : remainingMs > 0
              ? remainingMs
              : 25 * 60_000
      if (!Number.isFinite(duration) || duration <= 0 || duration > 24 * 60 * 60_000) {
        return 'erro: timer.start exige ms/minutes entre 1 e 1440 minutos'
      }
      this.mutateNode(node, { endAt: now + duration, remainingMs: undefined })
      return JSON.stringify({ nodeId: node.node.id, running: true, remainingMs: duration })
    }
    if (tool === 'timer.pause' || tool === 'timer.stop') {
      this.mutateNode(node, { endAt: undefined, remainingMs })
      return JSON.stringify({ nodeId: node.node.id, running: false, remainingMs })
    }
    if (tool === 'timer.reset') {
      const duration = typeof args.ms === 'number' && args.ms > 0 ? args.ms : 25 * 60_000
      this.mutateNode(node, { endAt: undefined, remainingMs: duration })
      return JSON.stringify({ nodeId: node.node.id, running: false, remainingMs: duration })
    }
    return `erro: tool desconhecida ${tool}`
  }
}

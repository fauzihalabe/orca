import { randomUUID } from 'node:crypto'
import type { WebContents } from 'electron'
import type {
  CrewCanvasPersistedState,
  CrewCanvasRuntimeRequest,
  CrewCanvasSyncResult
} from '../shared/crew-canvas'
import {
  crewCanvasNodeLabel,
  crewCanvasNodeTools,
  crewCanvasText,
  isCrewCanvasRecord,
  isValidCrewCanvasId,
  type LocatedCanvasNode
} from './crew-canvas-graph'
import { CrewCanvasNativeTools } from './crew-canvas-native-tools'
import { CrewCanvasOrchestration } from './crew-canvas-orchestration'
import { CrewCanvasStateStore } from './crew-canvas-state'
import type { OrcaRuntimeService } from './runtime/orca-runtime'

const MAX_TEXT_BYTES = 512 * 1024

export type CrewCanvasBridgePayload = CrewCanvasRuntimeRequest

type BrokerOptions = {
  statePath: string
  getRuntime: () => OrcaRuntimeService | null
  forwardToRenderer: (payload: CrewCanvasBridgePayload) => Promise<string>
  getMainWebContents: () => WebContents | null
  devMode?: boolean
}

type TodoItem = { id: string; text: string; done: boolean }

export class CrewCanvasBroker {
  private readonly state: CrewCanvasStateStore
  private readonly native: CrewCanvasNativeTools
  private readonly orchestration: CrewCanvasOrchestration

  constructor(private readonly options: BrokerOptions) {
    this.state = new CrewCanvasStateStore(options.statePath, options.getMainWebContents)
    this.native = new CrewCanvasNativeTools(options.getRuntime, this.state)
    this.orchestration = new CrewCanvasOrchestration(
      this.state,
      this.native,
      options.devMode === true
    )
  }

  getState(): CrewCanvasPersistedState {
    return this.state.getState()
  }

  syncTab(args: {
    tabId: string
    worktreeId?: string | null
    graph: unknown
    baseRevision: number
  }): CrewCanvasSyncResult {
    return this.state.syncTab(args)
  }

  removeTab(args: { tabId: string; baseRevision: number }): CrewCanvasSyncResult {
    return this.state.removeTab(args)
  }

  async handle(payload: CrewCanvasBridgePayload): Promise<string> {
    const tool = payload.tool ?? 'ask'
    const args = payload.args ?? {}
    if (tool === 'graph') {
      return JSON.stringify(this.state.graphSummary())
    }
    const caller = this.state.findAgent(payload.from)
    if (!caller) {
      return `erro: agente chamador "${payload.from}" não encontrado no canvas`
    }
    if (tool === 'capabilities') {
      return JSON.stringify(this.capabilities(caller))
    }
    if (tool === 'ask') {
      const target = this.state.findAgent(payload.to ?? crewCanvasText(args.to))
      if (!target) {
        return `erro: nenhum agente chamado "${payload.to ?? crewCanvasText(args.to)}" no canvas`
      }
      if (!this.state.hasEdge(caller, target.node.id)) {
        return 'erro: o agente de destino não está conectado a você'
      }
      return this.orchestration.askAgent(
        caller,
        target,
        payload.message ?? crewCanvasText(args.message),
        args
      )
    }
    if (tool === 'orchestrate') {
      return this.orchestration.orchestrate(caller, args)
    }
    if (tool.endsWith('.spawn')) {
      return this.options.forwardToRenderer(payload)
    }
    if (tool.startsWith('browser.')) {
      const browser = this.state.selectConnected(caller, 'browser', args, 'navegador')
      return typeof browser === 'string'
        ? browser
        : this.native.browserTool(browser.node.id, tool, args)
    }
    if (tool.startsWith('network.')) {
      return this.networkTool(caller, tool, args)
    }
    if (tool.startsWith('simulator.')) {
      return this.simulatorTool(caller, tool, args)
    }
    if (tool.startsWith('note.')) {
      const note = this.state.selectConnected(caller, 'note', args, 'nota')
      return typeof note === 'string' ? note : this.noteTool(note, tool, args)
    }
    if (tool.startsWith('todo.')) {
      const todo = this.state.selectConnected(caller, 'todo', args, 'todo')
      return typeof todo === 'string' ? todo : this.todoTool(todo, tool, args)
    }
    if (tool.startsWith('timer.')) {
      const timer = this.state.selectConnected(caller, 'timer', args, 'timer')
      return typeof timer === 'string' ? timer : this.timerTool(timer, tool)
    }
    if (tool === 'terminal.read' || tool === 'terminal.send' || tool === 'terminal.run') {
      const terminal = this.state.selectConnected(caller, 'terminal', args, 'terminal')
      return typeof terminal === 'string'
        ? terminal
        : this.native.terminalTool(terminal, tool, args)
    }
    return `erro: tool desconhecida "${tool}"`
  }

  private capabilities(caller: LocatedCanvasNode): unknown {
    return {
      agent: {
        id: caller.node.id,
        label: crewCanvasNodeLabel(caller.node),
        tabId: caller.tab.tabId
      },
      revision: this.state.getState().revision,
      policy: {
        todo: {
          requiredForMultiStepWork: true,
          minimumActions: 2,
          workflow: ['todo.spawn-if-missing', 'todo.list', 'todo.add-once', 'todo.toggle-on-done']
        }
      },
      connections: this.state.connected(caller).map(({ node }) => ({
        id: node.id,
        kind: crewCanvasText(node.data.kind),
        label: crewCanvasNodeLabel(node),
        tools: crewCanvasNodeTools(crewCanvasText(node.data.kind)),
        page: node.data.kind === 'browser' ? this.state.browserPageId(node.id) : undefined
      }))
    }
  }

  private async networkTool(
    caller: LocatedCanvasNode,
    tool: string,
    args: Record<string, unknown>
  ): Promise<string> {
    const network = this.state.selectConnected(caller, 'network', args, 'network')
    if (typeof network === 'string') {
      return network
    }
    const browser = this.state.selectConnectedFrom(
      network,
      'browser',
      args.browserNodeId,
      'browser'
    )
    if (typeof browser === 'string') {
      return browser.includes('nenhum browser conectado')
        ? 'erro: o network precisa estar conectado a um browser para observar o tráfego'
        : browser
    }
    if (!['network.read', 'network.snapshot', 'network.list'].includes(tool)) {
      return `erro: tool desconhecida ${tool}`
    }
    return this.native.browserCaptureLog(browser.node.id, 'browser.network', args)
  }

  private async simulatorTool(
    caller: LocatedCanvasNode,
    tool: string,
    args: Record<string, unknown>
  ): Promise<string> {
    const simulator = this.state.selectConnected(caller, 'simulator', args, 'simulador')
    if (typeof simulator === 'string') {
      return simulator
    }
    const worktree = crewCanvasText(simulator.node.data.runtimeWorktreeId)
    if (!worktree) {
      return 'erro: o simulador ainda não está associado a um worktree ativo'
    }
    const params: Record<string, unknown> = { ...args, worktree }
    delete params.nodeId
    delete params.deviceUdid
    if (!params.device && simulator.node.data.deviceUdid) {
      params.device = simulator.node.data.deviceUdid
    }
    return this.native.call(
      `emulator.${tool.slice('simulator.'.length)}`,
      params,
      'erro no simulador nativo'
    )
  }

  private noteTool(node: LocatedCanvasNode, tool: string, args: Record<string, unknown>): string {
    if (tool === 'note.read') {
      return crewCanvasText(node.node.data.text) || '(nota vazia)'
    }
    if (tool === 'note.write') {
      const value = crewCanvasText(args.text)
      if (Buffer.byteLength(value, 'utf8') > MAX_TEXT_BYTES) {
        return 'erro: nota excede o limite de tamanho'
      }
      this.state.mutateNode(node, { text: value })
      return `nota atualizada (${value.length} chars)`
    }
    return `erro: tool desconhecida ${tool}`
  }

  private todoTool(node: LocatedCanvasNode, tool: string, args: Record<string, unknown>): string {
    const items = Array.isArray(node.node.data.items)
      ? (node.node.data.items as TodoItem[]).filter(
          (item) =>
            isCrewCanvasRecord(item) &&
            isValidCrewCanvasId(item.id) &&
            typeof item.text === 'string'
        )
      : []
    if (tool === 'todo.list') {
      return JSON.stringify(items)
    }
    if (tool === 'todo.add') {
      const value = crewCanvasText(args.text).trim()
      if (!value) {
        return 'erro: text obrigatório'
      }
      const next = [...items, { id: randomUUID(), text: value, done: false }]
      this.state.mutateNode(node, { items: next })
      return JSON.stringify(next.at(-1))
    }
    if (tool === 'todo.toggle') {
      const itemId = crewCanvasText(args.itemId ?? args.id)
      if (!items.some((item) => item.id === itemId)) {
        return `erro: item ${itemId} não encontrado`
      }
      const next = items.map((item) => (item.id === itemId ? { ...item, done: !item.done } : item))
      this.state.mutateNode(node, { items: next })
      return JSON.stringify(next.find((item) => item.id === itemId))
    }
    return `erro: tool desconhecida ${tool}`
  }

  private timerTool(node: LocatedCanvasNode, tool: string): string {
    const now = Date.now()
    const startedAt =
      typeof node.node.data.stopwatchStartedAt === 'number'
        ? node.node.data.stopwatchStartedAt
        : undefined
    const stored =
      typeof node.node.data.stopwatchElapsedMs === 'number'
        ? Math.max(0, node.node.data.stopwatchElapsedMs)
        : 0
    const running = typeof startedAt === 'number'
    const elapsedMs = running ? stored + Math.max(0, now - startedAt) : stored
    if (tool === 'timer.read') {
      return JSON.stringify({ nodeId: node.node.id, running, elapsedMs })
    }
    if (tool === 'timer.start') {
      if (!running) {
        this.state.mutateNode(node, {
          stopwatchStartedAt: now,
          stopwatchElapsedMs: stored,
          endAt: undefined,
          remainingMs: undefined
        })
      }
      return JSON.stringify({ nodeId: node.node.id, running: true, elapsedMs })
    }
    if (tool === 'timer.pause' || tool === 'timer.stop') {
      this.state.mutateNode(node, {
        stopwatchStartedAt: undefined,
        stopwatchElapsedMs: elapsedMs
      })
      return JSON.stringify({ nodeId: node.node.id, running: false, elapsedMs })
    }
    if (tool === 'timer.reset') {
      this.state.mutateNode(node, {
        stopwatchStartedAt: undefined,
        stopwatchElapsedMs: 0,
        endAt: undefined,
        remainingMs: undefined
      })
      return JSON.stringify({ nodeId: node.node.id, running: false, elapsedMs: 0 })
    }
    return `erro: tool desconhecida ${tool}`
  }
}

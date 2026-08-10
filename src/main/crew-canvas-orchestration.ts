import {
  crewCanvasAgentAliases,
  crewCanvasNodeLabel,
  crewCanvasText,
  isCrewCanvasRecord,
  type LocatedCanvasNode
} from './crew-canvas-graph'
import type { CrewCanvasNativeTools } from './crew-canvas-native-tools'
import type { CrewCanvasStateStore } from './crew-canvas-state'

const CANVAS_ASK_TIMEOUT_MS = 140_000
const CANVAS_ASK_POLL_MS = 500

type CanvasTask = { title?: string; spec: string }
type CanvasWorker = { located: LocatedCanvasNode; label: string; handle: string }
type CanvasOrchestrationReceipt = {
  runId: string
  tasks: {
    taskId: string
    title?: string
    worker: string
    workerNodeId: string
    dispatchId?: string
    state: string
    error?: string
  }[]
}

export class CrewCanvasOrchestration {
  constructor(
    private readonly state: CrewCanvasStateStore,
    private readonly native: CrewCanvasNativeTools,
    private readonly devMode: boolean
  ) {}

  async orchestrate(caller: LocatedCanvasNode, args: Record<string, unknown>): Promise<string> {
    const objective = crewCanvasText(args.objective).trim()
    if (!objective) {
      return 'erro: objective obrigatório'
    }
    const workers = this.connectedWorkers(caller, args.workers)
    if (typeof workers === 'string') {
      return workers
    }
    try {
      return JSON.stringify(
        await this.create({
          caller,
          objective,
          tasks: this.tasks(objective, args.tasks),
          workers
        })
      )
    } catch (error) {
      return `erro na orquestração nativa: ${error instanceof Error ? error.message : String(error)}`
    }
  }

  async askAgent(
    caller: LocatedCanvasNode,
    target: LocatedCanvasNode,
    message: string,
    args: Record<string, unknown>
  ): Promise<string> {
    const question = message.trim()
    if (!question) {
      return 'erro: message obrigatório'
    }
    let worker: CanvasWorker
    try {
      worker = {
        located: target,
        label: crewCanvasNodeLabel(target.node),
        handle: this.native.terminalIdentity(
          target,
          `o agente "${crewCanvasNodeLabel(target.node)}"`
        ).handle
      }
    } catch (error) {
      return `erro: ${error instanceof Error ? error.message : String(error)}`
    }
    try {
      const receipt = await this.create({
        caller,
        objective: `Solicitação do Canvas: ${crewCanvasNodeLabel(caller.node)} → ${worker.label}`,
        tasks: [{ title: 'Canvas ask', spec: question }],
        workers: [worker]
      })
      const dispatched = receipt.tasks[0]
      if (!dispatched || dispatched.state !== 'ready') {
        return JSON.stringify(receipt)
      }
      return this.waitForTask(caller, receipt.runId, dispatched, args.timeoutMs)
    } catch (error) {
      return `erro no ask nativo: ${error instanceof Error ? error.message : String(error)}`
    }
  }

  private connectedWorkers(caller: LocatedCanvasNode, requested: unknown): CanvasWorker[] | string {
    const connected = this.state.connected(caller).filter(({ node }) => node.data.kind === 'agent')
    const wanted = Array.isArray(requested)
      ? requested.map((value) => crewCanvasText(value).trim().toLowerCase()).filter(Boolean)
      : []
    const selected =
      wanted.length === 0
        ? connected
        : connected.filter(({ node }) =>
            wanted.some((alias) => crewCanvasAgentAliases(node).includes(alias))
          )
    const missing = wanted.filter(
      (alias) => !selected.some(({ node }) => crewCanvasAgentAliases(node).includes(alias))
    )
    if (missing.length > 0) {
      return `erro: workers não conectados a você: ${missing.join(', ')}`
    }
    if (selected.length === 0) {
      return 'erro: nenhum worker conectado a você — conecte agentes por linha'
    }
    try {
      return selected.map((located) => ({
        located,
        label: crewCanvasNodeLabel(located.node),
        handle: this.native.terminalIdentity(
          located,
          `o agente "${crewCanvasNodeLabel(located.node)}"`
        ).handle
      }))
    } catch (error) {
      return `erro: ${error instanceof Error ? error.message : String(error)}`
    }
  }

  private tasks(objective: string, raw: unknown): CanvasTask[] {
    if (!Array.isArray(raw)) {
      return [{ spec: objective }]
    }
    const tasks = raw
      .filter(isCrewCanvasRecord)
      .map((task) => ({
        spec: crewCanvasText(task.spec).trim(),
        ...(crewCanvasText(task.title).trim() ? { title: crewCanvasText(task.title).trim() } : {})
      }))
      .filter((task) => task.spec.length > 0)
    return tasks.length > 0 ? tasks : [{ spec: objective }]
  }

  private async create(args: {
    caller: LocatedCanvasNode
    objective: string
    tasks: CanvasTask[]
    workers: CanvasWorker[]
  }): Promise<CanvasOrchestrationReceipt> {
    const coordinator = this.native.terminalIdentity(args.caller, 'o agente coordenador')
    const created = (await this.native.dispatch('orchestration.runCreate', {
      objective: args.objective,
      from: coordinator.handle
    })) as { run?: { id?: string } }
    const runId = crewCanvasText(created.run?.id)
    if (!runId) {
      throw new Error('runtime não retornou o ID do Run')
    }

    const receipts: CanvasOrchestrationReceipt['tasks'] = []
    for (const [index, task] of args.tasks.entries()) {
      const worker = args.workers[index % args.workers.length]!
      const taskResult = (await this.native.dispatch('orchestration.taskCreate', {
        spec: task.spec,
        ...(task.title ? { taskTitle: task.title } : {}),
        run: runId,
        callerTerminalHandle: coordinator.handle
      })) as { task?: { id?: string } }
      const taskId = crewCanvasText(taskResult.task?.id)
      if (!taskId) {
        receipts.push(this.failedTask(worker, task, 'runtime não retornou o ID da Task'))
        continue
      }
      try {
        const start = (await this.native.dispatch('orchestration.workerStart', {
          task: taskId,
          terminal: worker.handle,
          from: coordinator.handle,
          run: runId,
          worktree: 'current',
          timeoutMs: 60_000,
          devMode: this.devMode
        })) as Record<string, unknown>
        const state = crewCanvasText(start.state || 'unknown')
        receipts.push({
          taskId,
          ...(task.title ? { title: task.title } : {}),
          worker: worker.label,
          workerNodeId: worker.located.node.id,
          dispatchId: crewCanvasText(start.dispatchId) || undefined,
          state,
          ...(state === 'ready'
            ? {}
            : {
                error: crewCanvasText(start.lastError || start.failedStage || 'worker não iniciou')
              })
        })
      } catch (error) {
        receipts.push(
          this.failedTask(
            worker,
            task,
            error instanceof Error ? error.message : String(error),
            taskId
          )
        )
      }
    }
    return { runId, tasks: receipts }
  }

  private failedTask(worker: CanvasWorker, task: CanvasTask, error: string, taskId = '') {
    return {
      taskId,
      ...(task.title ? { title: task.title } : {}),
      worker: worker.label,
      workerNodeId: worker.located.node.id,
      state: 'failed',
      error
    }
  }

  private async waitForTask(
    caller: LocatedCanvasNode,
    runId: string,
    dispatched: CanvasOrchestrationReceipt['tasks'][number],
    requestedTimeout: unknown
  ): Promise<string> {
    const coordinator = this.native.terminalIdentity(caller, 'o agente coordenador')
    const requested = Number(requestedTimeout)
    const timeoutMs = Number.isFinite(requested)
      ? Math.min(CANVAS_ASK_TIMEOUT_MS, Math.max(1_000, requested))
      : CANVAS_ASK_TIMEOUT_MS
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      const listed = (await this.native.dispatch('orchestration.taskList', {
        run: runId,
        callerTerminalHandle: coordinator.handle
      })) as { tasks?: Record<string, unknown>[] }
      const task = listed.tasks?.find((candidate) => candidate.id === dispatched.taskId)
      const status = crewCanvasText(task?.status)
      if (status === 'completed' || status === 'failed' || status === 'blocked') {
        return JSON.stringify({
          runId,
          taskId: dispatched.taskId,
          dispatchId: dispatched.dispatchId,
          status,
          report: this.parseReport(task?.result)
        })
      }
      await new Promise((resolve) => setTimeout(resolve, CANVAS_ASK_POLL_MS))
    }
    return JSON.stringify({
      runId,
      taskId: dispatched.taskId,
      dispatchId: dispatched.dispatchId,
      status: 'running',
      timedOut: true
    })
  }

  private parseReport(value: unknown): unknown {
    const raw = crewCanvasText(value)
    try {
      return JSON.parse(raw) as unknown
    } catch {
      return raw
    }
  }
}

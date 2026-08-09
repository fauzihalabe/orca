import { useAppStore } from '@/store'
import { agentPtyOf } from './agent-registry'
import { useCrewCanvas, type CrewCanvasNode } from './canvas-store'

// orchestrate — starts a REAL Orca orchestration Run from the canvas, with a
// native coordinator terminal (the runtime demands a live pane identity for
// coordinators) and the caller's canvas agents as workers (they are already
// handle-addressable runtime terminals). The coordinator tab stays in the
// strip — it IS the run's inbox, so it should be visible and honest.

export type OrchestrateArgs = {
  objective?: string
  tasks?: { title?: string; spec: string }[]
  workers?: string[]
}

const COORDINATOR_TITLE = 'Crew Coordinator'
// Why: worker-start blocks on engine agent_readiness (default 60s) before answering.
const CLI_TIMEOUT_MS = 75_000

type JsonRecord = Record<string, unknown>

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function shQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`
}

async function readJsonFile(path: string): Promise<JsonRecord | null> {
  try {
    const content = await window.api.crew.readTempFile({ path, deleteAfter: true })
    return JSON.parse(content) as JsonRecord
  } catch {
    return null
  }
}

async function runCli(ptyId: string, command: string): Promise<JsonRecord> {
  const outFile = `/tmp/crew-orch-${crypto.randomUUID()}.json`
  window.api.pty.write(ptyId, `${command} > ${shQuote(outFile)} 2>&1\r`)
  const started = Date.now()
  while (Date.now() - started < CLI_TIMEOUT_MS) {
    await sleep(600)
    const parsed = await readJsonFile(outFile)
    if (parsed) {
      return parsed
    }
  }
  throw new Error(`CLI não respondeu a tempo: ${command.slice(0, 80)}`)
}

function cliError(payload: JsonRecord): string | null {
  const error = payload.error as { code?: string; message?: string } | undefined
  return error ? `${error.code ?? 'erro'}: ${error.message ?? 'falha desconhecida'}` : null
}

async function ensureCoordinatorPty(
  worktreeId: string,
  canvasTabId: string
): Promise<{ ptyId: string; tabId: string }> {
  const store = useAppStore.getState()
  const canvasTab = (store.unifiedTabsByWorktree[worktreeId] ?? []).find(
    (tab) => tab.id === canvasTabId
  )
  const groupId = canvasTab?.groupId ?? store.activeGroupIdByWorktree[worktreeId]
  let tab = (store.tabsByWorktree[worktreeId] ?? []).find(
    (candidate) => candidate.customTitle === COORDINATOR_TITLE
  )
  if (!tab) {
    tab = store.createTab(worktreeId, groupId, undefined, { activate: false })
    store.setTabCustomTitle(tab.id, COORDINATOR_TITLE, { recordInteraction: false })
  }
  // The runtime only accepts a LIVE pane: mount the coordinator (brief view
  // swap — restored to the canvas tab when done).
  store.activateTab(tab.id)
  store.setActiveTabType('terminal')
  if (groupId) {
    store.focusGroup(worktreeId, groupId)
  }
  const started = Date.now()
  while (Date.now() - started < 15_000) {
    const ptyIds = useAppStore.getState().ptyIdsByTabId[tab.id] ?? []
    if (ptyIds.length > 0) {
      return { ptyId: ptyIds[0], tabId: tab.id }
    }
    await sleep(400)
  }
  throw new Error('o terminal coordenador não ganhou PTY a tempo')
}

export async function orchestrateRun(args: {
  canvasTabId: string
  worktreeId: string
  objective: string
  tasks: { title?: string; spec: string }[]
  workers: { label: string; ptyId: string }[]
}): Promise<string> {
  const store = useAppStore.getState()
  const { ptyId: coordinatorPty } = await ensureCoordinatorPty(args.worktreeId, args.canvasTabId)
  try {
    const runPayload = await runCli(
      coordinatorPty,
      `orca orchestration run-create --objective ${shQuote(args.objective)} --json`
    )
    const runError = cliError(runPayload)
    if (runError) {
      return `erro ao criar o run: ${runError}`
    }
    const runId = String(
      (runPayload.result as JsonRecord | undefined)?.run
        ? ((runPayload.result as JsonRecord).run as JsonRecord).id
        : ''
    )

    const lines: string[] = [`run ${runId} criado (coordenador: aba "${COORDINATOR_TITLE}")`]
    for (const task of args.tasks) {
      const titleFlag = task.title ? ` --task-title ${shQuote(task.title)}` : ''
      const taskPayload = await runCli(
        coordinatorPty,
        `orca orchestration task-create --spec ${shQuote(task.spec)}${titleFlag} --run ${runId} --json`
      )
      const taskError = cliError(taskPayload)
      if (taskError) {
        lines.push(`erro ao criar task "${task.title ?? task.spec.slice(0, 40)}": ${taskError}`)
        continue
      }
      const taskResult = taskPayload.result as JsonRecord | undefined
      const taskId = String((taskResult?.task as JsonRecord | undefined)?.id ?? '')
      lines.push(`task ${taskId} criada`)
      for (const worker of args.workers) {
        const listPayload = await runCli(coordinatorPty, 'orca terminal list --json')
        const terminals = ((listPayload.result as JsonRecord | undefined)?.terminals ??
          []) as JsonRecord[]
        const handle = terminals.find((t) => String(t.ptyId ?? '') === worker.ptyId)?.handle
        if (!handle) {
          lines.push(`erro: handle do worker "${worker.label}" não encontrado no runtime`)
          continue
        }
        const startPayload = await runCli(
          coordinatorPty,
          `orca orchestration worker-start --task ${taskId} --terminal ${String(handle)} --run ${runId} --json`
        )
        const startError = cliError(startPayload)
        lines.push(
          startError
            ? `erro ao despachar "${worker.label}": ${startError}`
            : `worker "${worker.label}" despachado pra task ${taskId}`
        )
      }
    }
    return lines.join('\n')
  } finally {
    // Restore the user's surface: back to the canvas tab.
    store.activateTab(args.canvasTabId)
    store.setActiveTabType('canvas')
    if (useAppStore.getState().unifiedTabsByWorktree[args.worktreeId]) {
      const canvasTab = useAppStore
        .getState()
        .unifiedTabsByWorktree[args.worktreeId].find((tab) => tab.id === args.canvasTabId)
      if (canvasTab) {
        store.focusGroup(args.worktreeId, canvasTab.groupId)
      }
    }
  }
}

function labelOf(node: CrewCanvasNode): string {
  return String(node.data.label ?? node.data.agentKind ?? '')
}

// Bridge entrypoint: resolves the caller's worktree + workers (explicit labels
// or every agent connected to it) and drives the native run.
export async function orchestrateFromCanvas(
  caller: CrewCanvasNode,
  canvasTabId: string,
  rawArgs: Record<string, unknown>
): Promise<string> {
  const args = rawArgs as OrchestrateArgs
  const objective = String(args.objective ?? '').trim()
  if (!objective) {
    return 'erro: objective obrigatório'
  }
  const store = useAppStore.getState()
  const worktreeId = Object.entries(store.unifiedTabsByWorktree).find(([, tabs]) =>
    (tabs ?? []).some((tab) => tab.id === canvasTabId)
  )?.[0]
  if (!worktreeId) {
    return 'erro: worktree da aba canvas não encontrado'
  }

  const graph = useCrewCanvas.getState().canvases[canvasTabId]
  if (!graph) {
    return 'erro: canvas da sua aba não encontrado'
  }
  const connectedAgents = graph.edges
    .filter((e) => e.source === caller.id || e.target === caller.id)
    .map((e) => graph.nodes.find((n) => n.id === (e.source === caller.id ? e.target : e.source)))
    .filter((n): n is CrewCanvasNode => Boolean(n) && n!.data.kind === 'agent')
  const wantedLabels = (args.workers ?? []).map((label) => label.toLowerCase())
  const targets =
    wantedLabels.length > 0
      ? connectedAgents.filter((node) => wantedLabels.includes(labelOf(node).toLowerCase()))
      : connectedAgents
  const missing = wantedLabels.filter(
    (label) => !targets.some((node) => labelOf(node).toLowerCase() === label)
  )
  if (missing.length > 0) {
    return `erro: workers não conectados a você: ${missing.join(', ')}`
  }
  const workers: { label: string; ptyId: string }[] = []
  for (const node of targets) {
    const ptyId = agentPtyOf(node.id)
    if (!ptyId) {
      return `erro: o agente "${labelOf(node)}" não tem terminal vivo`
    }
    workers.push({ label: labelOf(node), ptyId })
  }
  if (workers.length === 0) {
    return 'erro: nenhum worker conectado a você — conecte agentes por linha ou passe "workers"'
  }

  const tasks =
    args.tasks && args.tasks.length > 0
      ? args.tasks.filter((task) => task.spec?.trim())
      : [{ title: undefined, spec: objective }]
  return orchestrateRun({
    canvasTabId,
    worktreeId,
    objective,
    tasks: tasks.map((task) => ({ title: task.title, spec: task.spec })),
    workers
  })
}

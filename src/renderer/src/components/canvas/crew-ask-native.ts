import { callRuntimeRpc } from '@/runtime/runtime-rpc-client'
import { useCrewCanvas, type CrewCanvasNode } from './canvas-store'

export type CanvasLocatedNode = { node: CrewCanvasNode; tabId: string }

export function selectBrowserForNetwork(
  network: CanvasLocatedNode,
  args: Record<string, unknown>,
  connectedOfKind: (nodeId: string, kind: string) => CanvasLocatedNode[]
): CanvasLocatedNode | undefined {
  const browsers = connectedOfKind(network.node.id, 'browser')
  const requestedId = typeof args.browserNodeId === 'string' ? args.browserNodeId.trim() : ''
  if (requestedId) {
    return browsers.find(({ node }) => node.id === requestedId)
  }
  return browsers.length === 1 ? browsers[0] : undefined
}

export async function nativeRuntimeResult(
  method: string,
  params: Record<string, unknown>,
  errorPrefix: string
): Promise<string> {
  try {
    const result = await callRuntimeRpc<unknown>({ kind: 'local' }, method, params)
    return typeof result === 'string' ? result : JSON.stringify(result ?? null)
  } catch (error) {
    return `${errorPrefix}: ${error instanceof Error ? error.message : String(error)}`
  }
}

export async function runSimulatorTool(
  node: CrewCanvasNode,
  tool: string,
  args: Record<string, unknown>
): Promise<string> {
  const command = tool.slice('simulator.'.length)
  const method = `emulator.${command}`
  const runtimeWorktreeId = String(node.data.runtimeWorktreeId ?? '')
  if (!runtimeWorktreeId) {
    return 'erro: o simulador ainda não está associado a um worktree ativo'
  }
  const device = String(args.device ?? args.deviceUdid ?? node.data.deviceUdid ?? '').trim()
  const params: Record<string, unknown> = {
    ...args,
    worktree: runtimeWorktreeId,
    ...(device ? { device } : {})
  }
  delete params.nodeId
  delete params.deviceUdid
  return nativeRuntimeResult(method, params, 'erro no simulador nativo')
}

export function timerTool(
  tabId: string,
  nodeId: string,
  tool: string,
  args: Record<string, unknown>
): string {
  const graph = useCrewCanvas.getState().canvases[tabId]
  const node = graph?.nodes.find((candidate) => candidate.id === nodeId)
  if (!node) {
    return 'erro: timer não encontrado'
  }
  const data = node.data as CrewCanvasNode['data'] & { endAt?: number; remainingMs?: number }
  const now = Date.now()
  const active = typeof data.endAt === 'number' && data.endAt > now
  const remainingMs = active ? Math.max(0, data.endAt! - now) : Math.max(0, data.remainingMs ?? 0)
  if (tool === 'timer.read') {
    return JSON.stringify({ nodeId, running: active, remainingMs })
  }
  if (tool === 'timer.start') {
    const requestedMs = typeof args.ms === 'number' ? args.ms : undefined
    const requestedMinutes = typeof args.minutes === 'number' ? args.minutes * 60_000 : undefined
    const duration =
      requestedMs ?? requestedMinutes ?? (remainingMs > 0 ? remainingMs : 25 * 60_000)
    if (!Number.isFinite(duration) || duration <= 0 || duration > 24 * 60 * 60_000) {
      return 'erro: timer.start exige ms/minutes entre 1 e 1440 minutos'
    }
    useCrewCanvas.getState().updateNodeData(tabId, nodeId, {
      endAt: now + duration,
      remainingMs: undefined
    })
    return JSON.stringify({ nodeId, running: true, remainingMs: duration })
  }
  if (tool === 'timer.pause' || tool === 'timer.stop') {
    useCrewCanvas.getState().updateNodeData(tabId, nodeId, {
      endAt: undefined,
      remainingMs
    })
    return JSON.stringify({ nodeId, running: false, remainingMs })
  }
  if (tool === 'timer.reset') {
    const duration = typeof args.ms === 'number' && args.ms > 0 ? args.ms : 25 * 60_000
    useCrewCanvas.getState().updateNodeData(tabId, nodeId, {
      endAt: undefined,
      remainingMs: duration
    })
    return JSON.stringify({ nodeId, running: false, remainingMs: duration })
  }
  return `erro: tool desconhecida ${tool}`
}

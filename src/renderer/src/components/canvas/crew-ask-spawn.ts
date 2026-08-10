import type { Edge } from '@xyflow/react'
import { useCrewCanvas, type CrewCanvasNode, type CrewCanvasNodeData } from './canvas-store'

// Agent-driven node creation: the agent asks, the node appears next to it on
// its own canvas tab, already wired by an edge — the line is what unlocks the
// corresponding tools, so spawn and permission are the same act.

type SpawnableKind = Extract<
  CrewCanvasNodeData['kind'],
  'agent' | 'browser' | 'terminal' | 'simulator' | 'network' | 'note' | 'todo' | 'timer'
>

const SPAWN_SIZES: Record<SpawnableKind, { width: number; height: number }> = {
  agent: { width: 560, height: 380 },
  browser: { width: 560, height: 460 },
  terminal: { width: 520, height: 340 },
  simulator: { width: 400, height: 640 },
  network: { width: 480, height: 360 },
  note: { width: 260, height: 220 },
  todo: { width: 280, height: 300 },
  timer: { width: 220, height: 220 }
}

function isSpawnableKind(kind: string): kind is SpawnableKind {
  return kind in SPAWN_SIZES
}

export function spawnConnectedNode(
  caller: CrewCanvasNode,
  tabId: string,
  kind: string,
  data: Record<string, unknown>
): string {
  if (!isSpawnableKind(kind)) {
    return `erro: não sei spawnar "${kind}" (válidos: ${Object.keys(SPAWN_SIZES).join(', ')})`
  }
  const store = useCrewCanvas.getState()
  const graph = store.canvases[tabId]
  if (!graph) {
    return 'erro: canvas da sua aba não encontrado'
  }
  const id = crypto.randomUUID()
  const sameKind = graph.nodes.filter((n) => n.data.kind === kind).length
  const node: CrewCanvasNode = {
    id,
    type: kind,
    position: {
      x: caller.position.x + (caller.width ?? 560) + 80,
      y: caller.position.y + sameKind * 60
    },
    width: SPAWN_SIZES[kind].width,
    height: SPAWN_SIZES[kind].height,
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
  return `spawnado: ${kind} "${label}" conectado a você (id ${id.slice(0, 8)}). Se for terminal/browser, aguarde ~2s pro boot antes de usar.`
}

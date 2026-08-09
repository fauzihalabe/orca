import type { Edge } from '@xyflow/react'
import { useCrewCanvas, type CrewCanvasNode, type CrewCanvasNodeData } from './canvas-store'

// Agent-driven node creation: the agent asks, the node appears next to it on
// its own canvas tab, already wired by an edge — the line is what unlocks the
// corresponding tools, so spawn and permission are the same act.

type SpawnableKind = Extract<
  CrewCanvasNodeData['kind'],
  'agent' | 'browser' | 'terminal' | 'note' | 'todo'
>

const SPAWN_SIZES: Record<SpawnableKind, { width: number; height: number }> = {
  agent: { width: 560, height: 380 },
  browser: { width: 560, height: 460 },
  terminal: { width: 520, height: 340 },
  note: { width: 260, height: 220 },
  todo: { width: 280, height: 300 }
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

// Live self-discovery: edges change after boot, so the ground truth is the
// graph NOW — never the spawn-time preamble.
export function describeCapabilities(
  caller: CrewCanvasNode,
  graphEdges: Edge[],
  graphNodes: CrewCanvasNode[]
): string {
  const connected = graphEdges
    .filter((e) => e.source === caller.id || e.target === caller.id)
    .map((e) => graphNodes.find((n) => n.id === (e.source === caller.id ? e.target : e.source)))
    .filter((n): n is CrewCanvasNode => Boolean(n))
  const lines: string[] = []
  for (const node of connected) {
    const kind = String(node.data.kind)
    const label = String(node.data.label ?? node.data.agentKind ?? kind)
    if (kind === 'agent') {
      lines.push(`- agent "${label}" → ask {"to":"${label}","message":"..."}`)
    } else if (kind === 'browser') {
      lines.push(
        '- browser → browser.navigate {"url"}, browser.read, browser.click {"selector"}, browser.fill {"selector","value"}, browser.eval {"js"}'
      )
    } else if (kind === 'terminal') {
      lines.push('- terminal → terminal.run {"command"}')
    } else if (kind === 'note') {
      lines.push('- note → note.read, note.write {"text"}')
    } else if (kind === 'todo') {
      lines.push('- todo → todo.list, todo.add {"text"}, todo.toggle {"itemId"}')
    } else {
      lines.push(`- ${kind} "${label}" (sem tools diretas)`)
    }
  }
  const body = lines.length > 0 ? lines.join('\n') : '(nenhuma linha conectada a você ainda)'
  return (
    `Conectados agora:\n${body}\n\n` +
    'Spawn (sempre disponíveis, o node nasce conectado): terminal.spawn, browser.spawn {"url"?}, ' +
    'agent.spawn {"agentKind":"claude"|"codex"|"kimi","label","role"?}, note.spawn {"text"?}, todo.spawn.\n' +
    'Orquestração nativa: tool "orchestrate" {"objective","tasks"?,"workers"?} — cria um Run do Orca e despacha seus conectados.\n' +
    'Canvas inteiro: tool "graph".'
  )
}

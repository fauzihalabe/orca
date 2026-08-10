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
      lines.push(`- agent "${label}" (node ${node.id}) → ask {"to":"${node.id}","message":"..."}`)
    } else if (kind === 'browser') {
      lines.push(
        `- browser "${label}" (node ${node.id}) → todas as ferramentas nativas \`browser.*\` do Orca (ex.: browser.goto, browser.snapshot, browser.click, browser.fill, browser.eval, browser.screenshot, browser.network); página nativa \`${typeof node.data.browserPageId === 'string' && node.data.browserPageId.trim() ? node.data.browserPageId : `canvas-${node.id}`}\` → \`orca snapshot --page ${typeof node.data.browserPageId === 'string' && node.data.browserPageId.trim() ? node.data.browserPageId : `canvas-${node.id}`} --json\``
      )
    } else if (kind === 'terminal') {
      lines.push(`- terminal "${label}" (node ${node.id}) → terminal.run {"command"}`)
    } else if (kind === 'note') {
      lines.push(`- note "${label}" (node ${node.id}) → note.read, note.write {"text"}`)
    } else if (kind === 'todo') {
      lines.push(
        `- todo "${label}" (node ${node.id}) → todo.list, todo.add {"text"}, todo.toggle {"itemId"}`
      )
    } else if (kind === 'simulator') {
      lines.push(
        `- simulator "${label}" (node ${node.id}) → simulator.tap {"x","y"}, simulator.type {"text"}, simulator.gesture {"points"}, simulator.button {"name"}, simulator.rotate {"orientation"}, simulator.ax, simulator.logcat; executado pelo runtime nativo do Orca`
      )
    } else if (kind === 'network') {
      lines.push(
        `- network "${label}" (node ${node.id}) → network.read; precisa também de uma linha desse network para um browser conectado`
      )
    } else if (kind === 'timer') {
      lines.push(
        `- timer "${label}" (node ${node.id}) → timer.read, timer.start {"minutes"|"ms"}, timer.pause, timer.reset`
      )
    } else {
      lines.push(`- ${kind} "${label}" (sem tools diretas)`)
    }
  }
  const body = lines.length > 0 ? lines.join('\n') : '(nenhuma linha conectada a você ainda)'
  return (
    `Conectados agora:\n${body}\n\n` +
    'Spawn (sempre disponíveis, o node nasce conectado): terminal.spawn, browser.spawn {"url"?}, ' +
    'agent.spawn {"agentKind":"claude"|"codex"|"kimi","label","role"?}, note.spawn {"text"?}, todo.spawn, ' +
    'timer.spawn, simulator.spawn, network.spawn. Network também precisa ser ligado a um browser.\n' +
    'Orquestração nativa: tool "orchestrate" {"objective","tasks"?,"workers"?} — cria um Run do Orca e despacha seus conectados.\n' +
    'Canvas inteiro: tool "graph".'
  )
}

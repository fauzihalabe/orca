import type { CrewCanvasNodeSnapshot } from './crew-canvas'

export type CrewCanvasSpawnKind =
  | 'agent'
  | 'browser'
  | 'terminal'
  | 'simulator'
  | 'network'
  | 'note'
  | 'todo'
  | 'timer'

export type CrewCanvasNodeSize = { width: number; height: number }

export const CREW_CANVAS_NODE_SIZES: Record<CrewCanvasSpawnKind, CrewCanvasNodeSize> = {
  agent: { width: 560, height: 380 },
  browser: { width: 560, height: 460 },
  terminal: { width: 520, height: 340 },
  simulator: { width: 400, height: 640 },
  network: { width: 480, height: 360 },
  note: { width: 260, height: 220 },
  todo: { width: 280, height: 300 },
  timer: { width: 220, height: 220 }
}

const NODE_GAP = 64
const FALLBACK_NODE_SIZE = { width: 320, height: 240 }

function finiteDimension(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null
}

function nodeSize(node: CrewCanvasNodeSnapshot): CrewCanvasNodeSize {
  const measured =
    typeof node.measured === 'object' && node.measured !== null
      ? (node.measured as Record<string, unknown>)
      : null
  const kind = typeof node.data.kind === 'string' ? node.data.kind : ''
  const known =
    kind in CREW_CANVAS_NODE_SIZES
      ? CREW_CANVAS_NODE_SIZES[kind as CrewCanvasSpawnKind]
      : FALLBACK_NODE_SIZE
  return {
    width: finiteDimension(node.width) ?? finiteDimension(measured?.width) ?? known.width,
    height: finiteDimension(node.height) ?? finiteDimension(measured?.height) ?? known.height
  }
}

function overlaps(
  position: { x: number; y: number },
  size: CrewCanvasNodeSize,
  node: CrewCanvasNodeSnapshot
): boolean {
  const nodePosition = node.position ?? { x: 0, y: 0 }
  const occupied = nodeSize(node)
  return (
    position.x < nodePosition.x + occupied.width + NODE_GAP &&
    position.x + size.width + NODE_GAP > nodePosition.x &&
    position.y < nodePosition.y + occupied.height + NODE_GAP &&
    position.y + size.height + NODE_GAP > nodePosition.y
  )
}

function candidateOffsets(limit: number): number[] {
  const offsets = [0]
  for (let distance = 1; distance <= limit; distance += 1) {
    offsets.push(distance, -distance)
  }
  return offsets
}

export function findCrewCanvasSpawnPosition(
  caller: CrewCanvasNodeSnapshot,
  nodes: readonly CrewCanvasNodeSnapshot[],
  size: CrewCanvasNodeSize
): { x: number; y: number } {
  const callerPosition = caller.position ?? { x: 0, y: 0 }
  const callerDimensions = nodeSize(caller)
  const preferred = {
    x: callerPosition.x,
    y: callerPosition.y + callerDimensions.height + NODE_GAP
  }
  const searchLimit = Math.max(4, nodes.length + 2)
  const offsets = candidateOffsets(searchLimit)
  const candidates = offsets.flatMap((column) =>
    Array.from({ length: searchLimit + 1 }, (_, row) => ({
      x: preferred.x + column * (size.width + NODE_GAP),
      y: preferred.y + row * (size.height + NODE_GAP)
    }))
  )
  candidates.sort((left, right) => {
    const leftDistance = Math.hypot(left.x - preferred.x, left.y - preferred.y)
    const rightDistance = Math.hypot(right.x - preferred.x, right.y - preferred.y)
    return leftDistance - rightDistance || left.y - right.y || left.x - right.x
  })
  const available = candidates.find((position) =>
    nodes.every((node) => !overlaps(position, size, node))
  )
  if (available) {
    return available
  }
  const lowestEdge = nodes.reduce((bottom, node) => {
    const position = node.position ?? { x: 0, y: 0 }
    return Math.max(bottom, position.y + nodeSize(node).height)
  }, preferred.y)
  return { x: preferred.x, y: lowestEdge + NODE_GAP }
}

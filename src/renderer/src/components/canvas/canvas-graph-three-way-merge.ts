import type { Edge } from '@xyflow/react'
import {
  withoutCrewCanvasTransientEdgeState,
  withoutCrewCanvasTransientNodeState
} from '../../../../shared/crew-canvas'
import type { CrewCanvasGraph, CrewCanvasNode } from './canvas-store'

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function mergeItems<T extends { id?: string }>(args: {
  base: T[]
  local: T[]
  main: T[]
  stable: (item: T) => unknown
}): T[] {
  const baseById = new Map(args.base.map((item) => [item.id, item]))
  const localById = new Map(args.local.map((item) => [item.id, item]))
  const mainById = new Map(args.main.map((item) => [item.id, item]))
  const merged = new Map(mainById)

  for (const [id, baseItem] of baseById) {
    const localItem = localById.get(id)
    if (!localItem) {
      merged.delete(id)
      continue
    }
    if (!sameValue(args.stable(localItem), args.stable(baseItem))) {
      merged.set(id, localItem)
    }
  }

  for (const [id, localItem] of localById) {
    if (!baseById.has(id)) {
      merged.set(id, localItem)
    }
  }

  return [...merged.values()]
}

export function mergeCrewCanvasGraphs(
  base: CrewCanvasGraph,
  local: CrewCanvasGraph,
  main: CrewCanvasGraph
): CrewCanvasGraph {
  return {
    nodes: mergeItems<CrewCanvasNode>({
      base: base.nodes,
      local: local.nodes,
      main: main.nodes,
      stable: withoutCrewCanvasTransientNodeState
    }),
    edges: mergeItems<Edge>({
      base: base.edges,
      local: local.edges,
      main: main.edges,
      stable: withoutCrewCanvasTransientEdgeState
    }),
    viewport: sameValue(base.viewport, local.viewport) ? main.viewport : local.viewport,
    edgeStyle: base.edgeStyle === local.edgeStyle ? main.edgeStyle : local.edgeStyle
  }
}

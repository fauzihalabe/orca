import { describe, expect, it } from 'vitest'
import type { CrewCanvasNodeSnapshot } from './crew-canvas'
import { CREW_CANVAS_NODE_SIZES, findCrewCanvasSpawnPosition } from './crew-canvas-node-placement'

function node(
  id: string,
  kind: string,
  position: { x: number; y: number },
  width: number,
  height: number
): CrewCanvasNodeSnapshot {
  return { id, position, width, height, data: { kind } }
}

describe('findCrewCanvasSpawnPosition', () => {
  it('places the first terminal directly below its agent', () => {
    const agent = node('agent', 'agent', { x: 300, y: 120 }, 560, 380)

    expect(findCrewCanvasSpawnPosition(agent, [agent], CREW_CANVAS_NODE_SIZES.terminal)).toEqual({
      x: 300,
      y: 564
    })
  })

  it('uses the nearest free slot without overlapping an existing browser', () => {
    const agent = node('agent', 'agent', { x: 300, y: 120 }, 560, 380)
    const browser = node('browser', 'browser', { x: 300, y: 540 }, 1064, 835)
    const position = findCrewCanvasSpawnPosition(
      agent,
      [agent, browser],
      CREW_CANVAS_NODE_SIZES.terminal
    )

    expect(position).toEqual({ x: -284, y: 564 })
  })

  it('uses measured dimensions before a renderer node publishes width and height', () => {
    const agent = {
      id: 'agent',
      position: { x: 40, y: 20 },
      measured: { width: 700, height: 500 },
      data: { kind: 'agent' }
    }

    expect(findCrewCanvasSpawnPosition(agent, [agent], CREW_CANVAS_NODE_SIZES.todo)).toEqual({
      x: 40,
      y: 584
    })
  })
})

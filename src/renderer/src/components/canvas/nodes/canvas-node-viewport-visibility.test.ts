import { describe, expect, it } from 'vitest'
import { canvasNodeIntersectsViewport } from './canvas-node-viewport-visibility'

describe('canvasNodeIntersectsViewport', () => {
  it.each([
    [{ x: 10, y: 20, width: 400, height: 300 }, true],
    [{ x: -399, y: 20, width: 400, height: 300 }, true],
    [{ x: -400, y: 20, width: 400, height: 300 }, false],
    [{ x: 1000, y: 20, width: 400, height: 300 }, false],
    [{ x: 20, y: 800, width: 400, height: 300 }, false]
  ])('projects the node into the visible viewport', (node, expected) => {
    expect(
      canvasNodeIntersectsViewport({
        node,
        viewport: { width: 1000, height: 800 },
        transform: [0, 0, 1]
      })
    ).toBe(expected)
  })

  it('accounts for pan and zoom', () => {
    expect(
      canvasNodeIntersectsViewport({
        node: { x: 1000, y: 1000, width: 400, height: 300 },
        viewport: { width: 1000, height: 800 },
        transform: [-400, -400, 0.5]
      })
    ).toBe(true)
  })

  it('keeps unmeasured nodes visible until React Flow has dimensions', () => {
    expect(
      canvasNodeIntersectsViewport({
        node: { x: 1000, y: 1000, width: 0, height: 0 },
        viewport: { width: 1000, height: 800 },
        transform: [0, 0, 1]
      })
    ).toBe(true)
  })
})

// @vitest-environment happy-dom
import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { CrewCanvasGraph } from './canvas-store'
import { useActiveCanvasDeletion } from './use-active-canvas-deletion'

function selectedGraph(id: string): CrewCanvasGraph {
  return {
    nodes: [
      {
        id,
        type: 'note',
        position: { x: 0, y: 0 },
        selected: true,
        data: { kind: 'note' }
      }
    ],
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    edgeStyle: 'lineit'
  }
}

describe('active Canvas deletion', () => {
  it('allows only the event-time owner to consume Delete during listener overlap', () => {
    const removeOrca = vi.fn()
    const removeChutaae = vi.fn()
    const readOrca = vi.fn(() => selectedGraph('agent-orca'))
    const readChutaae = vi.fn(() => selectedGraph('browser-chutaae'))
    let owner = 'chutaae'
    renderHook(() =>
      useActiveCanvasDeletion({
        enabled: true,
        ownsKeyboardAtEvent: () => owner === 'orca',
        readGraph: readOrca,
        removeElements: removeOrca
      })
    )
    renderHook(() =>
      useActiveCanvasDeletion({
        enabled: true,
        ownsKeyboardAtEvent: () => owner === 'chutaae',
        readGraph: readChutaae,
        removeElements: removeChutaae
      })
    )

    act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete' })))

    expect(removeChutaae).toHaveBeenCalledWith(['browser-chutaae'], [])
    expect(removeOrca).not.toHaveBeenCalled()

    owner = 'orca'
    act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace' })))

    expect(removeOrca).toHaveBeenCalledWith(['agent-orca'], [])
    expect(removeChutaae).toHaveBeenCalledTimes(1)
  })
})

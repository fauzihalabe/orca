import { describe, expect, it, vi } from 'vitest'
import { canMeasureCanvasTerminal, fitCanvasTerminalViewport } from './canvas-terminal-geometry'

function terminalContainer(width: number, height: number): HTMLElement {
  return {
    getBoundingClientRect: () => ({ width, height })
  } as HTMLElement
}

describe('Canvas terminal geometry', () => {
  it('does not fit an inactive or collapsed Canvas terminal', () => {
    const fit = vi.fn()
    const fitAddon = { fit, proposeDimensions: vi.fn(() => ({ cols: 1, rows: 40 })) }

    expect(
      fitCanvasTerminalViewport({
        active: false,
        container: terminalContainer(900, 700),
        fitAddon
      })
    ).toBeNull()
    expect(
      fitCanvasTerminalViewport({
        active: true,
        container: terminalContainer(1, 700),
        fitAddon
      })
    ).toBeNull()
    expect(fit).not.toHaveBeenCalled()
  })

  it('fits and returns a valid visible terminal grid', () => {
    const fit = vi.fn()
    const fitAddon = { fit, proposeDimensions: vi.fn(() => ({ cols: 120, rows: 40 })) }
    const container = terminalContainer(900, 700)

    expect(canMeasureCanvasTerminal(container)).toBe(true)
    expect(fitCanvasTerminalViewport({ active: true, container, fitAddon })).toEqual({
      cols: 120,
      rows: 40
    })
    expect(fit).toHaveBeenCalledOnce()
  })
})

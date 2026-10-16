import { describe, expect, it } from 'vitest'
import { getDefaultSettings } from '../../../../shared/constants'
import {
  canvasTerminalColorOptions,
  resolveCanvasTerminalAppearance
} from './canvas-terminal-appearance'

describe('Canvas terminal appearance', () => {
  it('uses the complete native dark terminal palette and contrast floor', () => {
    const settings = { ...getDefaultSettings('/tmp'), theme: 'dark' as const }
    const appearance = resolveCanvasTerminalAppearance(settings, false)

    expect(appearance.theme).toMatchObject({
      background: expect.any(String),
      foreground: expect.any(String),
      black: expect.any(String),
      white: expect.any(String),
      brightBlack: expect.any(String),
      brightWhite: expect.any(String)
    })
    expect(canvasTerminalColorOptions(appearance).minimumContrastRatio).toBe(3)
  })

  it('uses the native light palette and WCAG-AA contrast floor', () => {
    const settings = { ...getDefaultSettings('/tmp'), theme: 'light' as const }
    const appearance = resolveCanvasTerminalAppearance(settings, true)

    expect(appearance.mode).toBe('light')
    expect(appearance.theme).toMatchObject({
      background: expect.any(String),
      foreground: expect.any(String),
      white: expect.any(String),
      brightWhite: expect.any(String)
    })
    expect(canvasTerminalColorOptions(appearance).minimumContrastRatio).toBe(4.5)
  })
})

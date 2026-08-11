// @vitest-environment happy-dom

import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { buildCanvasTerminalTheme, useCanvasColorMode } from './canvas-theme'

afterEach(() => {
  document.documentElement.className = ''
  document.documentElement.removeAttribute('style')
})

describe('canvas theme', () => {
  it('follows the document color mode when the root class changes', async () => {
    document.documentElement.className = 'light'
    const view = renderHook(() => useCanvasColorMode())

    expect(view.result.current).toBe('light')

    act(() => document.documentElement.classList.replace('light', 'dark'))

    await waitFor(() => expect(view.result.current).toBe('dark'))
    view.unmount()
  })

  it('builds the terminal palette from the active document tokens', () => {
    document.documentElement.style.setProperty('--background', '#fff')
    document.documentElement.style.setProperty('--foreground', '#111')
    document.documentElement.style.setProperty('--primary', '#222')
    document.documentElement.style.setProperty('--ring', '#333')

    expect(buildCanvasTerminalTheme()).toEqual({
      background: '#fff',
      foreground: '#111',
      cursor: '#222',
      selectionBackground: '#333'
    })
  })
})

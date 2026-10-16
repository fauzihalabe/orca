// @vitest-environment happy-dom

import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { useCanvasColorMode } from './canvas-theme'

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
})

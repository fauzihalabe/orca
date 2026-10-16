import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { canvasOwnsKeyboard, canvasOwnsKeyboardAtEvent } from './canvas-keyboard-ownership'

function keyboardState(activeWorktreeId: string) {
  return {
    activeView: 'terminal',
    activeWorktreeId,
    activeGroupIdByWorktree: {
      orca: 'orca-group',
      mcgames: 'mcgames-group'
    },
    groupsByWorktree: {
      orca: [{ id: 'orca-group', activeTabId: 'orca-canvas' }],
      mcgames: [{ id: 'mcgames-group', activeTabId: 'mcgames-canvas' }]
    },
    unifiedTabsByWorktree: {
      orca: [{ id: 'orca-canvas', groupId: 'orca-group', contentType: 'canvas' }],
      mcgames: [{ id: 'mcgames-canvas', groupId: 'mcgames-group', contentType: 'canvas' }]
    }
  }
}

describe('Canvas keyboard ownership', () => {
  it('belongs only to the visible Canvas in the focused split group', () => {
    expect(
      canvasOwnsKeyboard({ visible: true, groupId: 'group-left', activeGroupId: 'group-right' })
    ).toBe(false)
    expect(
      canvasOwnsKeyboard({ visible: true, groupId: 'group-right', activeGroupId: 'group-right' })
    ).toBe(true)
    expect(
      canvasOwnsKeyboard({ visible: false, groupId: 'group-right', activeGroupId: 'group-right' })
    ).toBe(false)
  })

  it('rechecks the active workspace and tab from the live store', () => {
    const state = keyboardState('mcgames')

    expect(
      canvasOwnsKeyboardAtEvent({
        tabId: 'mcgames-canvas',
        worktreeId: 'mcgames',
        state
      })
    ).toBe(true)
    expect(canvasOwnsKeyboardAtEvent({ tabId: 'orca-canvas', worktreeId: 'orca', state })).toBe(
      false
    )
  })

  it('restricts the global Canvas to its top-level view', () => {
    const state = keyboardState('mcgames')

    expect(canvasOwnsKeyboardAtEvent({ tabId: 'default', worktreeId: null, state })).toBe(false)
    state.activeView = 'canvas'
    expect(canvasOwnsKeyboardAtEvent({ tabId: 'default', worktreeId: null, state })).toBe(true)
  })

  it('disables the React Flow global deletion handler', () => {
    const source = readFileSync(new URL('./CanvasPage.tsx', import.meta.url), 'utf8')

    expect(source).toMatch(/<ReactFlow[\s\S]*?deleteKeyCode=\{null\}/)
  })
})

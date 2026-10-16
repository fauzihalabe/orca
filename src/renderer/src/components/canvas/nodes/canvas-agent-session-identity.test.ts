import { describe, expect, it } from 'vitest'
import { canvasAgentMirrorIdentityFromData } from './canvas-agent-session-identity'

describe('canvasAgentMirrorIdentityFromData', () => {
  it('keeps the native mirror tied to its worktree', () => {
    expect(
      canvasAgentMirrorIdentityFromData({
        mirrorTabId: 'tab-custom2',
        mirrorLeafId: '11111111-1111-4111-8111-111111111111',
        mirrorWorktreeId: 'worktree-custom2'
      })
    ).toEqual({
      tabId: 'tab-custom2',
      leafId: '11111111-1111-4111-8111-111111111111',
      worktreeId: 'worktree-custom2'
    })
  })

  it('uses the canvas scope for nodes created before the mirror is ready', () => {
    expect(
      canvasAgentMirrorIdentityFromData({
        mirrorTabId: 'tab-chutaae',
        canvasWorktreeId: 'worktree-chutaae'
      })
    ).toEqual({ tabId: 'tab-chutaae', worktreeId: 'worktree-chutaae' })
  })

  it('does not infer a workspace from an old unscoped mirror', () => {
    expect(
      canvasAgentMirrorIdentityFromData({
        mirrorTabId: 'tab-legacy',
        mirrorLeafId: '22222222-2222-4222-8222-222222222222'
      })
    ).toEqual({
      tabId: 'tab-legacy',
      leafId: '22222222-2222-4222-8222-222222222222'
    })
  })
})

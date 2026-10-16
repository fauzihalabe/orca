import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const registry = vi.hoisted(() => ({
  registeredWebContentsIds: new Map<string, number>(),
  webviewRegistry: new Map<string, Electron.WebviewTag>()
}))

vi.mock('@/components/browser-pane/webview-registry', () => registry)

describe('Canvas browser registration', () => {
  const isGuestRegistered = vi.fn()
  const repairGuestRegistration = vi.fn()

  beforeEach(() => {
    registry.registeredWebContentsIds.clear()
    registry.webviewRegistry.clear()
    isGuestRegistered.mockReset()
    repairGuestRegistration.mockReset()
    vi.stubGlobal('window', {
      setTimeout,
      api: { browser: { isGuestRegistered, repairGuestRegistration } }
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('accepts only a registration confirmed by the main process', async () => {
    isGuestRegistered.mockResolvedValue(true)
    registry.webviewRegistry.set('page-1', {
      getWebContentsId: () => 41
    } as unknown as Electron.WebviewTag)
    const { waitForCanvasBrowserRegistration } = await import('./canvas-browser-registration')

    await expect(
      waitForCanvasBrowserRegistration(
        { pageId: 'page-1', workspaceId: 'workspace-1', worktreeId: 'worktree-1' },
        0
      )
    ).resolves.toBe(true)
    expect(registry.registeredWebContentsIds.get('page-1')).toBe(41)
    expect(repairGuestRegistration).not.toHaveBeenCalled()
  })

  it('repairs a stale renderer registration without replacing the page', async () => {
    isGuestRegistered.mockResolvedValue(false)
    repairGuestRegistration.mockResolvedValue(true)
    registry.webviewRegistry.set('page-2', {
      getWebContentsId: () => 73
    } as unknown as Electron.WebviewTag)
    const { waitForCanvasBrowserRegistration } = await import('./canvas-browser-registration')

    await expect(
      waitForCanvasBrowserRegistration(
        {
          pageId: 'page-2',
          workspaceId: 'workspace-2',
          worktreeId: 'worktree-2',
          sessionProfileId: 'profile-1'
        },
        0
      )
    ).resolves.toBe(true)
    expect(repairGuestRegistration).toHaveBeenCalledWith({
      browserPageId: 'page-2',
      workspaceId: 'workspace-2',
      worktreeId: 'worktree-2',
      sessionProfileId: 'profile-1',
      webContentsId: 73
    })
    expect(registry.registeredWebContentsIds.get('page-2')).toBe(73)
  })

  it('does not report readiness without a live webview', async () => {
    const { waitForCanvasBrowserRegistration } = await import('./canvas-browser-registration')

    await expect(
      waitForCanvasBrowserRegistration(
        { pageId: 'missing', workspaceId: 'workspace-3', worktreeId: 'worktree-3' },
        0
      )
    ).resolves.toBe(false)
    expect(isGuestRegistered).not.toHaveBeenCalled()
  })

  it('rejects a guest that is replaced while native registration is being confirmed', async () => {
    const original = {
      isConnected: true,
      getWebContentsId: () => 91
    } as unknown as Electron.WebviewTag
    const replacement = {
      isConnected: true,
      getWebContentsId: () => 92
    } as unknown as Electron.WebviewTag
    registry.webviewRegistry.set('page-reparented', original)
    isGuestRegistered.mockImplementation(async () => {
      registry.webviewRegistry.set('page-reparented', replacement)
      return true
    })
    const { waitForCanvasBrowserRegistration } = await import('./canvas-browser-registration')

    await expect(
      waitForCanvasBrowserRegistration(
        {
          pageId: 'page-reparented',
          workspaceId: 'workspace-reparented',
          worktreeId: 'worktree-reparented'
        },
        0
      )
    ).resolves.toBe(false)
    expect(registry.registeredWebContentsIds.has('page-reparented')).toBe(false)
    expect(repairGuestRegistration).not.toHaveBeenCalled()
  })
})

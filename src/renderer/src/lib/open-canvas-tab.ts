import { useAppStore } from '@/store'
import { translate } from '@/i18n/i18n'

// Canvas tabs are ordinary unified tabs with contentType 'canvas'; the pane
// itself renders in CanvasPaneOverlayLayer (same anchor-slot pattern as the
// emulator pane), so the graph survives tab switches without remounting.

// Why structural and minimal: worktree-activation passes its own narrowed
// store type, and unit tests drive the opener with plain vi.fn() mocks.
export type CanvasTabOpenerStore = {
  activateTab: (tabId: string) => void
  activeGroupIdByWorktree: Record<string, string | undefined>
  createUnifiedTab: (
    worktreeId: string,
    contentType: 'canvas',
    init?: {
      label?: string
      targetGroupId?: string
      activate?: boolean
      recordInteraction?: boolean
    }
  ) => { id: string; groupId: string }
  focusGroup: (worktreeId: string, groupId: string) => void
  groupsByWorktree: Record<string, readonly { id: string }[] | undefined>
  setActiveTabType: (type: 'canvas') => void
}

export type OpenCanvasTabOptions = {
  targetGroupId?: string
  activate?: boolean
  recordInteraction?: boolean
}

export function openCanvasTabIn(
  store: CanvasTabOpenerStore,
  worktreeId: string,
  options?: OpenCanvasTabOptions
): string {
  const targetGroupId =
    options?.targetGroupId ??
    store.activeGroupIdByWorktree[worktreeId] ??
    store.groupsByWorktree[worktreeId]?.[0]?.id
  const shouldActivate = options?.activate ?? true
  const tab = store.createUnifiedTab(worktreeId, 'canvas', {
    label: translate('auto.lib.open.canvas.tab.canvasLabel', 'Canvas'),
    ...(targetGroupId ? { targetGroupId } : {}),
    activate: shouldActivate,
    ...(options?.recordInteraction === false ? { recordInteraction: false } : {})
  })
  if (shouldActivate) {
    store.activateTab(tab.id)
    store.setActiveTabType('canvas')
    store.focusGroup(worktreeId, tab.groupId)
  }
  return tab.id
}

export function openCanvasTab(worktreeId: string, options?: OpenCanvasTabOptions): string {
  return openCanvasTabIn(useAppStore.getState(), worktreeId, options)
}

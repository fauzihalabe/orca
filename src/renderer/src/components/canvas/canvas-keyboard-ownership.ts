export function canvasOwnsKeyboard(args: {
  visible: boolean
  groupId: string | undefined
  activeGroupId: string | undefined
}): boolean {
  return Boolean(args.visible && args.groupId && args.groupId === args.activeGroupId)
}

type CanvasKeyboardState = {
  activeView: string
  activeWorktreeId: string | null
  activeGroupIdByWorktree: Record<string, string | undefined>
  groupsByWorktree: Record<
    string,
    readonly { id: string; activeTabId: string | null }[] | undefined
  >
  unifiedTabsByWorktree: Record<
    string,
    readonly { id: string; groupId: string; contentType: string }[] | undefined
  >
}

export function canvasOwnsKeyboardAtEvent(args: {
  tabId: string
  worktreeId: string | null
  state: CanvasKeyboardState
}): boolean {
  const { state, tabId, worktreeId } = args
  if (worktreeId === null) {
    return tabId === 'default' && state.activeView === 'canvas'
  }
  if (state.activeView !== 'terminal' || state.activeWorktreeId !== worktreeId) {
    return false
  }
  const groups = state.groupsByWorktree[worktreeId] ?? []
  const activeGroupId = state.activeGroupIdByWorktree[worktreeId] ?? groups[0]?.id
  const activeGroup = groups.find((group) => group.id === activeGroupId)
  if (!activeGroupId || activeGroup?.activeTabId !== tabId) {
    return false
  }
  return Boolean(
    state.unifiedTabsByWorktree[worktreeId]?.some(
      (tab) => tab.id === tabId && tab.groupId === activeGroupId && tab.contentType === 'canvas'
    )
  )
}

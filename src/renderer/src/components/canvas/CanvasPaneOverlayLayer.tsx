import { memo, useCallback, useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useAppStore } from '@/store'
import type { Tab, TabGroup } from '../../../../shared/types'
import CanvasPage from '../canvas/CanvasPage'
import { tabGroupBodyAnchorName } from '../tab-group/tab-group-body-anchor'

const EMPTY_UNIFIED_TABS: readonly Tab[] = []
const EMPTY_GROUPS: readonly TabGroup[] = []

function useWorktreePath(worktreeId: string): string | null {
  return useAppStore((state) => {
    for (const worktrees of Object.values(state.worktreesByRepo ?? {})) {
      const found = worktrees.find((w) => w.id === worktreeId)
      if (found) {
        return found.path
      }
    }
    return null
  })
}

type CanvasOverlaySlotProps = {
  tab: Tab
  groupId: string | undefined
  isActive: boolean
  onFocusOwningGroup: ((groupId: string) => void) | undefined
}

const CanvasOverlaySlot = memo(function CanvasOverlaySlot({
  tab,
  groupId,
  isActive,
  onFocusOwningGroup
}: CanvasOverlaySlotProps): React.JSX.Element {
  const anchorName = groupId !== undefined ? tabGroupBodyAnchorName(groupId) : undefined
  const worktreePath = useWorktreePath(tab.worktreeId)
  const style: React.CSSProperties = useMemo(
    () =>
      anchorName
        ? {
            position: 'absolute',
            positionAnchor: anchorName,
            top: `anchor(${anchorName} top)`,
            left: `anchor(${anchorName} left)`,
            width: `anchor-size(${anchorName} width)`,
            height: `anchor-size(${anchorName} height)`,
            zIndex: isActive ? 2 : 1,
            visibility: isActive ? 'visible' : 'hidden',
            pointerEvents: isActive ? 'auto' : 'none'
          }
        : { display: 'none' },
    [anchorName, isActive]
  )

  return (
    <div
      style={style}
      className="orca-canvas-overlay-slot min-h-0 min-w-0 overflow-hidden"
      data-active={isActive ? 'true' : 'false'}
      onPointerDownCapture={() => {
        if (groupId && onFocusOwningGroup) {
          onFocusOwningGroup(groupId)
        }
      }}
    >
      <CanvasPage
        tabId={tab.id}
        worktreeId={tab.worktreeId}
        worktreePath={worktreePath}
        isActive={isActive}
      />
    </div>
  )
})

// Canvas tabs render as an overlay layer, exactly like the emulator pane —
// each canvas tab stays MOUNTED while hidden so its agent PTYs keep running.
const CanvasPaneOverlayLayer = memo(function CanvasPaneOverlayLayer({
  worktreeId,
  isWorktreeActive
}: {
  worktreeId: string
  isWorktreeActive: boolean
}): React.JSX.Element {
  const { unifiedTabs, groups } = useAppStore(
    useShallow((state) => ({
      unifiedTabs: state.unifiedTabsByWorktree[worktreeId] ?? EMPTY_UNIFIED_TABS,
      groups: state.groupsByWorktree[worktreeId] ?? EMPTY_GROUPS
    }))
  )
  const focusGroup = useAppStore((state) => state.focusGroup)
  const focusOwningGroup = useCallback(
    (groupId: string) => focusGroup(worktreeId, groupId),
    [focusGroup, worktreeId]
  )

  const groupActiveTabById = useMemo(() => {
    const lookup: Record<string, string | null | undefined> = {}
    for (const group of groups) {
      lookup[group.id] = group.activeTabId
    }
    return lookup
  }, [groups])

  const canvasTabs = useMemo(
    () => unifiedTabs.filter((t) => t.contentType === 'canvas'),
    [unifiedTabs]
  )

  return (
    <>
      {canvasTabs.map((tab) => {
        const isActiveInGroup = groupActiveTabById[tab.groupId] === tab.id
        const isActive = Boolean(isWorktreeActive && isActiveInGroup)
        return (
          <CanvasOverlaySlot
            key={tab.id}
            tab={tab}
            groupId={tab.groupId}
            isActive={isActive}
            onFocusOwningGroup={focusOwningGroup}
          />
        )
      })}
    </>
  )
})

export default CanvasPaneOverlayLayer

import { useCallback, useRef } from 'react'
import { translate } from '@/i18n/i18n'
import BrowserPane from '@/components/browser-pane/BrowserPane'
import {
  registerBrowserOverlaySlotViewport,
  unregisterBrowserOverlaySlotViewport
} from '@/components/browser-pane/browser-page-viewport'
import { useAppStore } from '@/store'
import type { BrowserTab as BrowserTabState } from '../../../../shared/types'
import { useCrewCanvas } from '../canvas/canvas-store'

// Why: BrowserPane mounts its persistent Electron <webview> into a slot viewport
// root keyed by the browser tab id. The main workspace registers that root via
// BrowserPaneOverlayLayer, but the floating panel renders BrowserPane directly
// and has no overlay layer — so without registering a root here,
// ensureBrowserPageViewport returns null, the webview is never created, and the
// page spins on "loading" forever. Mirror BrowserOverlaySlot's slot-root div so
// the guest mounts and survives tab switches (the root must not be reparented).
export function FloatingBrowserSlot({
  browserTab,
  isActive
}: {
  browserTab: BrowserTabState
  isActive: boolean
}): React.JSX.Element {
  const activeView = useAppStore((state) => state.activeView)
  const canvasOwnsBrowser = useCrewCanvas((state) => {
    if (activeView !== 'canvas') {
      return false
    }
    return (state.canvases.default?.nodes ?? []).some((node) => {
      if (node.data.kind !== 'browser') {
        return false
      }
      const configuredWorkspaceId = node.data.browserWorkspaceId
      return (
        browserTab.id ===
        (typeof configuredWorkspaceId === 'string' && configuredWorkspaceId.trim().length > 0
          ? configuredWorkspaceId
          : `canvas-browser-${node.id}`)
      )
    })
  })
  const slotRootRef = useRef<HTMLDivElement | null>(null)
  const setSlotViewportRef = useCallback(
    (node: HTMLDivElement | null): void => {
      if (node) {
        slotRootRef.current = node
        registerBrowserOverlaySlotViewport(browserTab.id, node)
        return
      }
      const previous = slotRootRef.current
      slotRootRef.current = null
      if (previous) {
        unregisterBrowserOverlaySlotViewport(browserTab.id, previous)
      }
    },
    [browserTab.id]
  )

  if (canvasOwnsBrowser) {
    return (
      <div className="flex flex-1 items-center justify-center text-xs text-muted-foreground">
        {translate(
          'auto.components.floatingTerminal.FloatingBrowserSlot.canvasOwned',
          'native browser shown in Canvas'
        )}
      </div>
    )
  }

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div ref={setSlotViewportRef} className="absolute inset-0 flex min-h-0 flex-col" />
      <BrowserPane browserTab={browserTab} isActive={isActive} />
    </div>
  )
}

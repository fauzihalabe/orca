import { memo, useLayoutEffect, useRef } from 'react'
import { Handle, NodeResizer, Position, useStore, type NodeProps } from '@xyflow/react'
import { Globe } from 'lucide-react'
import { translate } from '@/i18n/i18n'
import BrowserPane from '@/components/browser-pane/BrowserPane'
import {
  registerBrowserOverlaySlotViewport,
  unregisterBrowserOverlaySlotViewport
} from '@/components/browser-pane/browser-page-viewport'
import { useAppStore } from '@/store'
import { FLOATING_TERMINAL_WORKTREE_ID } from '../../../../../shared/constants'
import { getBrowserViewportPreset } from '../../../../../shared/browser-viewport-presets'
import type { BrowserWorkspace } from '../../../../../shared/types'
import type { CrewCanvasNodeData } from '../canvas-store'
import { getCrewCanvas, useCrewCanvasTab } from '../canvas-store'
import { useCanvasTab } from '../canvas-tab-context'
import {
  canvasBrowserPageId,
  canvasBrowserWorkspaceId,
  waitForNativeBrowserSessionHydration
} from './canvas-browser-session'
import { canvasNodeIntersectsViewport } from './canvas-node-viewport-visibility'

function ensureScheme(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed) {
    return 'about:blank'
  }
  // Preserve native non-HTTP URLs such as about:blank; the Orca browser store
  // is the normalization boundary for the complete browser URL grammar.
  return /^[a-z][a-z\d+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`
}

/**
 * A Canvas browser is the native Orca BrowserPane mounted inside a node.
 *
 * There is intentionally no second webview implementation here. The native
 * pane owns the Chromium guest, browser profiles, navigation history, grab /
 * annotate / markup, DevTools, downloads, viewport emulation and all browser
 * RPC registration. The Canvas only supplies a stable workspace/page id and
 * a layout container.
 */
export const BrowserNode = memo(function BrowserNode({ id, data, selected }: NodeProps) {
  const d = data as CrewCanvasNodeData & {
    url?: string
    browserWorkspaceId?: string
    browserPageId?: string
    browserSessionProfileId?: string | null
    browserSessionPartition?: string | null
    browserDesktopSize?: { width?: number; height?: number }
    browserAppliedViewportPresetId?: string | null
  }
  const { tabId, worktreeId, active } = useCanvasTab()
  const updateNodeData = useCrewCanvasTab(tabId, (s) => s.updateNodeData)
  const resizeNode = useCrewCanvasTab(tabId, (s) => s.resizeNode)
  const nativeWorktreeId = worktreeId ?? FLOATING_TERMINAL_WORKTREE_ID
  const stableWorkspaceId = d.browserWorkspaceId ?? canvasBrowserWorkspaceId(id)
  const stablePageId = d.browserPageId ?? canvasBrowserPageId(id)
  const slotRef = useRef<HTMLDivElement | null>(null)
  const intersectsViewport = useStore((state) => {
    const node = state.nodeLookup.get(id)
    if (!node) {
      return true
    }
    return canvasNodeIntersectsViewport({
      node: {
        x: node.internals.positionAbsolute.x,
        y: node.internals.positionAbsolute.y,
        width: node.measured.width ?? node.width ?? 0,
        height: node.measured.height ?? node.height ?? 0
      },
      viewport: { width: state.width, height: state.height },
      transform: state.transform
    })
  })
  const browserActive = active && intersectsViewport

  const browserWorkspace = useAppStore((state) =>
    Object.values(state.browserTabsByWorktree)
      .flat()
      .find((candidate) => candidate.id === stableWorkspaceId)
  )
  const browserWorkspaceForPane = browserWorkspace as BrowserWorkspace | undefined
  const browserWorkspaceIdForPane = browserWorkspaceForPane?.id
  const activeBrowserPage = useAppStore((state) => {
    const pages = state.browserPagesByWorkspace[stableWorkspaceId] ?? []
    return (
      pages.find((page) => page.id === browserWorkspaceForPane?.activePageId) ?? pages[0] ?? null
    )
  })
  const viewportPresetId = activeBrowserPage?.viewportPresetId ?? null
  const setBrowserPageViewportPreset = useAppStore((state) => state.setBrowserPageViewportPreset)
  useLayoutEffect(() => {
    let cancelled = false
    const reconcile = async () => {
      let state = useAppStore.getState()
      let existing = Object.values(state.browserTabsByWorktree)
        .flat()
        .find((candidate) => candidate.id === stableWorkspaceId)
      // A persisted Canvas node can paint before native browser session
      // hydration. Wait for that identity once, otherwise a second workspace
      // would be created and the restored guest would win later.
      if (!existing && (d.browserWorkspaceId || d.browserPageId) && !state.workspaceSessionReady) {
        await waitForNativeBrowserSessionHydration()
        if (cancelled) {
          return
        }
        state = useAppStore.getState()
        existing = Object.values(state.browserTabsByWorktree)
          .flat()
          .find((candidate) => candidate.id === stableWorkspaceId)
      }
      if (cancelled) {
        return
      }
      const workspace =
        existing ??
        state.createBrowserTab(nativeWorktreeId, ensureScheme(d.url ?? ''), {
          id: stableWorkspaceId,
          pageId: stablePageId,
          activate: false,
          title: translate('auto.components.canvas.BrowserNode.title', 'Canvas Browser'),
          ...(d.browserSessionProfileId !== undefined
            ? { sessionProfileId: d.browserSessionProfileId }
            : {}),
          ...(d.browserSessionPartition !== undefined
            ? { sessionPartition: d.browserSessionPartition }
            : {})
        })
      const pageId = workspace.activePageId ?? workspace.pageIds?.[0] ?? stablePageId
      const patch: Record<string, unknown> = {
        browserWorkspaceId: workspace.id,
        browserPageId: pageId,
        browserSessionProfileId: workspace.sessionProfileId ?? null,
        browserSessionPartition: workspace.sessionPartition ?? null
      }
      if (d.url !== workspace.url && workspace.url !== 'about:blank') {
        patch.url = workspace.url
      }
      updateNodeData(id, patch)
    }
    void reconcile()
    return () => {
      cancelled = true
    }
  }, [
    d.browserPageId,
    d.browserSessionPartition,
    d.browserSessionProfileId,
    d.browserWorkspaceId,
    d.url,
    id,
    nativeWorktreeId,
    stablePageId,
    stableWorkspaceId,
    updateNodeData
  ])

  useLayoutEffect(() => {
    const node = getCrewCanvas(tabId).nodes.find((candidate) => candidate.id === id)
    const preset = getBrowserViewportPreset(viewportPresetId)
    if (!node) {
      return
    }

    // CDP's native viewport override is independent from the <webview>'s host
    // rectangle. Size the Canvas node once when a preset changes so the host
    // shows the complete emulated viewport instead of clipping (for example,
    // a 1920px page inside a 400px node). Do not continuously enforce it: that
    // would fight NodeResizer and recreate the stuck/flickering gesture.
    if (preset) {
      const desktopSize = d.browserDesktopSize
      const rememberedSize = {
        width: Math.max(280, Math.round(desktopSize?.width ?? node.width ?? 560)),
        height: Math.max(180, Math.round(desktopSize?.height ?? node.height ?? 460))
      }
      // BrowserPane's native guest occupies the node minus the Canvas border
      // and the two native chrome rows. Measuring this during a React Flow
      // resize is unstable (the guest and node update on different frames),
      // which previously doubled the height on every restore and produced the
      // visible flashing. Keep the native viewport contract deterministic.
      const chromeWidth = 2
      const chromeHeight = 80
      const targetSize = {
        width: preset.width + chromeWidth,
        height: preset.height + chromeHeight
      }
      updateNodeData(id, {
        ...(!desktopSize ? { browserDesktopSize: rememberedSize } : {}),
        browserAppliedViewportPresetId: viewportPresetId
      })
      if (node.width !== targetSize.width || node.height !== targetSize.height) {
        resizeNode(id, targetSize)
      }
      return
    }

    const desktopSize = d.browserDesktopSize
    if (!desktopSize) {
      return
    }
    const restoredSize = {
      width: Math.max(280, Math.round(desktopSize.width ?? 560)),
      height: Math.max(180, Math.round(desktopSize.height ?? 460))
    }
    if (node.width !== restoredSize.width || node.height !== restoredSize.height) {
      resizeNode(id, restoredSize)
    }
    updateNodeData(id, {
      browserDesktopSize: undefined,
      browserAppliedViewportPresetId: null
    })
  }, [
    d.browserAppliedViewportPresetId,
    d.browserDesktopSize,
    id,
    resizeNode,
    tabId,
    updateNodeData,
    viewportPresetId
  ])

  const clearFixedViewportAfterManualResize = (
    _event: unknown,
    size: { width: number; height: number }
  ): void => {
    if (!viewportPresetId || !activeBrowserPage) {
      return
    }
    // A manual resize means "responsive/custom". Return the same native page
    // to Default metrics so its content follows the new node bounds rather
    // than leaving a fixed preset clipped inside them.
    updateNodeData(id, {
      browserDesktopSize: { width: size.width, height: size.height },
      browserAppliedViewportPresetId: null
    })
    setBrowserPageViewportPreset(activeBrowserPage.id, null)
    void window.api.browser.setViewportOverride({
      browserPageId: activeBrowserPage.id,
      override: null
    })
  }

  useLayoutEffect(() => {
    const root = slotRef.current
    if (!root || !browserWorkspaceIdForPane || !active) {
      return
    }
    registerBrowserOverlaySlotViewport(browserWorkspaceIdForPane, root)
    return () => unregisterBrowserOverlaySlotViewport(browserWorkspaceIdForPane, root)
  }, [active, browserWorkspaceIdForPane])

  const findShortcutScope = browserActive ? 'focused' : 'inactive'
  // The normal Orca browser overlay owns this same native workspace whenever
  // the Canvas tab is not active. Rendering another BrowserPane here would
  // reparent the same Chromium guest and make controls/viewport disappear.
  const pane =
    browserWorkspaceForPane && active ? (
      <BrowserPane
        browserTab={browserWorkspaceForPane}
        isActive={browserActive}
        findShortcutScope={findShortcutScope}
        canvasSurface
      />
    ) : (
      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--crew-canvas-node-muted)',
          fontSize: 11
        }}
      >
        {translate(
          'auto.components.canvas.BrowserNode.preparingNative',
          'preparing native browser…'
        )}
      </div>
    )

  return (
    <div
      className={`crew-node crew-browser-node${selected ? ' selected' : ''}`}
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--crew-canvas-node-surface)',
        border: `1px solid ${selected ? 'var(--crew-canvas-primary)' : 'var(--crew-canvas-node-border)'}`,
        borderRadius: 12,
        overflow: 'hidden',
        boxShadow: selected
          ? 'var(--crew-canvas-node-selected-shadow)'
          : 'var(--crew-canvas-node-shadow)'
      }}
    >
      <NodeResizer
        isVisible={selected === true}
        minWidth={280}
        minHeight={180}
        onResizeEnd={clearFixedViewportAfterManualResize}
        lineStyle={{ borderColor: 'var(--crew-canvas-primary-soft)' }}
        handleStyle={{
          width: 8,
          height: 8,
          borderRadius: 2,
          background: 'var(--crew-canvas-handle)'
        }}
      />
      <div
        className="crew-node-header drag-handle"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '5px 9px',
          borderBottom: '1px solid var(--crew-canvas-node-header-border)',
          background: 'var(--crew-canvas-node-header)',
          cursor: 'grab',
          userSelect: 'none',
          color: 'var(--crew-canvas-node-foreground)',
          fontSize: 11
        }}
      >
        <Globe size={12} style={{ color: 'var(--crew-canvas-success)', flexShrink: 0 }} />
        <span>
          {translate(
            'auto.components.canvas.BrowserNode.nativeTitle',
            'Canvas Browser · native Orca'
          )}
        </span>
      </div>
      <div
        ref={slotRef}
        className="nodrag nowheel"
        style={{ position: 'relative', flex: 1, minHeight: 0, minWidth: 0 }}
      >
        {pane}
        <div
          aria-hidden="true"
          className="crew-browser-interaction-shield"
          style={{ position: 'absolute', inset: 0, zIndex: 100, pointerEvents: 'none' }}
        />
      </div>
      <Handle
        type="target"
        position={Position.Left}
        style={{ width: 8, height: 8, background: 'var(--crew-canvas-handle)' }}
      />
      <Handle
        type="source"
        position={Position.Right}
        style={{ width: 8, height: 8, background: 'var(--crew-canvas-handle)' }}
      />
    </div>
  )
})

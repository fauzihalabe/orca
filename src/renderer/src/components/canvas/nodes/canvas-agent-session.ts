import { useAppStore } from '@/store'
import { createBrowserUuid } from '@/lib/browser-uuid'
import { singlePaneLayoutSnapshot } from '@/store/slices/terminal-helpers'
import { isValidHostTerminalTabId } from '../../../../../shared/terminal-tab-id'
import {
  makePaneKey,
  type PaneKey,
  type TerminalLeafId
} from '../../../../../shared/stable-pane-id'
import {
  isExpectedAgentProcess,
  recognizeAgentProcess
} from '../../../../../shared/agent-process-recognition'
import { isShellProcess } from '../../../../../shared/agent-detection'
import { isTuiAgent, TUI_AGENT_CONFIG } from '../../../../../shared/tui-agent-config'
import type { TuiAgent } from '../../../../../shared/types'
import {
  canvasAgentMirrorIdentityFromData,
  type CanvasAgentMirrorIdentity,
  type CanvasAgentSessionData
} from './canvas-agent-session-identity'

export type { CanvasAgentSessionData } from './canvas-agent-session-identity'

type CanvasAgentSessionTab = ReturnType<ReturnType<typeof useAppStore.getState>['createTab']>

export type CanvasAgentMirror = {
  tab: CanvasAgentSessionTab
  tabId: string
  leafId: TerminalLeafId
  paneKey: PaneKey
  worktreeId: string
  ptyId: string | null
  reusedExistingPty: boolean
}

function tabForId(tabId: string | undefined, worktreeId: string): CanvasAgentSessionTab | null {
  if (!tabId) {
    return null
  }
  return (
    Object.values(useAppStore.getState().tabsByWorktree)
      .flat()
      .find((tab) => tab.id === tabId && tab.worktreeId === worktreeId) ?? null
  )
}

async function waitForRestoredTab(
  tabId: string,
  worktreeId: string
): Promise<CanvasAgentSessionTab | null> {
  const deadline = Date.now() + 8_000
  while (Date.now() < deadline) {
    const state = useAppStore.getState()
    const tab = tabForId(tabId, worktreeId)
    if (tab || state.workspaceSessionReady) {
      return tab
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  return tabForId(tabId, worktreeId)
}

function ptyForTab(tab: CanvasAgentSessionTab, leafId: string | undefined): string | null {
  const state = useAppStore.getState()
  const fromLayout = leafId
    ? state.terminalLayoutsByTabId[tab.id]?.ptyIdsByLeafId?.[leafId]
    : undefined
  return fromLayout ?? tab.ptyId ?? state.ptyIdsByTabId[tab.id]?.[0] ?? null
}

function ptyBelongsToAgent(
  processName: string | null,
  agentKind: TuiAgent | undefined
): boolean | null {
  if (!processName || !agentKind || !isTuiAgent(agentKind)) {
    return null
  }
  if (isShellProcess(processName)) {
    return false
  }
  const recognized = recognizeAgentProcess(processName)
  if (recognized) {
    // Agent Teams is hosted by the native Claude process, so it is the one
    // intentional wrapper exception to the exact agent-id comparison.
    return (
      recognized.agent === agentKind ||
      (agentKind === 'claude-agent-teams' && recognized.agent === 'claude')
    )
  }
  return isExpectedAgentProcess(processName, TUI_AGENT_CONFIG[agentKind].expectedProcess)
}

/**
 * Finds or creates the real Orca terminal surface backing a Canvas agent.
 *
 * The Canvas xterm is only a second viewport. The terminal tab remains the
 * owner of the PTY, its stable pane identity, persistence, hooks and mobile
 * membership. This is deliberately renderer-store-only; spawning still goes
 * through window.api.pty.spawn below AgentNode.
 */
export async function ensureCanvasAgentMirror(args: {
  worktreeId: string
  agentKind?: TuiAgent
  label: string
  data: CanvasAgentSessionData
}): Promise<CanvasAgentMirror> {
  const state = useAppStore.getState()
  const identity = canvasAgentMirrorIdentityFromData(args.data)
  const persistedIdentity: CanvasAgentMirrorIdentity =
    identity.worktreeId && identity.worktreeId !== args.worktreeId ? {} : identity
  let tab = tabForId(persistedIdentity.tabId, args.worktreeId)
  // Canvas localStorage can hydrate a node a few frames before Orca restores
  // its native terminal tabs. Reconcile the persisted identity first; only a
  // genuinely missing tab after hydration is allowed to create a new one.
  if (!tab && persistedIdentity.tabId && !state.workspaceSessionReady) {
    tab = await waitForRestoredTab(persistedIdentity.tabId, args.worktreeId)
  }
  const leafId = persistedIdentity.leafId ?? (createBrowserUuid() as TerminalLeafId)

  if (!tab) {
    const requestedTabId =
      persistedIdentity.tabId && isValidHostTerminalTabId(persistedIdentity.tabId)
        ? persistedIdentity.tabId
        : undefined
    tab = state.createTab(args.worktreeId, undefined, undefined, {
      ...(requestedTabId ? { id: requestedTabId } : {}),
      activate: false,
      recordInteraction: false,
      ...(args.agentKind ? { launchAgent: args.agentKind } : {})
    })
  }

  const existingPtyId = ptyForTab(tab, leafId)
  let ptyId = existingPtyId
  let reusedExistingPty = false
  if (existingPtyId) {
    // `null` means the provider cannot answer authoritatively. Keeping the
    // binding in that case is safer than launching a second native agent.
    const alive = await window.api.pty.hasPty(existingPtyId).catch(() => null)
    const foreground =
      alive === true && args.agentKind
        ? await window.api.pty.confirmForegroundProcess(existingPtyId).catch(() => null)
        : null
    const belongsToAgent = ptyBelongsToAgent(foreground, args.agentKind)
    if (alive !== false && belongsToAgent !== false) {
      reusedExistingPty = true
    } else {
      // A failed launch leaves a live shell behind (the exact state shown by
      // `zsh: command not found: claude`). Do not restore that shell as if it
      // were the native agent; retire only this Canvas-owned PTY and launch
      // the selected agent again through Orca's normal pty path.
      if (alive === true) {
        await window.api.pty.kill(existingPtyId, { keepHistory: false }).catch(() => {})
      }
      ptyId = null
      state.clearTabPtyId(tab.id, existingPtyId)
    }
  }

  const paneKey = makePaneKey(tab.id, leafId)
  state.setTabLayout(tab.id, singlePaneLayoutSnapshot(leafId, ptyId ?? undefined))
  state.setTabCustomTitle(tab.id, `Canvas · ${args.label}`, { recordInteraction: false })

  return {
    tab,
    tabId: tab.id,
    leafId,
    paneKey,
    worktreeId: args.worktreeId,
    ptyId,
    reusedExistingPty
  }
}

/** Closes the native mirror and lets the normal Orca tab-retirement path own teardown. */
export function closeCanvasTerminalMirror(data: CanvasAgentSessionData): void {
  const { tabId, worktreeId } = canvasAgentMirrorIdentityFromData(data)
  if (!worktreeId) {
    return
  }
  const tab = tabForId(tabId, worktreeId)
  if (!tab) {
    return
  }
  useAppStore.getState().closeTab(tab.id, {
    recordInteraction: false,
    reason: 'cleanup'
  })
}

export function canvasAgentMirrorIdentity(data: CanvasAgentSessionData): {
  tabId: string | undefined
  leafId: TerminalLeafId | undefined
  worktreeId: string | undefined
} {
  const identity = canvasAgentMirrorIdentityFromData(data)
  return { tabId: identity.tabId, leafId: identity.leafId, worktreeId: identity.worktreeId }
}

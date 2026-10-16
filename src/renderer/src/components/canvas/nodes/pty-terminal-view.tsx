import { useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { useAppStore } from '@/store'
import { singlePaneLayoutSnapshot } from '@/store/slices/terminal-helpers'
import { FLOATING_TERMINAL_WORKTREE_ID } from '../../../../../shared/constants'
import { getCrewCanvas } from '../canvas-store'
import { attachCrewTermClipboard, attachCrewTermFileDrop } from './crew-term-clipboard'
import {
  closeCanvasTerminalMirror,
  ensureCanvasAgentMirror,
  type CanvasAgentMirror
} from './canvas-agent-session'
import { CREW_SPAWN_ENV_TO_DELETE } from '../crew-spawn-env'
import { subscribeToPtyData } from '@/components/terminal-pane/pty-data-sidecar-subscriptions'
import {
  applyCanvasTerminalAppearance,
  canvasTerminalOptions,
  useCanvasTerminalAppearance
} from '../canvas-terminal-appearance'
import { useCanvasTab } from '../canvas-tab-context'
import { canMeasureCanvasTerminal, fitCanvasTerminalViewport } from './canvas-terminal-geometry'
import { useCanvasTerminalRevealFit } from './use-canvas-terminal-reveal-fit'
import {
  finishCanvasTerminalReattach,
  replayCanvasTerminalSnapshot
} from './canvas-terminal-reattach'

// Plain Canvas terminal — the visible xterm is only a viewport. The native
// Orca TerminalTab owns the PTY, stable pane identity, persistence and mobile
// membership, exactly like a terminal opened outside the Canvas.
export function PtyTerminalView({
  sessionId,
  command,
  cwd,
  worktreeId,
  tabId,
  nodeId,
  label,
  onSessionReady
}: {
  sessionId: string
  command: string
  cwd?: string
  worktreeId?: string | null
  tabId: string
  nodeId: string
  label: string
  onSessionReady: (mirror: CanvasAgentMirror, sessionId?: string) => void
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const { active } = useCanvasTab()
  const activeRef = useRef(active)
  const resizeViewportRef = useRef<() => void>(() => {})
  const [spawnError, setSpawnError] = useState<string | null>(null)
  const settings = useAppStore((state) => state.settings)
  const terminalAppearance = useCanvasTerminalAppearance()
  const terminalAppearanceRef = useRef(terminalAppearance)
  const terminalSettingsRef = useRef(settings)
  const terminalSettingsReady = settings !== null
  terminalAppearanceRef.current = terminalAppearance
  terminalSettingsRef.current = settings
  activeRef.current = active
  useCanvasTerminalRevealFit(active, resizeViewportRef)

  useEffect(() => {
    const container = containerRef.current
    const terminalSettings = terminalSettingsRef.current
    if (!container || !terminalSettings) {
      return
    }
    const term = new Terminal(
      canvasTerminalOptions(terminalAppearanceRef.current, terminalSettings)
    )
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(container)
    termRef.current = term

    let disposed = false
    let removeDataListener: (() => void) | null = null
    let livePtyId: string | null = null
    let mirror: CanvasAgentMirror | null = null

    const fitVisibleTerminal = (): { cols: number; rows: number } | null => {
      const dimensions = fitCanvasTerminalViewport({
        active: activeRef.current,
        container,
        fitAddon: fit
      })
      if (dimensions && livePtyId) {
        window.api.pty.resize(livePtyId, dimensions.cols, dimensions.rows)
      }
      return dimensions
    }
    resizeViewportRef.current = () => {
      fitVisibleTerminal()
    }

    const waitForVisibleSize = () =>
      new Promise<void>((resolve) => {
        if (canMeasureCanvasTerminal(container)) {
          resolve()
          return
        }
        const gate = new ResizeObserver(() => {
          if (canMeasureCanvasTerminal(container)) {
            gate.disconnect()
            resolve()
          }
        })
        gate.observe(container)
      })

    const attachPty = async (
      ptyId: string,
      initial?: { replay?: string; snapshot?: string; coldRestore?: string }
    ) => {
      if (disposed) {
        return
      }
      livePtyId = ptyId
      let replaying = true
      const queuedLiveChunks: string[] = []
      removeDataListener = subscribeToPtyData(ptyId, (chunk) => {
        if (disposed) {
          return
        }
        if (replaying) {
          queuedLiveChunks.push(chunk)
          return
        }
        term.write(chunk)
      })
      if (initial?.replay) {
        term.write(initial.replay)
      } else if (initial?.snapshot) {
        term.write(initial.snapshot)
      } else if (initial?.coldRestore) {
        term.write(initial.coldRestore)
      } else {
        const current = await window.api.pty
          .getMainBufferSnapshot(ptyId, { scrollbackRows: 5000 })
          .catch(() => null)
        if (!disposed && current) {
          await replayCanvasTerminalSnapshot(term, current)
        }
      }
      if (disposed) {
        return
      }
      replaying = false
      for (const chunk of queuedLiveChunks) {
        term.write(chunk)
      }
      await finishCanvasTerminalReattach({
        terminal: term,
        ptyId,
        fitViewport: fitVisibleTerminal,
        shouldContinue: () => !disposed
      })
      if (disposed) {
        return
      }
      term.onData((input) => {
        if (livePtyId) {
          window.api.pty.write(livePtyId, input)
        }
      })
    }

    const spawn = async () => {
      try {
        await waitForVisibleSize()
        if (disposed) {
          return
        }
        const dimensions = fitVisibleTerminal()
        const nodeData = (getCrewCanvas(tabId).nodes.find((node) => node.id === nodeId)?.data ??
          {}) as Record<string, unknown>
        const nativeWorktreeId = worktreeId ?? FLOATING_TERMINAL_WORKTREE_ID
        mirror = await ensureCanvasAgentMirror({
          worktreeId: nativeWorktreeId,
          label,
          data: nodeData
        })
        const readyMirror = mirror
        onSessionReady(readyMirror)
        let durableSessionId =
          typeof nodeData.ptySessionId === 'string' && nodeData.ptySessionId.trim().length > 0
            ? nodeData.ptySessionId
            : sessionId
        const bindPty = (ptyId: string) => {
          useAppStore.getState().updateTabPtyId(readyMirror.tabId, ptyId)
          useAppStore
            .getState()
            .setTabLayout(readyMirror.tabId, singlePaneLayoutSnapshot(readyMirror.leafId, ptyId))
          onSessionReady({ ...readyMirror, ptyId }, durableSessionId)
        }
        if (readyMirror.reusedExistingPty && readyMirror.ptyId) {
          await attachPty(readyMirror.ptyId)
          return
        }
        const nativePtyId =
          typeof nodeData.nativePtyId === 'string' ? nodeData.nativePtyId.trim() : ''
        if (nativePtyId && (await window.api.pty.hasPty(nativePtyId).catch(() => false))) {
          bindPty(nativePtyId)
          await attachPty(nativePtyId)
          return
        }

        const spawnOpts = (id: string) => ({
          cols: dimensions?.cols ?? 80,
          rows: dimensions?.rows ?? 24,
          command: command || undefined,
          cwd: cwd || undefined,
          worktreeId: nativeWorktreeId,
          envToDelete: CREW_SPAWN_ENV_TO_DELETE,
          sessionId: id,
          initiallyHidden: false,
          tabId: readyMirror.tabId,
          leafId: readyMirror.leafId
        })
        let spawned
        try {
          spawned = await window.api.pty.spawn(spawnOpts(durableSessionId))
        } catch (firstError) {
          const message = firstError instanceof Error ? firstError.message : String(firstError)
          if (!/killed|not.?found|no such/i.test(message)) {
            throw firstError
          }
          durableSessionId = `${sessionId}-recovery-${Date.now()}`
          spawned = await window.api.pty.spawn(spawnOpts(durableSessionId))
        }
        if (disposed) {
          return
        }
        bindPty(spawned.id)
        await attachPty(spawned.id, {
          replay: spawned.replay,
          snapshot: spawned.snapshot,
          coldRestore: spawned.coldRestore?.scrollback
        })
      } catch (error) {
        if (!disposed) {
          if (mirror && !mirror.reusedExistingPty && !livePtyId) {
            closeCanvasTerminalMirror({
              mirrorTabId: mirror.tabId,
              mirrorWorktreeId: mirror.worktreeId
            })
          }
          setSpawnError(error instanceof Error ? error.message : String(error))
        }
      }
    }
    void spawn()

    const detachClipboard = attachCrewTermClipboard(container, term, () => livePtyId)
    const detachFileDrop = attachCrewTermFileDrop(container, term, () => livePtyId)

    const observer = new ResizeObserver(fitVisibleTerminal)
    observer.observe(container)

    return () => {
      disposed = true
      observer.disconnect()
      detachClipboard()
      detachFileDrop()
      removeDataListener?.()
      // Do not kill here: native TerminalTab owns the PTY. Explicit Canvas
      // node deletion closes that tab through canvas-store cleanup.
      term.dispose()
      termRef.current = null
      resizeViewportRef.current = () => {}
    }
  }, [
    command,
    cwd,
    label,
    nodeId,
    onSessionReady,
    sessionId,
    tabId,
    terminalSettingsReady,
    worktreeId
  ])

  useEffect(() => {
    const term = termRef.current
    if (term) {
      applyCanvasTerminalAppearance(term, terminalAppearance)
    }
  }, [terminalAppearance])

  return (
    <div
      className="nodrag nowheel"
      style={{
        flex: 1,
        minHeight: 0,
        background: 'var(--crew-canvas-terminal-background)',
        position: 'relative'
      }}
    >
      {spawnError ? (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--crew-canvas-error)',
            fontSize: 11,
            padding: 12,
            textAlign: 'center'
          }}
        >
          {spawnError}
        </div>
      ) : null}
      <div ref={containerRef} style={{ position: 'absolute', inset: 0 }} />
    </div>
  )
}

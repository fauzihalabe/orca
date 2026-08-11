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
  closeCanvasAgentMirror,
  ensureCanvasAgentMirror,
  type CanvasAgentMirror
} from './canvas-agent-session'
import { CREW_SPAWN_ENV_TO_DELETE } from '../crew-spawn-env'
import { subscribeToPtyData } from '@/components/terminal-pane/pty-data-sidecar-subscriptions'
import { buildCanvasTerminalTheme, useCanvasColorMode } from '../canvas-theme'

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
  const [spawnError, setSpawnError] = useState<string | null>(null)
  const colorMode = useCanvasColorMode()

  useEffect(() => {
    const container = containerRef.current
    if (!container) {
      return
    }
    const term = new Terminal({
      fontSize: 11,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
      theme: buildCanvasTerminalTheme(),
      cursorBlink: true,
      scrollback: 5000,
      convertEol: true
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(container)
    fit.fit()
    termRef.current = term

    let disposed = false
    let removeDataListener: (() => void) | null = null
    let livePtyId: string | null = null
    let mirror: CanvasAgentMirror | null = null

    const waitForVisibleSize = () =>
      new Promise<void>((resolve) => {
        if (container.clientHeight > 0) {
          resolve()
          return
        }
        const gate = new ResizeObserver(() => {
          if (container.clientHeight > 0) {
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
        if (!disposed && current?.data) {
          term.write(current.data)
        }
      }
      if (disposed) {
        return
      }
      removeDataListener = subscribeToPtyData(ptyId, (chunk) => {
        if (!disposed) {
          term.write(chunk)
        }
      })
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
        fit.fit()
        const nodeData = (getCrewCanvas(tabId).nodes.find((node) => node.id === nodeId)?.data ??
          {}) as Record<string, unknown>
        const nativeWorktreeId = worktreeId ?? FLOATING_TERMINAL_WORKTREE_ID
        mirror = await ensureCanvasAgentMirror({
          worktreeId: nativeWorktreeId,
          label,
          data: nodeData
        })
        onSessionReady(mirror)
        if (mirror.reusedExistingPty && mirror.ptyId) {
          await attachPty(mirror.ptyId)
          return
        }

        const dims = fit.proposeDimensions()
        const spawnOpts = (id: string) => ({
          cols: dims?.cols ?? 80,
          rows: dims?.rows ?? 24,
          command: command || undefined,
          cwd: cwd || undefined,
          worktreeId: nativeWorktreeId,
          envToDelete: CREW_SPAWN_ENV_TO_DELETE,
          sessionId: id,
          initiallyHidden: false,
          tabId: mirror!.tabId,
          leafId: mirror!.leafId
        })
        let durableSessionId =
          typeof nodeData.ptySessionId === 'string' && nodeData.ptySessionId.trim().length > 0
            ? nodeData.ptySessionId
            : sessionId
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
        useAppStore.getState().updateTabPtyId(mirror.tabId, spawned.id)
        useAppStore
          .getState()
          .setTabLayout(mirror.tabId, singlePaneLayoutSnapshot(mirror.leafId, spawned.id))
        onSessionReady({ ...mirror, ptyId: spawned.id }, durableSessionId)
        await attachPty(spawned.id, {
          replay: spawned.replay,
          snapshot: spawned.snapshot,
          coldRestore: spawned.coldRestore?.scrollback
        })
      } catch (error) {
        if (!disposed) {
          if (mirror && !mirror.reusedExistingPty && !livePtyId) {
            closeCanvasAgentMirror(mirror)
          }
          setSpawnError(error instanceof Error ? error.message : String(error))
        }
      }
    }
    void spawn()

    const detachClipboard = attachCrewTermClipboard(container, term, () => livePtyId)
    const detachFileDrop = attachCrewTermFileDrop(container, term, () => livePtyId)

    const observer = new ResizeObserver(() => {
      fit.fit()
      const dims = fit.proposeDimensions()
      if (dims && livePtyId) {
        window.api.pty.resize(livePtyId, dims.cols, dims.rows)
      }
    })
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
    }
  }, [command, cwd, label, nodeId, onSessionReady, sessionId, tabId, worktreeId])

  useEffect(() => {
    const term = termRef.current
    if (term) {
      term.options.theme = buildCanvasTerminalTheme()
    }
  }, [colorMode])

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

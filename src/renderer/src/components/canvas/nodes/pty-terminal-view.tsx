import { useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { registerAgentPty, unregisterAgentPty } from '../agent-registry'

// Shared live-PTY body for canvas nodes (agent, plain terminal). Owns the
// xterm lifecycle, the visibility gate (mounting under display:none breaks the
// guest), and the spawn/wire/teardown of the PTY through Orca's pty bridge.
// The worktreeId anchors the cwd in main's spawn resolver — without it the
// requested cwd is dropped and the shell lands in $HOME.
export function PtyTerminalView({
  sessionId,
  command,
  cwd,
  worktreeId,
  registryNodeId
}: {
  sessionId: string
  command: string
  cwd?: string
  worktreeId?: string | null
  registryNodeId?: string
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [spawnError, setSpawnError] = useState<string | null>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) {
      return
    }
    const term = new Terminal({
      fontSize: 11,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
      theme: { background: '#0b0b0d' },
      cursorBlink: true,
      scrollback: 5000,
      convertEol: true
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(container)
    fit.fit()

    let disposed = false
    let removeDataListener: (() => void) | null = null
    let livePtyId: string | null = null

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

    const spawn = async () => {
      try {
        await waitForVisibleSize()
        if (disposed) {
          return
        }
        fit.fit()
        const dims = fit.proposeDimensions()
        const spawnOpts = (id: string) => ({
          cols: dims?.cols ?? 80,
          rows: dims?.rows ?? 24,
          command: command || undefined,
          cwd: cwd || undefined,
          ...(worktreeId ? { worktreeId } : {}),
          sessionId: id,
          initiallyHidden: false
        })
        let spawned
        try {
          spawned = await window.api.pty.spawn(spawnOpts(sessionId))
        } catch (firstError) {
          // Why: after an intentional kill (tab close, remount) the stable id is
          // dead — spawning onto it throws TerminalKilledError; take a fresh id.
          const message = firstError instanceof Error ? firstError.message : String(firstError)
          if (!/killed|not.?found|no such/i.test(message)) {
            throw firstError
          }
          spawned = await window.api.pty.spawn(spawnOpts(`${sessionId}-${Date.now()}`))
        }
        if (disposed) {
          return
        }
        livePtyId = spawned.id
        if (registryNodeId) {
          registerAgentPty(registryNodeId, spawned.id, term)
        }
        if (spawned.replay) {
          term.write(spawned.replay)
        }
        removeDataListener = window.api.pty.onData((event) => {
          if (event.id === livePtyId) {
            term.write(event.data)
          }
        })
        term.onData((input) => {
          if (livePtyId) {
            window.api.pty.write(livePtyId, input)
          }
        })
      } catch (error) {
        if (!disposed) {
          setSpawnError(error instanceof Error ? error.message : String(error))
        }
      }
    }
    void spawn()

    const observer = new ResizeObserver(() => {
      fit.fit()
    })
    observer.observe(container)

    return () => {
      disposed = true
      observer.disconnect()
      removeDataListener?.()
      if (livePtyId) {
        if (registryNodeId) {
          unregisterAgentPty(registryNodeId, livePtyId)
        }
        void window.api.pty.kill(livePtyId)
      }
      term.dispose()
    }
  }, [sessionId, command, cwd, worktreeId, registryNodeId])

  return (
    <div
      className="nodrag nowheel"
      style={{ flex: 1, minHeight: 0, background: '#0b0b0d', position: 'relative' }}
    >
      {spawnError ? (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#ff7a7a',
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

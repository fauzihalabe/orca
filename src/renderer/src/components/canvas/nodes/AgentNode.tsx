import { memo, useEffect, useRef, useState } from 'react'
import type { NodeProps } from '@xyflow/react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import type { CrewCanvasNodeData } from '../canvas-store'
import { getCrewCanvas, useCrewCanvasTab } from '../canvas-store'
import {
  closeCanvasTerminalMirror,
  ensureCanvasAgentMirror,
  type CanvasAgentMirror
} from './canvas-agent-session'
import {
  canvasAgentNativeResumeForPane,
  canvasAgentNativeResumeFromData,
  startCanvasAgentNativeSessionCapture
} from './canvas-agent-native-session'
import { launchAgentBackgroundSession } from '@/lib/launch-agent-background-session'
import type { TuiAgent } from '../../../../../shared/types'
import { CREW_SPAWN_ENV_TO_DELETE } from '../crew-spawn-env'
import { useCanvasTab } from '../canvas-tab-context'
import { attachCrewTermClipboard, attachCrewTermFileDrop } from './crew-term-clipboard'
import { buildAgentCommand } from './agent-command'
import {
  applyCanvasTerminalAppearance,
  canvasTerminalOptions,
  useCanvasTerminalAppearance
} from '../canvas-terminal-appearance'
import { subscribeToPtyData } from '@/components/terminal-pane/pty-data-sidecar-subscriptions'
import { parsePaneKey } from '../../../../../shared/stable-pane-id'
import { AgentNodeSurface } from './agent-node-surface'
import { canMeasureCanvasTerminal, fitCanvasTerminalViewport } from './canvas-terminal-geometry'
import { useCanvasTerminalRevealFit } from './use-canvas-terminal-reveal-fit'
import { useAppStore } from '@/store'
import {
  finishCanvasTerminalReattach,
  replayCanvasTerminalSnapshot
} from './canvas-terminal-reattach'
import { resolveCanvasAgentLaunchContext } from './canvas-agent-launch-context'

// Agent node — spawns a REAL agent CLI in a PTY (Orca's pty:spawn) and renders
// it with xterm. Node data persists and respawns on mount; a captured CLI
// session relaunches with `--resume` after an app restart. Role is delivered
// through the CLI's native system-prompt channel.

export const AgentNode = memo(function AgentNode({ id, data, selected }: NodeProps) {
  const d = data as CrewCanvasNodeData & {
    agentKind?: string
    cwd?: string
    label?: string
    role?: string
    args?: string
    managedAccountId?: string | null
    linearIssueLabel?: string
  }
  const agentKind = d.agentKind ?? 'claude'
  const { tabId, worktreeId, worktreePath, active } = useCanvasTab()
  const nodeCwd = d.cwd || worktreePath || undefined
  const updateNodeData = useCrewCanvasTab(tabId, (s) => s.updateNodeData)
  const [accountNonce, setAccountNonce] = useState(0)
  const containerRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const ptyIdRef = useRef<string | null>(null)
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
    let removeExitListener: (() => void) | null = null
    let stopSessionCapture = (): void => {}

    const fitVisibleTerminal = (): void => {
      const dimensions = fitCanvasTerminalViewport({
        active: activeRef.current,
        container,
        fitAddon: fit
      })
      if (dimensions && ptyIdRef.current) {
        window.api.pty.resize(ptyIdRef.current, dimensions.cols, dimensions.rows)
      }
    }
    resizeViewportRef.current = fitVisibleTerminal

    const detachClipboard = attachCrewTermClipboard(container, term, () => ptyIdRef.current)
    const detachFileDrop = attachCrewTermFileDrop(container, term, () => ptyIdRef.current)

    // A node can mount while the canvas view is hidden (0x0) — spawning there
    // breaks xterm layout for good. Wait for real size before opening the PTY.
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

    const spawn = async () => {
      let mirror: CanvasAgentMirror | null = null
      try {
        await waitForVisibleSize()
        if (disposed) {
          return
        }
        fitVisibleTerminal()
        const {
          bridge,
          peers,
          connectedNotes,
          connectedKinds,
          connectedBrowserPageIds,
          fresh,
          linearContext
        } = await resolveCanvasAgentLaunchContext(tabId, id)
        const selfLabel = String(d.label ?? agentKind)
        if (!worktreeId) {
          throw new Error('agentes precisam de uma aba canvas de worktree (sem worktree aqui)')
        }

        // The native Orca terminal tab remains the PTY owner and mobile
        // surface. The Canvas xterm below is only a second viewport into it.
        // On recovery, reuse the persisted native identity. On a fresh node,
        // let the canonical Orca launcher create the backing tab after its
        // PTY is spawned; creating a placeholder here races the tab registry.
        const hasPersistedMirror = Boolean(fresh?.paneKey || fresh?.mirrorTabId)
        if (hasPersistedMirror) {
          mirror = await ensureCanvasAgentMirror({
            worktreeId,
            agentKind: agentKind as TuiAgent,
            label: selfLabel,
            data: fresh ?? {}
          })
          updateNodeData(id, {
            paneKey: mirror.paneKey,
            mirrorTabId: mirror.tabId,
            mirrorLeafId: mirror.leafId,
            mirrorWorktreeId: mirror.worktreeId
          })
        }
        const nativeResume =
          canvasAgentNativeResumeFromData(agentKind, fresh ?? {}) ??
          (mirror ? canvasAgentNativeResumeForPane(agentKind, mirror.paneKey) : null)
        const launch = buildAgentCommand(
          agentKind,
          d.role,
          selfLabel,
          peers,
          bridge,
          d.args,
          connectedNotes,
          connectedKinds,
          nativeResume ? undefined : fresh?.cliResumeCommand,
          linearContext,
          connectedBrowserPageIds,
          id
        )

        const attachPty = async (
          ptyId: string,
          initial?: {
            replay?: string
            snapshot?: string
            coldRestore?: string
          },
          options?: { subscribe?: boolean; readSnapshot?: boolean }
        ) => {
          if (disposed) {
            return
          }
          ptyIdRef.current = ptyId
          let replaying = true
          const queuedLiveChunks: string[] = []
          if (options?.subscribe !== false) {
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
          }
          if (initial?.replay) {
            term.write(initial.replay)
          } else if (initial?.snapshot) {
            term.write(initial.snapshot)
          } else if (initial?.coldRestore) {
            term.write(initial.coldRestore)
          } else if (options?.readSnapshot !== false) {
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
          removeExitListener = window.api.pty.onExit((event) => {
            if (event.id === ptyId && !disposed) {
              updateNodeData(id, { lastExitCode: event.code })
            }
          })
          term.onData((input) => {
            if (ptyIdRef.current) {
              window.api.pty.write(ptyIdRef.current, input)
            }
          })
        }

        if (mirror?.reusedExistingPty && mirror.ptyId) {
          if (disposed) {
            return
          }
          stopSessionCapture = startCanvasAgentNativeSessionCapture({
            nodeId: id,
            paneKey: mirror.paneKey,
            agentKind,
            updateNodeData
          })
          await attachPty(mirror.ptyId)
          return
        }

        const result = await launchAgentBackgroundSession({
          agent: agentKind as TuiAgent,
          worktreeId,
          ...(launch.agentArgs !== undefined ? { agentArgs: launch.agentArgs } : {}),
          ...(launch.systemPrompt ? { nativeSystemPrompt: launch.systemPrompt } : {}),
          ...(launch.env ? { agentEnv: launch.env } : {}),
          ...(nativeResume ? { resume: nativeResume } : {}),
          ...(mirror
            ? {
                nativeTab: {
                  tabId: mirror.tabId,
                  leafId: mirror.leafId,
                  paneKey: mirror.paneKey
                }
              }
            : {}),
          ...(agentKind === 'codex' && d.managedAccountId !== undefined
            ? { managedAccountId: d.managedAccountId }
            : {}),
          envToDelete: CREW_SPAWN_ENV_TO_DELETE,
          title: selfLabel,
          launchSource: 'unknown',
          onData: (chunk) => {
            if (!disposed) {
              term.write(chunk)
            }
          },
          onExit: (_ptyId, code) => {
            if (!disposed) {
              updateNodeData(id, { lastExitCode: code })
            }
          }
        })
        if (!result) {
          throw new Error('plano de launch indisponível para este agente')
        }
        if (disposed) {
          return
        }
        ptyIdRef.current = result.ptyId
        updateNodeData(id, {
          paneKey: result.paneKey,
          mirrorTabId: result.tabId,
          mirrorLeafId: parsePaneKey(result.paneKey)?.leafId,
          mirrorWorktreeId: worktreeId,
          agentLaunchConfig: result.startupPlan.launchConfig,
          ...(Object.prototype.hasOwnProperty.call(
            result.startupPlan.launchConfig,
            'managedAccountId'
          )
            ? { managedAccountId: result.startupPlan.launchConfig.managedAccountId }
            : {})
        })
        stopSessionCapture = startCanvasAgentNativeSessionCapture({
          nodeId: id,
          paneKey: result.paneKey,
          agentKind,
          updateNodeData
        })
        await attachPty(result.ptyId, undefined, { subscribe: false, readSnapshot: false })
      } catch (error) {
        if (!disposed) {
          setSpawnError(error instanceof Error ? error.message : String(error))
        }
      }
    }
    void spawn()

    const observer = new ResizeObserver(fitVisibleTerminal)
    observer.observe(container)

    return () => {
      disposed = true
      stopSessionCapture()
      observer.disconnect()
      detachClipboard()
      detachFileDrop()
      removeDataListener?.()
      removeExitListener?.()
      term.dispose()
      termRef.current = null
      resizeViewportRef.current = () => {}
    }
  }, [
    id,
    agentKind,
    nodeCwd,
    worktreeId,
    d.role,
    d.args,
    d.managedAccountId,
    d.label,
    accountNonce,
    tabId,
    terminalSettingsReady,
    updateNodeData
  ])

  useEffect(() => {
    const term = termRef.current
    if (term) {
      applyCanvasTerminalAppearance(term, terminalAppearance)
    }
  }, [terminalAppearance])

  const handleAccountChanged = (managedAccountId?: string | null): void => {
    const current = getCrewCanvas(tabId).nodes.find((node) => node.id === id)?.data
    if (current) {
      closeCanvasTerminalMirror(current)
    }
    updateNodeData(id, {
      managedAccountId,
      cliSessionId: undefined,
      cliResumeCommand: undefined,
      paneKey: undefined,
      mirrorTabId: undefined,
      mirrorLeafId: undefined,
      ptySessionId: undefined
    })
    setAccountNonce((n) => n + 1)
  }

  return (
    <AgentNodeSurface
      id={id}
      agentKind={agentKind}
      label={d.label}
      role={d.role ?? ''}
      args={d.args}
      managedAccountId={d.managedAccountId}
      linearIssueLabel={d.linearIssueLabel}
      selected={selected === true}
      spawnError={spawnError}
      containerRef={containerRef}
      onAccountChanged={handleAccountChanged}
    />
  )
})

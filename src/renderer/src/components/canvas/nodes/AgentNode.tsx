import { memo, useEffect, useRef, useState } from 'react'
import { Handle, NodeResizer, Position, type NodeProps } from '@xyflow/react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { CircleAlert } from 'lucide-react'
import type { CrewCanvasNodeData } from '../canvas-store'
import { getCrewCanvas, useCrewCanvasTab } from '../canvas-store'
import { startSessionCapture } from './agent-session-capture'
import {
  closeCanvasAgentMirror,
  ensureCanvasAgentMirror,
  type CanvasAgentMirror
} from './canvas-agent-session'
import { launchAgentBackgroundSession } from '@/lib/launch-agent-background-session'
import type { TuiAgent } from '../../../../../shared/types'
import { CREW_SPAWN_ENV_TO_DELETE } from '../crew-spawn-env'
import { useCanvasTab } from '../canvas-tab-context'
import { registerAgentPty, unregisterAgentPty } from '../agent-registry'
import { attachCrewTermClipboard, attachCrewTermFileDrop } from './crew-term-clipboard'
import { buildAgentCommand, type PeerInfo } from './agent-command'
import { AgentNodeHeader } from './agent-node-header'
import { subscribeToPtyData } from '@/components/terminal-pane/pty-data-sidecar-subscriptions'
import { parsePaneKey } from '../../../../../shared/stable-pane-id'

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
  const { tabId, worktreeId, worktreePath } = useCanvasTab()
  const nodeCwd = d.cwd || worktreePath || undefined
  const updateNodeData = useCrewCanvasTab(tabId, (s) => s.updateNodeData)
  const [accountNonce, setAccountNonce] = useState(0)
  const containerRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const ptyIdRef = useRef<string | null>(null)
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
    termRef.current = term

    let disposed = false
    let removeDataListener: (() => void) | null = null
    let removeExitListener: (() => void) | null = null

    attachCrewTermClipboard(term, () => ptyIdRef.current)
    const detachFileDrop = attachCrewTermFileDrop(container, term, () => ptyIdRef.current)

    // A node can mount while the canvas view is hidden (0x0) — spawning there
    // breaks xterm layout for good. Wait for real size before opening the PTY.
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
      let mirror: CanvasAgentMirror | null = null
      try {
        await waitForVisibleSize()
        if (disposed) {
          return
        }
        fit.fit()
        const graph = getCrewCanvas(tabId)
        const linked = graph.edges
          .filter((e) => e.source === id || e.target === id)
          .map((e) => graph.nodes.find((n) => n.id === (e.source === id ? e.target : e.source)))
          .filter(Boolean)
        const peers: PeerInfo[] = linked
          .filter((n) => n!.data.kind === 'agent')
          .map((n) => ({
            label: String(n!.data.label ?? n!.data.agentKind ?? 'agente'),
            role: String(n!.data.role ?? '')
          }))
        const connectedNotes = linked
          .filter((n) => n!.data.kind === 'note' && String(n!.data.text ?? '').trim().length > 0)
          .map((n) => String(n!.data.text))
        const connectedKinds = [...new Set(linked.map((n) => String(n!.data.kind)))]
        const connectedBrowserPageIds = linked
          .filter((n) => n!.data.kind === 'browser')
          .map((n) =>
            typeof n!.data.browserPageId === 'string' && n!.data.browserPageId.trim().length > 0
              ? n!.data.browserPageId
              : `canvas-${n!.id}`
          )
        // The bridge credential is scoped to this stable node id. A shared
        // token would let one local agent impersonate another after a restart.
        const bridge = await window.api.crew.getBridgeInfo({ nodeId: id })
        // Read fresh from the store at spawn time — cliSessionId/cliResumeCommand
        // are written by the capture poll and must NOT retrigger this effect.
        const fresh = getCrewCanvas(tabId).nodes.find((n) => n.id === id)?.data as
          | {
              cliSessionId?: string
              cliResumeCommand?: string
              linearIssueId?: string
              paneKey?: string
              mirrorTabId?: string
              mirrorLeafId?: string
              ptySessionId?: string
            }
          | undefined
        let linearContext: string | undefined
        if (fresh?.linearIssueId) {
          try {
            const issue = await window.api.linear.getIssue({ id: fresh.linearIssueId })
            if (issue) {
              linearContext =
                `Issue Linear linkada a você: ${issue.identifier} — ${issue.title} (estado: ${issue.state.name})\n` +
                `${issue.url}\n${issue.description?.trim() ? `${issue.description.trim()}\n` : ''}` +
                `Ao trabalhar nela, atualize-a pela CLI do Orca (já no PATH): \`orca linear\` — comente o progresso e mova o estado ao concluir.`
            }
          } catch {
            // Linear offline/desconectado — o agente segue sem o contexto da issue
          }
        }
        const selfLabel = String(d.label ?? agentKind)
        const launch = buildAgentCommand(
          agentKind,
          d.role,
          selfLabel,
          peers,
          bridge,
          d.args,
          connectedNotes,
          connectedKinds,
          fresh?.cliResumeCommand,
          linearContext,
          connectedBrowserPageIds,
          id
        )
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
            mirrorLeafId: mirror.leafId
          })
        }

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
            if (!disposed && current?.data) {
              term.write(current.data)
            }
          }
          if (disposed) {
            return
          }
          registerAgentPty(id, ptyId, term)
          if (options?.subscribe !== false) {
            removeDataListener = subscribeToPtyData(ptyId, (chunk) => {
              if (!disposed) {
                term.write(chunk)
              }
            })
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
          await attachPty(mirror.ptyId)
          return
        }

        if (mirror) {
          // A stale persisted identity must not be reused as an empty tab.
          // Return it to the normal Orca launcher, which owns PTY creation,
          // tab registration, persistence and mobile mirroring atomically.
          updateNodeData(id, {
            paneKey: undefined,
            mirrorTabId: undefined,
            mirrorLeafId: undefined
          })
          closeCanvasAgentMirror(mirror)
          mirror = null
        }

        const result = await launchAgentBackgroundSession({
          agent: agentKind as TuiAgent,
          worktreeId,
          ...(launch.agentArgs !== undefined ? { agentArgs: launch.agentArgs } : {}),
          ...(launch.systemPrompt ? { nativeSystemPrompt: launch.systemPrompt } : {}),
          ...(launch.env ? { agentEnv: launch.env } : {}),
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
          mirrorLeafId: parsePaneKey(result.paneKey)?.leafId
        })
        await attachPty(result.ptyId, undefined, { subscribe: false, readSnapshot: false })
      } catch (error) {
        if (!disposed) {
          if (mirror && !mirror.reusedExistingPty && !ptyIdRef.current) {
            closeCanvasAgentMirror(mirror)
          }
          setSpawnError(error instanceof Error ? error.message : String(error))
        }
      }
    }
    void spawn()

    // Session capture: poll Orca's AI Vault for the CLI session this node is
    // running, so an app restart can relaunch with the real `--resume` command.
    const stopSessionCapture = startSessionCapture({
      nodeId: id,
      agentKind,
      cwd: nodeCwd,
      tabId,
      updateNodeData
    })

    const observer = new ResizeObserver(() => {
      fit.fit()
      const dims = fit.proposeDimensions()
      if (dims && ptyIdRef.current) {
        window.api.pty.resize(ptyIdRef.current, dims.cols, dims.rows)
      }
    })
    observer.observe(container)

    return () => {
      disposed = true
      stopSessionCapture()
      observer.disconnect()
      detachFileDrop()
      removeDataListener?.()
      removeExitListener?.()
      if (ptyIdRef.current) {
        unregisterAgentPty(id, ptyIdRef.current)
      }
      term.dispose()
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
    updateNodeData
  ])

  return (
    <div
      className={`crew-node crew-agent-node${selected ? ' selected' : ''}`}
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        background: '#101013',
        border: `1px solid ${selected ? 'rgba(122,162,255,0.7)' : 'rgba(255,255,255,0.09)'}`,
        borderRadius: 12,
        overflow: 'hidden',
        boxShadow: selected
          ? '0 0 0 3px rgba(122,162,255,0.15), 0 12px 32px rgba(0,0,0,0.5)'
          : '0 8px 24px rgba(0,0,0,0.4)'
      }}
    >
      <NodeResizer
        isVisible={selected === true}
        minWidth={200}
        minHeight={140}
        lineStyle={{ borderColor: 'rgba(122,162,255,0.4)' }}
        handleStyle={{ width: 8, height: 8, borderRadius: 2, background: 'rgba(122,162,255,0.75)' }}
      />
      <AgentNodeHeader
        id={id}
        agentKind={agentKind}
        label={d.label}
        role={d.role ?? ''}
        args={d.args}
        managedAccountId={d.managedAccountId}
        linearIssueLabel={d.linearIssueLabel}
        onAccountChanged={(managedAccountId) => {
          const current = getCrewCanvas(tabId).nodes.find((node) => node.id === id)?.data
          if (current) {
            closeCanvasAgentMirror(current)
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
        }}
      />
      {spawnError ? (
        <div
          style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 6,
            color: '#ff7a7a',
            fontSize: 11,
            padding: 12,
            textAlign: 'center'
          }}
        >
          <CircleAlert size={13} />
          {spawnError}
        </div>
      ) : (
        <div
          ref={containerRef}
          className="nodrag nowheel"
          style={{ flex: 1, minHeight: 0, background: '#0b0b0d' }}
        />
      )}
      <Handle type="target" position={Position.Left} style={{ width: 12, height: 12 }} />
      <Handle type="source" position={Position.Right} style={{ width: 12, height: 12 }} />
    </div>
  )
})

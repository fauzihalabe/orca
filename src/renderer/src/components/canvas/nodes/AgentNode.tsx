import { memo, useEffect, useRef, useState } from 'react'
import { Handle, NodeResizer, Position, type NodeProps } from '@xyflow/react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { CircleAlert } from 'lucide-react'
import type { CrewCanvasNodeData } from '../canvas-store'
import { getCrewCanvas, useCrewCanvasTab } from '../canvas-store'
import { useCanvasTab } from '../canvas-tab-context'
import { registerAgentPty, unregisterAgentPty } from '../agent-registry'
import { buildAgentCommand, type PeerInfo } from './agent-command'
import { AgentNodeHeader } from './agent-node-header'

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
        const bridge = await window.api.crew.getBridgeInfo()
        // Read fresh from the store at spawn time — cliSessionId/cliResumeCommand
        // are written by the capture poll and must NOT retrigger this effect.
        const fresh = getCrewCanvas(tabId).nodes.find((n) => n.id === id)?.data as
          | { cliResumeCommand?: string; linearIssueId?: string }
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
        const dims = fit.proposeDimensions()
        const spawnOpts = (sessionId: string) => ({
          cols: dims?.cols ?? 80,
          rows: dims?.rows ?? 24,
          command: buildAgentCommand(
            agentKind,
            d.role,
            selfLabel,
            peers,
            bridge,
            d.args,
            connectedNotes,
            connectedKinds,
            fresh?.cliResumeCommand,
            linearContext
          ),
          cwd: nodeCwd,
          // Why: main's spawn resolver anchors the cwd at the workspace root —
          // without a worktreeId the requested cwd is dropped and the agent
          // boots in $HOME instead of the worktree.
          ...(worktreeId ? { worktreeId } : {}),
          // Stable per-node session: a renderer reload REATTACHES to this PTY
          // (replay below) instead of leaking a new agent process per mount.
          sessionId,
          initiallyHidden: false
        })
        // After an intentional kill (engine/account/args change) the stable id
        // is dead — spawning onto it throws TerminalKilledError. Fall back to a
        // fresh suffixed session in that case.
        let spawned
        try {
          spawned = await window.api.pty.spawn(spawnOpts(`crew-${id}`))
        } catch (firstError) {
          const message = firstError instanceof Error ? firstError.message : String(firstError)
          if (!/killed|not.?found|no such/i.test(message)) {
            throw firstError
          }
          spawned = await window.api.pty.spawn(spawnOpts(`crew-${id}-${Date.now()}`))
        }
        if (disposed) {
          return
        }
        ptyIdRef.current = spawned.id
        registerAgentPty(id, spawned.id, term)
        if (spawned.replay) {
          term.write(spawned.replay)
        }
        removeDataListener = window.api.pty.onData((event) => {
          if (event.id === ptyIdRef.current) {
            term.write(event.data)
          }
        })
        term.onData((input) => {
          if (ptyIdRef.current) {
            window.api.pty.write(ptyIdRef.current, input)
          }
        })
      } catch (error) {
        if (!disposed) {
          setSpawnError(error instanceof Error ? error.message : String(error))
        }
      }
    }
    void spawn()

    // Session capture: poll Orca's AI Vault for the CLI session this node is
    // running, so an app restart can relaunch with the real `--resume` command.
    const capture = async () => {
      try {
        const freshData = getCrewCanvas(tabId).nodes.find((n) => n.id === id)?.data as
          | { cliSessionId?: string }
          | undefined
        const result = await window.api.aiVault.listSessions({ limit: 40 })
        const mine = result.sessions
          .filter((s) => s.agent === agentKind && (!nodeCwd || s.cwd === nodeCwd))
          .sort((a, b) => (b.modifiedAt ?? '').localeCompare(a.modifiedAt ?? ''))
        const latest = mine[0]
        if (latest && latest.sessionId && latest.sessionId !== freshData?.cliSessionId) {
          updateNodeData(id, {
            cliSessionId: latest.sessionId,
            cliResumeCommand: latest.resumeCommand
          })
        }
      } catch {
        // vault scan unavailable this tick — retry next interval
      }
    }
    const captureTimer = setInterval(() => void capture(), 25_000)
    void capture()

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
      clearInterval(captureTimer)
      observer.disconnect()
      removeDataListener?.()
      if (ptyIdRef.current) {
        unregisterAgentPty(id, ptyIdRef.current)
        void window.api.pty.kill(ptyIdRef.current)
      }
      term.dispose()
    }
  }, [id, agentKind, nodeCwd, d.role, d.args, d.label, accountNonce, tabId, updateNodeData])

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
        linearIssueLabel={d.linearIssueLabel}
        onAccountChanged={() => {
          updateNodeData(id, { cliSessionId: undefined, cliResumeCommand: undefined })
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
      <Handle type="target" position={Position.Left} style={{ width: 8, height: 8 }} />
      <Handle type="source" position={Position.Right} style={{ width: 8, height: 8 }} />
    </div>
  )
})

import { memo, useCallback } from 'react'
import { Handle, NodeResizer, Position, type NodeProps } from '@xyflow/react'
import { SquareTerminal } from 'lucide-react'
import type { CrewCanvasNodeData } from '../canvas-store'
import { useCanvasTab } from '../canvas-tab-context'
import { useCrewCanvasTab } from '../canvas-store'
import type { CanvasAgentMirror } from './canvas-agent-session'
import { PtyTerminalView } from './pty-terminal-view'
import { translate } from '@/i18n/i18n'

// Plain terminal node — a real shell PTY (no agent CLI). Same wiring as the
// agent node minus the agent chrome (role/account/args).
export const TerminalNode = memo(function TerminalNode({ id, data, selected }: NodeProps) {
  const d = data as CrewCanvasNodeData & { label?: string; cwd?: string }
  const { tabId, worktreeId, worktreePath } = useCanvasTab()
  const updateNodeData = useCrewCanvasTab(tabId, (s) => s.updateNodeData)
  const label = d.label || translate('auto.components.canvas.TerminalNode.title', 'terminal')
  const onSessionReady = useCallback(
    (mirror: CanvasAgentMirror, durableId?: string) => {
      updateNodeData(id, {
        paneKey: mirror.paneKey,
        mirrorTabId: mirror.tabId,
        mirrorLeafId: mirror.leafId,
        ...(durableId ? { ptySessionId: durableId } : {})
      })
    },
    [id, updateNodeData]
  )
  return (
    <div
      className={`crew-node crew-terminal-node${selected ? ' selected' : ''}`}
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        background: '#101013',
        border: `1px solid ${selected ? 'rgba(94,214,155,0.7)' : 'rgba(255,255,255,0.09)'}`,
        borderRadius: 12,
        overflow: 'hidden',
        boxShadow: selected
          ? '0 0 0 3px rgba(94,214,155,0.15), 0 12px 32px rgba(0,0,0,0.5)'
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
      <div
        className="crew-node-header drag-handle"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 7,
          padding: '7px 10px',
          borderBottom: '1px solid rgba(255,255,255,0.07)',
          background: 'rgba(255,255,255,0.03)',
          cursor: 'grab',
          userSelect: 'none'
        }}
      >
        <SquareTerminal size={13} style={{ color: '#5ed69b', flexShrink: 0 }} />
        <span style={{ fontSize: 11.5, fontWeight: 600, color: 'rgba(255,255,255,0.85)' }}>
          {label}
        </span>
      </div>
      <PtyTerminalView
        sessionId={`crew-term-${id}`}
        command=""
        cwd={d.cwd ?? worktreePath ?? undefined}
        worktreeId={worktreeId}
        tabId={tabId}
        nodeId={id}
        label={label}
        onSessionReady={onSessionReady}
      />
      <Handle type="target" position={Position.Left} style={{ width: 8, height: 8 }} />
      <Handle type="source" position={Position.Right} style={{ width: 8, height: 8 }} />
    </div>
  )
})

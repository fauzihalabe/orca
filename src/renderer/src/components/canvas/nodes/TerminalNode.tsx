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
        background: 'var(--crew-canvas-node-surface)',
        border: `1px solid ${selected ? 'var(--crew-canvas-success)' : 'var(--crew-canvas-node-border)'}`,
        borderRadius: 12,
        overflow: 'hidden',
        boxShadow: selected
          ? 'var(--crew-canvas-node-selected-shadow)'
          : 'var(--crew-canvas-node-shadow)'
      }}
    >
      <NodeResizer
        isVisible={selected === true}
        minWidth={200}
        minHeight={140}
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
          gap: 7,
          padding: '7px 10px',
          borderBottom: '1px solid var(--crew-canvas-node-header-border)',
          background: 'var(--crew-canvas-node-header)',
          cursor: 'grab',
          userSelect: 'none'
        }}
      >
        <SquareTerminal size={13} style={{ color: 'var(--crew-canvas-success)', flexShrink: 0 }} />
        <span
          style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--crew-canvas-node-foreground)' }}
        >
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

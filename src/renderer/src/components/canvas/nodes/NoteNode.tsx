import { memo } from 'react'
import { Handle, NodeResizer, Position, type NodeProps } from '@xyflow/react'
import { StickyNote } from 'lucide-react'
import type { CrewCanvasNodeData } from '../canvas-store'
import { useCrewCanvasTab } from '../canvas-store'
import { useCanvasTab } from '../canvas-tab-context'
import { translate } from '@/i18n/i18n'

// Note node — a sticky that persists its text in the canvas graph. Connected
// to an agent it becomes shared memory (context edge).
export const NoteNode = memo(function NoteNode({ id, data, selected }: NodeProps) {
  const d = data as CrewCanvasNodeData & { text?: string }
  const tabId = useCanvasTab().tabId
  const updateNodeData = useCrewCanvasTab(tabId, (s) => s.updateNodeData)
  return (
    <div
      className={`crew-node crew-note-node${selected ? ' selected' : ''}`}
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        background: '#1c1a12',
        border: `1px solid ${selected ? 'rgba(255,212,122,0.7)' : 'rgba(255,212,122,0.18)'}`,
        borderRadius: 12,
        overflow: 'hidden',
        boxShadow: selected
          ? '0 0 0 3px rgba(255,212,122,0.14), 0 12px 32px rgba(0,0,0,0.5)'
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
          borderBottom: '1px solid rgba(255,212,122,0.12)',
          background: 'rgba(255,212,122,0.05)',
          cursor: 'grab',
          userSelect: 'none'
        }}
      >
        <StickyNote size={13} style={{ color: '#ffd47a', flexShrink: 0 }} />
        <span style={{ fontSize: 11.5, fontWeight: 600, color: 'rgba(255,235,190,0.85)' }}>
          {translate('auto.components.canvas.NoteNode.title', 'note')}
        </span>
      </div>
      <textarea
        className="nodrag nowheel"
        value={d.text ?? ''}
        placeholder={translate('auto.components.canvas.NoteNode.placeholder', 'write here…')}
        onChange={(event) => updateNodeData(id, { text: event.target.value })}
        onPointerDown={(event) => event.stopPropagation()}
        style={{
          flex: 1,
          minHeight: 0,
          background: 'transparent',
          border: 'none',
          outline: 'none',
          resize: 'none',
          padding: 10,
          fontSize: 11.5,
          lineHeight: 1.5,
          color: 'rgba(255,240,210,0.9)',
          fontFamily: 'inherit'
        }}
      />
      <Handle type="target" position={Position.Left} style={{ width: 8, height: 8 }} />
      <Handle type="source" position={Position.Right} style={{ width: 8, height: 8 }} />
    </div>
  )
})

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
        background: 'var(--crew-canvas-note-surface)',
        border: `1px solid ${selected ? 'var(--crew-canvas-note-accent)' : 'color-mix(in srgb, var(--crew-canvas-note-accent) 35%, var(--crew-canvas-node-border))'}`,
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
          borderBottom:
            '1px solid color-mix(in srgb, var(--crew-canvas-note-accent) 28%, transparent)',
          background: 'var(--crew-canvas-note-header)',
          cursor: 'grab',
          userSelect: 'none'
        }}
      >
        <StickyNote size={13} style={{ color: 'var(--crew-canvas-note-accent)', flexShrink: 0 }} />
        <span
          style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--crew-canvas-node-foreground)' }}
        >
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
          color: 'var(--crew-canvas-node-foreground)',
          fontFamily: 'inherit'
        }}
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

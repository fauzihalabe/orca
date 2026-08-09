import { memo, useState } from 'react'
import { Handle, NodeResizer, Position, type NodeProps } from '@xyflow/react'
import { ListChecks, Plus, X } from 'lucide-react'
import type { CrewCanvasNodeData } from '../canvas-store'
import { useCrewCanvasTab } from '../canvas-store'
import { useCanvasTab } from '../canvas-tab-context'
import { translate } from '@/i18n/i18n'

type TodoItem = { id: string; text: string; done: boolean }

// Todo node — a living checklist persisted in the graph (agents read/patch it
// when wired as context).
export const TodoNode = memo(function TodoNode({ id, data, selected }: NodeProps) {
  const d = data as CrewCanvasNodeData & { title?: string; items?: TodoItem[] }
  const items = d.items ?? []
  const tabId = useCanvasTab().tabId
  const updateNodeData = useCrewCanvasTab(tabId, (s) => s.updateNodeData)
  const [draft, setDraft] = useState('')

  const commit = (next: TodoItem[]) => updateNodeData(id, { items: next })

  return (
    <div
      className={`crew-node crew-todo-node${selected ? ' selected' : ''}`}
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        background: '#10131a',
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
        <ListChecks size={13} style={{ color: '#7aa2ff', flexShrink: 0 }} />
        <span style={{ fontSize: 11.5, fontWeight: 600, color: 'rgba(255,255,255,0.85)' }}>
          {d.title || translate('auto.components.canvas.TodoNode.title', 'todo')}
        </span>
        <span style={{ marginLeft: 'auto', fontSize: 10, color: 'rgba(255,255,255,0.35)' }}>
          {items.filter((i) => i.done).length}/{items.length}
        </span>
      </div>
      <div
        className="nodrag nowheel scrollbar-sleek"
        style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '6px 8px' }}
      >
        {items.map((item) => (
          <div
            key={item.id}
            style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '3px 0' }}
          >
            <input
              type="checkbox"
              checked={item.done}
              onChange={() =>
                commit(items.map((i) => (i.id === item.id ? { ...i, done: !i.done } : i)))
              }
              style={{ accentColor: '#7aa2ff', margin: 0, cursor: 'pointer', flexShrink: 0 }}
            />
            <span
              style={{
                flex: 1,
                fontSize: 11.5,
                color: item.done ? 'rgba(255,255,255,0.32)' : 'rgba(255,255,255,0.85)',
                textDecoration: item.done ? 'line-through' : 'none',
                wordBreak: 'break-word'
              }}
            >
              {item.text}
            </span>
            <button
              type="button"
              onClick={() => commit(items.filter((i) => i.id !== item.id))}
              style={{
                background: 'transparent',
                border: 'none',
                color: 'rgba(255,255,255,0.25)',
                cursor: 'pointer',
                padding: 2,
                display: 'inline-flex'
              }}
            >
              <X size={11} />
            </button>
          </div>
        ))}
        <form
          onSubmit={(event) => {
            event.preventDefault()
            const text = draft.trim()
            if (!text) {
              return
            }
            commit([...items, { id: crypto.randomUUID(), text, done: false }])
            setDraft('')
          }}
          style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}
        >
          <Plus size={12} style={{ color: 'rgba(255,255,255,0.3)', flexShrink: 0 }} />
          <input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder={translate('auto.components.canvas.TodoNode.newItem', 'new item…')}
            style={{
              flex: 1,
              background: 'transparent',
              border: 'none',
              outline: 'none',
              fontSize: 11.5,
              color: 'rgba(255,255,255,0.85)',
              padding: '3px 0'
            }}
          />
        </form>
      </div>
      <Handle type="target" position={Position.Left} style={{ width: 8, height: 8 }} />
      <Handle type="source" position={Position.Right} style={{ width: 8, height: 8 }} />
    </div>
  )
})

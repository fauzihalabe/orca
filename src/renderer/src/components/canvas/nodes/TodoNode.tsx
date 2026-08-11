import { memo, useEffect, useRef, useState } from 'react'
import { Handle, NodeResizer, Position, type NodeProps } from '@xyflow/react'
import { Check, Copy, ListChecks, Plus, X } from 'lucide-react'
import type { CrewCanvasNodeData } from '../canvas-store'
import { useCrewCanvasTab } from '../canvas-store'
import { useCanvasTab } from '../canvas-tab-context'
import { translate } from '@/i18n/i18n'
import { formatTodoClipboardText, type TodoItem } from './todo-content'

// Todo node — a living checklist persisted in the graph (agents read/patch it
// when wired as context).
export const TodoNode = memo(function TodoNode({ id, data, selected }: NodeProps) {
  const d = data as CrewCanvasNodeData & {
    label?: string
    title?: string
    items?: TodoItem[]
  }
  const items = d.items ?? []
  const tabId = useCanvasTab().tabId
  const updateNodeData = useCrewCanvasTab(tabId, (s) => s.updateNodeData)
  const [draft, setDraft] = useState('')
  const [copied, setCopied] = useState(false)
  const copyResetRef = useRef<number | null>(null)
  const title =
    d.label?.trim() || d.title?.trim() || translate('auto.components.canvas.TodoNode.title', 'todo')

  useEffect(
    () => () => {
      if (copyResetRef.current !== null) {
        window.clearTimeout(copyResetRef.current)
      }
    },
    []
  )

  const commit = (next: TodoItem[]) => updateNodeData(id, { items: next })

  const handleCopy = async (): Promise<void> => {
    try {
      await window.api.ui.writeClipboardText(formatTodoClipboardText(title, items))
      setCopied(true)
      if (copyResetRef.current !== null) {
        window.clearTimeout(copyResetRef.current)
      }
      copyResetRef.current = window.setTimeout(() => {
        copyResetRef.current = null
        setCopied(false)
      }, 1400)
    } catch {
      setCopied(false)
    }
  }

  return (
    <div
      className={`crew-node crew-todo-node${selected ? ' selected' : ''}`}
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--crew-canvas-node-surface)',
        border: `1px solid ${selected ? 'var(--crew-canvas-primary)' : 'var(--crew-canvas-node-border)'}`,
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
        <ListChecks size={13} style={{ color: 'var(--crew-canvas-primary)', flexShrink: 0 }} />
        <span
          title={title}
          style={{
            minWidth: 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            fontSize: 11.5,
            fontWeight: 600,
            color: 'var(--crew-canvas-node-foreground)'
          }}
        >
          {title}
        </span>
        <button
          className="nodrag"
          type="button"
          onClick={() => void handleCopy()}
          aria-label={
            copied
              ? translate('auto.components.canvas.TodoNode.copied', 'copied')
              : translate('auto.components.canvas.TodoNode.copy', 'copy todo content')
          }
          title={
            copied
              ? translate('auto.components.canvas.TodoNode.copied', 'copied')
              : translate('auto.components.canvas.TodoNode.copy', 'copy todo content')
          }
          style={{
            marginLeft: 'auto',
            background: 'transparent',
            border: 'none',
            color: copied ? 'var(--crew-canvas-primary)' : 'var(--crew-canvas-node-muted)',
            cursor: 'pointer',
            padding: 2,
            display: 'inline-flex',
            flexShrink: 0
          }}
        >
          {copied ? <Check size={11} /> : <Copy size={11} />}
        </button>
        <span style={{ fontSize: 10, color: 'var(--crew-canvas-node-muted)' }}>
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
              style={{
                accentColor: 'var(--crew-canvas-primary)',
                margin: 0,
                cursor: 'pointer',
                flexShrink: 0
              }}
            />
            <span
              style={{
                flex: 1,
                fontSize: 11.5,
                color: item.done
                  ? 'var(--crew-canvas-node-muted)'
                  : 'var(--crew-canvas-node-foreground)',
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
                color: 'var(--crew-canvas-node-muted)',
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
          <Plus size={12} style={{ color: 'var(--crew-canvas-node-muted)', flexShrink: 0 }} />
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
              color: 'var(--crew-canvas-node-foreground)',
              padding: '3px 0'
            }}
          />
        </form>
      </div>
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

import { memo, useEffect, useState } from 'react'
import { Handle, NodeResizer, Position, type NodeProps } from '@xyflow/react'
import { Pause, Play, RotateCcw, Timer } from 'lucide-react'
import type { CrewCanvasNodeData } from '../canvas-store'
import { useCrewCanvasTab } from '../canvas-store'
import { useCanvasTab } from '../canvas-tab-context'
import { translate } from '@/i18n/i18n'

// Timer node — countdown that survives reloads (endAt is persisted; the
// remaining time is derived, never stored).
export const TimerNode = memo(function TimerNode({ id, data, selected }: NodeProps) {
  const d = data as CrewCanvasNodeData & { endAt?: number; remainingMs?: number }
  const tabId = useCanvasTab().tabId
  const updateNodeData = useCrewCanvasTab(tabId, (s) => s.updateNodeData)
  const [, forceTick] = useState(0)

  const running = typeof d.endAt === 'number'
  const remaining = running ? Math.max(0, d.endAt! - Date.now()) : (d.remainingMs ?? 0)

  useEffect(() => {
    if (!running) {
      return
    }
    const tick = setInterval(() => forceTick((n) => n + 1), 250)
    return () => clearInterval(tick)
  }, [running])

  useEffect(() => {
    if (running && remaining <= 0) {
      updateNodeData(id, { endAt: undefined, remainingMs: 0 })
    }
  }, [running, remaining, id, updateNodeData])

  const minutes = Math.floor(remaining / 60000)
  const seconds = Math.floor((remaining % 60000) / 1000)
  const display = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`

  const start = (ms: number) =>
    updateNodeData(id, { endAt: Date.now() + ms, remainingMs: undefined })
  const pause = () => updateNodeData(id, { endAt: undefined, remainingMs: remaining })
  const reset = () => updateNodeData(id, { endAt: undefined, remainingMs: 25 * 60_000 })

  const iconBtn: React.CSSProperties = {
    background: 'rgba(255,255,255,0.06)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: 7,
    padding: 5,
    cursor: 'pointer',
    color: 'rgba(255,255,255,0.7)',
    display: 'inline-flex'
  }

  return (
    <div
      className={`crew-node crew-timer-node${selected ? ' selected' : ''}`}
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        background: '#131019',
        border: `1px solid ${selected ? 'rgba(200,140,255,0.7)' : 'rgba(255,255,255,0.09)'}`,
        borderRadius: 12,
        overflow: 'hidden',
        boxShadow: selected
          ? '0 0 0 3px rgba(200,140,255,0.15), 0 12px 32px rgba(0,0,0,0.5)'
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
        <Timer size={13} style={{ color: '#c88cff', flexShrink: 0 }} />
        <span style={{ fontSize: 11.5, fontWeight: 600, color: 'rgba(255,255,255,0.85)' }}>
          {translate('auto.components.canvas.TimerNode.title', 'timer')}
        </span>
      </div>
      <div
        className="nodrag"
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 10
        }}
      >
        <div
          style={{
            fontSize: 34,
            fontWeight: 700,
            fontVariantNumeric: 'tabular-nums',
            letterSpacing: '-0.02em',
            color: running ? '#e3c6ff' : 'rgba(255,255,255,0.75)'
          }}
        >
          {display}
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          {running ? (
            <button
              type="button"
              onClick={pause}
              style={iconBtn}
              title={translate('auto.components.canvas.TimerNode.pause', 'Pause')}
            >
              <Pause size={12} />
            </button>
          ) : (
            <button
              type="button"
              onClick={() => start(remaining > 0 ? remaining : 25 * 60_000)}
              style={iconBtn}
              title={translate('auto.components.canvas.TimerNode.start', 'Start')}
            >
              <Play size={12} />
            </button>
          )}
          <button
            type="button"
            onClick={reset}
            style={iconBtn}
            title={translate('auto.components.canvas.TimerNode.reset', 'Reset')}
          >
            <RotateCcw size={12} />
          </button>
        </div>
        <div style={{ display: 'flex', gap: 5 }}>
          {[5, 10, 25].map((min) => (
            <button
              key={min}
              type="button"
              onClick={() => start(min * 60_000)}
              style={{ ...iconBtn, fontSize: 10, padding: '3px 8px', fontWeight: 600 }}
            >
              {min}m
            </button>
          ))}
        </div>
      </div>
      <Handle type="target" position={Position.Left} style={{ width: 8, height: 8 }} />
      <Handle type="source" position={Position.Right} style={{ width: 8, height: 8 }} />
    </div>
  )
})

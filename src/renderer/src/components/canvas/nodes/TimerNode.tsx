import { memo, useEffect, useState } from 'react'
import { Handle, NodeResizer, Position, type NodeProps } from '@xyflow/react'
import { Pause, Play, RotateCcw, Timer } from 'lucide-react'
import type { CrewCanvasNodeData } from '../canvas-store'
import { useCrewCanvasTab } from '../canvas-store'
import { useCanvasTab } from '../canvas-tab-context'
import { translate } from '@/i18n/i18n'

// Stopwatch node — elapsed time survives reloads. While running, startedAt is
// persisted and the display derives elapsed time from the wall clock.
export const TimerNode = memo(function TimerNode({ id, data, selected }: NodeProps) {
  const d = data as CrewCanvasNodeData & {
    stopwatchStartedAt?: number
    stopwatchElapsedMs?: number
  }
  const tabId = useCanvasTab().tabId
  const updateNodeData = useCrewCanvasTab(tabId, (s) => s.updateNodeData)
  const [, forceTick] = useState(0)

  const running = typeof d.stopwatchStartedAt === 'number'
  const storedElapsed = Math.max(0, d.stopwatchElapsedMs ?? 0)
  const elapsed = running
    ? storedElapsed + Math.max(0, Date.now() - d.stopwatchStartedAt!)
    : storedElapsed

  useEffect(() => {
    if (!running) {
      return
    }
    const tick = setInterval(() => forceTick((n) => n + 1), 250)
    return () => clearInterval(tick)
  }, [running])

  const totalSeconds = Math.floor(elapsed / 1000)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  const display =
    hours > 0
      ? `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
      : `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`

  const start = () =>
    updateNodeData(id, {
      stopwatchStartedAt: Date.now(),
      stopwatchElapsedMs: storedElapsed,
      // Clear countdown data left by builds before the stopwatch migration.
      endAt: undefined,
      remainingMs: undefined
    })
  const pause = () =>
    updateNodeData(id, { stopwatchStartedAt: undefined, stopwatchElapsedMs: elapsed })
  const reset = () => updateNodeData(id, { stopwatchStartedAt: undefined, stopwatchElapsedMs: 0 })

  const iconBtn: React.CSSProperties = {
    background: 'var(--crew-canvas-control-background)',
    border: '1px solid var(--crew-canvas-control-border)',
    borderRadius: 7,
    padding: 5,
    cursor: 'pointer',
    color: 'var(--crew-canvas-node-muted)',
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
        background: 'var(--crew-canvas-timer-surface)',
        border: `1px solid ${selected ? 'var(--crew-canvas-timer-accent)' : 'var(--crew-canvas-node-border)'}`,
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
        <Timer size={13} style={{ color: 'var(--crew-canvas-timer-accent)', flexShrink: 0 }} />
        <span
          style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--crew-canvas-node-foreground)' }}
        >
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
            color: running
              ? 'var(--crew-canvas-timer-accent)'
              : 'var(--crew-canvas-node-foreground)'
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
              onClick={start}
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

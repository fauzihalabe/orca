import { useEffect, useRef, useState } from 'react'
import { BaseEdge, getBezierPath, type Edge, type EdgeProps } from '@xyflow/react'
import { useCrewCanvasTab, type CrewEdgeStyle } from '../canvas-store'
import { useCanvasTab } from '../canvas-tab-context'

// Crew edge — the dotted line. Behaviors:
// - flow: dots travel source→target continuously
// - fusion: a glow is drawn along the line when the connection is born
// - rope physics: a fresh connection DROPS like a rope — the curve starts
//   nearly straight and sags into its natural bend with a spring settle.

export type CrewEdge = Edge<{ newborn?: boolean }>

const EDGE_STYLES: Record<
  CrewEdgeStyle,
  { strokeWidth: number; dasharray: string; flowSeconds: number; opacity: number }
> = {
  // the lineit look — thick, well-spaced dots (default)
  lineit: { strokeWidth: 2.2, dasharray: '0.1 10', flowSeconds: 1.4, opacity: 0.6 },
  fine: { strokeWidth: 1.4, dasharray: '1 7', flowSeconds: 1.1, opacity: 0.5 },
  dash: { strokeWidth: 1.8, dasharray: '9 6', flowSeconds: 1.2, opacity: 0.55 }
}

export function CrewEdgeView({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  selected,
  markerEnd
}: EdgeProps) {
  const tabId = useCanvasTab().tabId
  const style = useCrewCanvasTab(tabId, (s) => s.edgeStyle)
  const newborn = data?.newborn === true
  const [sag, setSag] = useState(newborn ? 0 : 1)
  const frameRef = useRef<number | null>(null)

  // Rope drop: animate curvature from ~0 (straight) to 1 (full bend) with a
  // light overshoot, once, when the edge is born.
  useEffect(() => {
    if (!newborn) {
      setSag(1)
      return
    }
    const start = performance.now()
    const duration = 620
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / duration)
      // spring-ish ease: fast fall, small overshoot, settle
      const eased = 1 - Math.pow(1 - t, 2.2) * Math.cos(t * Math.PI * 1.1)
      setSag(Math.min(1.15, Math.max(0, eased)))
      if (t < 1) {
        frameRef.current = requestAnimationFrame(step)
      }
    }
    frameRef.current = requestAnimationFrame(step)
    return () => {
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current)
      }
    }
  }, [newborn])

  const curvature = 0.25 * sag
  const [path] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    curvature
  })
  const preset = EDGE_STYLES[style]

  return (
    <g className={`crew-edge${newborn ? ' crew-edge--newborn' : ''}${selected ? ' selected' : ''}`}>
      {newborn ? (
        <path
          d={path}
          fill="none"
          stroke="rgba(150,190,255,0.9)"
          strokeWidth={preset.strokeWidth + 1}
          strokeLinecap="round"
          className="crew-edge__fusion"
          pathLength={1}
        />
      ) : null}
      <BaseEdge
        id={id}
        path={path}
        markerEnd={markerEnd}
        style={{
          stroke: selected ? 'rgba(150,190,255,0.95)' : `rgba(140,170,230,${preset.opacity})`,
          strokeWidth: selected ? preset.strokeWidth + 0.6 : preset.strokeWidth,
          strokeDasharray: preset.dasharray,
          strokeLinecap: 'round',
          animation: `crew-edge-flow ${preset.flowSeconds}s linear infinite`
        }}
      />
    </g>
  )
}

import { useCallback, useRef, useState } from 'react'
import { useReactFlow } from '@xyflow/react'

export type RubberBand = {
  startX: number
  startY: number
  currentX: number
  currentY: number
}

// Drag-on-empty-canvas draws a creation frame (Figma-style). On release the
// caller opens the palette there and the new node takes the dragged size.
// Requires panOnDrag={false} + panOnScroll on the ReactFlow — pan moves to the
// trackpad/scroll gesture, which is the natural canvas feel on macOS.
export function useRubberBand(
  onCommit: (
    rect: { x: number; y: number; width: number; height: number },
    screen: { x: number; y: number }
  ) => void
) {
  const { screenToFlowPosition } = useReactFlow()
  const [band, setBand] = useState<RubberBand | null>(null)
  const bandRef = useRef<RubberBand | null>(null)

  const onPointerDown = useCallback((event: React.PointerEvent) => {
    // only left button, only on the empty pane (never over a node/handle)
    const target = event.target as HTMLElement
    if (event.button !== 0 || !target.classList.contains('react-flow__pane')) {
      return
    }
    const next = {
      startX: event.clientX,
      startY: event.clientY,
      currentX: event.clientX,
      currentY: event.clientY
    }
    bandRef.current = next
    setBand(next)
  }, [])

  const onPointerMove = useCallback((event: React.PointerEvent) => {
    if (!bandRef.current) {
      return
    }
    const next = { ...bandRef.current, currentX: event.clientX, currentY: event.clientY }
    bandRef.current = next
    setBand(next)
  }, [])

  const finish = useCallback(
    (event: React.PointerEvent) => {
      const current = bandRef.current
      bandRef.current = null
      setBand(null)
      if (!current) {
        return
      }
      const width = Math.abs(current.currentX - current.startX)
      const height = Math.abs(current.currentY - current.startY)
      if (width < 24 || height < 24) {
        return
      }
      const topLeft = screenToFlowPosition({
        x: Math.min(current.startX, current.currentX),
        y: Math.min(current.startY, current.currentY)
      })
      const bottomRight = screenToFlowPosition({
        x: Math.max(current.startX, current.currentX),
        y: Math.max(current.startY, current.currentY)
      })
      onCommit(
        {
          x: topLeft.x,
          y: topLeft.y,
          width: bottomRight.x - topLeft.x,
          height: bottomRight.y - topLeft.y
        },
        { x: event.clientX, y: event.clientY }
      )
    },
    [onCommit, screenToFlowPosition]
  )

  return { band, onPointerDown, onPointerMove, onPointerUp: finish, onPointerLeave: finish }
}

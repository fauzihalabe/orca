import { useEffect, type RefObject } from 'react'

export function useCanvasTerminalRevealFit(
  active: boolean,
  resizeViewportRef: RefObject<() => void>
): void {
  useEffect(() => {
    if (!active) {
      return
    }
    let secondFrame: number | null = null
    const firstFrame = window.requestAnimationFrame(() => {
      resizeViewportRef.current()
      secondFrame = window.requestAnimationFrame(() => resizeViewportRef.current())
    })
    return () => {
      window.cancelAnimationFrame(firstFrame)
      if (secondFrame !== null) {
        window.cancelAnimationFrame(secondFrame)
      }
    }
  }, [active, resizeViewportRef])
}

export type CanvasNodeViewportState = {
  node: { x: number; y: number; width: number; height: number }
  viewport: { width: number; height: number }
  transform: readonly [number, number, number]
}

export function canvasNodeIntersectsViewport({
  node,
  viewport,
  transform
}: CanvasNodeViewportState): boolean {
  if (viewport.width <= 0 || viewport.height <= 0 || node.width <= 0 || node.height <= 0) {
    return true
  }
  const [translateX, translateY, zoom] = transform
  const left = node.x * zoom + translateX
  const top = node.y * zoom + translateY
  const right = left + node.width * zoom
  const bottom = top + node.height * zoom
  return right > 0 && bottom > 0 && left < viewport.width && top < viewport.height
}

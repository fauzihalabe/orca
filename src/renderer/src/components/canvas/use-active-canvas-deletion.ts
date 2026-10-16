import { useEffect } from 'react'
import type { CrewCanvasGraph } from './canvas-store'

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) {
    return false
  }
  return Boolean(
    target.closest('input, textarea, select, [contenteditable="true"], .xterm, webview')
  )
}

export function useActiveCanvasDeletion(args: {
  enabled: boolean
  ownsKeyboardAtEvent: () => boolean
  readGraph: () => CrewCanvasGraph
  removeElements: (nodeIds: string[], edgeIds: string[]) => void
}): void {
  const { enabled, ownsKeyboardAtEvent, readGraph, removeElements } = args
  useEffect(() => {
    if (!enabled) {
      return
    }
    const deleteSelection = (event: KeyboardEvent): void => {
      if ((event.key !== 'Delete' && event.key !== 'Backspace') || isEditableTarget(event.target)) {
        return
      }
      if (!ownsKeyboardAtEvent()) {
        return
      }
      const graph = readGraph()
      const nodeIds = graph.nodes.filter((node) => node.selected).map((node) => node.id)
      const edgeIds = graph.edges.filter((edge) => edge.selected).map((edge) => edge.id)
      if (nodeIds.length === 0 && edgeIds.length === 0) {
        return
      }
      event.preventDefault()
      removeElements(nodeIds, edgeIds)
    }
    window.addEventListener('keydown', deleteSelection)
    return () => window.removeEventListener('keydown', deleteSelection)
  }, [enabled, ownsKeyboardAtEvent, readGraph, removeElements])
}

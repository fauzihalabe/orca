import { useSyncExternalStore } from 'react'

export type CanvasColorMode = 'dark' | 'light'

function readCanvasColorMode(): CanvasColorMode {
  return document.documentElement.classList.contains('dark') ? 'dark' : 'light'
}

function subscribeToCanvasColorMode(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange)
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
  return () => observer.disconnect()
}

export function useCanvasColorMode(): CanvasColorMode {
  return useSyncExternalStore(subscribeToCanvasColorMode, readCanvasColorMode, () => 'dark')
}

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

function readCanvasToken(name: string, fallback: string): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return value || fallback
}

export function buildCanvasTerminalTheme(): {
  background: string
  foreground: string
  cursor: string
  selectionBackground: string
} {
  return {
    background: readCanvasToken('--background', '#0a0a0a'),
    foreground: readCanvasToken('--foreground', '#fafafa'),
    cursor: readCanvasToken('--primary', '#e5e5e5'),
    selectionBackground: readCanvasToken('--ring', '#737373')
  }
}

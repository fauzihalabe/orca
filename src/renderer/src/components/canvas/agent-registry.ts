import type { Terminal } from '@xterm/xterm'

// Maps a canvas agent node to its live PTY + xterm. The node registers on
// spawn and unregisters on kill — the ask listener resolves "who is Revisor"
// through this and reads the agent's terminal BUFFER (what's on screen, which
// is the truth for rich TUIs like Claude Code that redraw constantly).
const registry = new Map<string, { ptyId: string; term: Terminal }>()

export function registerAgentPty(nodeId: string, ptyId: string, term: Terminal): void {
  registry.set(nodeId, { ptyId, term })
}

export function unregisterAgentPty(nodeId: string, ptyId: string): void {
  if (registry.get(nodeId)?.ptyId === ptyId) {
    registry.delete(nodeId)
  }
}

export function agentPtyOf(nodeId: string): string | null {
  return registry.get(nodeId)?.ptyId ?? null
}

export function agentTerminalOf(nodeId: string): Terminal | null {
  return registry.get(nodeId)?.term ?? null
}

// Debug/e2e handle.
if (typeof window !== 'undefined') {
  ;(window as unknown as { __crewRegistry: typeof registry }).__crewRegistry = registry
}

import { agentPtyOf, agentTerminalOf } from './agent-registry'

// terminal.run — writes the command into the connected terminal node's PTY and
// returns what the screen shows after it settles.
export async function terminalRun(nodeId: string, command: string): Promise<string> {
  if (!command.trim()) {
    return 'erro: command obrigatório'
  }
  // Why: a spawned terminal mounts its PTY async — wait for readiness instead
  // of failing the agent's first run right after terminal.spawn.
  let ptyId = agentPtyOf(nodeId)
  let term = agentTerminalOf(nodeId)
  const waitStart = Date.now()
  while ((!ptyId || !term) && Date.now() - waitStart < 12_000) {
    await new Promise((resolve) => setTimeout(resolve, 500))
    ptyId = agentPtyOf(nodeId)
    term = agentTerminalOf(nodeId)
  }
  if (!ptyId || !term) {
    return 'erro: o terminal conectado não está vivo'
  }
  // Read by CONTENT, not length: a half-empty screen doesn't grow buffer.length
  // when output prints, so a length-anchored window reads nothing. Slice the
  // screen after the last echo of our own command instead.
  const readScreen = (): string => {
    const lines: string[] = []
    const buffer = term.buffer.active
    for (let i = buffer.length - 1; i >= 0 && lines.length < 80; i--) {
      const text = buffer.getLine(i)?.translateToString(true).trimEnd() ?? ''
      if (text.trim().length > 0) {
        lines.unshift(text)
      }
    }
    return lines.join('\n')
  }
  const tailFromMarker = (screen: string): string => {
    const at = screen.lastIndexOf(command)
    return at >= 0 ? screen.slice(at + command.length) : screen
  }
  window.api.pty.write(ptyId, `${command}\r`)
  let last = ''
  let stable = 0
  const started = Date.now()
  while (Date.now() - started < 30_000) {
    await new Promise((resolve) => setTimeout(resolve, 600))
    const current = tailFromMarker(readScreen())
    if (current === last && current.trim().length > 0) {
      stable += 1
    } else {
      stable = 0
      last = current
    }
    if (stable >= 3) {
      break
    }
  }
  const out = last
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0)
  // Drop the trailing idle prompt so the agent reads the answer, not the shell chrome.
  return (
    out
      .slice(0, Math.max(out.length - 1, 1))
      .join('\n')
      .trim()
      .slice(-3000) || '(sem saída)'
  )
}

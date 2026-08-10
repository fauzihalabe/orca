import { agentPtyOf, agentTerminalOf } from './agent-registry'
import { wrapTerminalBracketedPasteText } from '../terminal-pane/terminal-bracketed-paste'
import { findAgentNode } from './crew-ask-graph'

const AGENT_PROMPT_SUBMIT_DELAY_MS = 500
const HARD_CAP_MS = 150_000

export async function askPeer(from: string, to: string, message: string): Promise<string> {
  const target = findAgentNode(to)
  if (!target) {
    return `erro: nenhum agente chamado "${to}" no canvas`
  }
  const ptyId = agentPtyOf(target.node.id)
  const term = agentTerminalOf(target.node.id)
  if (!ptyId || !term) {
    return `erro: o agente "${to}" não tem terminal vivo (respawn ou aguarde o boot)`
  }

  // Native agent-prompt delivery (same wire format as Orca's own agent
  // terminals): bracketed-paste payload, settle pause, then the submit byte.
  window.api.pty.write(ptyId, wrapTerminalBracketedPasteText(`[mensagem de ${from}] ${message}`))
  await new Promise((resolve) => setTimeout(resolve, AGENT_PROMPT_SUBMIT_DELAY_MS))
  window.api.pty.write(ptyId, '\r')

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
  const marker = `[mensagem de ${from}]`
  const tailFromMarker = (screen: string): string => {
    const at = screen.lastIndexOf(marker)
    return at >= 0 ? screen.slice(at + marker.length) : screen
  }

  let last = ''
  let stable = 0
  const started = Date.now()
  while (Date.now() - started < HARD_CAP_MS) {
    await new Promise((resolve) => setTimeout(resolve, 700))
    const current = tailFromMarker(readScreen())
    if (current === last) {
      stable += 1
    } else {
      stable = 0
      last = current
    }
    if (stable >= 4 && Date.now() - started > 2500) {
      break
    }
  }
  const cleaned = last
    .split('\n')
    .filter((line) => {
      const t = line.trim()
      return t.length > 0 && t !== '❯' && !t.startsWith('[mensagem de')
    })
    .join('\n')
    .trim()
  return cleaned.length > 0 ? cleaned : '(o agente não produziu saída neste turno)'
}

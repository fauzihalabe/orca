// Builds the launch command for an agent node: role via the CLI's native
// system-prompt channel, connected notes as live context, and the capability
// list derived from the node's edges (the line is the permission). A saved
// resumeCommand takes over the base so restarts continue the conversation.

export type PeerInfo = {
  label: string
  role: string
}

export function buildAgentCommand(
  agentKind: string,
  role: string | undefined,
  selfLabel: string,
  peers: PeerInfo[],
  bridge: { port: number; token: string } | null,
  launchArgs: string | undefined,
  connectedNotes: string[],
  connectedKinds: string[],
  resumeCommand?: string,
  linearContext?: string
): string {
  const args = launchArgs?.trim() ? ` ${launchArgs.trim()}` : ''
  const base = resumeCommand?.trim() ? resumeCommand.trim() : agentKind
  const trimmed = role?.trim()
  const lines: string[] = []
  if (trimmed) {
    lines.push(
      `Você é um agente da equipe Crew. Seu papel: ${trimmed}. Esse papel é um contrato operacional vinculante — conduza decisões e entregas de acordo com ele.`
    )
  }
  if (linearContext) {
    lines.push(linearContext)
  }
  if (connectedNotes.length > 0) {
    lines.push(
      `Notas conectadas a você (contexto vivo do canvas — o usuário as edita em tempo real):\n${connectedNotes.join('\n---\n')}`
    )
  }
  if (bridge) {
    const caps: string[] = []
    if (peers.length > 0) {
      const roster = peers.map((p) => `${p.label} (${p.role || 'sem papel'})`).join(', ')
      caps.push(
        `- Falar com colegas conectados (${roster}): tool "ask", args {"to":"<nome>","message":"..."} — a resposta do turno volta na saída.`
      )
    }
    if (connectedKinds.includes('browser')) {
      caps.push(
        '- Navegador conectado: tools "browser.navigate" {"url"}, "browser.read", "browser.click" {"selector"}, "browser.fill" {"selector","value"}, "browser.eval" {"js"}.'
      )
    }
    if (connectedKinds.includes('note')) {
      caps.push(
        '- Nota conectada: "note.read" e "note.write" {"text"} — memória viva compartilhada.'
      )
    }
    if (connectedKinds.includes('todo')) {
      caps.push('- Todo conectado: "todo.list", "todo.add" {"text"}, "todo.toggle" {"itemId"}.')
    }
    if (connectedKinds.includes('terminal')) {
      caps.push('- Terminal conectado: "terminal.run" {"command"} — roda e devolve a saída.')
    }
    if (caps.length > 0) {
      lines.push(
        `Suas capacidades no canvas (só o que está conectado a você por linha funciona — a linha é a permissão). Chame com curl (uma linha):\n` +
          `curl -s -X POST http://127.0.0.1:${bridge.port}/tool -H 'content-type: application/json' -H 'x-crew-token: ${bridge.token}' -d '{"from":"${selfLabel}","tool":"TOOL","args":{...}}'\n${caps.join(
            '\n'
          )}\n- Ver o canvas inteiro: tool "graph" (sempre disponível).`
      )
    }
  }
  if (lines.length === 0) {
    return base + args
  }
  const identity = lines.join('\n\n')
  const escaped = identity.replaceAll("'", "'\\''")
  if (agentKind === 'claude') {
    return `${base}${args} --append-system-prompt '${escaped}'`
  }
  if (agentKind === 'codex') {
    return `${base}${args} -c developer_instructions='${escaped}'`
  }
  return base + args
}

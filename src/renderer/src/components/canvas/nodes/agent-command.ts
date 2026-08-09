// Builds the launch command for an agent node: role via the CLI's native
// system-prompt channel, connected notes as live context, and the capability
// list derived from the node's edges (the line is the permission). A saved
// resumeCommand takes over the base so restarts continue the conversation.

export type PeerInfo = {
  label: string
  role: string
}

export type AgentLaunch = {
  command: string
  env?: Record<string, string>
}

// The capability text is intentionally self-contained: no MCP, no external
// docs, nothing to "go look for" — one localhost curl endpoint, and a live
// discovery tool because edges can be connected AFTER the agent boots.
function bridgeBlock(
  bridge: { port: number; token: string },
  selfLabel: string,
  caps: string[]
): string {
  const curl =
    `curl -s -X POST http://127.0.0.1:${bridge.port}/tool -H 'content-type: application/json' ` +
    `-H 'x-crew-token: ${bridge.token}' -d '{"from":"${selfLabel}","tool":"TOOL","args":{...}}'`
  const staticCaps = caps.length > 0 ? `\nConectadas agora:\n${caps.join('\n')}` : ''
  return (
    `Ferramentas do canvas (IMPORTANTE: NÃO é MCP — não existe MCP ou plugin pra procurar; ` +
    `é um endpoint HTTP local que já está no ar). Uso (uma linha, troque TOOL e args):\n${curl}\n` +
    `A linha é a permissão: uma tool só age em nodes conectados a você POR LINHA neste momento. ` +
    `Conexões mudam em tempo real — o usuário pode ligar/desligar linhas depois do seu boot. ` +
    `Então: antes de dizer que não consegue algo, chame a tool "capabilities" — ela lista o que está ` +
    `conectado a você AGORA (e o que cada tool aceita). Para ver o canvas inteiro: tool "graph".` +
    `${staticCaps}\nVocê também pode CRIAR recursos: "terminal.spawn", "browser.spawn" {"url"?}, ` +
    `"agent.spawn" {"agentKind":"claude"|"codex"|"kimi","label","role"?}, "note.spawn" {"text"?}, ` +
    `"todo.spawn" — o node nasce já conectado a você por linha.\n` +
    `- Orquestrar pela bridge: tool "orchestrate" {"objective":"...","tasks"?:[{"title"?,"spec"}],"workers"?:["<labels>"]} ` +
    `— cria um Run nativo do Orca (aba "Crew Coordinator") e despacha seus agentes conectados como workers.\n\n` +
    `Motor nativo do Orca (o CLI \`orca\`/\`orca-dev\` JÁ está no seu PATH — você é um terminal ` +
    `first-class do runtime, aparece no \`orca terminal list\` com handle term_*):\n` +
    `- Descobrir tudo: \`orca agent-context\` (228 comandos em schema JSON).\n` +
    `- Orquestração formal (runs/tasks/workers persistidos no host): \`orca orchestration run-create\`, ` +
    `\`task-create\`, \`worker-start\`, \`send\`, \`inbox\`, \`gate-*\` — para trabalho em equipe com ` +
    `estado durável, use-a; o visual/linhas do canvas continua sendo sua camada de conexão.\n` +
    `- Falar com terminais FORA do canvas: \`orca terminal send --terminal <handle> --text "..." --enter\`.\n` +
    `Regra de bolso: tools do canvas = nodes ligados a você; CLI orca = orquestração e o host inteiro.`
  )
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
): AgentLaunch {
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
    lines.push(bridgeBlock(bridge, selfLabel, caps))
  }
  if (lines.length === 0) {
    return { command: base + args }
  }
  const identity = lines.join('\n\n')
  // Why: Orca delivers the launch command by typing it into the shell — a 1.5KB
  // multi-line single-quoted blob breaks mid-command (the "command not found"
  // garbage that left agents at a bare prompt). The identity rides as an env
  // var instead; the typed command stays short and single-line.
  const env = { CREW_SYSTEM_PROMPT: identity }
  if (agentKind === 'claude') {
    return { command: `${base}${args} --append-system-prompt "$CREW_SYSTEM_PROMPT"`, env }
  }
  if (agentKind === 'codex') {
    return { command: `${base}${args} -c developer_instructions="$CREW_SYSTEM_PROMPT"`, env }
  }
  return { command: base + args }
}

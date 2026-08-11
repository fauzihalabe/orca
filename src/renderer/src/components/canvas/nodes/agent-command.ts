// Builds the launch command for an agent node: role via the CLI's native
// system-prompt channel, connected notes as live context, and the capability
// list derived from the node's edges (the line is the permission). A saved
// resumeCommand takes over the base so restarts continue the conversation.

import { getCommandTokenPathBasename } from '../../../../../shared/command-token-scanner'
import {
  getTuiAgentDetectCommands,
  isTuiAgent,
  TUI_AGENT_CONFIG
} from '../../../../../shared/tui-agent-config'
import {
  buildShellCommandFromArgv,
  tokenizeStartupCommand
} from '../../../../../shared/tui-agent-startup-shell'

export type PeerInfo = {
  label: string
  role: string
}

export type AgentLaunch = {
  command: string
  /** Arguments for Orca's native launcher, without shell prefixes or the binary. */
  agentArgs?: string
  /** Context delivered through the selected CLI's native system-prompt option. */
  systemPrompt?: string
  env?: Record<string, string>
}

type NativeInvocation = {
  recognized: boolean
  agentArgs: string
  env: Record<string, string>
}

function nativeInvocation(agentKind: string, command: string): NativeInvocation {
  if (!isTuiAgent(agentKind)) {
    return { recognized: false, agentArgs: '', env: {} }
  }

  const tokenized = tokenizeStartupCommand(command, 'posix')
  if (!tokenized.ok) {
    return { recognized: false, agentArgs: '', env: {} }
  }
  const candidates = getTuiAgentDetectCommands(TUI_AGENT_CONFIG[agentKind])
  const executableIndex = tokenized.tokens.findIndex((token) => {
    const basename = getCommandTokenPathBasename(token)
    return candidates.includes(token) || candidates.includes(basename)
  })
  if (executableIndex < 0) {
    return { recognized: false, agentArgs: '', env: {} }
  }

  const env: Record<string, string> = {}
  for (const token of tokenized.tokens.slice(0, executableIndex)) {
    const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(token)
    if (match) {
      env[match[1]] = match[2]
    }
  }
  return {
    recognized: true,
    agentArgs: buildShellCommandFromArgv(tokenized.tokens.slice(executableIndex + 1), 'posix'),
    env
  }
}

function resumeBelongsToAgent(agentKind: string, resumeCommand: string | undefined): boolean {
  return Boolean(resumeCommand?.trim() && nativeInvocation(agentKind, resumeCommand).recognized)
}

function withCodexCanvasMcp(agentArgs: string, selfNodeId: string): string {
  const mcpArgs = buildShellCommandFromArgv(
    [
      '-c',
      'mcp_servers.orca_canvas.command="orca"',
      '-c',
      'mcp_servers.orca_canvas.args=["canvas","mcp-serve"]',
      '-c',
      'mcp_servers.orca_canvas.startup_timeout_sec=15',
      '-c',
      'mcp_servers.orca_canvas.tool_timeout_sec=180',
      '-c',
      'mcp_servers.orca_canvas.default_tools_approval_mode="approve"',
      '-c',
      `mcp_servers.orca_canvas.env.ORCA_CREW_AGENT_ID=${JSON.stringify(selfNodeId)}`
    ],
    'posix'
  )
  return [agentArgs.trim(), mcpArgs].filter(Boolean).join(' ')
}

// The capability text is self-contained. Codex uses a stdio MCP transport
// because its shell sandbox blocks sockets; the MCP process still calls the
// same OrcaRuntimeService used by the native CLI and mobile clients.
function bridgeBlock(
  selfLabel: string,
  caps: string[],
  connectedBrowserPageIds: string[],
  useMcpTransport: boolean
): string {
  const staticCaps = caps.length > 0 ? `\nConectadas agora:\n${caps.join('\n')}` : ''
  const nativeBrowser =
    connectedBrowserPageIds.length > 0
      ? useMcpTransport
        ? `\n- Browser nativo do Canvas disponível em ${connectedBrowserPageIds.join(', ')}: chame \`orca_canvas.canvas_call\` com tool \`browser.snapshot\` ou \`browser.screenshot\`.`
        : `\n- Browser nativo do Canvas: use \`orca snapshot --page <id> --json\` ou \`orca screenshot --page <id> --json\` com ${connectedBrowserPageIds.join(', ')}.`
      : ''
  const canvasTransport = useMcpTransport
    ? `A interface obrigatória do Canvas neste Codex é o servidor stdio nativo \`orca_canvas\`: ` +
      `chame diretamente \`orca_canvas.canvas_connections\`, \`orca_canvas.canvas_graph\`, ` +
      `\`orca_canvas.canvas_call\` ou \`orca_canvas.canvas_ask\`. NÃO execute \`orca canvas ...\` ` +
      `pelo shell: o sandbox do Codex bloqueia sockets do processo de shell. O MCP é somente o ` +
      `transporte; autorização, estado e execução continuam no OrcaRuntimeService. Antes de ` +
      `responder qualquer pergunta sobre Canvas, nodes ou recursos conectados, chame ` +
      `\`orca_canvas.canvas_connections\`. Se houver browser conectado e a solicitação envolver ` +
      `a página, inspecione-o e use-o automaticamente por \`orca_canvas.canvas_call\`.`
    : `Use \`orca canvas connections --json\` para descobrir TODOS os nodes ligados a você ` +
      `neste momento. Para chamar uma conexão, use \`orca canvas call --tool <tool> --node ` +
      `<node-id> --args '<json>' --json\`; para falar com outro agente, use \`orca canvas ask\`.`
  const todoProtocol = useMcpTransport
    ? `PROTOCOLO TODO OBRIGATÓRIO: quando um pedido tiver duas ou mais ações concretas, antes de executar chame ` +
      `\`orca_canvas.canvas_connections\`. Se não houver Todo conectado, crie um com ` +
      `\`orca_canvas.canvas_call\` usando tool \`todo.spawn\`, depois redescubra as conexões. Liste o estado ` +
      `com \`todo.list\`, adicione cada ação uma única vez com \`todo.add\` e marque-a com ` +
      `\`todo.toggle\` imediatamente ao concluir. Mantenha pendências fiéis; o Todo é o registro durável ` +
      `do progresso, não uma narração opcional.`
    : `PROTOCOLO TODO OBRIGATÓRIO: quando um pedido tiver duas ou mais ações concretas, antes de executar rode ` +
      `\`orca canvas connections --json\`. Se não houver Todo conectado, crie um com ` +
      `\`orca canvas call --tool todo.spawn --args '{}' --json\` e redescubra as conexões. Use ` +
      `\`todo.list\`, adicione cada ação uma única vez com \`todo.add\` e marque com \`todo.toggle\` assim que ` +
      `concluir. Mantenha pendências fiéis; o Todo é o registro durável do progresso.`
  return (
    `Agente Canvas "${selfLabel}". Você está sob a capability nativa \`orca-canvas\` do Orca. ` +
    `${canvasTransport} A linha é a permissão: uma ação só age em node conectado por linha. ` +
    `Conexões mudam em tempo real — redescubra depois que o usuário ligar/desligar linhas.` +
    `${staticCaps}\n${todoProtocol}\nVocê também pode CRIAR recursos: "terminal.spawn", "browser.spawn" {"url"?}, ` +
    `"agent.spawn" {"agentKind":"claude"|"codex"|"kimi","label","role"?}, "note.spawn" {"text"?}, ` +
    `"todo.spawn", "timer.spawn", "simulator.spawn", "network.spawn" — o node nasce já conectado a você por linha. ` +
    `Network precisa depois ser ligado a um browser.\n` +
    `- Orquestrar pelo runtime: tool "orchestrate" {"objective":"...","tasks"?:[{"title"?,"spec"}],"workers"?:["<labels>"]} ` +
    `— usa este agente como coordenador, cria um Run nativo persistido do Orca e despacha seus agentes conectados como workers.\n\n` +
    `Motor nativo do Orca (você é um terminal ` +
    `first-class do runtime, aparece no \`orca terminal list\` com handle term_*):\n` +
    `- Orquestração formal (runs/tasks/workers persistidos no host): \`orca orchestration run-create\`, ` +
    `\`task-create\`, \`worker-start\`, \`send\`, \`inbox\`, \`gate-*\` — para trabalho em equipe com ` +
    `estado durável, use-a; o visual/linhas do canvas continua sendo sua camada de conexão.\n` +
    `- Falar com terminais FORA do canvas: \`orca terminal send --terminal <handle> --text "..." --enter\`.${nativeBrowser}\n` +
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
  linearContext?: string,
  connectedBrowserPageIds: string[] = [],
  selfNodeId = selfLabel
): AgentLaunch {
  const canResume = resumeBelongsToAgent(agentKind, resumeCommand)
  const args = !canResume && launchArgs?.trim() ? ` ${launchArgs.trim()}` : ''
  const base = canResume ? resumeCommand!.trim() : agentKind
  const invocation = canResume
    ? nativeInvocation(agentKind, base)
    : { recognized: true, agentArgs: launchArgs?.trim() ?? '', env: {} }
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
        agentKind === 'codex'
          ? '- Navegador conectado: chame `orca_canvas.canvas_call` com qualquer método nativo `browser.*` (goto/navigate, snapshot/read, click, fill, type, select, scroll, back, forward, reload, screenshot, eval, wait, tabs, cookies, storage, viewport, network, console, downloads, capture). Tudo passa pelo browser runtime nativo.'
          : '- Navegador conectado: use qualquer método nativo `browser.*` do Orca (goto/navigate, snapshot/read, click, fill, type, select, scroll, back, forward, reload, screenshot, eval, wait, tabs, cookies, storage, viewport, network, console, downloads, capture e os demais registrados em `orca agent-context --json`). Os aliases browser.navigate/read/click/fill também existem; tudo passa pelo browser runtime nativo, sem webview ou ferramenta paralela.'
      )
      if (connectedBrowserPageIds.length > 0) {
        caps.push(
          agentKind === 'codex'
            ? `- O navegador está registrado no motor nativo como page ${connectedBrowserPageIds.join(', ')}; selecione o node retornado por \`orca_canvas.canvas_connections\`.`
            : `- O mesmo navegador está registrado no motor nativo: page ${connectedBrowserPageIds.join(', ')}. Para usar a API nativa, passe esse id: \`orca snapshot --page <id> --json\`, \`orca click --page <id> --element <ref> --json\`, \`orca fill --page <id> --element <ref> --value <texto> --json\`.`
        )
      }
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
      caps.push(
        '- Terminal conectado: "terminal.run" {"text" ou "command"} envia pelo runtime nativo e retorna a leitura inline em uma chamada; não chame "terminal.read" automaticamente depois. Use "terminal.send" para iniciar um processo contínuo e "terminal.read" para acompanhar ou obter mais linhas.'
      )
    }
    if (connectedKinds.includes('simulator')) {
      caps.push(
        '- Simulador conectado: "simulator.tap" {"x","y"}, "simulator.type" {"text"}, "simulator.gesture" {"points"}, "simulator.button" {"name"}, "simulator.rotate" {"orientation"}, "simulator.ax", "simulator.logcat" — tudo passa pelo emulator runtime nativo do Orca.'
      )
    }
    if (connectedKinds.includes('network')) {
      caps.push(
        '- Network conectado: "network.read" — lê o tráfego pelo browser.network nativo; o node network também precisa estar ligado a um browser.'
      )
    }
    if (connectedKinds.includes('timer')) {
      caps.push(
        '- Cronômetro conectado (contagem crescente): "timer.read", "timer.start", "timer.pause", "timer.reset".'
      )
    }
    lines.push(bridgeBlock(selfLabel, caps, connectedBrowserPageIds, agentKind === 'codex'))
  }
  if (lines.length === 0) {
    return {
      command: base + args,
      agentArgs: invocation.agentArgs,
      env: Object.keys(invocation.env).length > 0 ? invocation.env : undefined
    }
  }
  const identity = lines.join('\n\n')
  // Why: Orca delivers the launch command by typing it into the shell — a 1.5KB
  // multi-line single-quoted blob breaks mid-command (the "command not found"
  // garbage that left agents at a bare prompt). The identity rides as an env
  // var instead; the typed command stays short and single-line.
  const env = {
    ...invocation.env,
    CREW_SYSTEM_PROMPT: identity,
    ORCA_CREW_AGENT_ID: selfNodeId,
    ORCA_CREW_AGENT_LABEL: selfLabel,
    ORCA_CREW_SKILL: 'orca-canvas',
    ...(bridge
      ? {
          ORCA_CREW_BRIDGE_PORT: String(bridge.port),
          ORCA_CREW_BRIDGE_TOKEN: bridge.token
        }
      : {})
  }
  if (agentKind === 'claude') {
    return {
      command: `${base}${args} --append-system-prompt "$CREW_SYSTEM_PROMPT"`,
      agentArgs: invocation.agentArgs,
      systemPrompt: identity,
      env
    }
  }
  if (agentKind === 'codex') {
    return {
      command: `${base}${args} -c developer_instructions="$CREW_SYSTEM_PROMPT"`,
      // Codex sandboxes shell commands, including localhost and Unix sockets.
      // Its stdio MCP child runs as part of the native agent process, so this
      // is the capability transport while OrcaRuntimeService remains the sole
      // authority and implementation for every Canvas operation.
      agentArgs: withCodexCanvasMcp(invocation.agentArgs, selfNodeId),
      systemPrompt: identity,
      env
    }
  }
  return {
    command: base + args,
    agentArgs: invocation.agentArgs,
    env: Object.keys(env).length ? env : undefined
  }
}

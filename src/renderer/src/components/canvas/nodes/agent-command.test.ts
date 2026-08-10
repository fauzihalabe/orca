import { describe, expect, it } from 'vitest'
import { buildAgentCommand } from './agent-command'

describe('Canvas agent launch command', () => {
  it('does not replay a Claude resume after switching the node to Codex', () => {
    const launch = buildAgentCommand(
      'codex',
      undefined,
      'codex',
      [],
      null,
      undefined,
      [],
      [],
      "cd '/workspace' && claude --resume 'old-session'"
    )

    expect(launch.command).toBe('codex')
  })

  it('keeps a resume belonging to the selected agent', () => {
    const launch = buildAgentCommand(
      'codex',
      undefined,
      'codex',
      [],
      null,
      '--yolo',
      [],
      [],
      "cd '/workspace' && codex resume 'session-1'"
    )

    expect(launch.command).toBe("cd '/workspace' && codex resume 'session-1'")
    expect(launch.agentArgs).toBe("'resume' 'session-1'")
  })

  it('removes shell prefixes before handing a resumed agent to Orca', () => {
    const launch = buildAgentCommand(
      'codex',
      undefined,
      'codex',
      [],
      null,
      undefined,
      [],
      [],
      "CODEX_HOME='/account' cd '/workspace' && /usr/local/bin/codex resume 'session-1'"
    )

    expect(launch.agentArgs).toBe("'resume' 'session-1'")
    expect(launch.env).toMatchObject({ CODEX_HOME: '/account' })
  })

  it('keeps the full native resume command intact', () => {
    const launch = buildAgentCommand(
      'codex',
      undefined,
      'codex',
      [],
      null,
      undefined,
      [],
      [],
      "cd '/workspace/custom' && codex resume 'session-1'",
      undefined,
      ['canvas-browser-1']
    )

    expect(launch.command).toContain("cd '/workspace/custom' && codex resume 'session-1'")
    expect(launch.command).not.toContain("'&&'")
  })

  it('teaches a connected agent the stable native Canvas browser page', () => {
    const launch = buildAgentCommand(
      'codex',
      undefined,
      'codex',
      [],
      { port: 4312, token: 'token' },
      undefined,
      [],
      ['browser'],
      undefined,
      undefined,
      ['canvas-browser-1']
    )

    expect(launch.env?.CREW_SYSTEM_PROMPT).toContain('canvas-browser-1')
    expect(launch.env?.CREW_SYSTEM_PROMPT).toContain('orca_canvas.canvas_connections')
    expect(launch.env?.CREW_SYSTEM_PROMPT).toContain('NÃO execute `orca canvas ...`')
    expect(launch.env?.CREW_SYSTEM_PROMPT).toContain('PROTOCOLO TODO OBRIGATÓRIO')
    expect(launch.env?.CREW_SYSTEM_PROMPT).toContain('`todo.spawn`')
    expect(launch.env?.CREW_SYSTEM_PROMPT).toContain('`todo.toggle`')
    expect(launch.env).toMatchObject({
      ORCA_CREW_BRIDGE_PORT: '4312',
      ORCA_CREW_BRIDGE_TOKEN: 'token',
      ORCA_CREW_AGENT_ID: 'codex',
      ORCA_CREW_AGENT_LABEL: 'codex'
    })
    expect(launch.agentArgs).toContain('mcp_servers.orca_canvas.command')
    expect(launch.agentArgs).toContain('canvas')
    expect(launch.agentArgs).toContain('mcp-serve')
    expect(launch.agentArgs).toContain('mcp_servers.orca_canvas.env.ORCA_CREW_AGENT_ID')
  })

  it('adds the native Canvas MCP transport to a resumed Codex session', () => {
    const launch = buildAgentCommand(
      'codex',
      undefined,
      'codex',
      [],
      { port: 4312, token: 'token' },
      undefined,
      [],
      ['browser'],
      "codex resume 'session-1'"
    )

    expect(launch.agentArgs).toContain("'resume' 'session-1'")
    expect(launch.agentArgs).toContain('mcp_servers.orca_canvas.args')
  })
})

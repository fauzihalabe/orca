import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RuntimeClient } from '../runtime-client'
import { CANVAS_HANDLERS } from './canvas'

function context(client: RuntimeClient, flags: Map<string, string | boolean>, json = true) {
  return { flags, json, cwd: '/tmp', client } as never
}

function nativeClient(response: unknown = 'connected') {
  return {
    call: vi.fn(async () => ({
      id: 'request-1',
      ok: true as const,
      result: { response },
      _meta: { runtimeId: 'runtime-1' }
    }))
  } as unknown as RuntimeClient
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

describe('Canvas CLI native runtime', () => {
  it('uses the stable Canvas agent identity over Orca runtime RPC', async () => {
    vi.stubEnv('ORCA_CREW_AGENT_ID', 'agent-node-1')
    const client = nativeClient('connected')
    const output = vi.spyOn(console, 'log').mockImplementation(() => {})

    await CANVAS_HANDLERS['canvas connections']!(context(client, new Map(), false))

    expect(client.call).toHaveBeenCalledWith(
      'canvas.invoke',
      { from: 'agent-node-1', tool: 'capabilities', args: {} },
      { timeoutMs: 180_000 }
    )
    expect(output).toHaveBeenCalledWith('connected')
  })

  it('targets the requested node and preserves tool arguments', async () => {
    vi.stubEnv('ORCA_CREW_AGENT_ID', 'agent-node-1')
    const client = nativeClient('/workspace')

    await CANVAS_HANDLERS['canvas call']!(
      context(
        client,
        new Map([
          ['tool', 'terminal.run'],
          ['node', 'terminal-node-2'],
          ['args', '{"command":"pwd"}']
        ])
      )
    )

    expect(client.call).toHaveBeenCalledWith(
      'canvas.invoke',
      {
        from: 'agent-node-1',
        tool: 'terminal.run',
        args: { command: 'pwd', nodeId: 'terminal-node-2' }
      },
      { timeoutMs: 180_000 }
    )
  })

  it('ignores obsolete HTTP bridge variables from a restored native agent', async () => {
    vi.stubEnv('ORCA_CREW_AGENT_ID', 'agent-node-restored')
    vi.stubEnv('ORCA_CREW_BRIDGE_PORT', '54851')
    vi.stubEnv('ORCA_CREW_BRIDGE_TOKEN', 'stale-token')
    const client = nativeClient({ nodes: ['browser-node'] })

    await CANVAS_HANDLERS['canvas graph']!(context(client, new Map(), false))

    expect(client.call).toHaveBeenCalledWith(
      'canvas.invoke',
      { from: 'agent-node-restored', tool: 'graph', args: {} },
      { timeoutMs: 180_000 }
    )
  })
})

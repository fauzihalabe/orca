import { describe, expect, it, vi } from 'vitest'
import type { RuntimeClient } from './runtime-client'
import { handleCanvasMcpRequest } from './canvas-mcp-server'

function client(response: unknown): RuntimeClient {
  return {
    call: vi.fn().mockResolvedValue({
      id: 'rpc-1',
      ok: true,
      result: { response },
      _meta: { runtimeId: 'runtime-1' }
    })
  } as unknown as RuntimeClient
}

describe('Canvas MCP server', () => {
  it('makes durable Todo tracking part of every Canvas agent session', async () => {
    const result = await handleCanvasMcpRequest(client({}), {
      id: 0,
      method: 'initialize'
    })

    expect(result).toMatchObject({
      instructions: expect.stringContaining('Mandatory progress protocol')
    })
    expect((result as { instructions: string }).instructions).toContain('todo.spawn')
    expect((result as { instructions: string }).instructions).toContain('toggle each item')
  })

  it('advertises the edge-scoped native Canvas tools', async () => {
    const result = await handleCanvasMcpRequest(client({}), {
      id: 1,
      method: 'tools/list'
    })

    expect(result).toMatchObject({
      tools: [
        { name: 'canvas_connections' },
        { name: 'canvas_graph' },
        { name: 'canvas_call' },
        { name: 'canvas_ask' }
      ]
    })
  })

  it('routes a tool call through canvas.invoke with the stable agent identity', async () => {
    vi.stubEnv('ORCA_CREW_AGENT_ID', 'agent-1')
    const runtime = client({ connected: [{ id: 'browser-1', kind: 'browser' }] })

    const result = await handleCanvasMcpRequest(runtime, {
      id: 2,
      method: 'tools/call',
      params: { name: 'canvas_connections', arguments: {} }
    })

    expect(runtime.call).toHaveBeenCalledWith(
      'canvas.invoke',
      { from: 'agent-1', tool: 'capabilities', args: {} },
      { timeoutMs: 180_000 }
    )
    expect(result).toMatchObject({
      isError: false,
      structuredContent: { connected: [{ id: 'browser-1', kind: 'browser' }] }
    })
  })

  it('passes explicit node selection to the native broker', async () => {
    vi.stubEnv('ORCA_CREW_AGENT_ID', 'agent-1')
    const runtime = client({ url: 'https://example.com' })

    await handleCanvasMcpRequest(runtime, {
      id: 3,
      method: 'tools/call',
      params: {
        name: 'canvas_call',
        arguments: {
          tool: 'browser.snapshot',
          node: 'browser-1',
          args: { interactive: true }
        }
      }
    })

    expect(runtime.call).toHaveBeenCalledWith(
      'canvas.invoke',
      {
        from: 'agent-1',
        tool: 'browser.snapshot',
        args: { interactive: true, nodeId: 'browser-1' }
      },
      { timeoutMs: 180_000 }
    )
  })
})

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
    expect((result as { instructions: string }).instructions).toContain(
      'Canvas terminals are manual user resources and are never agent-callable'
    )
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
    expect(JSON.stringify(result)).toContain('browser.navigate reuses its page')
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

  it('rejects stale Canvas terminal calls before reaching the broker', async () => {
    vi.stubEnv('ORCA_CREW_AGENT_ID', 'agent-1')
    const runtime = client({})

    const result = await handleCanvasMcpRequest(runtime, {
      id: 4,
      method: 'tools/call',
      params: {
        name: 'canvas_call',
        arguments: { tool: 'terminal.run', args: { command: 'pwd' } }
      }
    })

    expect(result).toMatchObject({ isError: true })
    expect(JSON.stringify(result)).toContain('not agent-callable')
    expect(runtime.call).not.toHaveBeenCalled()
  })

  it('marks every native Canvas error prefix as an MCP error', async () => {
    vi.stubEnv('ORCA_CREW_AGENT_ID', 'agent-1')
    const result = await handleCanvasMcpRequest(
      client('erro no navegador: browser_tab_not_found'),
      {
        id: 5,
        method: 'tools/call',
        params: {
          name: 'canvas_call',
          arguments: { tool: 'browser.snapshot', args: {} }
        }
      }
    )

    expect(result).toMatchObject({ isError: true })
  })

  it('returns browser screenshots as image content instead of base64 text', async () => {
    vi.stubEnv('ORCA_CREW_AGENT_ID', 'agent-1')
    const result = await handleCanvasMcpRequest(
      client(JSON.stringify({ data: 'cG5nLWJ5dGVz', format: 'png' })),
      {
        id: 6,
        method: 'tools/call',
        params: {
          name: 'canvas_call',
          arguments: { tool: 'browser.screenshot', node: 'browser-1', args: {} }
        }
      }
    )

    expect(result).toEqual({
      content: [{ type: 'image', data: 'cG5nLWJ5dGVz', mimeType: 'image/png' }],
      structuredContent: { format: 'png' },
      isError: false
    })
  })

  it('returns browser PDFs as embedded resources instead of base64 text', async () => {
    vi.stubEnv('ORCA_CREW_AGENT_ID', 'agent-1')
    const result = await handleCanvasMcpRequest(client(JSON.stringify({ data: 'cGRmLWJ5dGVz' })), {
      id: 7,
      method: 'tools/call',
      params: {
        name: 'canvas_call',
        arguments: { tool: 'browser.pdf', node: 'browser-1', args: {} }
      }
    })

    expect(result).toEqual({
      content: [
        {
          type: 'resource',
          resource: {
            uri: 'orca://canvas/browser.pdf',
            mimeType: 'application/pdf',
            blob: 'cGRmLWJ5dGVz'
          }
        }
      ],
      structuredContent: { mimeType: 'application/pdf' },
      isError: false
    })
  })
})

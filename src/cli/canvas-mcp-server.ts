import { createInterface } from 'node:readline'
import type { RuntimeClient } from './runtime-client'

type JsonRpcId = string | number | null

type JsonRpcRequest = {
  jsonrpc?: string
  id?: JsonRpcId
  method?: string
  params?: unknown
}

type CanvasInvokeResult = { response: unknown }

type ToolCallParams = {
  name?: unknown
  arguments?: unknown
}

const TOOLS = [
  {
    name: 'canvas_connections',
    description:
      'Read every live Canvas node directly connected to this agent. Call this before answering questions about the Canvas and again after lines change.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: {
      title: 'Read Canvas connections',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false
    }
  },
  {
    name: 'canvas_graph',
    description:
      'Read the persisted native Orca Canvas graph, including tabs, nodes, edges, labels, kinds and native runtime identities.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: {
      title: 'Read Canvas graph',
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false
    }
  },
  {
    name: 'canvas_call',
    description:
      'Use a capability on a Canvas node connected to this agent, or create a connected resource with a *.spawn tool. For multi-step work, create a Todo with todo.spawn when none is connected, then keep todo.list/add/toggle synchronized. The Orca main process checks the live edge and dispatches operations through native Orca engines.',
    inputSchema: {
      type: 'object',
      properties: {
        tool: {
          type: 'string',
          description:
            'Native Canvas tool name returned by canvas_connections, for example browser.snapshot, simulator.ax, terminal.run or note.read.'
        },
        node: {
          type: 'string',
          description:
            'Stable node id. Required when more than one connected node can satisfy the tool.'
        },
        args: {
          type: 'object',
          description: 'Arguments for the native operation.',
          additionalProperties: true
        }
      },
      required: ['tool'],
      additionalProperties: false
    },
    annotations: {
      title: 'Use connected Canvas node',
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true
    }
  },
  {
    name: 'canvas_ask',
    description: 'Send a message to another agent directly connected by a Canvas line.',
    inputSchema: {
      type: 'object',
      properties: {
        to: { type: 'string', description: 'Connected agent node id or unambiguous label.' },
        message: { type: 'string', description: 'Message to send.' }
      },
      required: ['to', 'message'],
      additionalProperties: false
    },
    annotations: {
      title: 'Message connected Canvas agent',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false
    }
  }
] as const

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function agentId(): string {
  const value = process.env.ORCA_CREW_AGENT_ID?.trim()
  if (!value) {
    throw new Error('Canvas tools are only available inside an Orca Canvas agent terminal.')
  }
  return value
}

function textArgument(value: unknown, name: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${name} is required`)
  }
  return value.trim()
}

function responseText(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value ?? null, null, 2)
}

async function invoke(
  client: RuntimeClient,
  request: {
    tool: string
    args?: Record<string, unknown>
    to?: string
    message?: string
  }
): Promise<unknown> {
  const result = await client.call<CanvasInvokeResult>(
    'canvas.invoke',
    {
      from: agentId(),
      tool: request.tool,
      args: request.args ?? {},
      ...(request.to ? { to: request.to } : {}),
      ...(request.message ? { message: request.message } : {})
    },
    { timeoutMs: 180_000 }
  )
  return result.result.response
}

async function callTool(client: RuntimeClient, params: unknown): Promise<unknown> {
  const call = isRecord(params) ? (params as ToolCallParams) : {}
  const name = textArgument(call.name, 'tool name')
  const args = isRecord(call.arguments) ? call.arguments : {}
  switch (name) {
    case 'canvas_connections':
      return await invoke(client, { tool: 'capabilities' })
    case 'canvas_graph':
      return await invoke(client, { tool: 'graph' })
    case 'canvas_call': {
      const tool = textArgument(args.tool, 'tool')
      const operationArgs = isRecord(args.args) ? { ...args.args } : {}
      if (typeof args.node === 'string' && args.node.trim()) {
        operationArgs.nodeId = args.node.trim()
      }
      return await invoke(client, { tool, args: operationArgs })
    }
    case 'canvas_ask':
      return await invoke(client, {
        tool: 'ask',
        to: textArgument(args.to, 'to'),
        message: textArgument(args.message, 'message')
      })
    default:
      throw new Error(`Unknown Canvas tool: ${name}`)
  }
}

function send(message: unknown): void {
  process.stdout.write(`${JSON.stringify(message)}\n`)
}

function success(id: JsonRpcId, result: unknown): void {
  send({ jsonrpc: '2.0', id, result })
}

function failure(id: JsonRpcId, error: unknown): void {
  send({
    jsonrpc: '2.0',
    id,
    error: {
      code: -32_603,
      message: error instanceof Error ? error.message : String(error)
    }
  })
}

export async function handleCanvasMcpRequest(
  client: RuntimeClient,
  request: JsonRpcRequest
): Promise<unknown> {
  switch (request.method) {
    case 'initialize': {
      const requested = isRecord(request.params) ? request.params.protocolVersion : undefined
      return {
        protocolVersion: typeof requested === 'string' ? requested : '2025-06-18',
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'orca-canvas', version: '1.0.0' },
        instructions:
          'Use canvas_connections before answering about the Canvas. Lines are live capability grants; all actions are authorized and executed by the native Orca runtime. Mandatory progress protocol: for any request with two or more concrete actions, ensure a connected Todo exists (canvas_call todo.spawn if needed), add every action once, and toggle each item immediately when completed.'
      }
    }
    case 'ping':
      return {}
    case 'tools/list':
      return { tools: TOOLS }
    case 'tools/call': {
      try {
        const result = await callTool(client, request.params)
        const text = responseText(result)
        return {
          content: [{ type: 'text', text }],
          structuredContent: typeof result === 'string' ? { response: result } : result,
          isError: typeof result === 'string' && result.startsWith('erro:')
        }
      } catch (error) {
        return {
          content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }],
          isError: true
        }
      }
    }
    case undefined:
      throw new Error('Method not found: ')
    default:
      throw new Error(`Method not found: ${request.method}`)
  }
}

export async function serveCanvasMcp(client: RuntimeClient): Promise<void> {
  const lines = createInterface({ input: process.stdin, crlfDelay: Infinity, terminal: false })
  for await (const line of lines) {
    if (!line.trim()) {
      continue
    }
    let request: JsonRpcRequest
    try {
      request = JSON.parse(line) as JsonRpcRequest
    } catch {
      failure(null, new Error('Invalid JSON'))
      continue
    }
    // MCP notifications intentionally have no response frame.
    if (request.id === undefined) {
      continue
    }
    try {
      success(request.id, await handleCanvasMcpRequest(client, request))
    } catch (error) {
      failure(request.id, error)
    }
  }
}

import type { CommandHandler, HandlerContext } from '../dispatch'
import { printResult } from '../format'
import { getOptionalStringFlag, getRequiredStringFlag } from '../flags'
import { RuntimeClientError } from '../runtime-client'
import { serveCanvasMcp } from '../canvas-mcp-server'

type CanvasInvokeResult = { response: unknown }

function canvasAgentId(): string {
  const id = process.env.ORCA_CREW_AGENT_ID?.trim()
  if (!id) {
    throw new RuntimeClientError(
      'invalid_environment',
      'Canvas tools are only available inside an Orca Canvas agent terminal.'
    )
  }
  return id
}

function parseArgsJson(raw: string | undefined): Record<string, unknown> {
  if (!raw) {
    return {}
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new RuntimeClientError('invalid_argument', '--args must be a JSON object')
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new RuntimeClientError('invalid_argument', '--args must be a JSON object')
  }
  return parsed as Record<string, unknown>
}

function formatCanvasResult(value: CanvasInvokeResult): string {
  return typeof value.response === 'string'
    ? value.response
    : JSON.stringify(value.response ?? null, null, 2)
}

async function invokeCanvas(
  context: Pick<HandlerContext, 'client' | 'json'>,
  request: {
    tool: string
    args?: Record<string, unknown>
    to?: string
    message?: string
  }
): Promise<void> {
  const result = await context.client.call<CanvasInvokeResult>(
    'canvas.invoke',
    {
      from: canvasAgentId(),
      tool: request.tool,
      args: request.args ?? {},
      ...(request.to ? { to: request.to } : {}),
      ...(request.message ? { message: request.message } : {})
    },
    { timeoutMs: 180_000 }
  )
  printResult(result, context.json, formatCanvasResult)
}

export const CANVAS_HANDLERS: Record<string, CommandHandler> = {
  'canvas mcp-serve': async ({ client }) => {
    await serveCanvasMcp(client)
  },
  'canvas connections': async ({ client, json }) => {
    await invokeCanvas({ client, json }, { tool: 'capabilities' })
  },
  'canvas graph': async ({ client, json }) => {
    await invokeCanvas({ client, json }, { tool: 'graph' })
  },
  'canvas call': async ({ flags, client, json }) => {
    const tool = getRequiredStringFlag(flags, 'tool')
    const node = getOptionalStringFlag(flags, 'node')
    const args = parseArgsJson(getOptionalStringFlag(flags, 'args'))
    if (node) {
      args.nodeId = node
    }
    await invokeCanvas({ client, json }, { tool, args })
  },
  'canvas ask': async ({ flags, client, json }) => {
    await invokeCanvas(
      { client, json },
      {
        tool: 'ask',
        to: getRequiredStringFlag(flags, 'to'),
        message: getRequiredStringFlag(flags, 'message')
      }
    )
  }
}

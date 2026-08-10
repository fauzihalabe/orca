import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { defineMethod, type RpcMethod } from '../core'

const CanvasInvokeParams = z
  .object({
    from: z.string().trim().min(1).max(240),
    tool: z.string().trim().min(1).max(240),
    to: z.string().trim().min(1).max(240).optional(),
    message: z
      .string()
      .max(512 * 1024)
      .optional(),
    args: z.record(z.string(), z.unknown()).optional()
  })
  .strict()

function parseCanvasResponse(response: string): unknown {
  try {
    return JSON.parse(response) as unknown
  } catch {
    return response
  }
}

export const CANVAS_METHODS: RpcMethod[] = [
  defineMethod({
    name: 'canvas.invoke',
    params: CanvasInvokeParams,
    handler: async (params, { runtime, requestId }) => ({
      response: parseCanvasResponse(
        await runtime.invokeCrewCanvas({
          requestId: requestId ?? `canvas-${randomUUID()}`,
          from: params.from,
          tool: params.tool,
          to: params.to,
          message: params.message,
          args: params.args ?? {}
        })
      )
    })
  })
]

import { describe, expect, it, vi } from 'vitest'
import type { OrcaRuntimeService } from '../../orca-runtime'
import type { RpcRequest } from '../core'
import { RpcDispatcher } from '../dispatcher'
import { CANVAS_METHODS } from './canvas'

function makeRequest(params: unknown): RpcRequest {
  return { id: 'req-1', authToken: 'tok', method: 'canvas.invoke', params }
}

describe('Canvas native runtime RPC', () => {
  it('routes the stable agent identity to the Canvas capability broker', async () => {
    const runtime = {
      getRuntimeId: () => 'test-runtime',
      invokeCrewCanvas: vi.fn().mockResolvedValue('{"connections":[{"kind":"browser"}]}')
    } as unknown as OrcaRuntimeService
    const dispatcher = new RpcDispatcher({ runtime, methods: CANVAS_METHODS })

    const response = await dispatcher.dispatch(
      makeRequest({
        from: 'agent-node-1',
        tool: 'capabilities',
        args: {}
      })
    )

    expect(runtime.invokeCrewCanvas).toHaveBeenCalledWith({
      requestId: 'req-1',
      from: 'agent-node-1',
      tool: 'capabilities',
      to: undefined,
      message: undefined,
      args: {}
    })
    expect(response).toMatchObject({
      ok: true,
      result: { response: { connections: [{ kind: 'browser' }] } }
    })
  })

  it('rejects unknown fields at the native RPC boundary', async () => {
    const runtime = {
      getRuntimeId: () => 'test-runtime',
      invokeCrewCanvas: vi.fn()
    } as unknown as OrcaRuntimeService
    const dispatcher = new RpcDispatcher({ runtime, methods: CANVAS_METHODS })

    const response = await dispatcher.dispatch(
      makeRequest({ from: 'agent-node-1', tool: 'graph', args: {}, forged: true })
    )

    expect(response).toMatchObject({ ok: false, error: { code: 'invalid_argument' } })
    expect(runtime.invokeCrewCanvas).not.toHaveBeenCalled()
  })
})

import type { CrewCanvasRuntimeRequest } from '../shared/crew-canvas'
import { isCrewCanvasErrorResponse } from '../shared/crew-canvas-response'
import { isCrewCanvasBrowserUnavailable } from './crew-canvas-browser-adapter'
import { isCrewCanvasRecord } from './crew-canvas-graph'
import type { LocatedCanvasNode } from './crew-canvas-graph'
import type { CrewCanvasNativeTools } from './crew-canvas-native-tools'

function browserRecoveryReady(value: string): boolean {
  try {
    const parsed = JSON.parse(value) as unknown
    return isCrewCanvasRecord(parsed) && parsed.ready === true && parsed.reused === true
  } catch {
    return false
  }
}

async function ensureConnectedBrowserReady(args: {
  payload: CrewCanvasRuntimeRequest
  browser: LocatedCanvasNode
  native: CrewCanvasNativeTools
  forwardToRenderer: (payload: CrewCanvasRuntimeRequest) => Promise<string>
  force?: boolean
}): Promise<string | null> {
  if (!args.force && args.native.browserPageReady(args.browser.node.id)) {
    return null
  }
  const recovery = await args.forwardToRenderer({
    ...args.payload,
    tool: 'browser.spawn',
    args: { nativeReuseNodeId: args.browser.node.id }
  })
  if (isCrewCanvasErrorResponse(recovery) || !browserRecoveryReady(recovery)) {
    return `erro: recuperação do browser conectado falhou: ${recovery}`
  }
  if (!(await args.native.waitForBrowserPageReady(args.browser.node.id))) {
    return 'erro: recuperação do browser conectado não publicou a página no runtime nativo'
  }
  return null
}

export async function callCrewCanvasBrowserWithRecovery(args: {
  payload: CrewCanvasRuntimeRequest
  browser: LocatedCanvasNode
  native: CrewCanvasNativeTools
  forwardToRenderer: (payload: CrewCanvasRuntimeRequest) => Promise<string>
}): Promise<string> {
  const tool = args.payload.tool ?? ''
  const toolArgs = args.payload.args ?? {}
  const preparationError = await ensureConnectedBrowserReady(args)
  if (preparationError) {
    return preparationError
  }
  const result = await args.native.browserTool(args.browser.node.id, tool, toolArgs)
  if (!isCrewCanvasBrowserUnavailable(result)) {
    return result
  }
  const recoveryError = await ensureConnectedBrowserReady({ ...args, force: true })
  if (recoveryError) {
    return recoveryError
  }
  return args.native.browserTool(args.browser.node.id, tool, toolArgs)
}

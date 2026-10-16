import { randomUUID } from 'node:crypto'
import { ORCHESTRATION_CONTRACT_VERSION } from '../shared/protocol-version'
import type { OrcaRuntimeService } from './runtime/orca-runtime'
import { RpcDispatcher } from './runtime/rpc/dispatcher'
import {
  crewCanvasBrowserTextArgument,
  crewCanvasBrowserWaitArgs,
  formatCrewCanvasBrowserSnapshot,
  normalizeCrewCanvasBrowserEvalExpression
} from './crew-canvas-browser-adapter'
import { crewCanvasJson, crewCanvasText, type LocatedCanvasNode } from './crew-canvas-graph'
import type { CrewCanvasStateStore } from './crew-canvas-state'

const NATIVE_REQUEST_TIMEOUT_MS = 150_000

function nativeError(context: string, error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return `erro: ${context}: ${message}`
}

export class CrewCanvasNativeTools {
  constructor(
    private readonly getRuntime: () => OrcaRuntimeService | null,
    private readonly state: CrewCanvasStateStore
  ) {}

  async call(method: string, params: Record<string, unknown>, context: string): Promise<string> {
    if (!this.getRuntime()) {
      return `erro: ${context}: runtime nativo indisponível`
    }
    try {
      return crewCanvasJson(await this.dispatch(method, params))
    } catch (error) {
      return nativeError(context, error)
    }
  }

  async dispatch(
    method: string,
    params: Record<string, unknown>,
    timeoutMs = NATIVE_REQUEST_TIMEOUT_MS
  ): Promise<unknown> {
    const runtime = this.getRuntime()
    if (!runtime) {
      throw new Error('runtime nativo indisponível')
    }
    let timeout: ReturnType<typeof setTimeout> | undefined
    const response = await Promise.race([
      new RpcDispatcher({ runtime }).dispatch({
        id: `canvas-${randomUUID()}`,
        authToken: 'desktop-canvas',
        method,
        params,
        ...(method.startsWith('orchestration.')
          ? { orchestrationContractVersion: ORCHESTRATION_CONTRACT_VERSION }
          : {})
      }),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error('native runtime timeout')), timeoutMs)
        timeout.unref?.()
      })
    ]).finally(() => {
      if (timeout) {
        clearTimeout(timeout)
      }
    })
    if (response.ok !== true) {
      throw new Error(`${response.error.code}: ${response.error.message}`)
    }
    return response.result
  }

  terminalIdentity(located: LocatedCanvasNode, noun: string): { handle: string; paneKey: string } {
    const runtime = this.getRuntime()
    if (!runtime) {
      throw new Error('runtime nativo indisponível')
    }
    const paneKey = crewCanvasText(located.node.data.paneKey).trim()
    if (!paneKey) {
      throw new Error(`${noun} ainda não publicou sua identidade nativa; aguarde o boot`)
    }
    const terminal = runtime.resolveTerminalPane(paneKey, located.tab.worktreeId ?? undefined)
    if (terminal.connected === false) {
      throw new Error(`${noun} não está conectado ao runtime nativo`)
    }
    return { handle: terminal.handle, paneKey }
  }

  async browserTool(nodeId: string, tool: string, args: Record<string, unknown>): Promise<string> {
    const page = this.state.browserPageId(nodeId)
    const worktree = this.state.browserWorktreeId(nodeId)
    const target = { page, ...(worktree ? { worktree } : {}) }
    const { nodeId: _nodeId, ...nativeArgs } = args
    void _nodeId
    if (tool === 'browser.navigate') {
      const url = crewCanvasText(args.url).trim()
      return url
        ? this.call('browser.goto', { ...target, url }, 'navegador')
        : 'erro: url obrigatória'
    }
    if (tool === 'browser.read' || tool === 'browser.snapshot') {
      try {
        return formatCrewCanvasBrowserSnapshot(
          await this.dispatch('browser.snapshot', target),
          args.maxBytes
        )
      } catch (error) {
        return nativeError('navegador', error)
      }
    }
    if (tool === 'browser.eval') {
      const expression = crewCanvasBrowserTextArgument(args, ['expression', 'js', 'code'])
      return expression
        ? this.call(
            'browser.eval',
            { ...target, expression: normalizeCrewCanvasBrowserEvalExpression(expression) },
            'navegador'
          )
        : 'erro: expression/js obrigatório'
    }
    if (tool === 'browser.type') {
      const input = crewCanvasBrowserTextArgument(args, ['input', 'text', 'value'])
      return input
        ? this.call('browser.type', { ...target, input }, 'navegador')
        : 'erro: input/text obrigatório'
    }
    if (tool === 'browser.wait') {
      const waitArgs = crewCanvasBrowserWaitArgs(args)
      return waitArgs
        ? this.call('browser.wait', { ...target, ...waitArgs }, 'navegador')
        : 'erro: browser.wait exige selector, text, url, load, fn, state ou timeout'
    }
    if (tool === 'browser.click' || tool === 'browser.fill') {
      return this.browserElementTool(tool, target, args)
    }
    if (tool === 'browser.hover' || tool === 'browser.upload') {
      const element = crewCanvasText(args.element ?? args.ref).trim()
      return element
        ? this.call(tool, { ...nativeArgs, ...target, element }, 'navegador')
        : 'erro: element/ref obrigatório; use uma ref do browser.snapshot nativo'
    }
    if (tool === 'browser.network' || tool === 'browser.console') {
      return this.browserCaptureLog(nodeId, tool, args)
    }
    return this.call(tool, { ...nativeArgs, ...target }, 'navegador')
  }

  browserPageReady(nodeId: string): boolean {
    const runtime = this.getRuntime()
    if (!runtime) {
      return false
    }
    return runtime.browserPageReady({ page: this.state.browserPageId(nodeId) })
  }

  async waitForBrowserPageReady(nodeId: string, timeoutMs = 4_000): Promise<boolean> {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      if (this.browserPageReady(nodeId)) {
        return true
      }
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    return this.browserPageReady(nodeId)
  }

  async browserCaptureLog(
    nodeId: string,
    method: 'browser.network' | 'browser.console',
    args: Record<string, unknown>
  ): Promise<string> {
    const page = this.state.browserPageId(nodeId)
    const worktree = this.state.browserWorktreeId(nodeId)
    const target = { page, ...(worktree ? { worktree } : {}) }
    try {
      await this.dispatch('browser.capture.start', target)
      return crewCanvasJson(
        await this.dispatch(method, {
          ...target,
          limit: typeof args.limit === 'number' ? args.limit : 100
        })
      )
    } catch (error) {
      return nativeError('navegador nativo', error)
    }
  }

  private async browserElementTool(
    tool: 'browser.click' | 'browser.fill',
    target: Record<string, string>,
    args: Record<string, unknown>
  ): Promise<string> {
    const element = crewCanvasText(args.element ?? args.ref).trim()
    const value = crewCanvasBrowserTextArgument(args, ['value', 'text', 'input'])
    if (tool === 'browser.fill' && value === undefined) {
      return 'erro: value/text obrigatório'
    }
    if (element) {
      return this.call(
        tool,
        tool === 'browser.click' ? { ...target, element } : { ...target, element, value },
        'navegador'
      )
    }
    return 'erro: element/ref obrigatório; use uma ref do browser.snapshot nativo'
  }
}

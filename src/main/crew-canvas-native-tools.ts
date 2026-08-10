import { randomUUID } from 'node:crypto'
import { ORCHESTRATION_CONTRACT_VERSION } from '../shared/protocol-version'
import type { OrcaRuntimeService } from './runtime/orca-runtime'
import { RpcDispatcher } from './runtime/rpc/dispatcher'
import {
  crewCanvasJson,
  crewCanvasText,
  type LocatedCanvasNode
} from './crew-canvas-graph'
import type { CrewCanvasStateStore } from './crew-canvas-state'

const NATIVE_REQUEST_TIMEOUT_MS = 150_000

export class CrewCanvasNativeTools {
  constructor(
    private readonly getRuntime: () => OrcaRuntimeService | null,
    private readonly state: CrewCanvasStateStore
  ) {}

  async call(method: string, params: Record<string, unknown>, prefix: string): Promise<string> {
    if (!this.getRuntime()) {
      return `${prefix}: runtime nativo indisponível`
    }
    try {
      return crewCanvasJson(await this.dispatch(method, params))
    } catch (error) {
      return `${prefix}: ${error instanceof Error ? error.message : String(error)}`
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
    const { nodeId: _nodeId, selector, js, ...nativeArgs } = args
    void _nodeId
    if (tool === 'browser.navigate') {
      const url = crewCanvasText(args.url).trim()
      return url
        ? this.call('browser.goto', { ...target, url }, 'erro no navegador')
        : 'erro: url obrigatória'
    }
    if (tool === 'browser.read' || tool === 'browser.snapshot') {
      return this.call('browser.snapshot', target, 'erro no navegador')
    }
    if (tool === 'browser.eval') {
      const expression = crewCanvasText(args.expression ?? js)
      return expression
        ? this.call('browser.eval', { ...target, expression }, 'erro no navegador')
        : 'erro: expression/js obrigatório'
    }
    if (tool === 'browser.click' || tool === 'browser.fill') {
      return this.browserElementTool(tool, target, args, selector)
    }
    if (tool === 'browser.network' || tool === 'browser.console') {
      return this.browserCaptureLog(nodeId, tool, args)
    }
    return this.call(tool, { ...nativeArgs, ...target }, 'erro no navegador')
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
      return `erro no navegador nativo: ${error instanceof Error ? error.message : String(error)}`
    }
  }

  async terminalTool(
    terminal: LocatedCanvasNode,
    tool: string,
    args: Record<string, unknown>
  ): Promise<string> {
    let handle: string
    try {
      handle = this.terminalIdentity(terminal, 'o terminal').handle
    } catch (error) {
      return `erro: ${error instanceof Error ? error.message : String(error)}`
    }
    try {
      if (tool === 'terminal.read') {
        return JSON.stringify(
          await this.dispatch('terminal.read', {
            terminal: handle,
            ...(typeof args.cursor === 'number' ? { cursor: args.cursor } : {}),
            ...(typeof args.limit === 'number' ? { limit: args.limit } : {})
          })
        )
      }
      const command = crewCanvasText(args.command ?? args.text)
      if (!command.trim()) {
        return 'erro: command/text obrigatório'
      }
      await this.dispatch('terminal.send', {
        terminal: handle,
        text: command,
        enter: args.enter !== false
      })
      if (tool === 'terminal.send') {
        return JSON.stringify({ sent: true })
      }
      // Why: terminal.run must feel exactly like a native agent's own command
      // execution — one call, output inline. The wait is ENGINE-side (tui-idle,
      // the runtime's own prompt/idle detector), so no model cycles burn on
      // cursor polling; terminal.read stays available for explicit follow-up.
      const timeoutMs = typeof args.timeoutMs === 'number' ? args.timeoutMs : 60_000
      try {
        await this.dispatch('terminal.wait', { terminal: handle, for: 'tui-idle', timeoutMs })
      } catch {
        // timeout/stale — fall through and return whatever the screen has
      }
      return JSON.stringify(
        await this.dispatch('terminal.read', {
          terminal: handle,
          ...(typeof args.lines === 'number' ? { limit: args.lines } : { limit: 400 })
        })
      )
    } catch (error) {
      return `erro no terminal nativo: ${error instanceof Error ? error.message : String(error)}`
    }
  }

  private async browserElementTool(
    tool: 'browser.click' | 'browser.fill',
    target: Record<string, string>,
    args: Record<string, unknown>,
    selector: unknown
  ): Promise<string> {
    const element = crewCanvasText(args.element ?? args.ref).trim()
    if (element) {
      return this.call(
        tool,
        tool === 'browser.click'
          ? { ...target, element }
          : { ...target, element, value: crewCanvasText(args.value) },
        'erro no navegador'
      )
    }
    const css = crewCanvasText(selector).trim()
    if (!css) {
      return 'erro: element ou selector obrigatório'
    }
    const expression =
      tool === 'browser.click'
        ? `(() => { const el = document.querySelector(${JSON.stringify(css)}); if (!el) return 'not-found'; el.scrollIntoView({block:'center'}); el.click(); return 'clicked' })()`
        : `(() => { const el = document.querySelector(${JSON.stringify(css)}); if (!el) return 'not-found'; el.focus(); el.value = ${JSON.stringify(crewCanvasText(args.value))}; el.dispatchEvent(new Event('input', {bubbles:true})); el.dispatchEvent(new Event('change', {bubbles:true})); return 'filled' })()`
    const result = await this.call('browser.eval', { ...target, expression }, 'erro no navegador')
    if (result === 'not-found') {
      return `erro: ${css} não encontrado`
    }
    return tool === 'browser.click' ? `clicado ${css}` : `preenchido ${css}`
  }
}

// Browser crew tools — route through Orca's native browser runtime. The
// dispatcher resolves which connected node is allowed; this module only adds
// the Canvas page identity and keeps the small, human-friendly aliases used by
// the agent prompt.

import { callRuntimeRpc } from '@/runtime/runtime-rpc-client'
import { allCrewGraphs } from './canvas-store'

export function crewBrowserPageId(nodeId: string): string {
  const configured = allCrewGraphs()
    .flatMap((graph) => graph.nodes)
    .find((node) => node.id === nodeId)?.data.browserPageId
  return typeof configured === 'string' && configured.trim().length > 0
    ? configured
    : `canvas-${nodeId}`
}

export async function runBrowserTool(
  nodeId: string,
  tool: string,
  args: Record<string, unknown>
): Promise<string> {
  const page = crewBrowserPageId(nodeId)
  const { nodeId: _ignoredNodeId, selector, js, ...nativeArgs } = args
  void _ignoredNodeId
  try {
    // Keep the old Canvas vocabulary as aliases, but execute every action
    // through the exact runtime methods used by `orca browser ...`.
    if (tool === 'browser.navigate') {
      const url = String(args.url ?? '')
      if (!url) {
        return 'erro: url obrigatória'
      }
      const result = await callRuntimeRpc<unknown>({ kind: 'local' }, 'browser.goto', {
        page,
        url
      })
      return formatNativeResult(result)
    }
    if (tool === 'browser.read' || tool === 'browser.snapshot') {
      const result = await callRuntimeRpc<unknown>({ kind: 'local' }, 'browser.snapshot', { page })
      return formatNativeResult(result)
    }
    if (tool === 'browser.eval') {
      const expression = String(args.expression ?? js ?? '')
      if (!expression) {
        return 'erro: expression/js obrigatório'
      }
      const result = await callRuntimeRpc<unknown>({ kind: 'local' }, 'browser.eval', {
        page,
        expression
      })
      return formatNativeResult(result)
    }
    if (tool === 'browser.click') {
      const element = String(args.element ?? args.ref ?? '')
      if (element) {
        const result = await callRuntimeRpc<unknown>({ kind: 'local' }, 'browser.click', {
          page,
          element
        })
        return formatNativeResult(result)
      }
      return runNativeSelectorEval(page, 'click', selector)
    }
    if (tool === 'browser.fill') {
      const element = String(args.element ?? args.ref ?? '')
      const value = String(args.value ?? '')
      if (element) {
        const result = await callRuntimeRpc<unknown>({ kind: 'local' }, 'browser.fill', {
          page,
          element,
          value
        })
        return formatNativeResult(result)
      }
      return runNativeSelectorEval(page, 'fill', selector, value)
    }

    if (tool === 'browser.network') {
      const result = await callRuntimeRpc<unknown>({ kind: 'local' }, 'browser.network', {
        page,
        limit: typeof args.limit === 'number' ? args.limit : undefined
      })
      return formatNativeResult(result)
    }

    // Native browser commands can be addressed directly from the Canvas too:
    // browser.console, browser.screenshot, browser.wait, browser.tabShow, ...
    if (tool.startsWith('browser.')) {
      const result = await callRuntimeRpc<unknown>({ kind: 'local' }, tool, {
        ...nativeArgs,
        page
      })
      return formatNativeResult(result)
    }
    return `erro: tool desconhecida ${tool}`
  } catch (error) {
    return `erro no navegador: ${error instanceof Error ? error.message.slice(0, 300) : String(error)}`
  }
}

function formatNativeResult(value: unknown): string {
  if (typeof value === 'string') {
    return value
  }
  return JSON.stringify(value ?? null)
}

async function runNativeSelectorEval(
  page: string,
  action: 'click' | 'fill',
  selector: unknown,
  value?: string
): Promise<string> {
  const css = String(selector ?? '')
  if (!css) {
    return 'erro: element ou selector obrigatório'
  }
  const expression =
    action === 'click'
      ? `(() => { const el = document.querySelector(${JSON.stringify(css)}); if (!el) return 'not-found'; el.scrollIntoView({block:'center'}); el.click(); return 'clicked' })()`
      : `(() => { const el = document.querySelector(${JSON.stringify(css)}); if (!el) return 'not-found'; el.focus(); el.value = ${JSON.stringify(value ?? '')}; el.dispatchEvent(new Event('input', {bubbles:true})); el.dispatchEvent(new Event('change', {bubbles:true})); return 'filled' })()`
  const result = await callRuntimeRpc<unknown>({ kind: 'local' }, 'browser.eval', {
    page,
    expression
  })
  if (result === 'not-found') {
    return `erro: ${css} não encontrado`
  }
  return action === 'click' ? `clicado ${css}` : `preenchido ${css}`
}

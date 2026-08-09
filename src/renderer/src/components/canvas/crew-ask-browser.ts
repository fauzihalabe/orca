// Browser crew tools — run against the <webview> of the browser node directly
// connected to the calling agent (the edge is the permission; the dispatcher
// in crew-ask-listener resolves WHICH node, this module only drives it).

function guestWebviewOf(nodeId: string): Electron.WebviewTag | null {
  const host = document.querySelector(`[data-id="${nodeId}"]`)
  return (host?.querySelector('webview') as Electron.WebviewTag | null) ?? null
}

export async function runBrowserTool(
  nodeId: string,
  tool: string,
  args: Record<string, unknown>
): Promise<string> {
  const wv = guestWebviewOf(nodeId)
  if (!wv) {
    return 'erro: o navegador conectado não está montado/visível'
  }
  try {
    if (tool === 'browser.navigate') {
      const url = String(args.url ?? '')
      if (!url) {
        return 'erro: url obrigatória'
      }
      wv.setAttribute('src', /^[a-z]+:\/\//i.test(url) ? url : `https://${url}`)
      await new Promise((resolve) => setTimeout(resolve, 1500))
      return `navegado para ${url}`
    }
    if (tool === 'browser.read') {
      const text = (await wv.executeJavaScript(
        'document.body?.innerText?.slice(0, 4000) ?? ""'
      )) as string
      const url = (await wv.executeJavaScript('location.href')) as string
      return `${url}\n\n${text}`
    }
    if (tool === 'browser.eval') {
      const js = String(args.js ?? '')
      if (!js) {
        return 'erro: js obrigatório'
      }
      const result = await wv.executeJavaScript(js)
      return JSON.stringify(result ?? null)
    }
    if (tool === 'browser.click') {
      const selector = String(args.selector ?? '')
      const result = await wv.executeJavaScript(
        `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return 'not-found'; el.scrollIntoView({block:'center'}); el.click(); return 'clicked' })()`
      )
      return result === 'clicked' ? `clicado ${selector}` : `erro: ${selector} não encontrado`
    }
    if (tool === 'browser.fill') {
      const selector = String(args.selector ?? '')
      const value = String(args.value ?? '')
      const result = await wv.executeJavaScript(
        `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return 'not-found'; el.focus(); el.value = ${JSON.stringify(value)}; el.dispatchEvent(new Event('input', {bubbles:true})); el.dispatchEvent(new Event('change', {bubbles:true})); return 'filled' })()`
      )
      return result === 'filled' ? `preenchido ${selector}` : `erro: ${selector} não encontrado`
    }
    return `erro: tool desconhecida ${tool}`
  } catch (error) {
    return `erro no navegador: ${error instanceof Error ? error.message.slice(0, 200) : String(error)}`
  }
}

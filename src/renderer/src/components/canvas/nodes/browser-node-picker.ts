const PICKER_JS = String.raw`
(() => {
  if (window.__crewPicker) return 'already'
  window.__crewPicker = true
  let current = null
  const box = document.createElement('div')
  box.style.cssText = 'position:fixed;z-index:2147483647;pointer-events:none;border:2px solid #4d8dff;background:rgba(77,141,255,0.12);border-radius:4px;display:none'
  document.documentElement.appendChild(box)
  const onMove = (e) => {
    const el = document.elementFromPoint(e.clientX, e.clientY)
    if (!el || el === box) return
    current = el
    const r = el.getBoundingClientRect()
    box.style.display = 'block'
    box.style.left = r.left + 'px'; box.style.top = r.top + 'px'
    box.style.width = r.width + 'px'; box.style.height = r.height + 'px'
  }
  const selectorOf = (el) => {
    if (el.id) return '#' + el.id
    const parts = []
    let node = el
    while (node && node !== document.body && parts.length < 5) {
      let part = node.tagName.toLowerCase()
      if (node.className && typeof node.className === 'string') {
        const cls = node.className.trim().split(/\s+/).slice(0, 2).join('.')
        if (cls) part += '.' + cls
      }
      parts.unshift(part)
      node = node.parentElement
    }
    return parts.join(' > ')
  }
  const onClick = (e) => {
    e.preventDefault(); e.stopPropagation()
    const el = current
    if (el) {
      const text = (el.innerText || el.value || el.alt || '').trim().slice(0, 280)
      window.__crewPicked = JSON.stringify({ selector: selectorOf(el), tag: el.tagName.toLowerCase(), text, url: location.href })
    } else {
      window.__crewPicked = 'cancelled'
    }
    cleanup()
  }
  const cleanup = () => {
    window.__crewPicker = false
    document.removeEventListener('mousemove', onMove, true)
    document.removeEventListener('click', onClick, true)
    box.remove()
  }
  document.addEventListener('mousemove', onMove, true)
  document.addEventListener('click', onClick, true)
  return 'armed'
})()
`

export async function runBrowserElementPicker(
  webview: Electron.WebviewTag,
  onPicked: (pickedJson: string) => void
): Promise<void> {
  await webview.executeJavaScript('window.__crewPicked = null')
  await webview.executeJavaScript(PICKER_JS)
  const picked = await waitForPick(webview)
  if (picked && picked !== 'cancelled') {
    onPicked(picked)
  }
}

function waitForPick(webview: Electron.WebviewTag): Promise<string | null> {
  return new Promise((resolve) => {
    const started = Date.now()
    const poll = async () => {
      if (Date.now() - started > 60_000) {
        resolve(null)
        return
      }
      const state = (await webview.executeJavaScript('window.__crewPicker')) as boolean
      if (state === false) {
        const picked = (await webview.executeJavaScript('window.__crewPicked ?? null')) as
          | string
          | null
        resolve(picked)
        return
      }
      setTimeout(poll, 350)
    }
    void poll()
  })
}

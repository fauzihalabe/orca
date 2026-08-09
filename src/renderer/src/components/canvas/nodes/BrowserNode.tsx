import { memo, useEffect, useRef, useState } from 'react'
import { Handle, NodeResizer, Position, type NodeProps } from '@xyflow/react'
import { Globe, Monitor, RefreshCw, Smartphone, Crosshair } from 'lucide-react'
import { ORCA_BROWSER_GUEST_WEB_PREFERENCES_ATTRIBUTE } from '../../../../../shared/browser-guest-web-preferences'
import { ORCA_BROWSER_PARTITION } from '../../../../../shared/constants'
import type { CrewCanvasNodeData } from '../canvas-store'
import { getCrewCanvas, useCrewCanvasTab } from '../canvas-store'
import { useCanvasTab } from '../canvas-tab-context'
import { agentPtyOf } from '../agent-registry'
import { translate } from '@/i18n/i18n'

const MOBILE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1'

function ensureScheme(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed) {
    return ''
  }
  return /^[a-z]+:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
}

// Element-picker injected into the guest: hover outlines, click captures
// selector + text, then the note goes to the connected agent's terminal.
const PICKER_JS = `
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
        const cls = node.className.trim().split(/\\s+/).slice(0, 2).join('.')
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

// Browser node — a real Chromium guest (Orca's webview engine). Mobile toggle
// switches UA + narrows the viewport; the crosshair arms element-picking and
// sends the note to the connected agent node's terminal.
export const BrowserNode = memo(function BrowserNode({ id, data, selected }: NodeProps) {
  const d = data as CrewCanvasNodeData & {
    url?: string
    mobile?: boolean
    desktopSize?: { width: number; height: number }
  }
  const tabId = useCanvasTab().tabId
  const updateNodeData = useCrewCanvasTab(tabId, (s) => s.updateNodeData)
  const [urlInput, setUrlInput] = useState(d.url ?? '')
  const [picking, setPicking] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const webviewRef = useRef<Electron.WebviewTag | null>(null)
  const readyRef = useRef(false)

  useEffect(() => {
    const container = containerRef.current
    if (!container) {
      return
    }
    let webview: Electron.WebviewTag | null = null
    let disposed = false

    // A webview created under display:none never boots its guest process
    // (Electron quirk) — wait until the node is actually visible to attach.
    const mount = () => {
      if (disposed || webview) {
        return
      }
      const wv = document.createElement('webview') as Electron.WebviewTag
      wv.setAttribute('partition', ORCA_BROWSER_PARTITION)
      wv.setAttribute('webpreferences', ORCA_BROWSER_GUEST_WEB_PREFERENCES_ATTRIBUTE)
      wv.style.display = 'flex'
      wv.style.width = '100%'
      wv.style.height = '100%'
      wv.style.border = 'none'
      wv.style.background = '#fff'
      wv.addEventListener('dom-ready', () => {
        readyRef.current = true
        if (getCrewCanvas(tabId).nodes.find((n) => n.id === id)?.data.mobile) {
          wv.setUserAgent(MOBILE_UA)
        }
      })
      // src BEFORE attach: Orca's will-attach-webview guard reads params.src
      // at attach time and fail-closes on an empty one.
      if (d.url) {
        wv.setAttribute('src', d.url)
      }
      container.appendChild(wv)
      webview = wv
      webviewRef.current = wv
    }

    if (container.clientHeight > 0) {
      mount()
    } else {
      const gate = new ResizeObserver(() => {
        if (container.clientHeight > 0) {
          gate.disconnect()
          mount()
        }
      })
      gate.observe(container)
      return () => {
        disposed = true
        gate.disconnect()
      }
    }

    return () => {
      disposed = true
      webviewRef.current = null
      webview?.remove()
    }
    // mount once per node — url/mobile changes go through live calls below
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  useEffect(() => {
    const webview = webviewRef.current
    if (webview && readyRef.current) {
      webview.setUserAgent(d.mobile ? MOBILE_UA : '')
      webview.reload()
    }
  }, [d.mobile])

  const navigate = (raw: string) => {
    const next = ensureScheme(raw)
    setUrlInput(next)
    updateNodeData(id, { url: next })
    if (next && webviewRef.current) {
      webviewRef.current.setAttribute('src', next)
    }
  }

  const runPicker = async () => {
    const webview = webviewRef.current
    if (!webview) {
      return
    }
    setPicking(true)
    try {
      await webview.executeJavaScript('window.__crewPicked = null')
      await webview.executeJavaScript(PICKER_JS)
      const picked = await waitForPick(webview)
      if (picked && picked !== 'cancelled') {
        sendNoteToAgent(picked)
      }
    } finally {
      setPicking(false)
    }
  }

  const waitForPick = (webview: Electron.WebviewTag): Promise<string | null> =>
    new Promise((resolve) => {
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

  const sendNoteToAgent = (pickedJson: string) => {
    const graph = getCrewCanvas(tabId)
    const peer = graph.edges
      .filter((e) => e.source === id || e.target === id)
      .map((e) => graph.nodes.find((n) => n.id === (e.source === id ? e.target : e.source)))
      .find((n) => n && n.data.kind === 'agent')
    if (!peer) {
      return
    }
    const ptyId = agentPtyOf(peer.id)
    if (!ptyId) {
      return
    }
    let pretty = pickedJson
    try {
      const parsed = JSON.parse(pickedJson) as { selector: string; text: string; url: string }
      pretty = `[anotação do navegador] ${parsed.url}\nelemento: ${parsed.selector}\nconteúdo: ${parsed.text}`
    } catch {
      // keep raw
    }
    window.api.pty.write(ptyId, `${pretty}\r`)
  }

  return (
    <div
      className={`crew-node crew-browser-node${selected ? ' selected' : ''}`}
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        background: '#101013',
        border: `1px solid ${selected ? 'rgba(122,162,255,0.7)' : 'rgba(255,255,255,0.09)'}`,
        borderRadius: 12,
        overflow: 'hidden',
        boxShadow: selected
          ? '0 0 0 3px rgba(122,162,255,0.15), 0 12px 32px rgba(0,0,0,0.5)'
          : '0 8px 24px rgba(0,0,0,0.4)'
      }}
    >
      <NodeResizer
        isVisible={selected === true}
        minWidth={200}
        minHeight={140}
        lineStyle={{ borderColor: 'rgba(122,162,255,0.4)' }}
        handleStyle={{ width: 8, height: 8, borderRadius: 2, background: 'rgba(122,162,255,0.75)' }}
      />
      <div
        className="crew-node-header drag-handle"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '6px 9px',
          borderBottom: '1px solid rgba(255,255,255,0.07)',
          background: 'rgba(255,255,255,0.03)',
          cursor: 'grab',
          userSelect: 'none'
        }}
      >
        <Globe size={12} style={{ color: '#5ed69b', flexShrink: 0 }} />
        <form
          className="nodrag"
          style={{ flex: 1, display: 'flex', minWidth: 0 }}
          onSubmit={(event) => {
            event.preventDefault()
            navigate(urlInput)
          }}
        >
          <input
            value={urlInput}
            onChange={(event) => setUrlInput(event.target.value)}
            onPointerDown={(event) => event.stopPropagation()}
            placeholder={translate(
              'auto.components.canvas.BrowserNode.urlPlaceholder',
              'https://…'
            )}
            spellCheck={false}
            style={{
              flex: 1,
              minWidth: 0,
              background: 'rgba(255,255,255,0.06)',
              border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: 7,
              padding: '3px 8px',
              fontSize: 11,
              color: 'rgba(255,255,255,0.85)',
              outline: 'none'
            }}
          />
        </form>
        <button
          type="button"
          className="nodrag"
          onClick={() => d.url && navigate(d.url)}
          title={translate('auto.components.canvas.BrowserNode.reload', 'Reload')}
          style={iconButtonStyle}
        >
          <RefreshCw size={11} />
        </button>
        <button
          type="button"
          className="nodrag"
          onClick={() => {
            const next = !d.mobile
            const store = getCrewCanvas(tabId)
            if (next) {
              const current = store.nodes.find((n) => n.id === id)
              updateNodeData(id, {
                mobile: true,
                desktopSize: { width: current?.width ?? 560, height: current?.height ?? 460 }
              })
              store.resizeNode(id, { width: 420, height: 820 })
            } else {
              const back = (d.desktopSize as { width: number; height: number } | undefined) ?? {
                width: 560,
                height: 460
              }
              updateNodeData(id, { mobile: false })
              store.resizeNode(id, back)
            }
          }}
          title={
            d.mobile
              ? translate(
                  'auto.components.canvas.BrowserNode.toDesktop',
                  'Mobile (iPhone UA) — switch to desktop'
                )
              : translate(
                  'auto.components.canvas.BrowserNode.toMobile',
                  'Desktop — switch to mobile'
                )
          }
          style={{ ...iconButtonStyle, color: d.mobile ? '#7aa2ff' : 'rgba(255,255,255,0.4)' }}
        >
          {d.mobile ? <Smartphone size={11} /> : <Monitor size={11} />}
        </button>
        <button
          type="button"
          className="nodrag"
          onClick={() => void runPicker()}
          title={translate(
            'auto.components.canvas.BrowserNode.annotate',
            'Annotate an element and send it to the connected agent'
          )}
          style={{ ...iconButtonStyle, color: picking ? '#ffd47a' : 'rgba(255,255,255,0.4)' }}
        >
          <Crosshair size={11} />
        </button>
      </div>
      <div
        ref={containerRef}
        className="nodrag nowheel"
        style={{ flex: 1, minHeight: 0, background: '#fff' }}
      />
      <Handle type="target" position={Position.Left} style={{ width: 8, height: 8 }} />
      <Handle type="source" position={Position.Right} style={{ width: 8, height: 8 }} />
    </div>
  )
})

const iconButtonStyle: React.CSSProperties = {
  background: 'rgba(255,255,255,0.06)',
  border: '1px solid rgba(255,255,255,0.1)',
  borderRadius: 6,
  padding: 4,
  cursor: 'pointer',
  color: 'rgba(255,255,255,0.55)',
  display: 'inline-flex',
  flexShrink: 0
}

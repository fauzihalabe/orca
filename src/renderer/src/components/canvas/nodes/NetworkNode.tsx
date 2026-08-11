import { memo, useEffect, useState } from 'react'
import { Handle, NodeResizer, Position, type NodeProps } from '@xyflow/react'
import { Activity } from 'lucide-react'
import type { CrewCanvasNodeData } from '../canvas-store'
import { getCrewCanvas } from '../canvas-store'
import { useCanvasTab } from '../canvas-tab-context'
import { translate } from '@/i18n/i18n'
import { callRuntimeRpc } from '@/runtime/runtime-rpc-client'
import { canvasBrowserPageId } from './canvas-browser-session'

type NetEntry = {
  method: string
  url: string
  status: number
  mimeType: string
  size: number
  timestamp: number
}

// Network/DevTools node — watches the live traffic of the connected browser
// node (edge browser→network). It polls Orca's native browser.network RPC;
// there is no injected collector in the page.
export const NetworkNode = memo(function NetworkNode({ id, data, selected }: NodeProps) {
  const d = data as CrewCanvasNodeData
  void d
  const [entries, setEntries] = useState<NetEntry[]>([])
  const [linked, setLinked] = useState(false)
  const { tabId, worktreeId } = useCanvasTab()

  useEffect(() => {
    let alive = true
    let inFlight = false
    const poll = async () => {
      const graph = getCrewCanvas(tabId)
      const browserNode = graph.edges
        .filter((e) => e.source === id || e.target === id)
        .map((e) => graph.nodes.find((n) => n.id === (e.source === id ? e.target : e.source)))
        .find((n) => n && n.data.kind === 'browser')
      if (!browserNode) {
        if (alive) {
          setLinked(false)
          setEntries([])
        }
        return
      }
      if (alive) {
        setLinked(true)
      }
      if (inFlight) {
        return
      }
      inFlight = true
      try {
        const page =
          typeof browserNode.data.browserPageId === 'string' &&
          browserNode.data.browserPageId.trim().length > 0
            ? browserNode.data.browserPageId
            : canvasBrowserPageId(browserNode.id)
        const target = {
          page,
          ...(worktreeId ? { worktree: worktreeId } : {})
        }
        // Native capture acquisition is idempotent. Reasserting it each poll
        // survives BrowserPane/session replacement without clearing its log.
        await callRuntimeRpc({ kind: 'local' }, 'browser.capture.start', target)
        const result = await callRuntimeRpc<{ entries?: NetEntry[] }>(
          { kind: 'local' },
          'browser.network',
          { ...target, limit: 100 }
        )
        if (alive && Array.isArray(result?.entries)) {
          setEntries([...result.entries].toReversed().slice(0, 40))
        }
      } catch {
        // Native browser runtime may still be registering the Canvas page.
        // The next poll retries without changing the node state.
      } finally {
        inFlight = false
      }
    }
    const timer = setInterval(() => void poll(), 2000)
    void poll()
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [id, tabId, worktreeId])

  return (
    <div
      className={`crew-node crew-network-node${selected ? ' selected' : ''}`}
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--crew-canvas-network-surface)',
        border: `1px solid ${selected ? 'var(--crew-canvas-success)' : 'var(--crew-canvas-node-border)'}`,
        borderRadius: 12,
        overflow: 'hidden',
        boxShadow: selected
          ? 'var(--crew-canvas-node-selected-shadow)'
          : 'var(--crew-canvas-node-shadow)'
      }}
    >
      <NodeResizer
        isVisible={selected === true}
        minWidth={200}
        minHeight={140}
        lineStyle={{ borderColor: 'var(--crew-canvas-primary-soft)' }}
        handleStyle={{
          width: 8,
          height: 8,
          borderRadius: 2,
          background: 'var(--crew-canvas-handle)'
        }}
      />
      <div
        className="crew-node-header drag-handle"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 7,
          padding: '7px 10px',
          borderBottom: '1px solid var(--crew-canvas-node-header-border)',
          background: 'var(--crew-canvas-node-header)',
          cursor: 'grab',
          userSelect: 'none'
        }}
      >
        <Activity size={13} style={{ color: 'var(--crew-canvas-success)', flexShrink: 0 }} />
        <span
          style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--crew-canvas-node-foreground)' }}
        >
          {translate('auto.components.canvas.NetworkNode.title', 'network')}
        </span>
        <span style={{ marginLeft: 'auto', fontSize: 9.5, color: 'var(--crew-canvas-node-muted)' }}>
          {linked
            ? `${entries.length}`
            : translate('auto.components.canvas.NetworkNode.unlinked', 'link a browser')}
        </span>
      </div>
      <div
        className="nodrag nowheel scrollbar-sleek"
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          padding: '4px 0',
          fontFamily: 'ui-monospace, monospace'
        }}
      >
        {entries.length === 0 ? (
          <div
            style={{
              padding: 12,
              fontSize: 10.5,
              color: 'var(--crew-canvas-node-muted)',
              fontFamily: 'inherit'
            }}
          >
            {translate('auto.components.canvas.NetworkNode.empty', 'no traffic yet')}
          </div>
        ) : (
          entries.map((entry, i) => (
            <div
              key={i}
              style={{
                display: 'flex',
                gap: 7,
                alignItems: 'baseline',
                padding: '2.5px 9px',
                fontSize: 10,
                borderBottom: '1px solid var(--crew-canvas-node-header-border)'
              }}
            >
              <span
                style={{
                  color: 'var(--crew-canvas-primary)',
                  fontWeight: 700,
                  width: 38,
                  flexShrink: 0
                }}
              >
                {entry.method}
              </span>
              <span
                style={{
                  color:
                    entry.status >= 400 || entry.status === 0
                      ? 'var(--crew-canvas-error)'
                      : 'var(--crew-canvas-node-muted)',
                  width: 28,
                  flexShrink: 0
                }}
              >
                {entry.status || '—'}
              </span>
              <span
                style={{
                  flex: 1,
                  color: 'var(--crew-canvas-node-foreground)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap'
                }}
                title={entry.url}
              >
                {entry.url.replace(/^[a-z]+:\/\//i, '').slice(0, 60)}
              </span>
              <span style={{ color: 'var(--crew-canvas-node-muted)', flexShrink: 0 }}>
                {entry.size > 0 ? `${entry.size}b` : entry.mimeType || '—'}
              </span>
            </div>
          ))
        )}
      </div>
      <Handle
        type="target"
        position={Position.Left}
        style={{ width: 8, height: 8, background: 'var(--crew-canvas-handle)' }}
      />
      <Handle
        type="source"
        position={Position.Right}
        style={{ width: 8, height: 8, background: 'var(--crew-canvas-handle)' }}
      />
    </div>
  )
})

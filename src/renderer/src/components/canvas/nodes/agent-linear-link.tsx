import { useEffect, useRef, useState } from 'react'
import { Link2, X } from 'lucide-react'
import { translate } from '@/i18n/i18n'

// Linear issue link for an agent node — searches and attaches through Orca's
// native Linear integration (window.api.linear). The linked issue feeds the
// agent's spawn preamble (title, description, state) and shows as a badge.
export function AgentLinearLink({
  issueLabel,
  onLink,
  onClear
}: {
  issueLabel: string | undefined
  onLink: (issueId: string, label: string) => void
  onClear: () => void
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<{ id: string; identifier: string; title: string }[]>([])
  const [searching, setSearching] = useState(false)
  const rootRef = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    if (!open) {
      return
    }
    const onDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    window.addEventListener('pointerdown', onDown, true)
    return () => window.removeEventListener('pointerdown', onDown, true)
  }, [open])

  useEffect(() => {
    if (!open) {
      return
    }
    const q = query.trim()
    const timer = setTimeout(async () => {
      setSearching(true)
      try {
        const found = q
          ? await window.api.linear.searchIssues({ query: q, limit: 8 })
          : ((await window.api.linear.listIssues({ filter: 'assigned', limit: 8 })).items ?? [])
        setResults(
          found.map((issue) => ({
            id: issue.id,
            identifier: issue.identifier,
            title: issue.title
          }))
        )
      } catch {
        setResults([])
      } finally {
        setSearching(false)
      }
    }, 300)
    return () => clearTimeout(timer)
  }, [query, open])

  return (
    <span
      ref={rootRef}
      className="nodrag"
      style={{ position: 'relative', display: 'inline-flex', flexShrink: 0 }}
    >
      {issueLabel ? (
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            fontSize: 10,
            fontWeight: 700,
            color: '#b0a4ff',
            background: 'rgba(176,164,255,0.12)',
            border: '1px solid rgba(176,164,255,0.3)',
            borderRadius: 6,
            padding: '2px 6px'
          }}
        >
          {issueLabel}
          <button
            type="button"
            onClick={onClear}
            onPointerDown={(event) => event.stopPropagation()}
            title={translate('auto.components.canvas.AgentLinearLink.unlink', 'Unlink issue')}
            style={{
              background: 'none',
              border: 'none',
              color: 'inherit',
              cursor: 'pointer',
              padding: 0,
              display: 'inline-flex'
            }}
          >
            <X size={10} />
          </button>
        </span>
      ) : (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          onPointerDown={(event) => event.stopPropagation()}
          title={translate('auto.components.canvas.AgentLinearLink.link', 'Link Linear issue')}
          style={{
            background: 'transparent',
            border: 'none',
            borderRadius: 5,
            padding: 3,
            cursor: 'pointer',
            color: 'rgba(255,255,255,0.35)',
            display: 'inline-flex'
          }}
        >
          <Link2 size={12} />
        </button>
      )}
      {open ? (
        <span
          style={{
            position: 'absolute',
            top: 22,
            right: 0,
            zIndex: 30,
            background: 'var(--popover, #17171b)',
            border: '1px solid var(--border, rgba(255,255,255,0.12))',
            borderRadius: 9,
            padding: 8,
            width: 260,
            boxShadow: '0 12px 32px rgba(0,0,0,0.55)',
            display: 'flex',
            flexDirection: 'column',
            gap: 6
          }}
        >
          <input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={translate(
              'auto.components.canvas.AgentLinearLink.search',
              'Search Linear issues…'
            )}
            style={{
              background: 'rgba(255,255,255,0.06)',
              border: '1px solid rgba(255,255,255,0.12)',
              borderRadius: 6,
              padding: '5px 8px',
              fontSize: 11,
              color: 'rgba(255,255,255,0.85)',
              outline: 'none'
            }}
          />
          <span
            className="scrollbar-sleek"
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 2,
              maxHeight: 220,
              overflowY: 'auto'
            }}
          >
            {searching ? (
              <span style={{ fontSize: 10.5, color: 'rgba(255,255,255,0.4)', padding: 6 }}>
                {translate('auto.components.canvas.AgentLinearLink.searching', 'searching…')}
              </span>
            ) : results.length === 0 ? (
              <span style={{ fontSize: 10.5, color: 'rgba(255,255,255,0.4)', padding: 6 }}>
                {translate('auto.components.canvas.AgentLinearLink.empty', 'no issues')}
              </span>
            ) : (
              results.map((issue) => (
                <button
                  key={issue.id}
                  type="button"
                  onClick={() => {
                    onLink(issue.id, issue.identifier)
                    setOpen(false)
                  }}
                  style={{
                    display: 'flex',
                    gap: 7,
                    alignItems: 'baseline',
                    background: 'transparent',
                    border: 'none',
                    borderRadius: 6,
                    padding: '5px 7px',
                    cursor: 'pointer',
                    textAlign: 'left'
                  }}
                  onMouseEnter={(event) => {
                    event.currentTarget.style.background = 'rgba(176,164,255,0.1)'
                  }}
                  onMouseLeave={(event) => {
                    event.currentTarget.style.background = 'transparent'
                  }}
                >
                  <span style={{ fontSize: 10, fontWeight: 700, color: '#b0a4ff', flexShrink: 0 }}>
                    {issue.identifier}
                  </span>
                  <span
                    style={{
                      fontSize: 11,
                      color: 'rgba(255,255,255,0.8)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap'
                    }}
                  >
                    {issue.title}
                  </span>
                </button>
              ))
            )}
          </span>
        </span>
      ) : null}
    </span>
  )
}

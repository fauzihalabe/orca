import { useState } from 'react'
import { Settings2 } from 'lucide-react'
import { translate } from '@/i18n/i18n'

// Launch-args editor — the raw flags the agent CLI boots with
// (e.g. --dangerously-skip-permissions). Persisted in node data, so respawn
// and workspace reopen always boot the agent with the same command.
export function AgentArgsEditor({
  args,
  onSave
}: {
  args: string
  onSave: (args: string) => void
}) {
  const [open, setOpen] = useState(false)

  return (
    <span style={{ position: 'relative', display: 'inline-flex', flexShrink: 0 }}>
      <button
        type="button"
        className="nodrag"
        onClick={() => setOpen((v) => !v)}
        onPointerDown={(event) => event.stopPropagation()}
        title={
          args
            ? translate(
                'auto.components.canvas.AgentArgsEditor.buttonTitleSet',
                'Args: {{value0}}',
                { value0: args }
              )
            : translate('auto.components.canvas.AgentArgsEditor.buttonTitle', 'Agent launch args')
        }
        style={{
          background: args ? 'rgba(122,162,255,0.14)' : 'transparent',
          border: 'none',
          borderRadius: 5,
          padding: 3,
          cursor: 'pointer',
          color: args ? '#7aa2ff' : 'rgba(255,255,255,0.35)',
          display: 'inline-flex'
        }}
      >
        <Settings2 size={12} />
      </button>
      {open ? (
        <span
          className="nodrag"
          onPointerDown={(event) => event.stopPropagation()}
          style={{
            position: 'absolute',
            top: 22,
            right: 0,
            zIndex: 30,
            background: '#17171b',
            border: '1px solid rgba(255,255,255,0.12)',
            borderRadius: 9,
            padding: 9,
            width: 240,
            boxShadow: '0 12px 32px rgba(0,0,0,0.55)'
          }}
        >
          <span
            style={{
              display: 'block',
              fontSize: 9.5,
              fontWeight: 700,
              letterSpacing: '0.05em',
              textTransform: 'uppercase',
              color: 'rgba(255,255,255,0.4)',
              marginBottom: 5
            }}
          >
            {translate('auto.components.canvas.AgentArgsEditor.heading', 'Launch args')}
          </span>
          <input
            autoFocus
            defaultValue={args}
            placeholder={translate(
              'auto.components.canvas.AgentArgsEditor.placeholder',
              '--dangerously-skip-permissions'
            )}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                onSave(event.currentTarget.value.trim())
                setOpen(false)
              }
              if (event.key === 'Escape') {
                setOpen(false)
              }
            }}
            onBlur={(event) => {
              onSave(event.currentTarget.value.trim())
              setOpen(false)
            }}
            style={{
              width: '100%',
              background: 'rgba(255,255,255,0.06)',
              border: '1px solid rgba(255,255,255,0.12)',
              borderRadius: 6,
              padding: '5px 7px',
              fontSize: 11,
              fontFamily: 'ui-monospace, monospace',
              color: 'rgba(255,255,255,0.85)',
              outline: 'none',
              boxSizing: 'border-box'
            }}
          />
          <span
            style={{
              display: 'block',
              marginTop: 5,
              fontSize: 9.5,
              color: 'rgba(255,255,255,0.35)',
              lineHeight: 1.4
            }}
          >
            {translate(
              'auto.components.canvas.AgentArgsEditor.note',
              'Applies on next spawn — the agent restarts with exactly this command.'
            )}
          </span>
        </span>
      ) : null}
    </span>
  )
}

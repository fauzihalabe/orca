import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { translate } from '@/i18n/i18n'

export type PaletteKind =
  | 'agent'
  | 'browser'
  | 'terminal'
  | 'note'
  | 'todo'
  | 'timer'
  | 'simulator'
  | 'network'

const paletteEntries = (): { kind: PaletteKind; label: string; hint: string }[] => [
  {
    kind: 'agent',
    label: translate('auto.components.canvas.CanvasPage.agent', 'Agent'),
    hint: translate('auto.components.canvas.CanvasPage.agentHint', 'real agent CLI terminal')
  },
  {
    kind: 'browser',
    label: translate('auto.components.canvas.CanvasPage.browser', 'Browser'),
    hint: translate(
      'auto.components.canvas.CanvasPage.browserHint',
      'embedded chromium (mobile/desktop)'
    )
  },
  {
    kind: 'terminal',
    label: translate('auto.components.canvas.CanvasPage.terminal', 'Terminal'),
    hint: translate('auto.components.canvas.CanvasPage.terminalHint', 'plain shell PTY')
  },
  {
    kind: 'note',
    label: translate('auto.components.canvas.CanvasPage.note', 'Note'),
    hint: translate('auto.components.canvas.CanvasPage.noteHint', 'sticky shared memory')
  },
  {
    kind: 'todo',
    label: translate('auto.components.canvas.CanvasPage.todo', 'Todo'),
    hint: translate('auto.components.canvas.CanvasPage.todoHint', 'living checklist')
  },
  {
    kind: 'timer',
    label: translate('auto.components.canvas.CanvasPage.timer', 'Timer'),
    hint: translate('auto.components.canvas.CanvasPage.timerHint', 'stopwatch')
  },
  {
    kind: 'simulator',
    label: translate('auto.components.canvas.CanvasPage.simulator', 'Simulator'),
    hint: translate('auto.components.canvas.CanvasPage.simulatorHint', 'iOS device (Orca engine)')
  },
  {
    kind: 'network',
    label: translate('auto.components.canvas.CanvasPage.network', 'Network'),
    hint: translate(
      'auto.components.canvas.CanvasPage.networkHint',
      'live traffic of a linked browser'
    )
  }
]

// Creation palette — opens where the user double-clicked (or dropped a rubber
// band). Closes on esc, outside click, or after a pick.
export function CreatePalette({
  x,
  y,
  onPick,
  onClose
}: {
  x: number
  y: number
  onPick: (kind: PaletteKind) => void
  onClose: () => void
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose()
      }
    }
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null
      if (!target?.closest('.crew-create-palette')) {
        onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('pointerdown', onPointerDown, true)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('pointerdown', onPointerDown, true)
    }
  }, [onClose])

  // Clamp into the viewport — the palette opens at the drag end point, which
  // on small screens can land past the bottom/right edge and become unusable.
  const rootRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ left: x, top: y })
  useLayoutEffect(() => {
    const el = rootRef.current
    if (!el) {
      return
    }
    const rect = el.getBoundingClientRect()
    const margin = 8
    const left = Math.max(margin, Math.min(x, window.innerWidth - rect.width - margin))
    const top = Math.max(margin, Math.min(y, window.innerHeight - rect.height - margin))
    setPos((current) => (current.left === left && current.top === top ? current : { left, top }))
  }, [x, y])

  return (
    <div
      ref={rootRef}
      className="crew-create-palette nodrag nowheel scrollbar-sleek"
      style={{
        position: 'fixed',
        left: pos.left,
        top: pos.top,
        maxHeight: 'calc(100vh - 16px)',
        overflowY: 'auto',
        zIndex: 40,
        background: 'var(--popover, #17171b)',
        border: '1px solid var(--border, rgba(255,255,255,0.12))',
        borderRadius: 10,
        padding: 5,
        boxShadow: '0 16px 44px rgba(0,0,0,0.6)',
        display: 'flex',
        flexDirection: 'column',
        gap: 2,
        minWidth: 170
      }}
      onPointerDown={(event) => event.stopPropagation()}
    >
      {paletteEntries().map(({ kind, label, hint }) => (
        <button
          key={kind}
          type="button"
          onClick={() => onPick(kind)}
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'flex-start',
            gap: 1,
            background: 'transparent',
            border: 'none',
            borderRadius: 7,
            padding: '7px 9px',
            cursor: 'pointer',
            textAlign: 'left'
          }}
          onMouseEnter={(event) => {
            event.currentTarget.style.background = 'rgba(122,162,255,0.12)'
          }}
          onMouseLeave={(event) => {
            event.currentTarget.style.background = 'transparent'
          }}
        >
          <span
            style={{
              fontSize: 12,
              fontWeight: 600,
              color: 'var(--popover-foreground, rgba(255,255,255,0.88))'
            }}
          >
            {label}
          </span>
          <span style={{ fontSize: 10, color: 'var(--muted-foreground, rgba(255,255,255,0.4))' }}>
            {hint}
          </span>
        </button>
      ))}
    </div>
  )
}

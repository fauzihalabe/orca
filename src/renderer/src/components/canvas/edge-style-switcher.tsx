import { useCrewCanvasTab, type CrewEdgeStyle } from './canvas-store'
import { useCanvasTab } from './canvas-tab-context'
import { translate } from '@/i18n/i18n'

const styleOptions = (): { id: CrewEdgeStyle; title: string; preview: string }[] => [
  {
    id: 'lineit',
    title: translate('auto.components.canvas.EdgeStyleSwitcher.styleLineit', 'Thick spaced dots'),
    preview: '• ╌ • ╌ •'
  },
  {
    id: 'fine',
    title: translate('auto.components.canvas.EdgeStyleSwitcher.styleFine', 'Fine dots'),
    preview: '·········'
  },
  {
    id: 'dash',
    title: translate('auto.components.canvas.EdgeStyleSwitcher.styleDash', 'Dashes'),
    preview: '— — —'
  }
]

// Edge style switcher — one control restyles every connection on the canvas
// (persisted). Sits bottom-left, quiet until hovered.
export function EdgeStyleSwitcher() {
  const tabId = useCanvasTab().tabId
  const edgeStyle = useCrewCanvasTab(tabId, (s) => s.edgeStyle)
  const setEdgeStyle = useCrewCanvasTab(tabId, (s) => s.setEdgeStyle)
  return (
    <div
      className="nodrag nowheel"
      style={{
        position: 'absolute',
        left: 12,
        bottom: 12,
        zIndex: 30,
        display: 'flex',
        gap: 3,
        background: 'var(--popover, #17171b)',
        border: '1px solid var(--border, rgba(255,255,255,0.1))',
        borderRadius: 9,
        padding: 4,
        boxShadow: '0 8px 24px rgba(0,0,0,0.45)'
      }}
    >
      {styleOptions().map((option) => (
        <button
          key={option.id}
          type="button"
          onClick={() => setEdgeStyle(option.id)}
          title={option.title}
          style={{
            fontSize: 11,
            letterSpacing: 1.5,
            padding: '3px 9px',
            borderRadius: 6,
            border: 'none',
            cursor: 'pointer',
            background: edgeStyle === option.id ? 'rgba(122,162,255,0.18)' : 'transparent',
            color: edgeStyle === option.id ? '#a8c2ff' : 'rgba(255,255,255,0.4)'
          }}
        >
          {option.preview}
        </button>
      ))}
    </div>
  )
}

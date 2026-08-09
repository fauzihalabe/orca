import { memo } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { useAppStore } from '@/store'
import { EmulatorDeviceFrame } from '../../emulator-pane/emulator-device-frame'
import { useEmulatorPaneSession } from '../../emulator-pane/use-emulator-pane-session'
import type { CrewCanvasNodeData } from '../canvas-store'
import { translate } from '@/i18n/i18n'

// iOS Simulator node — just the device floating on the canvas, no app chrome:
// no toolbar, no banner. Orca's emulator engine (stream, tap, gesture) drives
// it; the thin dark rim around the device doubles as the drag handle.
export const SimulatorNode = memo(function SimulatorNode({ data, selected }: NodeProps) {
  const d = data as CrewCanvasNodeData
  void d
  const worktreeId = useAppStore((s) => s.activeWorktreeId)

  return (
    <div
      className={`crew-node crew-simulator-node${selected ? ' selected' : ''}`}
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        background: 'transparent',
        border: 'none',
        overflow: 'visible'
      }}
    >
      {worktreeId ? (
        <SimulatorDevice worktreeId={worktreeId} selected={selected === true} />
      ) : (
        <div
          className="drag-handle"
          style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'rgba(255,255,255,0.35)',
            fontSize: 11,
            padding: 16,
            textAlign: 'center',
            background: '#101013',
            borderRadius: 12,
            border: '1px solid rgba(255,255,255,0.09)',
            cursor: 'grab'
          }}
        >
          {translate(
            'auto.components.canvas.SimulatorNode.noWorktree',
            'Add a project to attach the simulator'
          )}
        </div>
      )}
      <Handle type="target" position={Position.Left} style={{ width: 8, height: 8 }} />
      <Handle type="source" position={Position.Right} style={{ width: 8, height: 8 }} />
    </div>
  )
})

function SimulatorDevice({ worktreeId, selected }: { worktreeId: string; selected: boolean }) {
  const {
    selectedUdid,
    attach,
    loading,
    previewUrl,
    wsUrl,
    streamKey,
    displayName,
    isLive,
    visualOrientation,
    sendTap,
    sendGesture
  } = useEmulatorPaneSession({ worktreeId, autoAttachOnMount: true })

  void selectedUdid
  void attach
  void loading

  return (
    <div
      className="drag-handle"
      style={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 10,
        borderRadius: 24,
        background: 'rgba(16,16,19,0.55)',
        border: `1px solid ${selected ? 'rgba(255,150,170,0.55)' : 'rgba(255,255,255,0.07)'}`,
        boxShadow: selected
          ? '0 0 0 3px rgba(255,150,170,0.12), 0 18px 44px rgba(0,0,0,0.55)'
          : '0 14px 36px rgba(0,0,0,0.45)',
        cursor: 'grab',
        userSelect: 'none',
        backdropFilter: 'blur(8px)',
        boxSizing: 'border-box'
      }}
      title={displayName}
    >
      <div
        className="nodrag nowheel"
        style={{
          height: '100%',
          width: '100%',
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
          position: 'relative',
          overflow: 'hidden'
        }}
      >
        <EmulatorDeviceFrame
          previewUrl={previewUrl}
          wsUrl={wsUrl}
          streamKey={streamKey}
          deviceName={displayName}
          loading={loading}
          isLive={isLive}
          visualOrientation={visualOrientation}
          isActive
          onTap={(x, y) => void sendTap(x, y)}
          onGesture={(points) => void sendGesture(points)}
        />
      </div>
    </div>
  )
}

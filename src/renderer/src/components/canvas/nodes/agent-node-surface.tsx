import type { RefObject } from 'react'
import { Handle, NodeResizer, Position } from '@xyflow/react'
import { CircleAlert } from 'lucide-react'
import { AgentNodeHeader } from './agent-node-header'

type AgentNodeSurfaceProps = {
  id: string
  agentKind: string
  label?: string
  role: string
  args?: string
  managedAccountId?: string | null
  linearIssueLabel?: string
  selected: boolean
  spawnError: string | null
  containerRef: RefObject<HTMLDivElement | null>
  onAccountChanged: (managedAccountId?: string | null) => void
}

export function AgentNodeSurface({
  id,
  agentKind,
  label,
  role,
  args,
  managedAccountId,
  linearIssueLabel,
  selected,
  spawnError,
  containerRef,
  onAccountChanged
}: AgentNodeSurfaceProps): React.JSX.Element {
  return (
    <div
      className={`crew-node crew-agent-node${selected ? ' selected' : ''}`}
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--crew-canvas-node-surface)',
        border: `1px solid ${selected ? 'var(--crew-canvas-primary)' : 'var(--crew-canvas-node-border)'}`,
        borderRadius: 12,
        overflow: 'hidden',
        boxShadow: selected
          ? 'var(--crew-canvas-node-selected-shadow)'
          : 'var(--crew-canvas-node-shadow)'
      }}
    >
      <NodeResizer
        isVisible={selected}
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
      <AgentNodeHeader
        id={id}
        agentKind={agentKind}
        label={label}
        role={role}
        args={args}
        managedAccountId={managedAccountId}
        linearIssueLabel={linearIssueLabel}
        onAccountChanged={onAccountChanged}
      />
      {spawnError ? (
        <div
          style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 6,
            color: 'var(--crew-canvas-error)',
            fontSize: 11,
            padding: 12,
            textAlign: 'center'
          }}
        >
          <CircleAlert size={13} />
          {spawnError}
        </div>
      ) : (
        <div
          ref={containerRef}
          className="nodrag nowheel"
          style={{ flex: 1, minHeight: 0, background: 'var(--crew-canvas-terminal-background)' }}
        />
      )}
      <Handle
        type="target"
        position={Position.Left}
        style={{ width: 12, height: 12, background: 'var(--crew-canvas-handle)' }}
      />
      <Handle
        type="source"
        position={Position.Right}
        style={{ width: 12, height: 12, background: 'var(--crew-canvas-handle)' }}
      />
    </div>
  )
}

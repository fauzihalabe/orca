import { useState } from 'react'
import { Bot } from 'lucide-react'
import { useCrewCanvasTab } from '../canvas-store'
import { useCanvasTab } from '../canvas-tab-context'
import { AgentAccountSelect } from './agent-account-select'
import { AgentArgsEditor } from './agent-args-editor'
import { AgentLinearLink } from './agent-linear-link'
import { translate } from '@/i18n/i18n'

// Agent node header — name, role, account (Orca engine), Linear link, launch
// args and engine picker. Owns its inline-edit state; writes go straight to
// the canvas store.
export function AgentNodeHeader({
  id,
  agentKind,
  label,
  role,
  args,
  linearIssueLabel,
  onAccountChanged
}: {
  id: string
  agentKind: string
  label: string | undefined
  role: string
  args: string | undefined
  linearIssueLabel: string | undefined
  onAccountChanged: () => void
}) {
  const tabId = useCanvasTab().tabId
  const updateNodeData = useCrewCanvasTab(tabId, (s) => s.updateNodeData)
  const [editingLabel, setEditingLabel] = useState(false)
  const [editingRole, setEditingRole] = useState(false)

  const fieldStyle: React.CSSProperties = {
    background: 'transparent',
    border: 'none',
    outline: 'none',
    color: 'rgba(255,255,255,0.85)',
    fontSize: 11.5,
    fontWeight: 600,
    padding: 0,
    minWidth: 0
  }

  return (
    <div
      className="crew-node-header drag-handle"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 7,
        padding: '7px 10px',
        borderBottom: '1px solid rgba(255,255,255,0.07)',
        background: 'rgba(255,255,255,0.03)',
        cursor: 'grab',
        userSelect: 'none'
      }}
    >
      <Bot size={13} style={{ color: '#7aa2ff', flexShrink: 0 }} />
      {editingLabel ? (
        <input
          autoFocus
          className="nodrag"
          defaultValue={label ?? ''}
          placeholder={agentKind}
          onPointerDown={(event) => event.stopPropagation()}
          onBlur={(event) => {
            updateNodeData(id, { label: event.target.value.trim() || undefined })
            setEditingLabel(false)
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.currentTarget.blur()
            }
            if (event.key === 'Escape') {
              setEditingLabel(false)
            }
          }}
          style={{ ...fieldStyle, width: 90 }}
        />
      ) : (
        <span
          style={{ fontSize: 11.5, fontWeight: 600, color: 'rgba(255,255,255,0.85)' }}
          onDoubleClick={(event) => {
            event.stopPropagation()
            setEditingLabel(true)
          }}
          title={translate(
            'auto.components.canvas.AgentNode.renameTitle',
            'Double-click to rename'
          )}
        >
          {label || agentKind}
        </span>
      )}
      {editingRole ? (
        <input
          autoFocus
          className="nodrag"
          defaultValue={role}
          placeholder={translate(
            'auto.components.canvas.AgentNode.rolePlaceholder',
            'role (e.g. ACP reviewer)'
          )}
          onPointerDown={(event) => event.stopPropagation()}
          onBlur={(event) => {
            updateNodeData(id, { role: event.target.value.trim() || undefined })
            setEditingRole(false)
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.currentTarget.blur()
            }
            if (event.key === 'Escape') {
              setEditingRole(false)
            }
          }}
          style={{ ...fieldStyle, flex: 1, fontWeight: 400, fontStyle: 'italic' }}
        />
      ) : (
        <span
          onDoubleClick={(event) => {
            event.stopPropagation()
            setEditingRole(true)
          }}
          title={
            role
              ? translate(
                  'auto.components.canvas.AgentNode.roleTitleSet',
                  'Role: {{value0}} (double-click to edit)',
                  { value0: role }
                )
              : translate(
                  'auto.components.canvas.AgentNode.roleTitle',
                  'Double-click to set the role'
                )
          }
          style={{
            fontSize: 10.5,
            fontStyle: 'italic',
            color: role ? 'rgba(170,200,255,0.75)' : 'rgba(255,255,255,0.28)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            maxWidth: 160,
            cursor: 'text'
          }}
        >
          {role || translate('auto.components.canvas.AgentNode.noRole', 'no role')}
        </span>
      )}
      <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
        <AgentLinearLink
          issueLabel={linearIssueLabel}
          onLink={(issueId, linkLabel) =>
            updateNodeData(id, { linearIssueId: issueId, linearIssueLabel: linkLabel })
          }
          onClear={() =>
            updateNodeData(id, { linearIssueId: undefined, linearIssueLabel: undefined })
          }
        />
        <AgentAccountSelect agentKind={agentKind} onAccountChanged={onAccountChanged} />
        <AgentArgsEditor
          args={args ?? ''}
          onSave={(next) => updateNodeData(id, { args: next || undefined })}
        />
        <select
          className="nodrag"
          value={agentKind}
          onChange={(event) =>
            updateNodeData(id, {
              agentKind: event.target.value,
              cliSessionId: undefined,
              cliResumeCommand: undefined
            })
          }
          onPointerDown={(event) => event.stopPropagation()}
          style={{
            fontSize: 10,
            fontWeight: 600,
            color: 'rgba(255,255,255,0.55)',
            background: 'rgba(255,255,255,0.06)',
            border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: 6,
            padding: '2px 5px',
            outline: 'none',
            cursor: 'pointer',
            flexShrink: 0
          }}
        >
          {AGENT_KINDS.map((kind) => (
            <option key={kind} value={kind}>
              {kind}
            </option>
          ))}
        </select>
      </span>
    </div>
  )
}

const AGENT_KINDS = ['claude', 'codex', 'kimi'] as const

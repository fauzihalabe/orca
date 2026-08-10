import { useCallback, useEffect, useState } from 'react'
import { translate } from '@/i18n/i18n'

type AccountOption = { id: string; label: string }

const WORKSPACE_DEFAULT = '__orca_workspace_default__'
const SYSTEM_DEFAULT = '__orca_system_default__'

// Codex accounts are launch-scoped: the selected Orca-managed CODEX_HOME is
// persisted on this Canvas node and its native pane. Claude keeps using Orca's
// native workspace/runtime selector because its auth engine is shared today.
export function AgentAccountSelect({
  agentKind,
  managedAccountId,
  onAccountChanged
}: {
  agentKind: string
  managedAccountId?: string | null
  onAccountChanged: (managedAccountId?: string | null) => void
}) {
  const [options, setOptions] = useState<AccountOption[]>([])
  const [workspaceActiveId, setWorkspaceActiveId] = useState<string | null>(null)
  const [systemIdentity, setSystemIdentity] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const api =
    agentKind === 'claude'
      ? window.api.claudeAccounts
      : agentKind === 'codex'
        ? window.api.codexAccounts
        : null

  const refresh = useCallback(async () => {
    if (!api) {
      return
    }
    try {
      const state = await api.list()
      const opts: AccountOption[] = state.accounts
        .filter(
          (account) =>
            agentKind !== 'codex' ||
            !('managedHomeRuntime' in account) ||
            account.managedHomeRuntime !== 'wsl'
        )
        .map((account) => ({
          id: account.id,
          label:
            'email' in account && typeof account.email === 'string' && account.email
              ? account.email
              : account.id
        }))
      setOptions(opts)
      setWorkspaceActiveId(state.activeAccountId ?? null)
      if (agentKind === 'codex' && 'systemDefault' in state && state.systemDefault?.email) {
        setSystemIdentity(state.systemDefault.email)
      } else {
        setSystemIdentity(null)
      }
    } catch {
      setOptions([])
    }
  }, [agentKind, api])

  useEffect(() => {
    void refresh()
    const unsubscribe =
      agentKind === 'codex'
        ? window.api.codexAccounts.onChanged(() => {
            void refresh()
          })
        : undefined
    const refreshOnFocus = (): void => {
      void refresh()
    }
    window.addEventListener('focus', refreshOnFocus)
    return () => {
      unsubscribe?.()
      window.removeEventListener('focus', refreshOnFocus)
    }
  }, [agentKind, refresh])

  if (!api) {
    return null
  }

  const workspaceAccount = options.find((option) => option.id === workspaceActiveId)
  const systemDefaultLabel = translate(
    'auto.components.canvas.AgentAccountSelect.systemDefault',
    'system default'
  )
  const systemLabel = systemIdentity
    ? `${systemDefaultLabel} · ${systemIdentity}`
    : systemDefaultLabel
  const workspaceLabel = workspaceAccount
    ? `Orca · ${workspaceAccount.label}`
    : workspaceActiveId
      ? 'Orca workspace'
      : `Orca · ${systemLabel}`
  const codexValue =
    managedAccountId === undefined
      ? WORKSPACE_DEFAULT
      : managedAccountId === null
        ? SYSTEM_DEFAULT
        : managedAccountId
  const selectedManagedAccountMissing =
    agentKind === 'codex' &&
    typeof managedAccountId === 'string' &&
    !options.some((option) => option.id === managedAccountId)
  const workspaceUsesSystemDefault = agentKind === 'codex' && workspaceActiveId === null
  const combinedSystemFallbackValue = managedAccountId === null ? SYSTEM_DEFAULT : WORKSPACE_DEFAULT

  return (
    <select
      className="nodrag"
      value={agentKind === 'codex' ? codexValue : (workspaceActiveId ?? '')}
      disabled={busy}
      onChange={async (event) => {
        const value = event.target.value
        setBusy(true)
        try {
          if (agentKind === 'codex') {
            onAccountChanged(
              value === WORKSPACE_DEFAULT ? undefined : value === SYSTEM_DEFAULT ? null : value
            )
            return
          }
          await api.select({ accountId: value || null })
          await refresh()
          onAccountChanged(undefined)
        } finally {
          setBusy(false)
        }
      }}
      onPointerDown={(event) => {
        event.stopPropagation()
        void refresh()
      }}
      title={translate(
        'auto.components.canvas.AgentAccountSelect.title',
        'Provider account (Orca native engine — manage in Settings → AI Provider Accounts)'
      )}
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
        maxWidth: 145,
        flexShrink: 0,
        opacity: busy ? 0.5 : 1
      }}
    >
      {agentKind === 'codex' && workspaceUsesSystemDefault ? (
        <option value={combinedSystemFallbackValue}>{workspaceLabel}</option>
      ) : agentKind === 'codex' ? (
        <>
          <option value={WORKSPACE_DEFAULT}>{workspaceLabel}</option>
          <option value={SYSTEM_DEFAULT}>{systemLabel}</option>
        </>
      ) : (
        <option value="">{systemLabel}</option>
      )}
      {selectedManagedAccountMissing ? (
        <option value={managedAccountId}>
          {translate('auto.components.canvas.AgentAccountSelect.missing', 'missing')} ·{' '}
          {managedAccountId}
        </option>
      ) : null}
      {options.map((option) => (
        <option key={option.id} value={option.id}>
          {option.label}
        </option>
      ))}
    </select>
  )
}

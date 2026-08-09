import { useCallback, useEffect, useState } from 'react'
import { translate } from '@/i18n/i18n'

type AccountOption = { id: string; label: string }

// Account switcher riding Orca's NATIVE account engine (claudeAccounts /
// codexAccounts services — the same one Settings → AI Provider Accounts uses).
// Selecting an account switches the provider's active account through Orca and
// the node respawns into it. New accounts are added in Settings (Orca owns the
// login flow there).
export function AgentAccountSelect({
  agentKind,
  onAccountChanged
}: {
  agentKind: string
  onAccountChanged: () => void
}) {
  const [options, setOptions] = useState<AccountOption[]>([])
  const [activeId, setActiveId] = useState<string>('')
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
      const opts: AccountOption[] = state.accounts.map((a) => ({
        id: a.id,
        label: 'email' in a && typeof a.email === 'string' && a.email ? a.email : a.id
      }))
      setOptions(opts)
      setActiveId(state.activeAccountId ?? '')
    } catch {
      setOptions([])
    }
  }, [api])

  useEffect(() => {
    void refresh()
  }, [refresh])

  if (!api) {
    return null
  }

  return (
    <select
      className="nodrag"
      value={activeId}
      disabled={busy}
      onChange={async (event) => {
        const accountId = event.target.value || null
        setBusy(true)
        try {
          await api.select({ accountId })
          await refresh()
          onAccountChanged()
        } finally {
          setBusy(false)
        }
      }}
      onPointerDown={(event) => event.stopPropagation()}
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
        maxWidth: 110,
        flexShrink: 0,
        opacity: busy ? 0.5 : 1
      }}
    >
      <option value="">
        {translate('auto.components.canvas.AgentAccountSelect.systemDefault', 'system default')}
      </option>
      {options.map((option) => (
        <option key={option.id} value={option.id}>
          {option.label}
        </option>
      ))}
    </select>
  )
}

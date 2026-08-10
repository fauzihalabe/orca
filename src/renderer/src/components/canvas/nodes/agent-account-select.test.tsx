// @vitest-environment happy-dom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AgentAccountSelect } from './agent-account-select'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root
let list: ReturnType<typeof vi.fn>
let accountChangedListener: (() => void) | null

function accountState(accounts: { id: string; email: string }[], activeAccountId: string | null) {
  return {
    accounts,
    activeAccountId,
    systemDefault: { email: 'system@example.com' }
  }
}

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  accountChangedListener = null
  list = vi.fn(() => Promise.resolve(accountState([], null)))
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: {
      codexAccounts: {
        list,
        onChanged: (listener: () => void) => {
          accountChangedListener = listener
          return () => {
            accountChangedListener = null
          }
        }
      }
    }
  })
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe('AgentAccountSelect', () => {
  it('shows a single fallback when Orca already uses system default', async () => {
    await act(async () => {
      root.render(
        <AgentAccountSelect
          agentKind="codex"
          managedAccountId={undefined}
          onAccountChanged={vi.fn()}
        />
      )
    })

    const labels = Array.from(container.querySelectorAll('option')).map(
      (option) => option.textContent
    )
    expect(labels).toEqual(['Orca · system default · system@example.com'])
  })

  it('refreshes the choices when native Orca adds an account', async () => {
    await act(async () => {
      root.render(
        <AgentAccountSelect
          agentKind="codex"
          managedAccountId={undefined}
          onAccountChanged={vi.fn()}
        />
      )
    })
    list.mockResolvedValueOnce(
      accountState([{ id: 'account-2', email: 'second@example.com' }], 'account-2')
    )

    await act(async () => {
      accountChangedListener?.()
      await Promise.resolve()
    })

    expect(container.textContent).toContain('second@example.com')
    expect(list).toHaveBeenCalledTimes(2)
  })
})

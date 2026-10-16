import { beforeEach, describe, expect, it, vi } from 'vitest'

const storeHarness = vi.hoisted(() => ({
  state: {
    agentStatusByPaneKey: {} as Record<string, unknown>,
    sleepingAgentSessionsByPaneKey: {} as Record<string, unknown>,
    getAgentLaunchConfigForStatusEntry: vi.fn()
  },
  listener: (): void => {},
  unsubscribe: vi.fn(),
  subscribe: vi.fn((listener: () => void) => {
    storeHarness.listener = listener
    return storeHarness.unsubscribe
  })
}))

vi.mock('@/store', () => ({
  useAppStore: {
    getState: () => storeHarness.state,
    subscribe: storeHarness.subscribe
  }
}))

import {
  canvasAgentNativeResumeForPane,
  canvasAgentNativeResumeFromData,
  startCanvasAgentNativeSessionCapture
} from './canvas-agent-native-session'

describe('canvasAgentNativeResumeFromData', () => {
  it('restores the provider session and account-pinned launch configuration', () => {
    expect(
      canvasAgentNativeResumeFromData('codex', {
        providerSession: { key: 'session_id', id: 'session-codex' },
        agentLaunchConfig: {
          agentCommand: 'codex --profile canvas',
          agentArgs: '--profile canvas',
          agentEnv: { ORCA_CREW_BRIDGE_TOKEN: 'token', INVALID: 7 },
          managedAccountId: 'account-canvas'
        }
      })
    ).toEqual({
      providerSession: { key: 'session_id', id: 'session-codex' },
      launchConfig: {
        agentCommand: 'codex --profile canvas',
        agentArgs: '--profile canvas',
        agentEnv: { ORCA_CREW_BRIDGE_TOKEN: 'token' },
        managedAccountId: 'account-canvas'
      }
    })
  })

  it('migrates a legacy Canvas session id without accepting unsupported agents', () => {
    expect(canvasAgentNativeResumeFromData('claude', { cliSessionId: 'session-claude' })).toEqual({
      providerSession: { key: 'session_id', id: 'session-claude' }
    })
    expect(
      canvasAgentNativeResumeFromData('command-code', { cliSessionId: 'session-command' })
    ).toBeNull()
  })
})

describe('startCanvasAgentNativeSessionCapture', () => {
  beforeEach(() => {
    storeHarness.state.agentStatusByPaneKey = {}
    storeHarness.state.sleepingAgentSessionsByPaneKey = {}
    storeHarness.state.getAgentLaunchConfigForStatusEntry.mockReset()
    storeHarness.subscribe.mockClear()
    storeHarness.unsubscribe.mockClear()
    storeHarness.listener = (): void => {}
  })

  it('captures only the exact native pane session and its saved account', () => {
    const paneA = {
      agentType: 'codex',
      providerSession: { key: 'session_id', id: 'session-a' }
    }
    const paneB = {
      agentType: 'codex',
      providerSession: { key: 'session_id', id: 'session-b' }
    }
    storeHarness.state.agentStatusByPaneKey = { 'tab-a:leaf-a': paneA, 'tab-b:leaf-b': paneB }
    storeHarness.state.getAgentLaunchConfigForStatusEntry.mockImplementation(
      (status: { providerSession: { id: string } }) => ({
        agentCommand: 'codex',
        agentArgs: '',
        agentEnv: {},
        managedAccountId: `account-${status.providerSession.id}`
      })
    )
    const updateNodeData = vi.fn()

    const stop = startCanvasAgentNativeSessionCapture({
      nodeId: 'node-a',
      paneKey: 'tab-a:leaf-a',
      agentKind: 'codex',
      updateNodeData
    })

    expect(updateNodeData).toHaveBeenCalledWith('node-a', {
      providerSession: { key: 'session_id', id: 'session-a' },
      cliSessionId: 'session-a',
      agentLaunchConfig: {
        agentCommand: 'codex',
        agentArgs: '',
        agentEnv: {},
        managedAccountId: 'account-session-a'
      },
      managedAccountId: 'account-session-a'
    })

    storeHarness.state.agentStatusByPaneKey['tab-b:leaf-b'] = {
      agentType: 'codex',
      providerSession: { key: 'session_id', id: 'session-b-updated' }
    }
    storeHarness.listener()
    expect(updateNodeData).toHaveBeenCalledTimes(1)

    storeHarness.state.agentStatusByPaneKey['tab-a:leaf-a'] = {
      agentType: 'codex',
      providerSession: { key: 'session_id', id: 'session-a-updated' }
    }
    storeHarness.listener()
    expect(updateNodeData).toHaveBeenCalledTimes(2)
    expect(updateNodeData.mock.calls[1]?.[1]).toMatchObject({
      cliSessionId: 'session-a-updated',
      managedAccountId: 'account-session-a-updated'
    })

    stop()
    expect(storeHarness.unsubscribe).toHaveBeenCalledOnce()
  })

  it('captures the exact sleeping session when the PTY is absent after restart', () => {
    storeHarness.state.sleepingAgentSessionsByPaneKey = {
      'tab-a:leaf-a': {
        agent: 'codex',
        providerSession: { key: 'session_id', id: 'sleeping-a' },
        launchConfig: {
          agentCommand: 'codex',
          agentArgs: '',
          agentEnv: {},
          managedAccountId: 'account-a'
        }
      },
      'tab-b:leaf-b': {
        agent: 'codex',
        providerSession: { key: 'session_id', id: 'sleeping-b' }
      }
    }
    const updateNodeData = vi.fn()

    expect(canvasAgentNativeResumeForPane('codex', 'tab-a:leaf-a')).toEqual({
      providerSession: { key: 'session_id', id: 'sleeping-a' },
      launchConfig: {
        agentCommand: 'codex',
        agentArgs: '',
        agentEnv: {},
        managedAccountId: 'account-a'
      }
    })

    startCanvasAgentNativeSessionCapture({
      nodeId: 'node-a',
      paneKey: 'tab-a:leaf-a',
      agentKind: 'codex',
      updateNodeData
    })

    expect(updateNodeData).toHaveBeenCalledWith(
      'node-a',
      expect.objectContaining({ cliSessionId: 'sleeping-a', managedAccountId: 'account-a' })
    )
  })
})

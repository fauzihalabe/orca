import { useAppStore } from '@/store'
import {
  isResumableTuiAgent,
  normalizeAgentProviderSession,
  type AgentProviderSessionMetadata,
  type SleepingAgentLaunchConfig
} from '../../../../../shared/agent-session-resume'

export type CanvasAgentNativeResume = {
  providerSession: AgentProviderSessionMetadata
  launchConfig?: SleepingAgentLaunchConfig
}

type CanvasAgentNativeSessionData = {
  providerSession?: unknown
  agentLaunchConfig?: unknown
  cliSessionId?: unknown
}

function normalizeAgentEnv(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return {}
  }
  return Object.fromEntries(
    Object.entries(raw).filter((entry): entry is [string, string] => typeof entry[1] === 'string')
  )
}

function normalizeLaunchConfig(raw: unknown): SleepingAgentLaunchConfig | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return undefined
  }
  const value = raw as Record<string, unknown>
  const managedAccountId = value.managedAccountId
  if (
    managedAccountId !== undefined &&
    managedAccountId !== null &&
    typeof managedAccountId !== 'string'
  ) {
    return undefined
  }
  return {
    ...(typeof value.agentCommand === 'string' && value.agentCommand.trim()
      ? { agentCommand: value.agentCommand.trim() }
      : {}),
    agentArgs: typeof value.agentArgs === 'string' ? value.agentArgs : '',
    agentEnv: normalizeAgentEnv(value.agentEnv),
    ...(managedAccountId !== undefined ? { managedAccountId } : {}),
    ...(typeof value.ompResumeFilePath === 'string' && value.ompResumeFilePath.trim()
      ? { ompResumeFilePath: value.ompResumeFilePath.trim() }
      : {})
  }
}

export function canvasAgentNativeResumeFromData(
  agentKind: string,
  data: CanvasAgentNativeSessionData
): CanvasAgentNativeResume | null {
  if (!isResumableTuiAgent(agentKind)) {
    return null
  }
  const legacyProviderSession =
    typeof data.cliSessionId === 'string'
      ? normalizeAgentProviderSession({ key: 'session_id', id: data.cliSessionId })
      : null
  const providerSession =
    normalizeAgentProviderSession(data.providerSession) ?? legacyProviderSession
  if (!providerSession) {
    return null
  }
  const launchConfig = normalizeLaunchConfig(data.agentLaunchConfig)
  return { providerSession, ...(launchConfig ? { launchConfig } : {}) }
}

function readNativeSession(paneKey: string, agentKind: string): CanvasAgentNativeResume | null {
  if (!isResumableTuiAgent(agentKind)) {
    return null
  }
  const state = useAppStore.getState()
  const live = state.agentStatusByPaneKey[paneKey]
  const sleeping = state.sleepingAgentSessionsByPaneKey[paneKey]
  if (live?.agentType === agentKind) {
    const providerSession = normalizeAgentProviderSession(live.providerSession)
    if (providerSession) {
      const launchConfig = state.getAgentLaunchConfigForStatusEntry(live)
      return { providerSession, ...(launchConfig ? { launchConfig } : {}) }
    }
  }
  if (sleeping?.agent === agentKind) {
    const providerSession = normalizeAgentProviderSession(sleeping.providerSession)
    if (providerSession) {
      return {
        providerSession,
        ...(sleeping.launchConfig ? { launchConfig: sleeping.launchConfig } : {})
      }
    }
  }
  return null
}

export function canvasAgentNativeResumeForPane(
  agentKind: string,
  paneKey: string
): CanvasAgentNativeResume | null {
  return readNativeSession(paneKey, agentKind)
}

export function startCanvasAgentNativeSessionCapture(args: {
  nodeId: string
  paneKey: string
  agentKind: string
  updateNodeData: (nodeId: string, patch: Record<string, unknown>) => void
}): () => void {
  let lastFingerprint = ''
  const capture = (): void => {
    const session = readNativeSession(args.paneKey, args.agentKind)
    if (!session) {
      return
    }
    const fingerprint = JSON.stringify(session)
    if (fingerprint === lastFingerprint) {
      return
    }
    lastFingerprint = fingerprint
    args.updateNodeData(args.nodeId, {
      providerSession: session.providerSession,
      cliSessionId: session.providerSession.id,
      ...(session.launchConfig ? { agentLaunchConfig: session.launchConfig } : {}),
      ...(session.launchConfig &&
      Object.prototype.hasOwnProperty.call(session.launchConfig, 'managedAccountId')
        ? { managedAccountId: session.launchConfig.managedAccountId }
        : {})
    })
  }
  capture()
  return useAppStore.subscribe(capture)
}

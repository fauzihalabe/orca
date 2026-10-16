import { parsePaneKey, type TerminalLeafId } from '../../../../../shared/stable-pane-id'

export type CanvasAgentSessionData = Record<string, unknown>

export type CanvasAgentMirrorIdentity = {
  tabId?: string
  leafId?: TerminalLeafId
  worktreeId?: string
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined
}

export function canvasAgentMirrorIdentityFromData(
  data: CanvasAgentSessionData
): CanvasAgentMirrorIdentity {
  const parsed = stringValue(data.paneKey) ? parsePaneKey(String(data.paneKey)) : null
  const tabId = stringValue(data.mirrorTabId) ?? parsed?.tabId
  const leafIdValue = stringValue(data.mirrorLeafId) ?? parsed?.leafId
  const leafId = leafIdValue ? parsePaneKey(`canvas:${leafIdValue}`)?.leafId : undefined
  const worktreeId = stringValue(data.mirrorWorktreeId) ?? stringValue(data.canvasWorktreeId)
  return { tabId, leafId, worktreeId }
}

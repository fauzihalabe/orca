import { TUI_AGENT_CONFIG } from '../../../shared/tui-agent-config'
import type { TuiAgent } from '../../../shared/types'

export async function trustAgentWorkspace(
  agent: TuiAgent,
  workspacePath: string,
  connectionId: string | null | undefined
): Promise<void> {
  const preset = TUI_AGENT_CONFIG[agent].preflightTrust
  if (!preset || !workspacePath || !window.api.agentTrust?.markTrusted) {
    return
  }
  try {
    await window.api.agentTrust.markTrusted({
      preset,
      workspacePath,
      ...(connectionId ? { connectionId } : {})
    })
  } catch {
    // Best-effort: the user can still accept the native provider trust prompt.
  }
}

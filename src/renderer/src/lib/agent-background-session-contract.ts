import type { ParsedAgentStatusPayload } from '../../../shared/agent-status-types'
import type { LaunchSource } from '../../../shared/telemetry-events'
import type { TuiAgent } from '../../../shared/types'
import type { AgentStartupPlan } from '@/lib/tui-agent-startup'
import type { AutomationTerminalOwnership } from '@/lib/automation-terminal-ownership'

export type LaunchAgentBackgroundSessionArgs = {
  agent: TuiAgent
  worktreeId: string
  /** Optional pre-created native tab/pane owned by a Canvas node. */
  nativeTab?: {
    tabId: string
    leafId: string
    paneKey: string
  }
  prompt?: string
  launchSource?: LaunchSource
  title?: string
  /** Per-launch CLI args appended to the agent command (overrides the settings-derived default). */
  agentArgs?: string | null
  /** Optional context delivered through the agent CLI's native system-prompt option. */
  nativeSystemPrompt?: string | null
  /** Per-launch env merged over the settings-derived agent env (pane stamps still win). */
  agentEnv?: Record<string, string>
  /** Orca-managed provider account pinned to this native agent session.
   *  Undefined follows Orca's selected account; null pins system default. */
  managedAccountId?: string | null
  /** Inherited vars to strip from this spawn's environment (e.g. ambient LINEIT_* in dev shells). */
  envToDelete?: string[]
  onData?: (chunk: string) => void
  onExit?: (ptyId: string, code: number) => void
  onAgentStatus?: (payload: ParsedAgentStatusPayload) => void
}

export type LaunchAgentBackgroundSessionResult = {
  tabId: string
  paneKey: string
  ptyId: string
  startupPlan: AgentStartupPlan
  terminalOwnership: AutomationTerminalOwnership | null
}

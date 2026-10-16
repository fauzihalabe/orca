import type { AppState } from '@/store'
import { buildAgentResumeStartupPlan, buildAgentStartupPlan } from '@/lib/tui-agent-startup'
import type { AgentStartupPlan } from '@/lib/tui-agent-startup'
import type { LaunchAgentBackgroundSessionArgs } from '@/lib/agent-background-session-contract'
import { resolveAgentBackgroundLaunchHost } from '@/lib/agent-background-session-launch-host'
import { trustAgentWorkspace } from '@/lib/agent-background-workspace-trust'
import {
  resolveTuiAgentLaunchArgs,
  resolveTuiAgentLaunchEnv
} from '../../../shared/tui-agent-launch-defaults'
import { TUI_AGENT_CONFIG } from '../../../shared/tui-agent-config'
import { isResumableTuiAgent } from '../../../shared/agent-session-resume'
import { resolveLocalWindowsAgentStartupShell } from '../../../shared/windows-terminal-shell'

type PreparedAgentBackgroundStartup = {
  worktree: NonNullable<ReturnType<AppState['getKnownWorktreeById']>>
  launchHost: ReturnType<typeof resolveAgentBackgroundLaunchHost>
  startupPlan: AgentStartupPlan
  trimmedPrompt: string
  hasPrompt: boolean
  isFollowupPath: boolean
  pasteDraftAfterLaunch: string | null
}

export async function prepareAgentBackgroundStartup(
  args: LaunchAgentBackgroundSessionArgs,
  store: AppState
): Promise<PreparedAgentBackgroundStartup | null> {
  const { agent, worktreeId } = args
  const worktree = store.getKnownWorktreeById(worktreeId)
  if (!worktree) {
    throw new Error('The target workspace is no longer available.')
  }
  const repo = store.repos.find((entry) => entry.id === worktree.repoId) ?? null
  const launchHost = resolveAgentBackgroundLaunchHost({
    store,
    worktreeId,
    worktreePath: worktree.path,
    repo
  })
  await trustAgentWorkspace(agent, worktree.path, launchHost.connectionId)
  const commandOverrides = store.settings?.agentCmdOverrides ?? {}
  const resumeLaunchConfig = args.resume?.launchConfig
  const agentArgs =
    resumeLaunchConfig?.agentArgs ??
    args.agentArgs ??
    resolveTuiAgentLaunchArgs(agent, store.settings?.agentDefaultArgs)
  const agentEnv = {
    ...(resumeLaunchConfig?.agentEnv ??
      resolveTuiAgentLaunchEnv(agent, store.settings?.agentDefaultEnv)),
    ...args.agentEnv
  }
  const startupShell = resolveLocalWindowsAgentStartupShell({
    platform: launchHost.platform,
    isRemote: launchHost.isRemote,
    terminalWindowsShell: store.settings?.terminalWindowsShell
  })
  const trimmedPrompt = args.prompt?.trim() ?? ''
  const hasPrompt = trimmedPrompt.length > 0
  const isFollowupPath = TUI_AGENT_CONFIG[agent].promptInjectionMode === 'stdin-after-start'
  const resumeAgent = args.resume && isResumableTuiAgent(agent) ? agent : null
  if (args.resume && !resumeAgent) {
    return null
  }
  const managedAccountId =
    args.managedAccountId !== undefined
      ? args.managedAccountId
      : resumeLaunchConfig?.managedAccountId
  const startupPlan =
    args.resume && resumeAgent
      ? buildAgentResumeStartupPlan({
          agent: resumeAgent,
          providerSession: args.resume.providerSession,
          cmdOverrides: commandOverrides,
          agentArgs,
          agentEnv,
          ...(resumeLaunchConfig?.agentCommand
            ? { agentCommand: resumeLaunchConfig.agentCommand }
            : {}),
          ...(managedAccountId !== undefined ? { managedAccountId } : {}),
          ...(resumeLaunchConfig?.ompResumeFilePath
            ? { ompResumeFilePath: resumeLaunchConfig.ompResumeFilePath }
            : {}),
          nativeSystemPrompt: args.nativeSystemPrompt,
          platform: launchHost.platform,
          shell: startupShell,
          isRemote: launchHost.isRemote
        })
      : buildAgentStartupPlan({
          agent,
          prompt: hasPrompt && !isFollowupPath ? trimmedPrompt : '',
          cmdOverrides: commandOverrides,
          agentArgs,
          agentEnv,
          ...(managedAccountId !== undefined ? { managedAccountId } : {}),
          nativeSystemPrompt: args.nativeSystemPrompt,
          platform: launchHost.platform,
          shell: startupShell,
          isRemote: launchHost.isRemote,
          allowEmptyPromptLaunch: !hasPrompt || isFollowupPath
        })
  if (!startupPlan) {
    return null
  }
  return {
    worktree,
    launchHost,
    startupPlan,
    trimmedPrompt,
    hasPrompt,
    isFollowupPath,
    pasteDraftAfterLaunch: hasPrompt && isFollowupPath ? trimmedPrompt : null
  }
}

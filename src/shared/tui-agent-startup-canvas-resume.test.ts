import { describe, expect, it } from 'vitest'
import { buildAgentResumeStartupPlan } from './tui-agent-startup'

describe('Canvas agent resume startup', () => {
  it('keeps native instructions on resume without persisting them in the base command', () => {
    const plan = buildAgentResumeStartupPlan({
      agent: 'codex',
      providerSession: { key: 'session_id', id: 's1' },
      cmdOverrides: {},
      nativeSystemPrompt: 'canvas native instructions',
      platform: 'linux'
    })

    expect(plan?.launchCommand).toBe(
      "codex -c 'developer_instructions=canvas native instructions' 'resume' 's1'"
    )
    expect(plan?.launchConfig.agentCommand).toBe('codex')
  })
})

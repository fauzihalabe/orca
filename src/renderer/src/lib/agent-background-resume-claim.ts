import { useAppStore } from '@/store'

export function releaseAutomaticAgentResumeClaim(tabId: string): void {
  useAppStore.setState((state) => {
    if (!state.automaticAgentResumeClaimsByTabId[tabId]) {
      return state
    }
    const automaticAgentResumeClaimsByTabId = { ...state.automaticAgentResumeClaimsByTabId }
    delete automaticAgentResumeClaimsByTabId[tabId]
    return { automaticAgentResumeClaimsByTabId }
  })
}

import { allCrewGraphs, getCrewCanvas } from '../canvas-store'

// Session capture: polls Orca's AI Vault for the CLI session this node is
// running, so an app restart can relaunch with the real `--resume` command.
// Two same-kind agents share agent+cwd, so "latest match" hijacks a sibling's
// session. Instead: never touch ids claimed by other nodes, only claim files
// born after THIS spawn, and take the EARLIEST such candidate (our own file
// is the first one created after we boot).
export function startSessionCapture({
  nodeId,
  agentKind,
  cwd,
  tabId,
  updateNodeData
}: {
  nodeId: string
  agentKind: string
  cwd?: string
  tabId: string
  updateNodeData: (nodeId: string, patch: Record<string, unknown>) => void
}): () => void {
  const spawnedAt = Date.now()
  const capture = async () => {
    try {
      const freshData = getCrewCanvas(tabId).nodes.find((n) => n.id === nodeId)?.data as
        | { cliSessionId?: string; cliResumeCommand?: string }
        | undefined
      const claimedElsewhere = new Set<string>()
      for (const g of allCrewGraphs()) {
        for (const n of g.nodes) {
          if (n.id !== nodeId && typeof n.data.cliSessionId === 'string') {
            claimedElsewhere.add(n.data.cliSessionId)
          }
        }
      }
      const result = await window.api.aiVault.listSessions({ limit: 40 })
      const mine = result.sessions
        .filter(
          (s) =>
            s.agent === agentKind &&
            (!cwd || s.cwd === cwd) &&
            Boolean(s.sessionId) &&
            !claimedElsewhere.has(s.sessionId!)
        )
        .sort((a, b) => (a.modifiedAt ?? '').localeCompare(b.modifiedAt ?? ''))
      if (freshData?.cliSessionId) {
        const own = mine.find((s) => s.sessionId === freshData.cliSessionId)
        if (own?.resumeCommand && own.resumeCommand !== freshData.cliResumeCommand) {
          updateNodeData(nodeId, { cliResumeCommand: own.resumeCommand })
        }
        return
      }
      const own = mine.find((s) => {
        const modified = s.modifiedAt ? Date.parse(s.modifiedAt) : 0
        return modified >= spawnedAt - 15_000
      })
      if (own?.sessionId) {
        updateNodeData(nodeId, {
          cliSessionId: own.sessionId,
          cliResumeCommand: own.resumeCommand
        })
      }
    } catch {
      // vault scan unavailable this tick — retry next interval
    }
  }
  const first = setTimeout(() => void capture(), 8_000)
  const interval = setInterval(() => void capture(), 25_000)
  return () => {
    clearTimeout(first)
    clearInterval(interval)
  }
}

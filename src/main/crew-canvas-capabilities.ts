import {
  crewCanvasNodeLabel,
  crewCanvasNodeTools,
  crewCanvasText,
  type LocatedCanvasNode
} from './crew-canvas-graph'
import type { CrewCanvasStateStore } from './crew-canvas-state'

export function crewCanvasCapabilities(
  state: CrewCanvasStateStore,
  caller: LocatedCanvasNode
): unknown {
  return {
    agent: {
      id: caller.node.id,
      label: crewCanvasNodeLabel(caller.node),
      tabId: caller.tab.tabId
    },
    revision: state.getState().revision,
    policy: {
      todo: {
        requiredForMultiStepWork: true,
        minimumActions: 2,
        workflow: ['todo.spawn-if-missing', 'todo.list', 'todo.add-once', 'todo.toggle-on-done']
      },
      terminal: {
        version: 3,
        supersedesLaunchPrompt: true,
        agentToolsEnabled: false,
        execution: 'use-agent-native-terminal-tool-only',
        canvasTerminals: 'manual-user-resources-only',
        agentNodeSurface: 'native-pty-visual-mirror'
      },
      browser: {
        version: 2,
        engine: 'native-orca-browser',
        useFor: 'visible-authenticated-ui',
        codeAndApi: 'use-agent-native-terminal',
        connectedPageOnly: true,
        spawn: 'reuse-connected-node',
        navigate: 'reuse-connected-page',
        screenshot: 'mcp-image-content',
        snapshotDefaultBytes: 24_576,
        snapshotMaxBytes: 131_072
      }
    },
    connections: state
      .connected(caller)
      .filter(({ node }) => node.data.kind !== 'terminal')
      .map(({ node }) => {
        return {
          id: node.id,
          kind: crewCanvasText(node.data.kind),
          label: crewCanvasNodeLabel(node),
          tools: crewCanvasNodeTools(crewCanvasText(node.data.kind)),
          page: node.data.kind === 'browser' ? state.browserPageId(node.id) : undefined
        }
      })
  }
}

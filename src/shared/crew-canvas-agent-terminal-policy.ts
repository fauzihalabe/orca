export const CREW_CANVAS_AGENT_TERMINAL_DISABLED_MESSAGE =
  'Canvas terminals are manual user resources and are not agent-callable; use only the agent native terminal tool.'

export function isCrewCanvasAgentTerminalTool(tool: string): boolean {
  return tool === 'terminal.spawn' || tool.startsWith('terminal.')
}

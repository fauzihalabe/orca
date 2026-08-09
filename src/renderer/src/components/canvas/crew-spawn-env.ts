// Canvas crew spawns are Orca agents, not lineit AgentNodes. When Orca itself
// runs inside a lineit-driven shell (dev), the ambient LINEIT_* vars leak into
// the PTY and the user's global Claude hooks fail-closed against a contract
// that doesn't exist here — every prompt dies with a 403. Strip them.
export const CREW_SPAWN_ENV_TO_DELETE = [
  'LINEIT_SESSION',
  'LINEIT_WORKSPACE_ID',
  'LINEIT_AGENT_CONNECTION_ID',
  'LINEIT_CONTEXT_VIA_CLIENT'
]

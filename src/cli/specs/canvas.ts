import type { CommandSpec } from '../args'
import { GLOBAL_FLAGS } from '../args'

export const CANVAS_COMMAND_SPECS: CommandSpec[] = [
  {
    path: ['canvas', 'mcp-serve'],
    summary: 'Run the native Canvas tool transport for a managed agent',
    usage: 'orca canvas mcp-serve',
    allowedFlags: []
  },
  {
    path: ['canvas', 'connections'],
    summary: 'List the Canvas nodes connected to this agent',
    usage: 'orca canvas connections [--json]',
    allowedFlags: [...GLOBAL_FLAGS],
    notes: [
      'Only nodes joined to the current Canvas agent by an edge are returned; the graph is the permission boundary.',
      'Connections are read live, so call this again after the user changes an edge.'
    ],
    examples: ['orca canvas connections --json']
  },
  {
    path: ['canvas', 'graph'],
    summary: 'List the persisted Canvas graphs and nodes',
    usage: 'orca canvas graph [--json]',
    allowedFlags: [...GLOBAL_FLAGS],
    examples: ['orca canvas graph --json']
  },
  {
    path: ['canvas', 'call'],
    summary: 'Call a tool on a connected Canvas node',
    usage: 'orca canvas call --tool <tool> [--node <node-id>] [--args <json-object>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'tool', 'node', 'args'],
    examples: [
      'orca canvas call --tool note.read --node <node-id> --json',
      'orca canvas call --tool terminal.run --node <node-id> --args \'{"command":"pwd"}\' --json',
      'orca canvas call --tool browser.read --node <node-id> --json'
    ]
  },
  {
    path: ['canvas', 'ask'],
    summary: 'Send a message to another connected Canvas agent',
    usage: 'orca canvas ask --to <node-id-or-label> --message <text> [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'to', 'message'],
    examples: ['orca canvas ask --to reviewer --message "please review this" --json']
  }
]

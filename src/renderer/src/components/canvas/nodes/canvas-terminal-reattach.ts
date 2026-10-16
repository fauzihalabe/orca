import type { Terminal } from '@xterm/xterm'
import { isRemoteRuntimePtyId } from '@/runtime/runtime-terminal-inspection'
import { waitForTerminalReplayWritesParsed } from '@/components/terminal-pane/replay-guard'
import {
  buildMainModelSnapshotReplayWrites,
  resolvePositiveTerminalDimensions
} from '@/components/terminal-pane/terminal-snapshot-replay-paint'

export type CanvasTerminalSnapshot = {
  data: string
  cols: number
  rows: number
  alternateScreen?: boolean
  scrollbackAnsi?: string
  pendingEscapeTailAnsi?: string
}

type CanvasReplayTerminal = Pick<Terminal, 'cols' | 'rows' | 'resize' | 'write'>

export async function replayCanvasTerminalSnapshot(
  terminal: CanvasReplayTerminal,
  snapshot: CanvasTerminalSnapshot
): Promise<void> {
  const dimensions = resolvePositiveTerminalDimensions(snapshot.cols, snapshot.rows)
  if (dimensions && (terminal.cols !== dimensions.cols || terminal.rows !== dimensions.rows)) {
    terminal.resize(dimensions.cols, dimensions.rows)
  }
  for (const chunk of buildMainModelSnapshotReplayWrites(snapshot)) {
    terminal.write(chunk)
  }
  if (snapshot.pendingEscapeTailAnsi) {
    terminal.write(snapshot.pendingEscapeTailAnsi)
  }
  await waitForTerminalReplayWritesParsed(terminal)
}

export async function finishCanvasTerminalReattach(args: {
  terminal: Pick<Terminal, 'write'>
  ptyId: string
  fitViewport: () => void
  signal?: (ptyId: string, signal: string) => void
  shouldContinue?: () => boolean
}): Promise<boolean> {
  await waitForTerminalReplayWritesParsed(args.terminal)
  if (args.shouldContinue && !args.shouldContinue()) {
    return false
  }
  args.fitViewport()
  if (!isRemoteRuntimePtyId(args.ptyId)) {
    const signal = args.signal ?? window.api.pty.signal
    signal(args.ptyId, 'SIGWINCH')
  }
  return true
}

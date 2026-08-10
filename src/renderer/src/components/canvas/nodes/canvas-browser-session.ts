import { useAppStore } from '@/store'

export type CanvasBrowserSessionData = Record<string, unknown>

export function canvasBrowserWorkspaceId(nodeId: string): string {
  return `canvas-browser-${nodeId}`
}

export function canvasBrowserPageId(nodeId: string): string {
  return `canvas-${nodeId}`
}

export async function waitForNativeBrowserSessionHydration(): Promise<void> {
  if (useAppStore.getState().workspaceSessionReady) {
    return
  }
  const deadline = Date.now() + 8_000
  while (Date.now() < deadline) {
    if (useAppStore.getState().workspaceSessionReady) {
      return
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined
}

export function closeCanvasBrowserMirror(data: CanvasBrowserSessionData): void {
  const state = useAppStore.getState()
  const requestedWorkspaceId = stringValue(data.browserWorkspaceId)
  const requestedPageId = stringValue(data.browserPageId)
  const workspace = Object.values(state.browserTabsByWorktree)
    .flat()
    .find(
      (candidate) =>
        (requestedWorkspaceId && candidate.id === requestedWorkspaceId) ||
        (requestedPageId && candidate.pageIds?.includes(requestedPageId))
    )
  if (workspace) {
    state.closeBrowserTab(workspace.id)
  }
}

import {
  registeredWebContentsIds,
  webviewRegistry
} from '@/components/browser-pane/webview-registry'

export type CanvasBrowserRegistrationTarget = {
  pageId: string
  workspaceId: string
  worktreeId: string
  sessionProfileId?: string | null
}

function isCurrentLiveWebview(
  pageId: string,
  webview: Electron.WebviewTag,
  webContentsId: number
): boolean {
  if (webview.isConnected === false || webviewRegistry.get(pageId) !== webview) {
    return false
  }
  try {
    return webview.getWebContentsId() === webContentsId
  } catch {
    return false
  }
}

async function registrationReady(target: CanvasBrowserRegistrationTarget): Promise<boolean> {
  const webview = webviewRegistry.get(target.pageId)
  if (!webview || webview.isConnected === false) {
    return false
  }
  let webContentsId: number
  try {
    webContentsId = webview.getWebContentsId()
  } catch {
    return false
  }
  const registered = await window.api.browser.isGuestRegistered({
    browserPageId: target.pageId,
    webContentsId
  })
  if (!isCurrentLiveWebview(target.pageId, webview, webContentsId)) {
    return false
  }
  if (registered) {
    registeredWebContentsIds.set(target.pageId, webContentsId)
    return true
  }
  const repaired = await window.api.browser.repairGuestRegistration({
    browserPageId: target.pageId,
    workspaceId: target.workspaceId,
    worktreeId: target.worktreeId,
    sessionProfileId: target.sessionProfileId ?? null,
    webContentsId
  })
  if (repaired && isCurrentLiveWebview(target.pageId, webview, webContentsId)) {
    registeredWebContentsIds.set(target.pageId, webContentsId)
    return true
  }
  return false
}

export async function waitForCanvasBrowserRegistration(
  target: CanvasBrowserRegistrationTarget,
  timeoutMs = 4_000
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      if (await registrationReady(target)) {
        return true
      }
    } catch {
      await new Promise((resolve) => window.setTimeout(resolve, 50))
      continue
    }
    await new Promise((resolve) => window.setTimeout(resolve, 50))
  }
  try {
    return await registrationReady(target)
  } catch {
    return false
  }
}

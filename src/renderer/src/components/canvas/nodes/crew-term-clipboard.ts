import type { Terminal } from '@xterm/xterm'
import { APP_MENU_PASTE_EVENT } from '@/lib/app-menu-paste'
import { pasteTerminalText } from '../../terminal-pane/terminal-bracketed-paste'
import { pasteTerminalClipboard } from '../../terminal-pane/terminal-clipboard-paste'
import {
  firesNativePasteEvent,
  getClipboardEventText,
  isClipboardEventPasteRequired
} from '../../terminal-pane/terminal-clipboard-event-paste'

// Clipboard + OS file-drop for canvas xterms (agent/terminal nodes), reusing
// Orca's own paste machinery: image clipboard → temp file → bracketed path
// paste (TUIs detect it as an attachment); text → Orca's hardened paste path.
// Drops reach us through the preload's crew branch ('crew:native-file-drop')
// because webUtils File→path only exists in the preload world.

type PasteCapableTerminal = Parameters<typeof pasteTerminalText>[0]

export function isCrewTerminalPasteChord(
  event: Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey'>,
  isMac = navigator.userAgent.includes('Mac')
): boolean {
  const key = event.key.toLowerCase()
  return isMac
    ? key === 'v' && event.metaKey && !event.ctrlKey && !event.altKey
    : (key === 'v' && event.ctrlKey && !event.metaKey && !event.altKey) ||
        (event.key === 'Insert' &&
          event.shiftKey &&
          !event.ctrlKey &&
          !event.metaKey &&
          !event.altKey)
}

export function attachCrewTermClipboard(
  container: HTMLElement,
  term: Terminal,
  getPtyId: () => string | null
): () => void {
  const pasteText = (text: string, forceBracketedPaste = false) => {
    if (!getPtyId()) {
      return false
    }
    pasteTerminalText(term as unknown as PasteCapableTerminal, text, {
      forceBracketedPaste
    })
    return true
  }

  const doPaste = (readClipboardText = window.api.ui.readClipboardText): Promise<unknown> => {
    if (!getPtyId()) {
      return Promise.resolve()
    }
    // Keep the exact native Orca precedence and safety limits: text first,
    // image-path fallback second. The old Canvas path tried images first and
    // bypassed the bounded terminal paste coordinator.
    return pasteTerminalClipboard({
      readClipboardText,
      saveClipboardImageAsTempFile: window.api.ui.saveClipboardImageAsTempFile,
      pasteText: (text, options) => pasteText(text, options?.forceBracketedPaste === true)
    }).catch(() => undefined)
  }

  let suppressNextPasteEvent = false
  let suppressionTimer: number | null = null
  const suppressNativePasteOnce = (): void => {
    suppressNextPasteEvent = true
    if (suppressionTimer !== null) {
      window.clearTimeout(suppressionTimer)
    }
    suppressionTimer = window.setTimeout(() => {
      suppressionTimer = null
      suppressNextPasteEvent = false
    }, 0)
  }

  term.attachCustomKeyEventHandler((event) => {
    if (event.type !== 'keydown') {
      return true
    }
    if (isCrewTerminalPasteChord(event)) {
      if (
        isClipboardEventPasteRequired() &&
        firesNativePasteEvent(event, navigator.userAgent.includes('Mac'))
      ) {
        return true
      }
      suppressNativePasteOnce()
      void doPaste()
      return false
    }
    return true
  })

  const onPaste = (event: ClipboardEvent): void => {
    if (!container.contains(event.target as Node | null)) {
      return
    }
    event.preventDefault()
    event.stopPropagation()
    if (suppressNextPasteEvent) {
      suppressNextPasteEvent = false
      if (suppressionTimer !== null) {
        window.clearTimeout(suppressionTimer)
        suppressionTimer = null
      }
      return
    }
    if (isClipboardEventPasteRequired()) {
      const eventText = getClipboardEventText(event)
      void doPaste(async () => eventText)
      return
    }
    void doPaste()
  }

  const onAppMenuPaste = (event: Event): void => {
    const activeElement = document.activeElement
    if (!(activeElement instanceof Element) || !container.contains(activeElement)) {
      return
    }
    event.preventDefault()
    event.stopPropagation()
    void doPaste()
  }

  container.addEventListener('paste', onPaste, { capture: true })
  window.addEventListener(APP_MENU_PASTE_EVENT, onAppMenuPaste)
  return () => {
    if (suppressionTimer !== null) {
      window.clearTimeout(suppressionTimer)
    }
    container.removeEventListener('paste', onPaste, { capture: true })
    window.removeEventListener(APP_MENU_PASTE_EVENT, onAppMenuPaste)
  }
}

export function attachCrewTermFileDrop(
  container: HTMLElement,
  term: Terminal,
  getPtyId: () => string | null
): () => void {
  container.setAttribute('data-crew-pty-node', '1')
  const onDrop = (event: Event) => {
    const paths = (event as CustomEvent<{ paths?: string[] }>).detail?.paths ?? []
    if (!getPtyId()) {
      return
    }
    for (const path of paths) {
      pasteTerminalText(term as unknown as PasteCapableTerminal, path, {
        forceBracketedPaste: true
      })
    }
  }
  container.addEventListener('crew:native-file-drop', onDrop)
  return () => {
    container.removeEventListener('crew:native-file-drop', onDrop)
    container.removeAttribute('data-crew-pty-node')
  }
}

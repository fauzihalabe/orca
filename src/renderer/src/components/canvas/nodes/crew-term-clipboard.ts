import type { Terminal } from '@xterm/xterm'
import { pasteTerminalText } from '../../terminal-pane/terminal-bracketed-paste'

// Clipboard + OS file-drop for canvas xterms (agent/terminal nodes), reusing
// Orca's own paste machinery: image clipboard → temp file → bracketed path
// paste (TUIs detect it as an attachment); text → Orca's hardened paste path.
// Drops reach us through the preload's crew branch ('crew:native-file-drop')
// because webUtils File→path only exists in the preload world.

type PasteCapableTerminal = Parameters<typeof pasteTerminalText>[0]

export function attachCrewTermClipboard(term: Terminal, getPtyId: () => string | null): void {
  const pasteText = (text: string, force = false) => {
    if (!getPtyId()) {
      return
    }
    pasteTerminalText(term as unknown as PasteCapableTerminal, text, {
      forceBracketedPaste: force
    })
  }

  const doPaste = async () => {
    const imagePath = await window.api.ui
      .saveClipboardImageAsTempFile({})
      .catch(() => null as string | null)
    if (imagePath) {
      // Why force: image paths are attachment payloads for the TUI, even single-line.
      pasteText(imagePath, true)
      return
    }
    const text = await window.api.ui.readClipboardText().catch(() => '')
    if (text) {
      pasteText(text)
    }
  }

  term.attachCustomKeyEventHandler((event) => {
    if (event.type !== 'keydown') {
      return true
    }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'v') {
      void doPaste()
      return false
    }
    return true
  })
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

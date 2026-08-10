import { describe, expect, it } from 'vitest'
import { isCrewTerminalPasteChord } from './crew-term-clipboard'

const chord = (overrides: Partial<KeyboardEvent> = {}) =>
  ({
    key: 'v',
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    ...overrides
  }) as Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey'>

describe('Canvas terminal native paste chord', () => {
  it('captures Command+V on macOS without swallowing ordinary terminal input', () => {
    expect(isCrewTerminalPasteChord(chord({ metaKey: true }), true)).toBe(true)
    expect(isCrewTerminalPasteChord(chord(), true)).toBe(false)
    expect(isCrewTerminalPasteChord(chord({ ctrlKey: true }), true)).toBe(false)
  })

  it('captures Ctrl+V and Shift+Insert outside macOS', () => {
    expect(isCrewTerminalPasteChord(chord({ ctrlKey: true }), false)).toBe(true)
    expect(isCrewTerminalPasteChord(chord({ key: 'Insert', shiftKey: true }), false)).toBe(true)
    expect(isCrewTerminalPasteChord(chord({ metaKey: true }), false)).toBe(false)
  })
})

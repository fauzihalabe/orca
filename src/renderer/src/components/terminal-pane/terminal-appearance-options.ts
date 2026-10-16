import type { ITerminalOptions } from '@xterm/xterm'
import type { GlobalSettings } from '../../../../shared/types'
import { resolveTerminalFontWeights } from '../../../../shared/terminal-fonts'
import { normalizeTerminalLineHeight } from '../../../../shared/terminal-line-height-settings'
import {
  normalizeTerminalFastScrollSensitivity,
  normalizeTerminalScrollSensitivity,
  resolveTerminalCursorInactiveStyle
} from '@/lib/pane-manager/pane-terminal-options'
import { buildFontFamily } from './layout-serialization'

export function buildTerminalAppearanceOptions(
  settings: GlobalSettings | null,
  macOptionIsMeta: boolean
): Partial<ITerminalOptions> {
  const cursorStyle = settings?.terminalCursorStyle ?? 'block'
  const fontWeights = resolveTerminalFontWeights(settings?.terminalFontWeight)
  return {
    fontSize: settings?.terminalFontSize ?? 14,
    fontFamily: buildFontFamily(settings?.terminalFontFamily ?? ''),
    fontWeight: fontWeights.fontWeight,
    fontWeightBold: fontWeights.fontWeightBold,
    cursorStyle,
    cursorInactiveStyle: resolveTerminalCursorInactiveStyle(cursorStyle),
    cursorBlink: settings?.terminalCursorBlink ?? true,
    scrollSensitivity: normalizeTerminalScrollSensitivity(settings?.terminalScrollSensitivity),
    fastScrollSensitivity: normalizeTerminalFastScrollSensitivity(
      settings?.terminalFastScrollSensitivity
    ),
    lineHeight: normalizeTerminalLineHeight(settings?.terminalLineHeight),
    wordSeparator: settings?.terminalWordSeparator,
    macOptionIsMeta,
    allowTransparency:
      settings?.terminalBackgroundOpacity !== undefined && settings.terminalBackgroundOpacity < 1
  }
}

import { useMemo } from 'react'
import type { ITheme, ITerminalOptions, Terminal } from '@xterm/xterm'
import type { GlobalSettings } from '../../../../shared/types'
import { useAppStore } from '@/store'
import { useSystemPrefersDark } from '@/components/terminal-pane/use-system-prefers-dark'
import {
  applyTerminalColorAppearance,
  composeActiveTerminalTheme
} from '@/components/terminal-pane/terminal-appearance'
import { getBuiltinTheme, resolveEffectiveTerminalAppearance } from '@/lib/terminal-theme'
import { resolveTerminalMinimumContrastRatio } from '@/lib/terminal-contrast-correction'
import { buildDefaultTerminalOptions } from '@/lib/pane-manager/pane-terminal-options'
import { buildTerminalAppearanceOptions } from '@/components/terminal-pane/terminal-appearance-options'

export type CanvasTerminalAppearance = {
  theme: ITheme | null
  mode: 'dark' | 'light'
  allowTransparency: boolean
}

export function resolveCanvasTerminalAppearance(
  settings: GlobalSettings | null,
  systemPrefersDark: boolean
): CanvasTerminalAppearance {
  if (!settings) {
    return {
      theme: null,
      mode: systemPrefersDark ? 'dark' : 'light',
      allowTransparency: false
    }
  }
  const appearance = resolveEffectiveTerminalAppearance(settings, systemPrefersDark)
  return {
    theme: composeActiveTerminalTheme(
      appearance.theme ?? getBuiltinTheme(appearance.themeName),
      settings
    ),
    mode: appearance.mode,
    allowTransparency:
      settings.terminalBackgroundOpacity !== undefined && settings.terminalBackgroundOpacity < 1
  }
}

export function canvasTerminalColorOptions(
  appearance: CanvasTerminalAppearance
): Pick<ITerminalOptions, 'theme' | 'minimumContrastRatio' | 'allowTransparency'> {
  return {
    theme: appearance.theme ?? undefined,
    minimumContrastRatio: resolveTerminalMinimumContrastRatio(
      appearance.theme?.background,
      appearance.mode
    ),
    allowTransparency: appearance.allowTransparency
  }
}

export function canvasTerminalOptions(
  appearance: CanvasTerminalAppearance,
  settings: GlobalSettings | null
): ITerminalOptions {
  return {
    ...buildDefaultTerminalOptions(),
    ...buildTerminalAppearanceOptions(settings, false),
    ...canvasTerminalColorOptions(appearance)
  }
}

export function applyCanvasTerminalAppearance(
  terminal: Pick<Terminal, 'options'>,
  appearance: CanvasTerminalAppearance
): void {
  applyTerminalColorAppearance(
    terminal,
    appearance.theme,
    appearance.mode,
    appearance.allowTransparency
  )
}

export function useCanvasTerminalAppearance(): CanvasTerminalAppearance {
  const settings = useAppStore((state) => state.settings)
  const systemPrefersDark = useSystemPrefersDark()
  return useMemo(
    () => resolveCanvasTerminalAppearance(settings, systemPrefersDark),
    [settings, systemPrefersDark]
  )
}

import {
  canMeasureTerminalFit,
  canMeasureTerminalPixelBox
} from '@/lib/pane-manager/pane-fit-measurability'

type TerminalDimensions = { cols: number; rows: number }

type CanvasTerminalFitAddon = {
  fit: () => void
  proposeDimensions: () => TerminalDimensions | undefined
}

export function canMeasureCanvasTerminal(container: HTMLElement): boolean {
  const rect = container.getBoundingClientRect()
  return canMeasureTerminalPixelBox(rect.width, rect.height)
}

export function fitCanvasTerminalViewport(args: {
  active: boolean
  container: HTMLElement
  fitAddon: CanvasTerminalFitAddon
}): TerminalDimensions | null {
  if (!args.active) {
    return null
  }
  try {
    const rect = args.container.getBoundingClientRect()
    const proposed = args.fitAddon.proposeDimensions()
    if (!canMeasureTerminalFit(rect.width, rect.height, proposed)) {
      return null
    }
    args.fitAddon.fit()
    return proposed
  } catch {
    return null
  }
}

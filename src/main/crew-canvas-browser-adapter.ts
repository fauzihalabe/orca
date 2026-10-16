import { crewCanvasJson } from './crew-canvas-graph'

const DEFAULT_SNAPSHOT_BYTES = 24 * 1024
const MIN_SNAPSHOT_BYTES = 8 * 1024
const MAX_SNAPSHOT_BYTES = 128 * 1024

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function snapshotByteLimit(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return DEFAULT_SNAPSHOT_BYTES
  }
  return Math.min(MAX_SNAPSHOT_BYTES, Math.max(MIN_SNAPSHOT_BYTES, Math.round(value)))
}

function prefixWithinBytes(value: string, maxBytes: number): string {
  let low = 0
  let high = value.length
  while (low < high) {
    const middle = Math.ceil((low + high) / 2)
    if (Buffer.byteLength(value.slice(0, middle), 'utf8') <= maxBytes) {
      low = middle
    } else {
      high = middle - 1
    }
  }
  const end = low > 0 && /[\uD800-\uDBFF]/.test(value[low - 1] ?? '') ? low - 1 : low
  return value.slice(0, end)
}

function suffixWithinBytes(value: string, maxBytes: number): string {
  let low = 0
  let high = value.length
  while (low < high) {
    const middle = Math.floor((low + high) / 2)
    if (Buffer.byteLength(value.slice(middle), 'utf8') <= maxBytes) {
      high = middle
    } else {
      low = middle + 1
    }
  }
  const start = low < value.length && /[\uDC00-\uDFFF]/.test(value[low] ?? '') ? low + 1 : low
  return value.slice(start)
}

function boundedSnapshot(
  value: string,
  requestedBytes: unknown
): {
  snapshot: string
  truncated: boolean
  originalBytes: number
} {
  const originalBytes = Buffer.byteLength(value, 'utf8')
  const maxBytes = snapshotByteLimit(requestedBytes)
  if (originalBytes <= maxBytes) {
    return { snapshot: value, truncated: false, originalBytes }
  }
  const marker = `\n… snapshot truncado pelo Canvas (${originalBytes} bytes); refine a página e tire outro snapshot …\n`
  const contentBudget = Math.max(0, maxBytes - Buffer.byteLength(marker, 'utf8'))
  const headBudget = Math.floor(contentBudget * 0.75)
  return {
    snapshot: `${prefixWithinBytes(value, headBudget)}${marker}${suffixWithinBytes(
      value,
      contentBudget - headBudget
    )}`,
    truncated: true,
    originalBytes
  }
}

function refCount(value: unknown): number {
  if (Array.isArray(value)) {
    return value.length
  }
  return isRecord(value) ? Object.keys(value).length : 0
}

export function formatCrewCanvasBrowserSnapshot(value: unknown, requestedBytes?: unknown): string {
  if (!isRecord(value) || typeof value.snapshot !== 'string') {
    return crewCanvasJson(value)
  }
  const bounded = boundedSnapshot(value.snapshot, requestedBytes)
  return crewCanvasJson({
    ...(typeof value.browserPageId === 'string' ? { browserPageId: value.browserPageId } : {}),
    ...(typeof value.url === 'string' ? { url: value.url } : {}),
    ...(typeof value.origin === 'string' ? { origin: value.origin } : {}),
    ...(typeof value.title === 'string' ? { title: value.title } : {}),
    snapshot: bounded.snapshot,
    refCount: refCount(value.refs),
    truncated: bounded.truncated,
    originalBytes: bounded.originalBytes
  })
}

export function crewCanvasBrowserTextArgument(
  args: Record<string, unknown>,
  names: readonly string[]
): string | undefined {
  for (const name of names) {
    if (typeof args[name] === 'string') {
      return args[name]
    }
  }
  return undefined
}

export function normalizeCrewCanvasBrowserEvalExpression(expression: string): string {
  const trimmed = expression.trim()
  if (
    /^(?:async\s*)?\(\s*\)\s*=>/.test(trimmed) ||
    /^(?:async\s+)?function(?:\s+[A-Za-z_$][\w$]*)?\s*\(\s*\)/.test(trimmed)
  ) {
    return `(${trimmed})()`
  }
  return trimmed
}

export function crewCanvasBrowserWaitArgs(
  args: Record<string, unknown>
): Record<string, unknown> | null {
  const normalized: Record<string, unknown> = {}
  for (const name of ['selector', 'text', 'url', 'load', 'fn', 'state'] as const) {
    const value = crewCanvasBrowserTextArgument(args, [name])?.trim()
    if (value) {
      normalized[name] = value
    }
  }
  const timeout = args.timeout ?? args.timeoutMs ?? args.ms
  if (typeof timeout === 'number' && Number.isFinite(timeout) && timeout > 0) {
    normalized.timeout = Math.round(timeout)
  }
  return Object.keys(normalized).length > 0 ? normalized : null
}

export function isCrewCanvasBrowserUnavailable(value: unknown): boolean {
  return (
    typeof value === 'string' &&
    ['browser_tab_not_found', 'browser_no_tab'].some((code) => value.includes(code))
  )
}

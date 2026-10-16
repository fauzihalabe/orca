import { describe, expect, it } from 'vitest'
import {
  crewCanvasBrowserTextArgument,
  crewCanvasBrowserWaitArgs,
  formatCrewCanvasBrowserSnapshot,
  isCrewCanvasBrowserUnavailable,
  normalizeCrewCanvasBrowserEvalExpression
} from './crew-canvas-browser-adapter'

describe('Crew Canvas browser adapter', () => {
  it('normalizes aliases without losing an intentional empty fill', () => {
    expect(crewCanvasBrowserTextArgument({ text: '' }, ['value', 'text'])).toBe('')
    expect(crewCanvasBrowserTextArgument({ input: 'hello' }, ['input', 'text'])).toBe('hello')
    expect(crewCanvasBrowserWaitArgs({ text: 'Ready', timeoutMs: 2_500 })).toEqual({
      text: 'Ready',
      timeout: 2_500
    })
    expect(crewCanvasBrowserWaitArgs({})).toBeNull()
  })

  it('invokes zero-argument eval callbacks exactly once', () => {
    expect(normalizeCrewCanvasBrowserEvalExpression('() => document.title')).toBe(
      '(() => document.title)()'
    )
    expect(normalizeCrewCanvasBrowserEvalExpression('async () => await run()')).toBe(
      '(async () => await run())()'
    )
    expect(normalizeCrewCanvasBrowserEvalExpression('document.title')).toBe('document.title')
  })

  it('removes duplicate refs and bounds large snapshots', () => {
    const formatted = formatCrewCanvasBrowserSnapshot(
      {
        browserPageId: 'page-1',
        origin: 'https://example.com',
        refs: { e1: { role: 'button' }, e2: { role: 'textbox' } },
        snapshot: `start-${'x'.repeat(20_000)}-end`
      },
      8_192
    )
    const parsed = JSON.parse(formatted) as {
      snapshot: string
      refCount: number
      truncated: boolean
      originalBytes: number
      refs?: unknown
    }

    expect(parsed.refs).toBeUndefined()
    expect(parsed.refCount).toBe(2)
    expect(parsed.truncated).toBe(true)
    expect(parsed.originalBytes).toBeGreaterThan(20_000)
    expect(Buffer.byteLength(parsed.snapshot, 'utf8')).toBeLessThanOrEqual(8_192)
    expect(parsed.snapshot).toContain('start-')
    expect(parsed.snapshot).toContain('-end')
  })

  it('recognizes browser availability errors', () => {
    expect(isCrewCanvasBrowserUnavailable('erro: navegador: browser_tab_not_found')).toBe(true)
    expect(isCrewCanvasBrowserUnavailable('erro: navegador: browser_timeout')).toBe(false)
  })
})

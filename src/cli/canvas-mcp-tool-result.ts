import { isCrewCanvasErrorResponse } from '../shared/crew-canvas-response'

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function responseText(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value ?? null, null, 2)
}

function browserScreenshot(value: unknown): { data: string; format: 'png' | 'jpeg' } | null {
  let parsed = value
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value) as unknown
    } catch {
      return null
    }
  }
  if (
    !isRecord(parsed) ||
    typeof parsed.data !== 'string' ||
    (parsed.format !== 'png' && parsed.format !== 'jpeg')
  ) {
    return null
  }
  return { data: parsed.data, format: parsed.format }
}

function browserPdf(value: unknown): string | null {
  let parsed = value
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value) as unknown
    } catch {
      return null
    }
  }
  return isRecord(parsed) && typeof parsed.data === 'string' ? parsed.data : null
}

export function requestedCanvasOperation(params: unknown): string | null {
  if (!isRecord(params) || params.name !== 'canvas_call' || !isRecord(params.arguments)) {
    return null
  }
  const tool = params.arguments.tool
  return typeof tool === 'string' ? tool : null
}

export function canvasMcpToolResult(result: unknown, operation: string | null): unknown {
  const isError = isCrewCanvasErrorResponse(result)
  if (!isError && operation === 'browser.screenshot') {
    const screenshot = browserScreenshot(result)
    if (screenshot) {
      return {
        content: [
          {
            type: 'image',
            data: screenshot.data,
            mimeType: `image/${screenshot.format}`
          }
        ],
        structuredContent: { format: screenshot.format },
        isError: false
      }
    }
  }
  if (!isError && operation === 'browser.pdf') {
    const data = browserPdf(result)
    if (data) {
      return {
        content: [
          {
            type: 'resource',
            resource: {
              uri: 'orca://canvas/browser.pdf',
              mimeType: 'application/pdf',
              blob: data
            }
          }
        ],
        structuredContent: { mimeType: 'application/pdf' },
        isError: false
      }
    }
  }
  return {
    content: [{ type: 'text', text: responseText(result) }],
    structuredContent: typeof result === 'string' ? { response: result } : result,
    isError
  }
}

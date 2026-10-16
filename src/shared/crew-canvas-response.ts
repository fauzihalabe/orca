export function isCrewCanvasErrorResponse(value: unknown): value is string {
  return typeof value === 'string' && /^\s*erro(?:\s|:)/i.test(value)
}

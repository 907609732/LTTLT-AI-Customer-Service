import type { ScreenPoint } from '../src/shared/contracts/desktop'

/** 数值必须有限，拒绝 NaN、Infinity 和畸形对象，避免原生窗口 API 崩溃。 */
export function isScreenPoint(value: unknown): value is ScreenPoint {
  if (!value || typeof value !== 'object') return false
  const point = value as Partial<ScreenPoint>
  return (
    typeof point.screenX === 'number' &&
    typeof point.screenY === 'number' &&
    Number.isFinite(point.screenX) &&
    Number.isFinite(point.screenY) &&
    Math.abs(point.screenX) <= 100000 &&
    Math.abs(point.screenY) <= 100000
  )
}

export function isExternalUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 8192) return false
  try {
    const url = new URL(value)
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password
  } catch {
    return false
  }
}

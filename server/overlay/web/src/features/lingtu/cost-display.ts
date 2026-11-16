// The server rounds each call to integer microyuan; display never rounds it to cents.
export function formatCostMicros(value: number | undefined): string {
  if (value === undefined || !Number.isSafeInteger(value) || value < 0) {
    return '—'
  }
  return `¥${Math.floor(value / 1000000)}.${String(value % 1000000).padStart(6, '0')}`
}

export function costStatusMessage(status: string | undefined): string {
  switch (status) {
    case 'unknown_usage':
      return 'Cost unavailable: usage not returned'
    case 'missing_price':
      return 'Cost unavailable: model prices not configured'
    case 'cache_usage_unknown':
      return 'Cost unavailable: cache usage not returned'
    case 'invalid_price':
      return 'Cost unavailable: invalid price snapshot'
    case 'cost_overflow':
      return 'Cost unavailable: amount exceeds supported range'
    case 'pending':
      return 'Cost estimate pending'
    default:
      return 'Cost unavailable: no historical price snapshot'
  }
}

export function validCostPrice(value: string): boolean {
  if (value === '') return true
  return (
    /^(0|[1-9][0-9]{0,6})(\.[0-9]{1,6})?$/.test(value) &&
    Number(value) <= 1000000
  )
}

export function formatCNY(value?: string) {
  if (value === undefined || value === '') return '—'
  const amount = Number(value)
  if (!Number.isFinite(amount) || amount < 0) return '—'
  if (amount > 0 && amount < 0.000001) return '< ¥0.000001'
  return `¥${amount.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 6 })}`
}

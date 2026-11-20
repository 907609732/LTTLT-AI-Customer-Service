/**
 * 套餐额度说明的纯展示帮助：中文读数、每千次费用和同金额额度比较。
 *
 * 只消费服务端已校验的 amount（分）/calls 快照，不参与价格、订单或额度计算。
 * 非法输入返回空串，保留原数字展示，避免为了“看起来划算”编造中文或百分比。
 */
const DIGITS = '零一二三四五六七八九'
const SMALL_UNITS = ['', '十', '百', '千']
const GROUP_UNITS = ['', '万', '亿']
/** 当前套餐上限为一百万；为常见中间零留出余量，超出即安全退化。 */
const MAX_CHINESE_CALLS = 99_999_999
/** 与服务端默认体验包一致的稳定标识，仅用于挑选比较基准。 */
export const EXPERIENCE_PLAN_ID = 'usage_1000'

export interface PlanValue {
  id: string
  amount: number
  calls: number
}

function positive(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0
}

function groupText(group: number): string {
  let text = ''
  let pendingZero = false
  for (let unit = 3; unit >= 0; unit--) {
    const digit = Math.floor(group / 10 ** unit) % 10
    if (digit === 0) {
      if (text) pendingZero = true
      continue
    }
    if (pendingZero) {
      text += '零'
      pendingZero = false
    }
    text += DIGITS[digit] + SMALL_UNITS[unit]
  }
  return text
}

/** 0/10/11/100/1000/10000/20000/100000/300000/1000000 及中间零。 */
export function chineseNumeral(value: number): string {
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_CHINESE_CALLS) return ''
  if (value === 0) return '零'
  const groups: number[] = []
  for (let rest = value; rest > 0; rest = Math.floor(rest / 10000)) groups.push(rest % 10000)
  let text = ''
  let pendingZero = false
  for (let index = groups.length - 1; index >= 0; index--) {
    const group = groups[index]
    if (group === 0) {
      if (text) pendingZero = true
      continue
    }
    if (text && (pendingZero || group < 1000)) text += '零'
    text += groupText(group) + GROUP_UNITS[index]
    pendingZero = false
  }
  // “十一”而不是“一十一”；只有二万/二亿读作两万/两亿，二十万仍读二十万。
  if (text.startsWith('一十')) text = text.slice(1)
  if (text.startsWith('二万') || text.startsWith('二亿')) text = `两${text.slice(1)}`
  return text
}

/** 数字保持服务端原值，中文只作括注；不可转换时不加括注。 */
export function callCountText(calls: number): string {
  const numeral = chineseNumeral(calls)
  return numeral ? `${calls}（${numeral}）次` : `${calls} 次`
}

/** 每千次调用的人民币费用；amount 为分，无法整除时标注“约”。 */
export function costPerThousand(plan: Pick<PlanValue, 'amount' | 'calls'>): string {
  const { amount, calls } = plan
  if (!positive(amount) || !positive(calls)) return ''
  // amount * 1000 / calls 是每千次的分（可能是小数分），再决定是否精确到分。
  const milliCents = amount * 1000
  const cents = Math.round(milliCents / calls)
  if (!positive(cents)) return ''
  const exact = milliCents % calls === 0
  return `${exact ? '' : '约'}¥${(cents / 100).toFixed(2)}`
}

/**
 * 同等金额按体验包实际单价能买到的调用数，再与当前套餐比较。
 * 只用已发布套餐的 amount，不使用划线原价；基准缺失或没有正收益时返回空串。
 * 百分比精确到一位小数；只有截断/近似值才标“约”，避免把约 137.659% 说成 137.7%。
 */
export function planValueComparison(plan: PlanValue, plans: readonly PlanValue[]): string {
  if (plan.id === EXPERIENCE_PLAN_ID) return ''
  const base = plans.find((item) => item.id === EXPERIENCE_PLAN_ID)
  if (!base || !positive(plan.amount) || !positive(plan.calls)) return ''
  if (!positive(base.amount) || !positive(base.calls)) return ''
  const sameMoneyCalls = (base.calls * plan.amount) / base.amount
  if (!Number.isFinite(sameMoneyCalls) || sameMoneyCalls <= 0) return ''
  const percent = (plan.calls / sameMoneyCalls - 1) * 100
  if (!Number.isFinite(percent) || percent <= 0) return ''
  const tenths = Math.floor(percent * 10 + 1e-9) / 10
  if (tenths <= 0) return ''
  const exact = Math.abs(tenths - percent) < 1e-9
  const label = Number.isInteger(tenths) ? String(tenths) : tenths.toFixed(1)
  return `同等金额，较体验包${exact ? '' : '约'}多 ${label}% 额度`
}

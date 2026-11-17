import type { ReplyPacing, ReplyPacingMode } from './contracts/backend'

/** 回复间隔下拉项；顺序即界面顺序，默认项排在最前。 */
export const REPLY_PACING_OPTIONS: { value: ReplyPacingMode; label: string }[] = [
  { value: 'random-1-3', label: '1～3 秒随机（默认）' },
  { value: 'random-2-3', label: '2～3 秒随机' },
  { value: 'custom', label: '自定义随机范围' },
  { value: 'fixed-1', label: '固定 1 秒' },
]

/** 后台与界面共用的范围边界：至少 1 秒，最多 3600 秒。 */
export const REPLY_PACING_LIMITS = { minSeconds: 1, maxSeconds: 3600 } as const

export interface ReplyPacingRange {
  minSeconds: number
  maxSeconds: number
}

/** 模式对应的实际随机范围；自定义范围已由保存边界校验过 min<=max。 */
export function replyPacingRange(pacing: ReplyPacing): ReplyPacingRange {
  switch (pacing.mode) {
    case 'random-2-3':
      return { minSeconds: 2, maxSeconds: 3 }
    case 'custom':
      return { minSeconds: pacing.customMinSeconds, maxSeconds: pacing.customMaxSeconds }
    case 'fixed-1':
      return { minSeconds: 1, maxSeconds: 1 }
    default:
      return { minSeconds: 1, maxSeconds: 3 }
  }
}

/** 供设置页“当前值”与保存结果使用的简短说明。 */
export function describeReplyPacing(pacing: ReplyPacing): string {
  const range = replyPacingRange(pacing)
  return range.minSeconds === range.maxSeconds
    ? `固定 ${range.minSeconds} 秒`
    : `${range.minSeconds}～${range.maxSeconds} 秒随机`
}

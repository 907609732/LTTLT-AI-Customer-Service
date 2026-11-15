/** 保留已有合法间隔，仅修正低于新最小值的旧配置。 */
export function normalizeReplyInterval(milliseconds: number): number {
  return Math.max(1000, milliseconds)
}
export function validateReplyInterval(seconds: unknown): void {
  if (typeof seconds !== 'number' || !Number.isInteger(seconds) || seconds < 1 || seconds > 3600)
    throw new Error('AI 回复最少间隔须为 1～3600 的整数秒')
}

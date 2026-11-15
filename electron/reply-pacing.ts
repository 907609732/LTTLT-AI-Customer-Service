/** 兼容旧版默认60秒和不限制值；保留其他已自定义的合法间隔。 */
export function normalizeReplyInterval(milliseconds: number): number {
  return milliseconds === 60000 ? 1000 : Math.max(1000, milliseconds)
}

export function validateReplyInterval(seconds: unknown): void {
  if (typeof seconds !== 'number' || !Number.isInteger(seconds) || seconds < 1 || seconds > 3600)
    throw new Error('AI 回复最少间隔须为 1～3600 的整数秒')
}

import { expect, it } from 'vitest'
import { normalizeReplyInterval, validateReplyInterval } from '../electron/reply-pacing'
it('迁移不限制，保留已有60秒和自定义间隔', () => {
  expect(normalizeReplyInterval(60000)).toBe(60000)
  expect(normalizeReplyInterval(0)).toBe(1000)
  expect(normalizeReplyInterval(15000)).toBe(15000)
})
it('后台强制1至3600整数秒', () => {
  for (const value of [0, -1, 0.5, 3601, null, '1'])
    expect(() => validateReplyInterval(value)).toThrow()
  for (const value of [1, 15, 3600]) expect(() => validateReplyInterval(value)).not.toThrow()
})

import { expect, it } from 'vitest'
import { normalizeReplyInterval, validateReplyInterval } from '../electron/reply-pacing'

it('新版默认1秒，旧默认60秒和不限制迁移为1秒，自定义值保留', () => {
  expect(normalizeReplyInterval(60000)).toBe(1000)
  expect(normalizeReplyInterval(0)).toBe(1000)
  expect(normalizeReplyInterval(15000)).toBe(15000)
  expect(normalizeReplyInterval(1000)).toBe(1000)
})
it('后台拒绝小于1秒和非整数，保留原上限', () => {
  for (const value of [0, -1, 0.5, 3601, null, '1'])
    expect(() => validateReplyInterval(value)).toThrow()
  for (const value of [1, 15, 3600]) expect(() => validateReplyInterval(value)).not.toThrow()
})

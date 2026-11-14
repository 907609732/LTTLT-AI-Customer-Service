import { expect, it } from 'vitest'
import { createAssistAlertTracker, relativeTime } from '../src/modules/auxiliary/assist-model'
it('提醒基线不响，新事项只响一次，切工作区不重播历史', () => {
  const tracker = createAssistAlertTracker()
  expect(tracker.update('a', ['pending:1'])).toBe(false)
  expect(tracker.update('a', ['pending:1', 'pending:2'])).toBe(true)
  expect(tracker.update('a', ['pending:1', 'pending:2'])).toBe(false)
  expect(tracker.update('b', ['pending:1', 'pending:2'])).toBe(false)
})
it('无效时间不编造刚刚，未来时间不显示负值', () => {
  expect(relativeTime(0)).toBe('时间未知')
  expect(relativeTime(100, 50)).toBe('刚刚')
})
it('当前事项超过2000时重复快照不会被历史淘汰策略反复提醒', () => {
  const tracker = createAssistAlertTracker(),
    events = Array.from({ length: 2001 }, (_, index) => `item-${index}`)
  expect(tracker.update('a', events)).toBe(false)
  expect(tracker.update('a', events)).toBe(false)
  expect(tracker.update('a', events)).toBe(false)
  expect(tracker.update('a', [...events, 'new-item'])).toBe(true)
})

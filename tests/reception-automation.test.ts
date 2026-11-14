import { describe, it, expect } from 'vitest'
import { ReceptionAutomation } from '../electron/reception-automation-runtime'
import { ReceptionScheduler } from '../electron/scheduler-runtime'
const now = Date.parse('2026-11-14T00:00:00Z')
function setup() {
  const scheduler = new ReceptionScheduler({
    workspaceId: 'w',
    load: () => undefined,
    save: () => {},
    now: () => now,
    capability: () => '',
  })
  const automation = new ReceptionAutomation({
    scheduler,
    load: () => undefined,
    save: () => {},
    now: () => now,
  })
  automation.saveRule({
    id: 'r',
    storeId: 's',
    enabled: true,
    trigger: 'visitor',
    actions: [
      { kind: 'welcome-text', text: '您好' },
      { kind: 'welcome-image', url: 'https://example.com/image.png' },
    ],
  })
  return { scheduler, automation }
}
const visitor = {
  type: 'visitor' as const,
  id: 'visit-1',
  storeId: 's',
  uid: 'u',
  observedAt: now,
  sessionId: 'page1',
  messageCount: 0 as const,
}
describe('接待事件只产生有界待确认事项', () => {
  it('无消息访客一次生成独立文字/媒体事项，重复事件不重复', () => {
    const { scheduler, automation } = setup()
    expect(automation.observe(visitor)).toBe(2)
    expect(automation.observe(visitor)).toBe(0)
    expect(scheduler.snapshot().runs.map((r) => r.action.kind)).toEqual([
      'welcome-text',
      'welcome-image',
    ])
  })
  it('非空会话、旧事件、未来事件不冒充访客进入', () => {
    const { scheduler, automation } = setup()
    expect(() => automation.observe({ ...visitor, messageCount: 1 })).toThrow()
    expect(() => automation.observe({ ...visitor, observedAt: now - 600001 })).toThrow(/过期/)
    expect(() => automation.observe({ ...visitor, observedAt: now + 10000 })).toThrow(/时间/)
    expect(scheduler.snapshot().runs).toEqual([])
  })
  it('跨店事件不触发；已停用规则不触发', () => {
    const { automation } = setup()
    expect(automation.observe({ ...visitor, storeId: 'other' })).toBe(0)
    automation.setEnabled('r', false)
    expect(automation.observe(visitor)).toBe(0)
  })
  it('催付需实际未付款订单，客服转接需名单中存在的目标', () => {
    const { automation, scheduler } = setup()
    automation.saveRule({
      id: 'pay',
      storeId: 's',
      enabled: true,
      trigger: 'unpaid-order',
      actions: [{ kind: 'payment-reminder', text: '请核对订单', orderId: 'order' }],
    })
    expect(() =>
      automation.observe({
        type: 'unpaid-order',
        id: 'p',
        storeId: 's',
        uid: 'u',
        observedAt: now,
        orderId: 'order',
        status: 'paid',
      }),
    ).toThrow()
    expect(
      automation.observe({
        type: 'unpaid-order',
        id: 'p',
        storeId: 's',
        uid: 'u',
        observedAt: now,
        orderId: 'order',
        status: 'unpaid',
      }),
    ).toBe(1)
    automation.saveRule({
      id: 'transfer',
      storeId: 's',
      enabled: true,
      trigger: 'transfer-request',
      actions: [{ kind: 'transfer', agentId: 'a' }],
    })
    expect(
      automation.observe({
        type: 'transfer-request',
        id: 't',
        storeId: 's',
        uid: 'u',
        observedAt: now,
        availableAgentIds: ['other'],
      }),
    ).toBe(0)
    expect(scheduler.snapshot().runs).toHaveLength(1)
  })
})

import { describe, it, expect } from 'vitest'
import { ReceptionAutomation } from '../electron/reception-automation-runtime'
import { createFileReceptionAutomation } from '../electron/reception-automation-storage'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
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
  it('催付模板不绑定旧订单，始终采用当前可信事件订单', () => {
    const { automation, scheduler } = setup()
    expect(() =>
      automation.saveRule({
        id: 'pay-template',
        storeId: 's',
        enabled: true,
        trigger: 'unpaid-order',
        actions: [{ kind: 'payment-reminder', text: '请核对订单' }],
      }),
    ).not.toThrow()
    automation.observe({
      type: 'unpaid-order',
      id: 'new-order-event',
      storeId: 's',
      uid: 'u',
      observedAt: now,
      orderId: 'new-order',
      status: 'unpaid',
    })
    expect(scheduler.snapshot().runs[0].action).toEqual({
      kind: 'payment-reminder',
      text: '请核对订单',
      orderId: 'new-order',
    })
  })
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
      actions: [{ kind: 'payment-reminder', text: '请核对订单' }],
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

describe('接待规则的账号加密存储', () => {
  it('规则正文不明文落盘，重启同账号恢复但不同密钥拒绝读取', () => {
    const directory = mkdtempSync(join(tmpdir(), 'lingtu-reception-rules-'))
    const key = randomBytes(32)
    const encryption = {
      isEncryptionAvailable: () => true,
      encryptString: (value: string) => {
        const iv = randomBytes(12),
          cipher = createCipheriv('aes-256-gcm', key, iv)
        const content = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
        return Buffer.concat([iv, cipher.getAuthTag(), content])
      },
      decryptString: (value: Buffer) => {
        const decipher = createDecipheriv('aes-256-gcm', key, value.subarray(0, 12))
        decipher.setAuthTag(value.subarray(12, 28))
        return Buffer.concat([decipher.update(value.subarray(28)), decipher.final()]).toString(
          'utf8',
        )
      },
    }
    try {
      const { scheduler } = setup()
      const first = createFileReceptionAutomation({ directory, scheduler, encryption })
      first.saveRule({
        id: 'private-rule',
        storeId: 's',
        enabled: false,
        trigger: 'visitor',
        actions: [{ kind: 'welcome-text', text: '不应明文落盘的本店欢迎语' }],
      })
      expect(readFileSync(join(directory, 'reception-rules.json'), 'utf8')).not.toContain(
        '不应明文落盘',
      )
      const restored = createFileReceptionAutomation({ directory, scheduler, encryption })
      expect(restored.snapshot()[0].actions).toEqual([
        { kind: 'welcome-text', text: '不应明文落盘的本店欢迎语' },
      ])
      expect(() =>
        createFileReceptionAutomation({
          directory,
          scheduler,
          encryption: {
            ...encryption,
            decryptString: () => {
              throw Error('wrong account')
            },
          },
        }),
      ).toThrow()
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
  it('系统加密不可用时拒绝写入而不降级为明文', () => {
    const directory = mkdtempSync(join(tmpdir(), 'lingtu-reception-no-crypto-'))
    try {
      const { scheduler } = setup()
      const automation = createFileReceptionAutomation({
        directory,
        scheduler,
        encryption: {
          isEncryptionAvailable: () => false,
          encryptString: () => {
            throw Error('should not encrypt')
          },
          decryptString: () => {
            throw Error('should not decrypt')
          },
        },
      })
      expect(() =>
        automation.saveRule({
          id: 'r',
          storeId: 's',
          enabled: false,
          trigger: 'visitor',
          actions: [{ kind: 'welcome-text', text: 'hello' }],
        }),
      ).toThrow(/加密/)
      expect(automation.snapshot()).toEqual([])
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
})

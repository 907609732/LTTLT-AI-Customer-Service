import { describe, it, expect } from 'vitest'
import { ReceptionAutomation } from '../electron/reception-automation-runtime'
import { ReceptionScheduler } from '../electron/scheduler-runtime'
import { ReceptionOperationsService } from '../electron/reception-operation-service'
import type {
  PlatformOperationsPort,
  ReceptionEvent,
} from '../src/shared/contracts/platform-operations'
const now = Date.parse('2026-11-14T00:00:00Z')
function setup() {
  let stores = ['s']
  let events: ReceptionEvent[] = []
  let available = true
  const writes: string[] = []
  const scheduler = new ReceptionScheduler({
    workspaceId: 'w',
    load: () => undefined,
    save: () => {},
    now: () => now,
  })
  const automation = new ReceptionAutomation({
    scheduler,
    load: () => undefined,
    save: () => {},
    now: () => now,
  })
  const port: PlatformOperationsPort = {
    read: async (scope) => ({
      storeId: scope.storeId,
      storeName: '真实店铺',
      accountId: 'account',
      observedAt: now,
      capabilities: [
        {
          kind: 'payment-reminder',
          available,
          reason: available ? '真实平台订单与按钮' : '平台没有暴露此能力',
        },
      ],
      buyers: [{ uid: 'u', name: '真实买家' }],
      orders: [{ orderId: 'order-new', uid: 'u', label: '当前未付订单', status: 'unpaid' }],
      agents: [{ agentId: 'agent', name: '真实客服', online: true }],
    }),
    observe: async () => events,
    prepare: async (input) =>
      available
        ? {
            status: 'ready',
            prepared: {
              runId: input.runId,
              action: input.action,
              target: {
                storeId: 's',
                storeName: '真实店铺',
                uid: 'u',
                buyerName: '真实买家',
                accountId: 'account',
                pageId: 'page',
              },
              basis: {
                accountId: 'account',
                pageId: 'page',
                storeRevision: '1',
                conversationRevision: '1',
              },
              preparedAt: now,
              expiresAt: now + 600000,
              orderLabel: '当前未付订单',
              evidence: [{ id: 'e', observedAt: now, description: '本订单实际未付款' }],
            },
          }
        : { status: 'blocked', reason: '平台没有暴露此能力' },
    revalidate: async () => ({ status: 'valid' }),
    execute: async (prepared) => {
      writes.push(prepared.runId)
      return {
        status: 'confirmed',
        reason: '准确回显',
        evidence: { id: 'echo', observedAt: now, description: '准确目标平台确认' },
      }
    },
  }
  const service = new ReceptionOperationsService({
    workspaceId: 'w',
    stores: () => stores,
    scheduler,
    automation,
    port,
    now: () => now,
  })
  return {
    service,
    scheduler,
    automation,
    port,
    writes,
    events: (value: ReceptionEvent[]) => {
      events = value
    },
    unavailable: () => {
      available = false
    },
    stores: (value: string[]) => {
      stores = value
    },
  }
}
describe('接待平台事实、规则、批准的领域装配', () => {
  it('真实可转接名单接受在线未知，不要求捏造online=true', async () => {
    const f = setup(),
      original = f.port.read
    f.port.read = async (scope) => ({
      ...(await original(scope)),
      agents: [{ agentId: 'native', name: '原生可转接客服', online: null, canTransfer: true }],
    })
    await expect(
      f.service.execute({
        type: 'save-rule',
        workspaceId: 'w',
        rule: {
          id: 'native-transfer',
          storeId: 's',
          enabled: false,
          trigger: 'transfer-request',
          actions: [{ kind: 'transfer', agentId: 'native' }],
        },
      }),
    ).resolves.toMatchObject({ rules: [{ actions: [{ agentId: 'native' }] }] })
  })
  it('空归档或空买家列表不会被推断为无消息访客', async () => {
    const f = setup()
    await f.service.execute({
      type: 'save-rule',
      workspaceId: 'w',
      rule: {
        id: 'welcome',
        storeId: 's',
        enabled: true,
        trigger: 'visitor',
        actions: [{ kind: 'welcome-text', text: '欢迎' }],
      },
    })
    await f.service.poll()
    expect((await f.service.snapshot()).runs).toEqual([])
    expect(f.writes).toEqual([])
  })
  it('可信新订单触发模板，准备准确订单并等待单项批准', async () => {
    const f = setup()
    await f.service.execute({
      type: 'save-rule',
      workspaceId: 'w',
      rule: {
        id: 'pay',
        storeId: 's',
        enabled: true,
        trigger: 'unpaid-order',
        actions: [{ kind: 'payment-reminder', text: '请核对' }],
      },
    })
    f.events([
      {
        type: 'unpaid-order',
        id: 'event',
        storeId: 's',
        uid: 'u',
        observedAt: now,
        orderId: 'order-new',
        status: 'unpaid',
      },
    ])
    await f.service.poll()
    const snapshot = await f.service.snapshot(),
      run = snapshot.runs[0]
    expect(run).toMatchObject({
      state: 'pending',
      action: { kind: 'payment-reminder', orderId: 'order-new' },
      prepared: { orderLabel: '当前未付订单' },
    })
    expect(f.writes).toEqual([])
    const next = await f.service.execute({
      type: 'approve',
      workspaceId: 'w',
      id: run.id,
      approvalId: run.approvalId!,
    })
    expect(next.runs[0].state).toBe('confirmed')
    expect(f.writes).toEqual([run.id])
  })
  it('不允许跨店规则、跨工作区命令或伪造事件调用', async () => {
    const f = setup()
    await expect(
      f.service.execute({
        type: 'save-rule',
        workspaceId: 'w',
        rule: {
          id: 'x',
          storeId: 'foreign',
          enabled: true,
          trigger: 'visitor',
          actions: [{ kind: 'welcome-text', text: '欢迎' }],
        },
      }),
    ).rejects.toThrow(/店铺/)
    await expect(f.service.execute({ type: 'refresh', workspaceId: 'other' })).rejects.toThrow(
      /工作区/,
    )
    await expect(
      f.service.execute({ type: 'observe', workspaceId: 'w', messageCount: 0 }),
    ).rejects.toThrow()
  })
  it('未提供平台能力时保存规则但明确阻塞，不伪造完成', async () => {
    const f = setup()
    f.unavailable()
    await f.service.execute({
      type: 'save-rule',
      workspaceId: 'w',
      rule: {
        id: 'pay',
        storeId: 's',
        enabled: true,
        trigger: 'unpaid-order',
        actions: [{ kind: 'payment-reminder', text: '请核对' }],
      },
    })
    f.events([
      {
        type: 'unpaid-order',
        id: 'event',
        storeId: 's',
        uid: 'u',
        observedAt: now,
        orderId: 'order-new',
        status: 'unpaid',
      },
    ])
    await f.service.poll()
    const snapshot = await f.service.snapshot()
    expect(snapshot.runs[0]).toMatchObject({ state: 'blocked', reason: '平台没有暴露此能力' })
    expect(f.writes).toEqual([])
  })
  it('规则版本冲突不覆盖已保存设置，转接只能选真实在线客服', async () => {
    const f = setup()
    const rule = {
      id: 't',
      storeId: 's',
      enabled: false,
      trigger: 'transfer-request',
      actions: [{ kind: 'transfer', agentId: 'invented' }],
    }
    await expect(f.service.execute({ type: 'save-rule', workspaceId: 'w', rule })).rejects.toThrow(
      /客服/,
    )
    rule.actions[0].agentId = 'agent'
    await f.service.execute({ type: 'save-rule', workspaceId: 'w', rule })
    await f.service.execute({
      type: 'save-rule',
      workspaceId: 'w',
      rule: { ...rule, revision: 1, enabled: true },
    })
    await expect(
      f.service.execute({ type: 'save-rule', workspaceId: 'w', rule: { ...rule, revision: 1 } }),
    ).rejects.toThrow(/更新/)
  })
})

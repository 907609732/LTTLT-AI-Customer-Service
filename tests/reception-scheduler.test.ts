import { describe, it, expect } from 'vitest'
import { ReceptionScheduler, nextOccurrence } from '../electron/scheduler-runtime'
import type { SchedulerState, SchedulerTaskInput } from '../src/shared/contracts/scheduler'
const now = Date.parse('2026-11-14T00:00:00Z')
const task = (extra: Partial<SchedulerTaskInput> = {}): SchedulerTaskInput => ({
  name: '欢迎',
  storeId: 's1',
  uid: 'u1',
  enabled: true,
  action: { kind: 'welcome-text', text: '您好' },
  schedule: { type: 'once', at: now + 1000 },
  ...extra,
})
function setup(initial?: SchedulerState, capability = '') {
  let saved: SchedulerState | undefined = initial
  const scheduler = new ReceptionScheduler({
    workspaceId: 'workspace',
    load: () => saved,
    save: (state) => {
      saved = structuredClone(state)
    },
    capability: () => capability,
    now: () => now,
  })
  return { scheduler, saved: () => saved! }
}
describe('审批事项调度，不调用发送', () => {
  it('到点仅建立一次待提交确认事项，重复 tick 不重复', () => {
    const { scheduler } = setup()
    scheduler.execute({ type: 'save', workspaceId: 'workspace', task: task() })
    scheduler.tick(now + 1000)
    scheduler.tick(now + 2000)
    expect(scheduler.snapshot().runs).toHaveLength(1)
    expect(scheduler.snapshot().runs[0].state).toBe('pending')
    expect(scheduler.snapshot().tasks[0].enabled).toBe(false)
  })
  it('未接入能力记录阻塞，不宣称执行完成', () => {
    const { scheduler } = setup(undefined, '没有访客来源')
    scheduler.execute({ type: 'save', workspaceId: 'workspace', task: task() })
    scheduler.tick(now + 1000)
    expect(scheduler.snapshot().runs[0]).toMatchObject({ state: 'blocked', reason: '没有访客来源' })
  })
  it('重启保留执行记录并取消未批准事项，不重放发送', () => {
    const { scheduler, saved } = setup()
    scheduler.execute({ type: 'save', workspaceId: 'workspace', task: task() })
    scheduler.tick(now + 1000)
    const restored = setup(saved()).scheduler
    restored.tick(now + 10000)
    expect(restored.snapshot().runs).toHaveLength(1)
    expect(restored.snapshot().runs[0].state).toBe('cancelled')
  })
  it('停用及删除任务取消旧事项，版本冲突不覆盖', () => {
    const { scheduler } = setup()
    scheduler.execute({
      type: 'save',
      workspaceId: 'workspace',
      task: task({ schedule: { type: 'interval', minutes: 1 } }),
    })
    scheduler.tick(now + 60000)
    const row = scheduler.snapshot().tasks[0]
    scheduler.execute({
      type: 'enable',
      workspaceId: 'workspace',
      id: row.id,
      revision: row.revision,
      enabled: false,
    })
    expect(scheduler.snapshot().runs[0].state).toBe('cancelled')
    expect(() =>
      scheduler.execute({
        type: 'remove',
        workspaceId: 'workspace',
        id: row.id,
        revision: row.revision,
      }),
    ).toThrow(/更新/)
  })
  it('离线错过的重复周期合并为一次，不补发历史', () => {
    const { scheduler } = setup()
    scheduler.execute({
      type: 'save',
      workspaceId: 'workspace',
      task: task({ schedule: { type: 'interval', minutes: 1 } }),
    })
    scheduler.tick(now + 24 * 3600000)
    expect(scheduler.snapshot().runs).toHaveLength(1)
    expect(scheduler.snapshot().tasks[0].nextAt).toBe(now + 24 * 3600000 + 60000)
  })
  it('跨工作区命令和过期一次性任务被拒绝', () => {
    const { scheduler } = setup()
    expect(() => scheduler.execute({ type: 'save', workspaceId: 'other', task: task() })).toThrow(
      /工作区/,
    )
    expect(() =>
      scheduler.execute({
        type: 'save',
        workspaceId: 'workspace',
        task: task({ schedule: { type: 'once', at: now } }),
      }),
    ).toThrow(/未来/)
  })
  it('持久化失败不发布未保存状态', () => {
    const scheduler = new ReceptionScheduler({
      workspaceId: 'workspace',
      load: () => undefined,
      save: () => {
        throw Error('disk')
      },
      now: () => now,
    })
    expect(() =>
      scheduler.execute({ type: 'save', workspaceId: 'workspace', task: task() }),
    ).toThrow('disk')
    expect(scheduler.snapshot().tasks).toEqual([])
  })
  it('按明确时区计算每天时刻，夏令时重复小时每天只触发一次', () => {
    expect(nextOccurrence({ type: 'daily', time: '09:00', timezone: 'Asia/Shanghai' }, now)).toBe(
      Date.parse('2026-11-14T01:00:00Z'),
    )
    const first = Date.parse('2026-11-01T05:30:00Z')
    expect(
      nextOccurrence({ type: 'daily', time: '01:30', timezone: 'America/New_York' }, first),
    ).toBe(Date.parse('2026-11-02T06:30:00Z'))
  })
})

describe('调度权限与事件恢复', () => {
  it('事件去重跨workspace实例令牌重建保持，旧待办不恢复', () => {
    const { scheduler: first, saved } = setup()
    const event = {
      key: 'session',
      ruleId: 'rule',
      storeId: 's1',
      uid: 'u1',
      actions: [{ kind: 'welcome-text' as const, text: '您好' }],
    }
    expect(first.enqueueEvent(event)).toBe(1)
    const restored = new ReceptionScheduler({
      workspaceId: 'new-token',
      load: () => saved(),
      save: () => {},
      now: () => now,
      capability: () => '',
    })
    expect(restored.enqueueEvent(event)).toBe(0)
  })
  it('保存校验拒绝外部店铺；到点重新核对已移除会话', () => {
    let valid = true
    const scheduler = new ReceptionScheduler({
      workspaceId: 'workspace',
      load: () => undefined,
      save: () => {},
      now: () => now,
      capability: () => '',
      validateTask: (row) => {
        if (!valid || row.storeId !== 's1') throw Error('店铺或会话不存在')
      },
    })
    expect(() =>
      scheduler.execute({
        type: 'save',
        workspaceId: 'workspace',
        task: task({ storeId: 'foreign' }),
      }),
    ).toThrow(/不存在/)
    scheduler.execute({ type: 'save', workspaceId: 'workspace', task: task() })
    valid = false
    scheduler.tick(now + 1000)
    expect(scheduler.snapshot().runs[0].state).toBe('blocked')
  })
  it('取消及过期不会被下次轮询恢复', () => {
    const { scheduler } = setup()
    scheduler.execute({ type: 'save', workspaceId: 'workspace', task: task() })
    scheduler.tick(now + 1000)
    scheduler.tick(now + 601000)
    expect(scheduler.snapshot().runs[0].state).toBe('expired')
    expect(() =>
      scheduler.execute({
        type: 'cancel',
        workspaceId: 'workspace',
        id: scheduler.snapshot().runs[0].id,
      }),
    ).toThrow(/过期/)
  })
})

describe('事件队列容量', () => {
  it('历史剩余空间为零时丢弃历史，保留全部待办；超过容量不写入', () => {
    let blocked = true
    const scheduler = new ReceptionScheduler({
      workspaceId: 'w',
      load: () => undefined,
      save: () => {},
      now: () => now,
      capability: () => (blocked ? '未接入' : ''),
    })
    const event = (key: string) => ({
      key,
      ruleId: 'r',
      storeId: 's',
      uid: 'u',
      actions: Array.from({ length: 5 }, () => ({ kind: 'welcome-text' as const, text: '您好' })),
    })
    scheduler.enqueueEvent(event('history'))
    blocked = false
    for (let i = 0; i < 99; i++) scheduler.enqueueEvent(event(String(i)))
    expect(scheduler.snapshot().runs).toHaveLength(500)
    expect(scheduler.enqueueEvent(event('last'))).toBe(5)
    expect(scheduler.snapshot().runs.every((r) => r.state === 'pending')).toBe(true)
    expect(scheduler.snapshot().runs).toHaveLength(500)
    expect(() => scheduler.enqueueEvent(event('overflow'))).toThrow(/已满/)
    expect(scheduler.snapshot().runs).toHaveLength(500)
  })
})

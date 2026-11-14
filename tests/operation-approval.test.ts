import { describe, it, expect } from 'vitest'
import { ReceptionScheduler } from '../electron/scheduler-runtime'
import { ReceptionOperationExecutor } from '../electron/reception-operation-executor'
import type { SchedulerState } from '../src/shared/contracts/scheduler'
import type {
  PlatformOperationsPort,
  PlatformOperationValidation,
  PlatformOperationResult,
  PreparedPlatformOperation,
} from '../src/shared/contracts/platform-operations'

const start = Date.parse('2026-11-14T00:00:00Z')
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}
function setup() {
  let now = start
  let saved: SchedulerState | undefined
  let validation: PlatformOperationValidation = { status: 'valid' }
  let result: PlatformOperationResult = {
    status: 'confirmed',
    reason: '对应买家卖家回显已核对',
    evidence: { id: 'echo', observedAt: start, description: '本买家新增同文卖家回显' },
  }
  const writes: PreparedPlatformOperation[] = []
  const scheduler = new ReceptionScheduler({
    workspaceId: 'w',
    load: () => undefined,
    save: (state) => {
      saved = structuredClone(state)
    },
    now: () => now,
    capability: () => '',
  })
  const port: PlatformOperationsPort = {
    read: async () => ({
      storeId: 's',
      storeName: '本店',
      accountId: 'account',
      observedAt: now,
      buyers: [{ uid: 'u', name: '买家甲' }],
      orders: [],
      agents: [],
      capabilities: [],
    }),
    observe: async () => [],
    prepare: async (input) => ({
      status: 'ready',
      prepared: {
        runId: input.runId,
        action: input.action,
        target: {
          storeId: input.storeId,
          storeName: '本店',
          uid: input.uid,
          buyerName: '买家甲',
          accountId: 'account',
          pageId: 'page',
        },
        basis: {
          accountId: 'account',
          pageId: 'page',
          conversationRevision: 'messages-1',
          storeRevision: 'store-1',
        },
        preparedAt: now,
        expiresAt: now + 600000,
        evidence: [{ id: 'read', observedAt: now, description: '对应店铺与买家页面基线' }],
      },
    }),
    revalidate: async () => validation,
    execute: async (prepared, guard) => {
      if (!guard.isCurrent()) return { status: 'failed', reason: '操作已经失效' }
      writes.push(prepared)
      return result
    },
    inspect: async () => result,
  }
  const executor = new ReceptionOperationExecutor({
    workspaceId: 'w',
    scheduler,
    port,
    now: () => now,
  })
  const enqueue = (key = 'first') => {
    scheduler.enqueueEvent({
      key,
      ruleId: 'rule',
      storeId: 's',
      uid: 'u',
      actions: [{ kind: 'welcome-text', text: '最终欢迎语' }],
    })
    return scheduler.snapshot().runs.at(-1)!.id
  }
  const approve = (id: string) =>
    executor.approve({
      workspaceId: 'w',
      id,
      approvalId: scheduler.snapshot().runs.find((r) => r.id === id)!.approvalId!,
    })
  return {
    scheduler,
    executor,
    port,
    writes,
    enqueue,
    approve,
    saved: () => saved!,
    setNow: (at: number) => {
      now = at
    },
    setValidation: (value: PlatformOperationValidation) => {
      validation = value
    },
    setResult: (value: PlatformOperationResult) => {
      result = value
    },
  }
}

describe('每项平台操作的一次批准', () => {
  it('只读准备不执行，单次批准执行准确目标和最终内容', async () => {
    const f = setup(),
      id = f.enqueue()
    await f.executor.prepare(id)
    expect(f.writes).toEqual([])
    expect(f.scheduler.snapshot().runs[0]).toMatchObject({
      state: 'pending',
      prepared: { target: { uid: 'u', buyerName: '买家甲' }, action: { text: '最终欢迎语' } },
    })
    await f.approve(id)
    expect(f.writes).toHaveLength(1)
    expect(f.writes[0]).toMatchObject({
      runId: id,
      action: { text: '最终欢迎语' },
      target: { storeId: 's', uid: 'u' },
    })
    expect(f.scheduler.snapshot().runs[0]).toMatchObject({
      state: 'confirmed',
      evidence: { id: 'echo' },
    })
    expect(f.scheduler.snapshot().runs[0].approvalId).toBeUndefined()
  })
  it('跨窗口重复批准只消费一次，跨账号批准零写动作', async () => {
    const f = setup(),
      id = f.enqueue()
    await f.executor.prepare(id)
    const approvalId = f.scheduler.snapshot().runs[0].approvalId!
    await expect(f.executor.approve({ workspaceId: 'other', id, approvalId })).rejects.toThrow(
      /工作区/,
    )
    await Promise.allSettled([
      f.executor.approve({ workspaceId: 'w', id, approvalId }),
      f.executor.approve({ workspaceId: 'w', id, approvalId }),
    ])
    expect(f.writes).toHaveLength(1)
  })
  it.each(['新买家消息', '订单已经付款', '目标客服离线', '页面或账号已切换'])(
    '%s使旧批准失效',
    async (reason) => {
      const f = setup(),
        id = f.enqueue()
      await f.executor.prepare(id)
      f.setValidation({ status: 'invalid', reason })
      await f.approve(id)
      expect(f.scheduler.snapshot().runs[0]).toMatchObject({ state: 'invalidated', reason })
      expect(f.writes).toEqual([])
    },
  )
  it('复核暂不可读不执行，旧批准不保留，重新准备前不能发送', async () => {
    const f = setup(),
      id = f.enqueue()
    await f.executor.prepare(id)
    const approvalId = f.scheduler.snapshot().runs[0].approvalId!
    f.setValidation({ status: 'unavailable', reason: '平台正在加载' })
    await f.approve(id)
    expect(f.scheduler.snapshot().runs[0].state).toBe('blocked')
    await expect(f.executor.approve({ workspaceId: 'w', id, approvalId })).rejects.toThrow()
    expect(f.writes).toEqual([])
  })
  it('过期及用户取消不会执行', async () => {
    const f = setup(),
      id = f.enqueue()
    await f.executor.prepare(id)
    f.setNow(start + 600001)
    await expect(f.approve(id)).rejects.toThrow(/过期/)
    expect(f.scheduler.snapshot().runs[0].state).toBe('expired')
    const id2 = f.enqueue('second')
    await f.executor.prepare(id2)
    f.executor.cancel(id2)
    await expect(f.approve(id2)).rejects.toThrow()
    expect(f.writes).toEqual([])
  })
  it('异步复核期间停店使发送guard失效', async () => {
    const f = setup(),
      id = f.enqueue(),
      gate = deferred<PlatformOperationValidation>()
    await f.executor.prepare(id)
    f.port.revalidate = () => gate.promise
    const pending = f.approve(id)
    await Promise.resolve()
    f.executor.invalidateStore('s', '店铺已停止')
    gate.resolve({ status: 'valid' })
    await pending
    expect(f.writes).toEqual([])
    expect(f.scheduler.snapshot().runs[0].state).toBe('uncertain')
  })
  it('结果未知进入待核对，不能重新准备或重批；只读核对可以确认', async () => {
    const f = setup(),
      id = f.enqueue()
    await f.executor.prepare(id)
    f.setResult({ status: 'uncertain', reason: '点击后回显读取超时' })
    await f.approve(id)
    expect(f.scheduler.snapshot().runs[0].state).toBe('uncertain')
    await expect(f.executor.prepare(id)).rejects.toThrow(/核对|状态/)
    await expect(f.approve(id)).rejects.toThrow()
    expect(f.writes).toHaveLength(1)
    f.setResult({
      status: 'confirmed',
      reason: '只读核对发现匹配回显',
      evidence: { id: 'read-back', observedAt: start, description: '准确目标与内容一致' },
    })
    await f.executor.inspect(id)
    expect(f.scheduler.snapshot().runs[0].state).toBe('confirmed')
    expect(f.writes).toHaveLength(1)
  })
  it('平台执行异常仍为待核对且不自动重试', async () => {
    const f = setup(),
      id = f.enqueue()
    await f.executor.prepare(id)
    f.port.execute = async () => {
      throw Error('timeout')
    }
    await f.approve(id)
    expect(f.scheduler.snapshot().runs[0].state).toBe('uncertain')
    await expect(f.executor.prepare(id)).rejects.toThrow()
  })
  it('执行中落盘，重启变为待核对且不会恢复批准', async () => {
    const f = setup(),
      id = f.enqueue(),
      gate = deferred<PlatformOperationResult>()
    await f.executor.prepare(id)
    f.port.execute = () => gate.promise
    const pending = f.approve(id)
    await new Promise<void>((r) => setTimeout(r, 0))
    expect(f.saved().runs[0].state).toBe('executing')
    const restored = new ReceptionScheduler({
      workspaceId: 'restart',
      load: f.saved,
      save: () => {},
      now: () => start,
    })
    expect(restored.snapshot().runs[0]).toMatchObject({ state: 'uncertain' })
    expect(restored.snapshot().runs[0].approvalId).toBeUndefined()
    gate.resolve({ status: 'uncertain', reason: '尚未核对' })
    await pending
  })
  it('不同批准串行执行，不并发占用平台页面', async () => {
    const f = setup(),
      a = f.enqueue('a'),
      b = f.enqueue('b'),
      gate = deferred<PlatformOperationResult>()
    await f.executor.prepare(a)
    await f.executor.prepare(b)
    let active = 0,
      maximum = 0,
      calls = 0
    f.port.execute = async () => {
      maximum = Math.max(maximum, ++active)
      const value =
        ++calls === 1
          ? await gate.promise
          : {
              status: 'confirmed' as const,
              reason: '准确回显',
              evidence: { id: 'echo-b', observedAt: start, description: '第二项准确回显' },
            }
      active--
      return value
    }
    const first = f.approve(a),
      second = f.approve(b)
    await new Promise<void>((r) => setTimeout(r, 0))
    expect(calls).toBe(1)
    gate.resolve({
      status: 'confirmed',
      reason: '准确回显',
      evidence: { id: 'echo-a', observedAt: start, description: '第一项准确回显' },
    })
    await Promise.all([first, second])
    expect(maximum).toBe(1)
    expect(f.scheduler.snapshot().runs.map((r) => r.state)).toEqual(['confirmed', 'confirmed'])
  })
  it('媒体未提供可信类型、大小及哈希不允许批准', async () => {
    const f = setup()
    f.scheduler.enqueueEvent({
      key: 'media',
      ruleId: 'r',
      storeId: 's',
      uid: 'u',
      actions: [{ kind: 'welcome-image', url: 'https://example.com/a.png' }],
    })
    const id = f.scheduler.snapshot().runs[0].id
    await f.executor.prepare(id)
    expect(f.scheduler.snapshot().runs[0].state).toBe('blocked')
    expect(f.scheduler.snapshot().runs[0].approvalId).toBeUndefined()
    expect(f.writes).toEqual([])
  })
  it('定时任务在异步复核期间被停用时不会继续旧操作', async () => {
    const f = setup(),
      gate = deferred<PlatformOperationValidation>()
    f.scheduler.execute({
      type: 'save',
      workspaceId: 'w',
      task: {
        name: '定时欢迎',
        storeId: 's',
        uid: 'u',
        enabled: true,
        schedule: { type: 'interval', minutes: 1 },
        action: { kind: 'welcome-text', text: '定时内容' },
      },
    })
    f.setNow(start + 60000)
    f.scheduler.tick()
    const row = f.scheduler.snapshot().tasks[0],
      id = f.scheduler.snapshot().runs[0].id
    await f.executor.prepare(id)
    f.port.revalidate = () => gate.promise
    const pending = f.approve(id)
    await Promise.resolve()
    f.scheduler.execute({
      type: 'enable',
      workspaceId: 'w',
      id: row.id,
      revision: row.revision,
      enabled: false,
    })
    gate.resolve({ status: 'valid' })
    await pending
    expect(f.writes).toEqual([])
  })
  it('未知结果的相同事件即使超过24小时去重期限也不会重建', async () => {
    const f = setup(),
      id = f.enqueue()
    await f.executor.prepare(id)
    f.setResult({ status: 'uncertain', reason: '未收到准确回显' })
    await f.approve(id)
    f.setNow(start + 86400001)
    f.enqueue()
    expect(f.scheduler.snapshot().runs).toHaveLength(1)
    expect(f.writes).toHaveLength(1)
  })
})

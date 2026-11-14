import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createAssistPlatformCollector,
  type AssistPageResult,
} from '../electron/assist-platform-collector'

const store = { id: 'store-a', storeName: '测试店', platform: 'pdd-web', identityId: 'mall-a' }
const empty = (): AssistPageResult => ({
  authenticated: true,
  identityId: 'mall-a',
  identityName: '测试店',
  recognized: true,
  items: [],
  total: 0,
  complete: true,
})
afterEach(() => vi.useRealTimers())
describe('平台只读同步', () => {
  it('未知页面不能伪装0，只有正识别空列表才能成功', async () => {
    const read = vi
      .fn()
      .mockResolvedValueOnce({ ...empty(), recognized: false })
      .mockResolvedValue(empty())
    const collector = createAssistPlatformCollector({
      workspaceId: 'workspace-a',
      stores: () => [store],
      read,
    })
    expect(collector.snapshot().stores[0].total).toBeNull()
    await collector.refresh(store.id, 'ticket')
    expect(collector.snapshot().stores[0]).toMatchObject({ status: 'error', total: null })
    await collector.refresh(store.id, 'ticket')
    expect(collector.snapshot().stores[0]).toMatchObject({
      status: 'success',
      total: 0,
      complete: true,
    })
    collector.dispose()
  })
  it('身份不符拒绝记录，登录过期准确显示未登录', async () => {
    const read = vi
      .fn()
      .mockResolvedValueOnce({ ...empty(), identityId: 'wrong-shop' })
      .mockResolvedValue({ ...empty(), authenticated: false })
    const collector = createAssistPlatformCollector({
      workspaceId: 'workspace-a',
      stores: () => [store],
      read,
    })
    await collector.refresh(store.id, 'ticket')
    expect(collector.snapshot().stores[0]).toMatchObject({
      status: 'error',
      total: null,
      items: [],
    })
    expect(collector.snapshot().stores[0].message).toContain('身份')
    await collector.refresh(store.id, 'ticket')
    expect(collector.snapshot().stores[0].status).toBe('login_required')
    collector.dispose()
  })
  it('分页重复按平台业务ID去重，读取失败保留上次记录与时间', async () => {
    const item = {
      id: 'ticket-a',
      storeId: store.id,
      platform: store.platform,
      kind: 'ticket' as const,
      title: '测试工单',
      status: '待处理',
      detailKey: 'ticket-a',
    }
    const read = vi
      .fn()
      .mockResolvedValueOnce({ ...empty(), items: [item, item], total: 1 })
      .mockRejectedValueOnce(new Error('页面暂时不可用'))
    const collector = createAssistPlatformCollector({
      workspaceId: 'workspace-a',
      stores: () => [store],
      read,
      now: () => 1000,
    })
    await collector.refresh(store.id, 'ticket')
    expect(collector.snapshot().stores[0].items).toHaveLength(1)
    await collector.refresh(store.id, 'ticket')
    expect(collector.snapshot().stores[0]).toMatchObject({
      status: 'stale',
      total: 1,
      lastSyncedAt: 1000,
      complete: false,
    })
    expect(collector.snapshot().stores[0].items).toHaveLength(1)
    collector.dispose()
  })
  it('超时保留unknown，后续迟到响应不得改写', async () => {
    vi.useFakeTimers()
    let resolve!: (value: AssistPageResult) => void
    const collector = createAssistPlatformCollector({
      workspaceId: 'workspace-a',
      stores: () => [store],
      timeoutMs: 20,
      read: () =>
        new Promise((done) => {
          resolve = done
        }),
    })
    const pending = collector.refresh(store.id, 'ticket')
    await vi.advanceTimersByTimeAsync(25)
    await pending
    expect(collector.snapshot().stores[0]).toMatchObject({ status: 'error', total: null })
    resolve(empty())
    await Promise.resolve()
    expect(collector.snapshot().stores[0].status).toBe('error')
    collector.dispose()
  })
  it('关闭/切换工作区丢弃在途响应，缓存不进入新实例', async () => {
    let resolve!: (value: AssistPageResult) => void
    const first = createAssistPlatformCollector({
      workspaceId: 'workspace-a',
      stores: () => [store],
      read: () =>
        new Promise((done) => {
          resolve = done
        }),
    })
    const pending = first.refresh(store.id, 'ticket')
    await Promise.resolve()
    first.dispose()
    resolve(empty())
    await pending
    const next = createAssistPlatformCollector({
      workspaceId: 'workspace-b',
      stores: () => [store],
      read: async () => empty(),
    })
    expect(next.snapshot()).toMatchObject({
      workspaceId: 'workspace-b',
      stores: [expect.objectContaining({ total: null, items: [] }), expect.anything()],
    })
    next.dispose()
  })
  it('自动刷新串行、关闭停止、最小化不改变活跃状态', async () => {
    vi.useFakeTimers()
    const read = vi.fn().mockResolvedValue(empty())
    const collector = createAssistPlatformCollector({
      workspaceId: 'workspace-a',
      stores: () => [store],
      read,
    })
    collector.setActive(true)
    await vi.advanceTimersByTimeAsync(1)
    expect(read).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(60000)
    expect(read).toHaveBeenCalledTimes(4)
    collector.setActive(false)
    await vi.advanceTimersByTimeAsync(120000)
    expect(read).toHaveBeenCalledTimes(4)
    collector.dispose()
  })
  it('浮窗关闭不遗留正在同步状态，迟到响应不回填', async () => {
    let resolve!: (value: AssistPageResult) => void
    const collector = createAssistPlatformCollector({
      workspaceId: 'workspace-a',
      stores: () => [store],
      read: () =>
        new Promise((done) => {
          resolve = done
        }),
    })
    collector.setActive(true)
    await Promise.resolve()
    expect(collector.snapshot().stores[0].status).toBe('syncing')
    collector.setActive(false)
    expect(collector.snapshot().stores[0].status).not.toBe('syncing')
    resolve(empty())
    await Promise.resolve()
    await Promise.resolve()
    expect(collector.snapshot().stores[0].total).toBeNull()
    collector.dispose()
  })
  it('异常总数不能标成同步成功，分页未完整不得声称全部完成', async () => {
    const read = vi
      .fn()
      .mockResolvedValueOnce({ ...empty(), total: -1 })
      .mockResolvedValueOnce({ ...empty(), total: 10, complete: true })
    const collector = createAssistPlatformCollector({
      workspaceId: 'workspace-a',
      stores: () => [store],
      read,
    })
    await collector.refresh(store.id, 'ticket')
    expect(collector.snapshot().stores[0]).toMatchObject({ status: 'error', total: null })
    await collector.refresh(store.id, 'ticket')
    expect(collector.snapshot().stores[0].complete).toBe(false)
    collector.dispose()
  })
  it('平台宣称0却有记录时拒绝矛盾结果，不伪装成功空列表', async () => {
    const item = {
      id: 'ticket-a',
      storeId: store.id,
      platform: store.platform,
      kind: 'ticket' as const,
      title: '测试工单',
      status: '待处理',
      detailKey: 'ticket-a',
    }
    const collector = createAssistPlatformCollector({
      workspaceId: 'workspace-a',
      stores: () => [store],
      read: async () => ({ ...empty(), items: [item], total: 0 }),
    })
    await collector.refresh(store.id, 'ticket')
    expect(collector.snapshot().stores[0]).toMatchObject({
      status: 'error',
      total: null,
      items: [],
      complete: false,
    })
    collector.dispose()
  })
  it('验证码暂停整店自动采集，只有手动刷新才重新尝试', async () => {
    vi.useFakeTimers()
    const read = vi
      .fn()
      .mockResolvedValue({
        ...empty(),
        authenticated: null,
        recognized: false,
        blocked: 'verification',
      })
    const collector = createAssistPlatformCollector({
      workspaceId: 'workspace-a',
      stores: () => [store],
      read,
    })
    collector.setActive(true)
    await vi.advanceTimersByTimeAsync(1)
    expect(read).toHaveBeenCalledTimes(1)
    expect(collector.snapshot().stores[0]).toMatchObject({ status: 'login_required', total: null })
    await vi.advanceTimersByTimeAsync(180000)
    expect(read).toHaveBeenCalledTimes(1)
    read.mockResolvedValue(empty())
    await collector.refresh(store.id, 'ticket')
    expect(read).toHaveBeenCalledTimes(2)
    expect(collector.snapshot().stores[0].status).toBe('success')
    collector.dispose()
  })
  it('超时在下一kind开始前取消旧读取，防止后台并行导航', async () => {
    vi.useFakeTimers()
    const activity: string[] = []
    const collector = createAssistPlatformCollector({
      workspaceId: 'workspace-a',
      stores: () => [store],
      timeoutMs: 20,
      read: async (_store, kind, signal) => {
        activity.push(`start:${kind}`)
        if (kind === 'aftersale') return empty()
        return new Promise((_resolve, reject) =>
          signal.addEventListener(
            'abort',
            () => {
              activity.push(`abort:${kind}`)
              reject(new Error('cancelled'))
            },
            { once: true },
          ),
        )
      },
    })
    const pending = collector.refresh(store.id)
    await vi.advanceTimersByTimeAsync(25)
    await pending
    expect(activity).toEqual(['start:ticket', 'abort:ticket', 'start:aftersale'])
    collector.dispose()
  })
})

import { describe, it, expect, vi, afterEach } from 'vitest'
import type { Session, WebContents } from 'electron'
import { createAssistQueryMonitor } from '../electron/assist-platform-query'

afterEach(() => vi.useRealTimers())
function fixture() {
  const callbacks = new Map<string, (details: object) => void>()
  const request = Object.fromEntries(
    ['onSendHeaders', 'onCompleted', 'onErrorOccurred'].map((name) => [
      name,
      vi.fn((_filter, callback) => {
        if (callback) callbacks.set(name, callback)
        else callbacks.delete(name)
      }),
    ]),
  )
  const session = { webRequest: request } as unknown as Session
  const page = { id: 7, session, isDestroyed: () => false } as unknown as WebContents
  const emit = (name: string, patch: object = {}) =>
    callbacks.get(name)?.({
      id: 1,
      webContentsId: 7,
      resourceType: 'xhr',
      url: 'https://mms.pinduoduo.com/fixture-query',
      statusCode: 200,
      ...patch,
    })
  return { callbacks, request, page, emit }
}
describe('平台查询原生请求完成观察', () => {
  it('页面保存的原始fetch不经过JS包装仍能确认，但不能在响应体结束前完成', async () => {
    vi.useFakeTimers()
    const f = fixture(),
      monitor = createAssistQueryMonitor()
    let finished = false
    const action = vi.fn(async () => f.emit('onSendHeaders'))
    const pending = monitor
      .run(f.page, action, async () => true)
      .then(() => {
        finished = true
      })
    await vi.advanceTimersByTimeAsync(400)
    expect(finished).toBe(false)
    f.emit('onCompleted')
    await vi.advanceTimersByTimeAsync(250)
    await pending
    expect(action).toHaveBeenCalledTimes(1)
    monitor.dispose()
  })
  it('不把其他页面、外站、静态资源和读取前的响应当查询完成', async () => {
    vi.useFakeTimers()
    const f = fixture(),
      monitor = createAssistQueryMonitor()
    const pending = expect(
      monitor.run(
        f.page,
        async () => {
          f.emit('onSendHeaders', { webContentsId: 8 })
          f.emit('onCompleted', { webContentsId: 8 })
          f.emit('onSendHeaders', { url: 'https://other.test/' })
          f.emit('onCompleted', { url: 'https://other.test/' })
          f.emit('onSendHeaders', { resourceType: 'image' })
          f.emit('onCompleted', { resourceType: 'image' })
          f.emit('onCompleted')
        },
        async () => true,
      ),
    ).rejects.toThrow('尚未确认')
    await vi.advanceTimersByTimeAsync(8100)
    await pending
    monitor.dispose()
  })
  it('失败响应不能变成同步成功，退出后取消监听', async () => {
    vi.useFakeTimers()
    const f = fixture(),
      monitor = createAssistQueryMonitor()
    const pending = expect(
      monitor.run(
        f.page,
        async () => {
          f.emit('onSendHeaders')
          f.emit('onCompleted', { statusCode: 500 })
        },
        async () => true,
      ),
    ).rejects.toThrow('请求失败')
    await vi.advanceTimersByTimeAsync(250)
    await pending
    monitor.dispose()
    expect(f.callbacks.size).toBe(0)
  })
  it('验证码检查报错立即结束，取消不执行下一轮动作', async () => {
    const f = fixture(),
      monitor = createAssistQueryMonitor()
    await expect(
      monitor.run(
        f.page,
        async () => {},
        async () => {
          throw Error('platform_verification_required')
        },
      ),
    ).rejects.toThrow('verification')
    const controller = new AbortController()
    controller.abort()
    const action = vi.fn()
    await expect(monitor.run(f.page, action, async () => true, controller.signal)).rejects.toThrow()
    expect(action).not.toHaveBeenCalled()
    monitor.dispose()
  })
})

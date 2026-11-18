import { describe, expect, it } from 'vitest'
import { PlatformWriteCoordinator } from '../electron/platform-write-coordinator'
import { configureDomTextAdapter } from '../electron/dom-text-adapter'
describe('原有文字发送与平台动作共用店铺互斥', () => {
  it('已配置网页复核的内部定位保留原始方法，不会重入同一队列死锁', async () => {
    const coordinator = new PlatformWriteCoordinator(),
      focused: string[] = []
    const raw = {
      async focusConversation(uid: string) {
        focused.push(uid)
        return { ok: true }
      },
      async sendText() {
        return { ok: true }
      },
      _wc() {
        throw Error('review must not click send')
      },
      async _callHook(method: string, args: unknown[]) {
        return {
          known: method === 'reviewHistory',
          uid: String(args[0]),
          page: 'page-a',
          messages: [{ from: 'buyer', content: '问题', media: [] }],
        }
      },
      _sendFailOrThrow() {},
    }
    const { backend, operations } = coordinator.bind(
      'store-a',
      configureDomTextAdapter('pdd-web', raw),
    )
    const review = backend as { reviewHistory(uid: string, focus: boolean): Promise<unknown> }
    await expect(review.reviewHistory('a', true)).resolves.toMatchObject({ known: true, uid: 'a' })
    await coordinator.exclusive('store-a', async () =>
      (operations as typeof review).reviewHistory('b', true),
    )
    expect(focused).toEqual(['a', 'b'])
  })
  it('文字发送在店铺锁内先定位本次买家，避免排队期间被另一位买家切走', async () => {
    const coordinator = new PlatformWriteCoordinator()
    const calls: string[] = []
    let activeUid = '222222'
    const raw = {
      async focusConversation(uid: string) {
        activeUid = uid
        calls.push('focus:' + uid)
        return { ok: true }
      },
      async sendText() {
        return { ok: true }
      },
      _wc() {
        return { focus() {}, sendInputEvent() {} }
      },
      async _callHook(method: string, args: unknown[]) {
        if (method === 'reviewHistory')
          return activeUid === String(args[0])
            ? {
                known: true,
                uid: String(args[0]),
                page: 'page-a',
                messages: [{ from: 'buyer', content: '问题', media: [] }],
              }
            : {
                known: false,
                uid: String(args[0]),
                page: 'page-a',
                messages: [],
                reason: 'different_conversation',
              }
        if (method === 'prepareNativeTextSend') {
          if (activeUid !== String(args[0])) return { ok: false, reason: 'conversation_not_found' }
          calls.push('prepare:' + String(args[0]))
          return { ok: true, token: 'token-a', point: { x: 5, y: 6 } }
        }
        if (method === 'confirmNativeTextSend') {
          calls.push('confirm:' + String(args[0]))
          return { ok: true, msgId: 'msg-a' }
        }
        return true
      },
      _sendFailOrThrow(_method: string, error: unknown) {
        throw error
      },
    }
    const { backend } = coordinator.bind('store-a', configureDomTextAdapter('pdd-web', raw))
    let release!: () => void
    const hold = coordinator.exclusive(
      'store-a',
      () =>
        new Promise<void>((resolve) => {
          release = resolve
        }),
    )
    await Promise.resolve()
    const sending = (backend as { sendText(uid: string, text: string): Promise<unknown> }).sendText(
      '111111',
      '回复正文',
    )
    await Promise.resolve()
    activeUid = '222222'
    release()
    await hold
    await expect(sending).resolves.toMatchObject({ ok: true, msgId: 'msg-a' })
    expect(calls).toEqual(['focus:111111', 'prepare:111111', 'confirm:111111'])
  })
  it('旧手动回复定位买家也排队，不能在媒体执行期间先切换页面', async () => {
    const coordinator = new PlatformWriteCoordinator(),
      order: string[] = []
    const raw = {
      async focusConversation(uid: string) {
        order.push('focus:' + uid)
        return { ok: true }
      },
      async sendText() {
        return { ok: true }
      },
    }
    const adapters = coordinator.bind('store-a', raw)
    let release!: () => void
    const media = coordinator.exclusive('store-a', async () => {
      order.push('media-start')
      await (adapters.operations as typeof raw).focusConversation('a')
      await new Promise<void>((resolve) => {
        release = resolve
      })
      order.push('media-end')
    })
    for (let i = 0; i < 5; i++) await Promise.resolve()
    const manual = raw.focusConversation('b')
    for (let i = 0; i < 5; i++) await Promise.resolve()
    expect(order).toEqual(['media-start', 'focus:a'])
    release()
    await Promise.all([media, manual])
    expect(order).toEqual(['media-start', 'focus:a', 'media-end', 'focus:b'])
  })
  it('媒体批准占用页面时旧文字入口排队，动作内部文字可安全复用原实现', async () => {
    const coordinator = new PlatformWriteCoordinator(),
      order: string[] = []
    const raw = {
      marker: 'original',
      async sendText() {
        order.push(this.marker)
        return { ok: true }
      },
    }
    const adapters = coordinator.bind('store-a', raw)
    let release!: () => void
    const hold = coordinator.exclusive('store-a', async () => {
      order.push('media-start')
      await new Promise<void>((resolve) => {
        release = resolve
      })
      await (adapters.operations as typeof raw).sendText()
      order.push('media-finish')
    })
    await Promise.resolve()
    const text = raw.sendText()
    expect(order).toEqual(['media-start'])
    release()
    await Promise.all([hold, text])
    expect(order).toEqual(['media-start', 'original', 'media-finish', 'original'])
  })
  it('关闭后取消仍在排队的文字入口，不影响正在结束的读写清理', async () => {
    const coordinator = new PlatformWriteCoordinator()
    let release!: () => void,
      writes = 0
    const first = coordinator.exclusive(
      'store-a',
      () =>
        new Promise<void>((resolve) => {
          release = resolve
        }),
    )
    await Promise.resolve()
    const second = coordinator.exclusive('store-a', async () => {
      writes++
    })
    const rejection = expect(second).rejects.toThrow('关闭')
    coordinator.dispose()
    release()
    await Promise.all([first, rejection])
    expect(writes).toBe(0)
  })
})

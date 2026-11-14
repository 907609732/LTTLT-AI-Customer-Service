import { afterEach, describe, expect, it, vi } from 'vitest'
import { configureDomTextAdapter } from '../electron/dom-text-adapter'

const snapshot = (known = true, page = 'page-a', uid = 'buyer') => ({
  known,
  uid,
  page,
  messages: known ? [{ from: 'buyer', content: '买家问题', media: [] }] : [],
  reason: known ? '' : 'messages_not_loaded',
})

function harness(read: () => unknown) {
  const focused: string[] = []
  const raw = {
    async focusConversation(uid: string) {
      focused.push(uid)
      return { ok: true }
    },
    async sendText() {},
    _wc() {
      throw Error('只读复核不得发送')
    },
    async _callHook(method: string, args: unknown[]) {
      expect(method).toBe('reviewHistory')
      expect(args).toEqual(['buyer'])
      return read()
    },
    _sendFailOrThrow() {},
  }
  const adapter = configureDomTextAdapter('pdd-web', raw) as typeof raw & {
    reviewHistory(uid: string, focus: boolean): Promise<unknown>
  }
  return { adapter, focused }
}

afterEach(() => vi.useRealTimers())

describe('拼多多生成前网页基线就绪', () => {
  it('定位成功但消息尚未加载时等待真实网页快照，不把未知基线交给生成', async () => {
    vi.useFakeTimers()
    let loaded = false
    const { adapter, focused } = harness(() => snapshot(loaded))
    let generated = false
    const generation = adapter.reviewHistory('buyer', true).then((baseline) => {
      generated = true
      return baseline
    })
    await vi.advanceTimersByTimeAsync(200)
    expect(generated).toBe(false)
    loaded = true
    await vi.advanceTimersByTimeAsync(500)
    await expect(generation).resolves.toEqual(snapshot())
    expect(focused).toEqual(['buyer'])
  })

  it('加载一直失败时在生成前明确报错，不返回不可批准的基线', async () => {
    vi.useFakeTimers()
    const { adapter } = harness(() => snapshot(false))
    const result = expect(adapter.reviewHistory('buyer', true)).rejects.toThrow('网页消息')
    await vi.advanceTimersByTimeAsync(6000)
    await result
  })

  it('等待期间页面实例改变时拒绝使用新页面基线', async () => {
    vi.useFakeTimers()
    let navigated = false
    const { adapter } = harness(() => snapshot(navigated, navigated ? 'page-b' : 'page-a'))
    const result = expect(adapter.reviewHistory('buyer', true)).rejects.toThrow('页面')
    await vi.advanceTimersByTimeAsync(200)
    navigated = true
    await vi.advanceTimersByTimeAsync(500)
    await result
  })

  it('其他买家的有效快照不能成为目标买家的基线', async () => {
    vi.useFakeTimers()
    const { adapter } = harness(() => snapshot(true, 'page-a', 'other-buyer'))
    const result = expect(adapter.reviewHistory('buyer', true)).rejects.toThrow('买家')
    await vi.advanceTimersByTimeAsync(6000)
    await result
  })

  it('后台检查仅观察一次未知快照，不抢切买家或等待页面', async () => {
    const { adapter, focused } = harness(() => snapshot(false))
    await expect(adapter.reviewHistory('buyer', false)).resolves.toEqual(snapshot(false))
    expect(focused).toEqual([])
  })
})

describe('拼多多输入期间发送授权失效', () => {
  function sendHarness(initiallyAllowed: boolean | undefined) {
    let allowed = initiallyAllowed
    let completePreparation!: (value: unknown) => void
    const prepared = new Promise<unknown>((resolve) => {
      completePreparation = resolve
    })
    const calls: string[] = [],
      clicks: unknown[] = [],
      authorizationRequests: string[][] = []
    const raw = {
      async focusConversation() {
        return { ok: true }
      },
      async sendText() {},
      _wc() {
        return { focus() {}, sendInputEvent: (event: unknown) => clicks.push(event) }
      },
      async _callHook(method: string) {
        calls.push(method)
        if (method === 'prepareNativeTextSend') return prepared
        if (method === 'confirmNativeTextSend') return { ok: true, msgId: 'sent' }
        return true
      },
      _sendFailOrThrow(_method: string, error: unknown) {
        throw error
      },
    }
    const adapter = configureDomTextAdapter('pdd-web', raw, 1, (uid, text) => {
      authorizationRequests.push([uid, text])
      if (initiallyAllowed === undefined) return undefined
      return () => allowed === true
    }) as { sendText(uid: string, text: string): Promise<unknown> }
    return {
      adapter,
      calls,
      clicks,
      authorizationRequests,
      revoke: () => {
        allowed = false
      },
      completePreparation,
    }
  }

  it('输入期间撤销授权会取消网页输入，准备完成后也不能点击发送', async () => {
    vi.useFakeTimers()
    const h = sendHarness(true)
    const result = h.adapter.sendText('buyer', '  已批准正文  ')
    await vi.advanceTimersByTimeAsync(1)
    expect(h.calls).toEqual(['prepareNativeTextSend'])
    h.revoke()
    await vi.advanceTimersByTimeAsync(150)
    expect(h.calls).toContain('cancelNativeTextSend')
    h.completePreparation({ ok: true, token: 'prepared', point: { x: 10, y: 20 } })
    await expect(result).resolves.toEqual({ ok: false, reason: 'cancelled' })
    expect(h.clicks).toEqual([])
    expect(h.calls).not.toContain('confirmNativeTextSend')
    expect(h.authorizationRequests).toEqual([['buyer', '已批准正文']])
  })

  it('入口授权已失效时不开始准备或点击发送', async () => {
    const h = sendHarness(false)
    await expect(h.adapter.sendText('buyer', '正文')).resolves.toEqual({
      ok: false,
      reason: 'cancelled',
    })
    expect(h.calls).not.toContain('prepareNativeTextSend')
    expect(h.clicks).toEqual([])
    expect(h.authorizationRequests).toEqual([['buyer', '正文']])
  })

  it('显式人工发送没有 AI 候选授权时保持原有网页发送流程', async () => {
    const h = sendHarness(undefined)
    const result = h.adapter.sendText('buyer', '人工正文')
    h.completePreparation({ ok: true, token: 'manual', point: { x: 10, y: 20 } })
    await expect(result).resolves.toEqual({ ok: true, msgId: 'sent', method: 'dom-click' })
    expect(h.clicks).toHaveLength(2)
    expect(h.calls).toContain('confirmNativeTextSend')
  })
})

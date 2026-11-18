import { afterEach, describe, expect, it, vi } from 'vitest'
import { configureDomTextAdapter } from '../electron/dom-text-adapter'
import { pageReviewFingerprint } from '../electron/conversation-review'

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

describe('默认整段填写回复', () => {
  function bulkHarness(change = false) {
    let page = snapshot()
    const clicks: unknown[] = []
    const calls: { method: string; args: unknown[] }[] = []
    const raw = {
      async focusConversation() {
        return { ok: true }
      },
      async sendText() {},
      _wc() {
        return { focus() {}, sendInputEvent: (event: unknown) => clicks.push(event) }
      },
      async _callHook(method: string, args: unknown[]) {
        calls.push({ method, args })
        if (method === 'reviewHistory') return structuredClone(page)
        if (method === 'prepareNativeTextSend') {
          if (change)
            page = {
              ...page,
              messages: [...page.messages, { from: 'buyer', content: '新问题', media: [] }],
            }
          return { ok: true, token: 'bulk', point: { x: 10, y: 20 } }
        }
        if (method === 'confirmNativeTextSend') return { ok: true }
        return true
      },
      _sendFailOrThrow(_method: string, error: unknown) {
        throw error
      },
    }
    const adapter = configureDomTextAdapter('pdd-web', raw) as {
      sendText(uid: string, text: string): Promise<unknown>
    }
    return { adapter, clicks, calls }
  }
  it('默认整段填写而非逐字延时，填写前后核对同一网页消息', async () => {
    const h = bulkHarness()
    await expect(h.adapter.sendText('buyer', '完整回复😀\n第二行')).resolves.toMatchObject({
      ok: true,
    })
    const prepare = h.calls.find((call) => call.method === 'prepareNativeTextSend')!
    expect(prepare.args[3]).toEqual({ mode: 'button', typeDelayMs: 0 })
    expect(h.calls.filter((call) => call.method === 'reviewHistory')).toHaveLength(2)
    expect(h.clicks).toHaveLength(2)
  })
  it('填写期间网页出现新消息，不点击发送', async () => {
    const h = bulkHarness(true)
    await expect(h.adapter.sendText('buyer', '旧回复')).resolves.toMatchObject({ ok: false })
    expect(h.clicks).toHaveLength(0)
    expect(h.calls.some((call) => call.method === 'confirmNativeTextSend')).toBe(false)
  })
})

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

describe('批准网页基线', () => {
  function pageHarness(current: unknown, approved = snapshot()) {
    const calls: string[] = [],
      clicks: unknown[] = []
    let prepares = 0,
      confirms = 0
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
        if (method === 'reviewHistory') return structuredClone(current)
        if (method === 'prepareNativeTextSend') {
          prepares += 1
          return { ok: true, token: 'page-token', point: { x: 10, y: 20 } }
        }
        if (method === 'confirmNativeTextSend') {
          confirms += 1
          return { ok: true, msgId: 'page-sent' }
        }
        return true
      },
      _sendFailOrThrow(_method: string, error: unknown) {
        throw error
      },
    }
    const fingerprint = pageReviewFingerprint(approved)
    if (!fingerprint) throw new Error('fixture baseline missing')
    const guard = (() => true) as (() => boolean) & {
      approvalPage?: { uid: string; page: string; fingerprint: string }
    }
    guard.approvalPage = { uid: 'buyer', page: 'page-a', fingerprint }
    const adapter = configureDomTextAdapter('pdd-web', raw, 0, () => guard) as {
      sendText(uid: string, text: string): Promise<unknown>
    }
    return {
      adapter,
      calls,
      clicks,
      get prepares() {
        return prepares
      },
      get confirms() {
        return confirms
      },
    }
  }

  it.each([
    ['网页未知', snapshot(false)],
    ['买家不属于目标 uid', snapshot(true, 'page-a', 'other-buyer')],
    ['页面实例改变', snapshot(true, 'page-b')],
    [
      '网页指纹增加新消息',
      {
        ...snapshot(),
        messages: [...snapshot().messages, { from: 'buyer', content: '新问题', media: [] }],
      },
    ],
  ])('%s 时在填写前失败，不准备不点击', async (_name, current) => {
    const h = pageHarness(current)
    await expect(h.adapter.sendText('buyer', '旧正文')).resolves.toMatchObject({
      ok: false,
      throttled: true,
      reason: 'hook_not_ready',
      detail: 'approved_page_changed',
    })
    expect(h.prepares).toBe(0)
    expect(h.clicks).toEqual([])
    expect(h.confirms).toBe(0)
    expect(h.calls).not.toContain('prepareNativeTextSend')
    expect(h.calls).not.toContain('confirmNativeTextSend')
  })

  function cancelDuringReadHarness(interval: number) {
    let allowed = true,
      prepares = 0,
      clicks = 0
    const approved = snapshot()
    const fingerprint = pageReviewFingerprint(approved)
    if (!fingerprint) throw new Error('fixture baseline missing')
    const guard = (() => allowed) as (() => boolean) & {
      approvalPage?: { uid: string; page: string; fingerprint: string }
    }
    guard.approvalPage = { uid: 'buyer', page: 'page-a', fingerprint }
    const raw = {
      async focusConversation() {
        return { ok: true }
      },
      async sendText() {},
      _wc() {
        return { focus() {}, sendInputEvent: () => clicks++ }
      },
      async _callHook(method: string) {
        if (method === 'reviewHistory') {
          // 模拟网页复核 await 期间停 AI/授权失效；页面本身仍与批准基线一致。
          allowed = false
          return structuredClone(approved)
        }
        if (method === 'prepareNativeTextSend') {
          prepares += 1
          return { ok: true, token: 'cancel-token', point: { x: 10, y: 20 } }
        }
        return { ok: true }
      },
      _sendFailOrThrow(_method: string, error: unknown) {
        throw error
      },
    }
    const adapter = configureDomTextAdapter('pdd-web', raw, interval, () => guard) as {
      sendText(uid: string, text: string): Promise<unknown>
    }
    return {
      adapter,
      get prepares() {
        return prepares
      },
      get clicks() {
        return clicks
      },
    }
  }

  it.each([0, 50])(
    '网页复核 await 期间停 AI/授权失效，interval=%i 在任何 prepare 前取消',
    async (interval) => {
      const h = cancelDuringReadHarness(interval)
      await expect(h.adapter.sendText('buyer', '不应填写')).resolves.toEqual({
        ok: false,
        reason: 'cancelled',
      })
      expect(h.prepares).toBe(0)
      expect(h.clicks).toBe(0)
    },
  )

  it('批准网页指纹未变时保持一次正常发送', async () => {
    const h = pageHarness(snapshot())
    await expect(h.adapter.sendText('buyer', '稳定正文')).resolves.toEqual({
      ok: true,
      msgId: 'page-sent',
      method: 'dom-click',
    })
    expect(h.prepares).toBe(1)
    expect(h.clicks).toHaveLength(2)
    expect(h.confirms).toBe(1)
  })
})

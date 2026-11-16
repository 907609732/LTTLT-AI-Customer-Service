import { describe, expect, it } from 'vitest'
import {
  XianyuAdapter,
  freshBuyerMessages,
  toLocalMessages,
  xianyuTimestamp,
  type XianyuBridge,
} from '../electron/xianyu/adapter'

type Handler = (args: Record<string, unknown>) => unknown

class FakeBridge implements XianyuBridge {
  calls: { op: string; args: Record<string, unknown> }[] = []
  readonly handlers = new Map<string, Handler>()

  async invoke(
    op: string,
    args: Record<string, unknown> = {},
    _timeoutMs?: number,
  ): Promise<unknown> {
    this.calls.push({ op, args })
    const handler = this.handlers.get(op)
    if (!handler) throw new Error(`unexpected op: ${op}`)
    return handler(args)
  }

  async ensureInjected(): Promise<void> {}

  count(op: string): number {
    return this.calls.filter((call) => call.op === op).length
  }
}

const NOW = new Date(2026, 10, 16, 15, 0, 0).getTime()

function adapterFixture(options: { now?: () => number } = {}) {
  const bridge = new FakeBridge()
  const adapter = new XianyuAdapter({
    store: { id: 'store-1', storeName: '闲鱼测试店', platform: 'xianyu' },
    bridge,
    now: options.now ?? (() => NOW),
    sleep: async () => {},
  })
  return { bridge, adapter }
}

describe('闲鱼消息映射', () => {
  it('按 HH:MM#序号 换算当天时间并合成稳定 msgId', () => {
    const base = new Date(2026, 10, 16, 14, 57, 0).getTime()
    expect(xianyuTimestamp('14:57#3', NOW)).toBe(base + 3000)
    const messages = toLocalMessages(
      '买家A',
      [
        { body: '在吗', side: 'left', ts: '14:56#1' },
        { body: '在的', side: 'right', ts: '14:56#2' },
        { body: '', side: 'left', isImage: true, ts: '14:57#3' },
        { body: '', side: 'left', isProduct: true, productTitle: '门锁', ts: '14:57#4' },
      ],
      NOW,
    )
    expect(messages.map((message) => message.msgId)).toEqual([
      'xy:买家A:14:56#1',
      'xy:买家A:14:56#2',
      'xy:买家A:14:57#3',
      'xy:买家A:14:57#4',
    ])
    expect(messages.map((message) => message.type)).toEqual(['text', 'text', 'image', 'card'])
    expect(messages[3]?.content).toBe('[商品] 门锁')
  })

  it('跨零点的时间标签归到前一天，而不是未来', () => {
    const afterMidnight = new Date(2026, 10, 16, 0, 10, 0).getTime()
    const value = xianyuTimestamp('23:55#1', afterMidnight)
    expect(value).toBe(new Date(2026, 10, 15, 23, 55, 1).getTime())
  })

  it('解析带日期和相对时间的分组标签，避免旧消息被当成现在', () => {
    const now = new Date(2026, 10, 17, 10, 0, 0).getTime()
    expect(xianyuTimestamp('昨天 21:47#1', now)).toBe(
      new Date(2026, 10, 16, 21, 47, 1).getTime(),
    )
    expect(xianyuTimestamp('前天 09:05', now)).toBe(new Date(2026, 10, 15, 9, 5, 0).getTime())
    expect(xianyuTimestamp('11-05 21:31', now)).toBe(new Date(2026, 10, 5, 21, 31, 0).getTime())
    expect(xianyuTimestamp('2026-11-05 21:31#2', now)).toBe(
      new Date(2026, 10, 5, 21, 31, 2).getTime(),
    )
    expect(xianyuTimestamp('5分钟前', now)).toBe(now - 5 * 60_000)
    expect(xianyuTimestamp('2小时前', now)).toBe(now - 2 * 3_600_000)
  })

  it('只把最后一条卖家消息之后的买家消息视为待回复', () => {
    const messages = toLocalMessages(
      '买家A',
      [
        { body: '在吗', side: 'left', ts: '14:50#1' },
        { body: '在的', side: 'right', ts: '14:51#2' },
        { body: '包邮吗', side: 'left', ts: '14:52#3' },
      ],
      NOW,
    )
    expect(freshBuyerMessages(messages).map((message) => message.content)).toEqual(['包邮吗'])
    const replied = toLocalMessages(
      '买家A',
      [
        { body: '包邮吗', side: 'left', ts: '14:52#3' },
        { body: '包邮的', side: 'right', ts: '14:53#4' },
      ],
      NOW,
    )
    expect(freshBuyerMessages(replied)).toEqual([])
  })
})

describe('闲鱼适配器', () => {
  it('readiness 未登录时返回 hook_not_ready，不伪装成已连接', async () => {
    const { bridge, adapter } = adapterFixture()
    bridge.handlers.set('readiness', () => ({
      loggedOutVisible: true,
      loginCookieMissing: true,
      conversationCount: 0,
      chatAreaPresent: false,
    }))
    const result = await adapter.ensure()
    expect(result.ok).toBe(false)
    expect(result).toMatchObject({ reason: 'hook_not_ready' })
    expect(adapter.authenticated()).toBe(false)
  })

  it('readiness 通过后记录登录态', async () => {
    const { bridge, adapter } = adapterFixture()
    bridge.handlers.set('readiness', () => ({
      loggedOutVisible: false,
      loginCookieMissing: false,
      conversationCount: 3,
      chatAreaPresent: true,
    }))
    expect(await adapter.ensure()).toEqual({ ok: true })
    expect(adapter.authenticated()).toBe(true)
  })

  it('从登录 cookie 读取店名和卖家 id，不用可能被打码的聊天昵称', async () => {
    const { bridge, adapter } = adapterFixture()
    bridge.handlers.set('cookieValue', (args) => {
      const name = String(args.name)
      return name === 'unb'
        ? { name, found: true, value: '2218297228331' }
        : { name, found: true, value: 'xy156791819394' }
    })
    bridge.handlers.set('readiness', () => ({
      loggedOutVisible: false,
      loginCookieMissing: false,
      conversationCount: 3,
      chatAreaPresent: true,
    }))
    await expect(adapter.identity()).resolves.toEqual({
      authenticated: true,
      storeName: 'xy156791819394',
      mallId: '2218297228331',
      customerServiceName: 'xy156791819394',
    })
  })

  it('登录完成后自动复查登录态并只回调一次', async () => {
    const bridge = new FakeBridge()
    let allowLogin = false
    let authenticatedCalls = 0
    bridge.handlers.set('readiness', () => ({
      loggedOutVisible: !allowLogin,
      loginCookieMissing: !allowLogin,
      conversationCount: allowLogin ? 3 : 0,
      chatAreaPresent: allowLogin,
    }))
    const adapter = new XianyuAdapter({
      store: { id: 'store-1', storeName: '闲鱼测试店', platform: 'xianyu' },
      bridge,
      now: () => NOW,
      sleep: async () => {},
      authPollMs: 10,
      onAuthenticated: () => {
        authenticatedCalls += 1
      },
    })
    expect(await adapter.ensure()).toMatchObject({ ok: false, reason: 'hook_not_ready' })
    expect(adapter.authenticated()).toBe(false)
    allowLogin = true
    await new Promise((resolve) => setTimeout(resolve, 80))
    expect(adapter.authenticated()).toBe(true)
    expect(authenticatedCalls).toBe(1)
  })

  it('popPending 切换会话、只返回新买家消息，并防止重复认领', async () => {
    const { bridge, adapter } = adapterFixture()
    bridge.handlers.set('pendingChats', () => ({ itemCount: 1, pending: ['买家A'] }))
    bridge.handlers.set('activateChat', () => ({ switched: true }))
    bridge.handlers.set('activeBuyer', () => ({ count: 1, nick: '买家A' }))
    bridge.handlers.set('readChat', () => ({
      buyerNick: '买家A',
      activeCount: 1,
      messages: [
        { body: '在吗', side: 'left', ts: '14:50#1' },
        { body: '在的', side: 'right', ts: '14:51#2' },
        { body: '包邮吗', side: 'left', ts: '14:52#3' },
      ],
    }))

    const row = await adapter.popPending()
    expect(row?.uid).toBe('买家A')
    expect(row?.messages.map((message) => message.content)).toEqual(['包邮吗'])
    expect(await adapter.popPending()).toBeNull()

    expect(await adapter.release('买家A')).toMatchObject({ ok: true })
    expect(await adapter.popPending()).not.toBeNull()

    expect(await adapter.discard('买家A')).toMatchObject({ ok: true })
    expect(await adapter.popPending()).toBeNull()

    // 新买家消息出现后重新进入队列，已确认的旧消息不会重复出现。
    bridge.handlers.set('readChat', () => ({
      buyerNick: '买家A',
      activeCount: 1,
      messages: [
        { body: '在吗', side: 'left', ts: '14:50#1' },
        { body: '在的', side: 'right', ts: '14:51#2' },
        { body: '包邮吗', side: 'left', ts: '14:52#3' },
        { body: '有优惠吗', side: 'left', ts: '14:55#4' },
      ],
    }))
    const next = await adapter.popPending()
    expect(next?.messages.map((message) => message.content)).toEqual(['有优惠吗'])
  })

  it('当前打开会话没有未读红点也交给 AI，并防止重复认领', async () => {
    const { bridge, adapter } = adapterFixture()
    bridge.handlers.set('pendingChats', () => ({ itemCount: 3, pending: [] }))
    bridge.handlers.set('readChat', () => ({
      buyerNick: '买家A',
      activeCount: 1,
      messages: [
        { body: '在的', side: 'right', ts: '14:50#1' },
        { body: '这个还有货吗', side: 'left', ts: '14:51#2' },
      ],
    }))
    const row = await adapter.popPending()
    expect(row?.uid).toBe('买家A')
    expect(row?.messages.map((message) => message.content)).toEqual(['这个还有货吗'])
    expect(await adapter.popPending()).toBeNull()
    expect(await adapter.release('买家A')).toMatchObject({ ok: true })
    expect(await adapter.popPending()).not.toBeNull()
    expect(await adapter.discard('买家A')).toMatchObject({ ok: true })
    expect(await adapter.popPending()).toBeNull()
  })

  it('当前会话最后一条是我方消息时不交给 AI', async () => {
    const { bridge, adapter } = adapterFixture()
    bridge.handlers.set('pendingChats', () => ({ itemCount: 1, pending: [] }))
    bridge.handlers.set('readChat', () => ({
      buyerNick: '买家A',
      activeCount: 1,
      messages: [
        { body: '包邮吗', side: 'left', ts: '14:50#1' },
        { body: '包邮的', side: 'right', ts: '14:51#2' },
      ],
    }))
    expect(await adapter.popPending()).toBeNull()
  })

  it('同名多会话切换被页面判定为 ambiguous 时跳过，不猜目标', async () => {
    const { bridge, adapter } = adapterFixture()
    bridge.handlers.set('pendingChats', () => ({ itemCount: 1, pending: ['买家A'] }))
    bridge.handlers.set('activateChat', () => ({ switched: false, reason: 'ambiguous' }))
    expect(await adapter.popPending()).toBeNull()
  })

  it('发送后重读会话核对回显；核对不到时补点一次并返回 send_unconfirmed', async () => {
    const { bridge, adapter } = adapterFixture()
    bridge.handlers.set('activateChat', () => ({ switched: true }))
    bridge.handlers.set('activeBuyer', () => ({ count: 1, nick: '买家A' }))
    bridge.handlers.set('inputValue', () => ({ value: '' }))
    bridge.handlers.set('write', () => true)
    bridge.handlers.set('commit', () => true)
    bridge.handlers.set('readChat', () => ({
      buyerNick: '买家A',
      activeCount: 1,
      messages: [{ body: '包邮的', side: 'right', ts: '14:53#4' }],
    }))
    expect(await adapter.sendText('买家A', '包邮的')).toMatchObject({
      ok: true,
      msgId: 'xy:买家A:14:53#4',
    })
    expect(bridge.count('commit')).toBe(1)

    // 第二次发送没有回显，且输入框仍保留原文时才补点一次。
    bridge.handlers.set('inputValue', () => ({ value: '包邮的' }))
    bridge.handlers.set('readChat', () => ({
      buyerNick: '买家A',
      activeCount: 1,
      messages: [{ body: '另一句', side: 'right', ts: '14:54#5' }],
    }))
    const failed = await adapter.sendText('买家A', '包邮的')
    expect(failed).toMatchObject({ ok: false, reason: 'send_unconfirmed' })
    expect(bridge.count('commit')).toBe(3)
  })

  it('输入框正文被页面改写时不点击发送', async () => {
    const { bridge, adapter } = adapterFixture()
    bridge.handlers.set('activateChat', () => ({ switched: true }))
    bridge.handlers.set('activeBuyer', () => ({ count: 1, nick: '买家A' }))
    bridge.handlers.set('inputValue', () => ({ value: '' }))
    bridge.handlers.set('write', () => ({ readback: '被改写的正文' }))
    bridge.handlers.set('commit', () => true)
    const result = await adapter.sendText('买家A', '原始回复')
    expect(result).toMatchObject({ ok: false, reason: 'input_not_found' })
    expect(bridge.count('commit')).toBe(0)
  })

  it('输入框已有未发送草稿时不覆盖也不点击发送', async () => {
    const { bridge, adapter } = adapterFixture()
    bridge.handlers.set('activateChat', () => ({ switched: true }))
    bridge.handlers.set('activeBuyer', () => ({ count: 1, nick: '买家A' }))
    bridge.handlers.set('inputValue', () => ({ value: '人工草稿' }))
    const result = await adapter.sendText('买家A', 'AI 回复')
    expect(result).toMatchObject({ ok: false, reason: 'input_not_found' })
    expect(bridge.count('write')).toBe(0)
    expect(bridge.count('commit')).toBe(0)
  })

  it('商家已切到其他买家时不抢回旧会话发送', async () => {
    const { bridge, adapter } = adapterFixture()
    bridge.handlers.set('activeBuyer', () => ({ count: 1, nick: '买家B' }))
    bridge.handlers.set('activateChat', () => ({ switched: true }))
    bridge.handlers.set('inputValue', () => ({ value: '' }))
    const result = await adapter.sendText('买家A', 'AI 回复')
    expect(result).toMatchObject({ ok: false, reason: 'input_not_found' })
    expect(bridge.count('activateChat')).toBe(0)
    expect(bridge.count('write')).toBe(0)
    expect(bridge.count('commit')).toBe(0)
  })

  it('写入后商家切走时不点击发送', async () => {
    const { bridge, adapter } = adapterFixture()
    let written = false
    bridge.handlers.set('activateChat', () => ({ switched: true }))
    bridge.handlers.set('activeBuyer', () => ({ count: 1, nick: written ? '买家B' : '买家A' }))
    bridge.handlers.set('inputValue', () => ({ value: '' }))
    bridge.handlers.set('write', () => {
      written = true
      return { readback: 'AI 回复' }
    })
    bridge.handlers.set('commit', () => true)
    const result = await adapter.sendText('买家A', 'AI 回复')
    expect(result).toMatchObject({ ok: false, reason: 'input_not_found' })
    expect(bridge.count('commit')).toBe(0)
  })

  it('事件采样只读取当前会话，并按 msgId 去重', async () => {
    let now = NOW
    const { bridge, adapter } = adapterFixture({ now: () => now })
    bridge.handlers.set('readChat', () => ({
      buyerNick: '买家A',
      activeCount: 1,
      messages: [{ body: '在吗', side: 'left', ts: '14:59#1' }],
    }))
    const first = await adapter.drainEvents({ sinceSeq: 0 })
    if (!first.ok) throw new Error(first.detail)
    expect(first.seq).toBe(1)
    expect(first.events).toHaveLength(1)

    now += 5_000
    const second = await adapter.drainEvents({ sinceSeq: 1 })
    if (!second.ok) throw new Error(second.detail)
    expect(second.events).toHaveLength(0)
    expect(second.seq).toBe(1)
  })
})

import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { afterEach, expect, it, vi } from 'vitest'

const source = readFileSync('vendor/lingtu-runtime/desk-v1/src/injections/pdd-web-hook.js', 'utf8')
interface Page {
  window: Window & typeof globalThis
}
const { JSDOM } = createRequire(import.meta.url)('jsdom') as {
  JSDOM: new (html: string, options: { url: string; runScripts: 'outside-only' }) => Page
}
const pages: Page[] = []
afterEach(() => {
  for (const page of pages.splice(0)) page.window.close()
  vi.useRealTimers()
})

const BUYER_A = '111111'
const BUYER_B = '222222'

interface HookMessage {
  msgId: string
  from: string
  content: string
}
interface HookApi {
  pending(): Record<string, { messages: HookMessage[] }>
  sent(uid: string): HookMessage[]
  reviewHistory(uid: string): { known: boolean; uid: string; reason?: string }
  scanNow(): { domUidConflict: number; domIdentityBlocked: number }
  currentUid(): string
}
interface StoreConversation {
  userInfo: { uid: string; nickname?: string }
  messageList: Array<{
    msg_id: string
    from: { role: string }
    content: string
    ts: number
  }>
}

function conversation(uid: string, text: string, reply = ''): StoreConversation {
  const now = Date.now()
  const messageList: StoreConversation['messageList'] = [
    { msg_id: `m-${uid}-1`, from: { role: 'buyer' }, content: text, ts: now },
  ]
  if (reply)
    messageList.push({
      msg_id: `m-${uid}-2`,
      from: { role: 'seller' },
      content: reply,
      ts: now + 1,
    })
  return { userInfo: { uid, nickname: uid }, messageList }
}

class FakeWebSocket {
  static readonly CONNECTING = 0
  static readonly OPEN = 1
  static readonly CLOSING = 2
  static readonly CLOSED = 3
  readonly listeners = new Map<string, Array<(event: { data: string }) => void>>()
  addEventListener(type: string, listener: (event: { data: string }) => void) {
    const list = this.listeners.get(type) ?? []
    list.push(listener)
    this.listeners.set(type, list)
  }
  push(payload: unknown) {
    for (const listener of this.listeners.get('message') ?? [])
      listener({ data: JSON.stringify(payload) })
  }
}

function fixture(options: {
  initialUid: string
  conversations: StoreConversation[]
  domTexts: string[]
  withWebSocket?: boolean
}) {
  vi.useFakeTimers()
  const page = new JSDOM(
    `<div id="app">
      <div class="chat-item-box active" data-random="${options.initialUid}-0-reply"></div>
      <div class="chat-item-box" data-random="${BUYER_B}-0-reply"></div>
    </div>
    <div class="chatMessage" id="panel"></div>`,
    { url: 'https://mms.pinduoduo.com/chat-merchant/index.html', runScripts: 'outside-only' },
  )
  pages.push(page)
  const { window } = page
  let socket: FakeWebSocket | undefined
  if (options.withWebSocket) {
    const Fake = function (this: FakeWebSocket) {
      socket = new FakeWebSocket()
      return socket
    } as unknown as typeof WebSocket
    Object.assign(Fake, FakeWebSocket)
    Object.defineProperty(window, 'WebSocket', { value: Fake, configurable: true })
  }
  const initial = options.conversations.find((c) => c.userInfo.uid === options.initialUid)!
  const state: {
    selectingChatUid?: string
    currentUserInfo: StoreConversation
    chatList: StoreConversation[]
  } = {
    selectingChatUid: options.initialUid,
    currentUserInfo: initial,
    chatList: options.conversations,
  }
  Object.assign(window.document.querySelector('#app')!, {
    __vue__: { $store: { state, getters: {} } },
  })
  const panel = window.document.querySelector('#panel')!
  const render = (texts: string[], sellerIndexes: number[] = []) => {
    panel.innerHTML = texts
      .map(
        (text, index) =>
          `<div class="chat-item${sellerIndexes.includes(index) ? ' merchantMessage' : ''}"><p class="chat-message-content">${text}</p></div>`,
      )
      .join('')
  }
  render(options.domTexts)
  window.eval(source)
  return {
    api: Reflect.get(window, '__pddWeb') as HookApi,
    state,
    window,
    panel,
    render,
    select(uid: string, conversationValue: StoreConversation) {
      state.selectingChatUid = uid
      state.currentUserInfo = conversationValue
      for (const box of window.document.querySelectorAll('.chat-item-box'))
        box.classList.toggle('active', box.getAttribute('data-random') === `${uid}-0-reply`)
    },
    socket: () => socket,
  }
}

it('没有切换时按当前买家采集，merchantMessage 卖家气泡不进入待回复', () => {
  const first = conversation(BUYER_A, '第一问', '第一答')
  const { api } = fixture({
    initialUid: BUYER_A,
    conversations: [first],
    domTexts: ['第一问', '第一答'],
  })
  expect(api.pending()[BUYER_A].messages.map((m) => [m.from, m.content])).toEqual([
    ['buyer', '第一问'],
  ])
  expect(api.sent(BUYER_A).map((m) => m.content)).toEqual(['第一答'])
})

it('selected 先更新、currentUserInfo 与列表选中仍旧时绝不归到新 uid', () => {
  const first = conversation(BUYER_A, '旧买家的问题')
  const { api, state, render } = fixture({
    initialUid: BUYER_A,
    conversations: [first],
    domTexts: ['旧买家的问题'],
  })
  expect(api.pending()[BUYER_A].messages).toHaveLength(1)

  state.selectingChatUid = BUYER_B
  render(['旧买家的问题'])
  const stats = api.scanNow()

  expect(api.pending()[BUYER_B]).toBeUndefined()
  expect(api.pending()[BUYER_A].messages.map((m) => m.content)).toEqual(['旧买家的问题'])
  expect(stats.domUidConflict).toBeGreaterThan(0)
})

it('身份稳定且消息区更新后恢复采集', () => {
  const first = conversation(BUYER_A, '旧买家的问题')
  const second = conversation(BUYER_B, '新买家的问题')
  const f = fixture({
    initialUid: BUYER_A,
    conversations: [first, second],
    domTexts: ['旧买家的问题'],
  })
  f.select(BUYER_B, second)
  f.render(['新买家的问题'])
  f.api.scanNow()

  expect(f.api.pending()[BUYER_B].messages.map((m) => m.content)).toEqual(['新买家的问题'])
})

it('消息区连续多轮仍是旧会话时保持 fail closed，更新后只收新买家消息', () => {
  const first = conversation(BUYER_A, '旧买家的问题')
  const second = conversation(BUYER_B, '新买家的问题')
  const f = fixture({
    initialUid: BUYER_A,
    conversations: [first, second],
    domTexts: ['旧买家的问题'],
  })
  f.select(BUYER_B, second)
  f.api.scanNow()
  f.api.scanNow()
  expect(f.api.pending()[BUYER_B].messages.map((m) => m.content)).toEqual(['新买家的问题'])

  f.render(['新买家的问题'])
  const stats = f.api.scanNow()
  expect(f.api.pending()[BUYER_B].messages.map((m) => m.content)).toEqual(['新买家的问题'])
  expect(stats.domIdentityBlocked).toBeGreaterThanOrEqual(2)
})

it('两位买家发送相同文本时各自保留一条，不因跨会话去重丢失', () => {
  const first = conversation(BUYER_A, '在吗')
  const second = conversation(BUYER_B, '在吗')
  const f = fixture({
    initialUid: BUYER_A,
    conversations: [first, second],
    domTexts: ['在吗'],
  })
  expect(f.api.pending()[BUYER_A].messages.map((m) => m.content)).toEqual(['在吗'])

  f.select(BUYER_B, second)
  f.render(['在吗'])
  f.api.scanNow()

  expect(f.api.pending()[BUYER_A].messages.map((m) => m.content)).toEqual(['在吗'])
  expect(f.api.pending()[BUYER_B].messages.map((m) => m.content)).toEqual(['在吗'])
})

it('未知方向帧不占用 ID 和水位，稍后 Vuex 补全买家角色仍进入待回复', () => {
  const first = conversation(BUYER_A, '初始问题')
  const f = fixture({
    initialUid: BUYER_A,
    conversations: [first],
    domTexts: ['初始问题'],
    withWebSocket: true,
  })
  const socket = new f.window.WebSocket('wss://example.test') as unknown as FakeWebSocket
  const now = Date.now()
  socket.push({
    msg_id: 'late-buyer-id',
    content: '迟到买家消息',
    from: { uid: BUYER_A },
    ts: now,
  })
  expect(f.api.pending()[BUYER_A]?.messages.map((m) => m.content) ?? []).not.toContain(
    '迟到买家消息',
  )
  expect(f.api.sent(BUYER_A).map((m) => m.content)).not.toContain('迟到买家消息')

  first.messageList.push({
    msg_id: 'late-buyer-id',
    from: { role: 'buyer' },
    content: '迟到买家消息',
    ts: now,
  })
  f.api.scanNow()
  expect(f.api.pending()[BUYER_A].messages.map((m) => m.content)).toContain('迟到买家消息')
})

it('未知方向帧不提前占用 ID，稍后 Vuex 补全卖家角色进入已发送而非买家待回复', () => {
  const first = conversation(BUYER_A, '初始问题')
  const f = fixture({
    initialUid: BUYER_A,
    conversations: [first],
    domTexts: ['初始问题'],
    withWebSocket: true,
  })
  const socket = new f.window.WebSocket('wss://example.test') as unknown as FakeWebSocket
  const now = Date.now()
  socket.push({
    msg_id: 'late-seller-id',
    content: '迟到卖家答复',
    from: { uid: 'seller1' },
    ts: now,
  })
  expect(f.api.sent(BUYER_A).map((m) => m.content)).not.toContain('迟到卖家答复')

  first.messageList.push({
    msg_id: 'late-seller-id',
    from: { role: 'seller' },
    content: '迟到卖家答复',
    ts: now + 1,
  })
  f.api.scanNow()
  expect(f.api.sent(BUYER_A).map((m) => m.content)).toContain('迟到卖家答复')
  expect(f.api.pending()[BUYER_A].messages.map((m) => m.content)).not.toContain('迟到卖家答复')
})

it('持续未知方向不提交水位，随后较早时间戳的明确买家消息仍可入队', () => {
  const first = conversation(BUYER_A, '初始问题')
  const f = fixture({
    initialUid: BUYER_A,
    conversations: [first],
    domTexts: ['初始问题'],
    withWebSocket: true,
  })
  const socket = new f.window.WebSocket('wss://example.test') as unknown as FakeWebSocket
  const base = Date.now()
  for (const [id, content] of [
    ['unknown-future-1', '未知通知一'],
    ['unknown-future-2', '未知通知二'],
  ])
    socket.push({
      msg_id: id,
      content,
      from: { uid: BUYER_A },
      ts: base + 600000,
    })

  socket.push({
    msg_id: 'buyer-older',
    content: '明确但时间较早的买家消息',
    from: { uid: BUYER_A, role: 'buyer' },
    ts: base - 30000,
  })
  expect(f.api.pending()[BUYER_A].messages.map((m) => m.content)).toContain(
    '明确但时间较早的买家消息',
  )
  expect(f.api.pending()[BUYER_A].messages.map((m) => m.content)).not.toContain('未知通知一')
  expect(f.api.sent(BUYER_A).map((m) => m.content)).not.toContain('未知通知二')
})

it('结构化消息缺少明确角色时不把卖家回显记成买家', () => {
  const first = conversation(BUYER_A, '买家问题')
  const f = fixture({
    initialUid: BUYER_A,
    conversations: [first],
    domTexts: ['买家问题'],
    withWebSocket: true,
  })
  const socket = new f.window.WebSocket('wss://example.test') as unknown as FakeWebSocket
  socket.push({
    msg_id: 'ws-seller-1',
    content: '卖家回显没有角色',
    from: { uid: 'seller1' },
    ts: Date.now(),
  })
  expect(f.api.pending()['seller1']).toBeUndefined()

  socket.push({
    msg_id: 'ws-buyer-1',
    content: '明确角色的买家新消息',
    from: { uid: BUYER_A, role: 'buyer' },
    ts: Date.now(),
  })
  expect(f.api.pending()[BUYER_A].messages.map((m) => m.content)).toContain('明确角色的买家新消息')
})

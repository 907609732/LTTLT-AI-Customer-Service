import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { afterEach, expect, it, vi } from 'vitest'

// All identifiers, product IDs and titles below are synthetic. The tests execute the
// real page hook against an isolated jsdom document and observe only its public queue
// contract; they do not mirror the extraction helper or call a platform API.
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

const A = 'syntheticBuyerA'
const B = 'syntheticBuyerB'
const P1 = '640000000001'
const P2 = '640000000002'
const P3 = '640000000003'

interface StoreMessage {
  msg_id: string
  from?: { role?: string; uid?: string }
  type?: number
  content?: string
  info?: Record<string, unknown>
  ts: number
}
interface Conversation {
  userInfo: { uid: string; nickname?: string }
  messageList: StoreMessage[]
}
interface HookMessage {
  msgId: string
  from: string
  content: string
  goodsId?: string
  goodsTitle?: string
}
interface HookRow {
  uid: string
  goodsId: string
  goodsTitle: string
  messages: HookMessage[]
}
interface HookEvent {
  seq: number
  uid: string
  msgId: string
  content: string
  goodsId?: string
  goodsTitle?: string
}
interface HookApi {
  pending(): Record<string, HookRow>
  popPending(): HookRow
  releasePendingClaim(uid: string): boolean
  discardClaim(uid: string): boolean
  drainEvents(params?: { sinceSeq?: number }): {
    ok: boolean
    seq: number
    events: HookEvent[]
  }
  goodsContext(uid: string): {
    goodsId: string
    goodsTitle: string
    orderId: string
    orderStatus: string
  }
  scanNow(): Record<string, number>
  stats(): Record<string, number>
  reviewHistory(uid: string): { known: boolean; reason?: string }
}

function conversation(uid: string, messageList: StoreMessage[]): Conversation {
  return { userInfo: { uid, nickname: uid }, messageList }
}

function cardMessage(
  id: string,
  uid: string,
  type: 0 | 41,
  productId: string,
  title: string,
  ts = Date.now(),
): StoreMessage {
  return {
    msg_id: id,
    from: { role: 'user', uid },
    type,
    content: `[商品] ${title}`,
    info:
      type === 41
        ? { goods_info: { goods_id: Number(productId), goods_name: title } }
        : { goodsID: Number(productId), goodsName: title },
    ts,
  }
}

function textMessage(id: string, uid: string, content: string, ts = Date.now()): StoreMessage {
  return { msg_id: id, from: { role: 'user', uid }, type: 1, content, ts }
}

function row(id: string, side: 'cs' | 'buyer', text: string) {
  return (
    `<li id="middlePanel_list_${id}" class="clearfix onemsg"><div class="merchantMessage">` +
    `<div class="${side === 'cs' ? 'cs-item' : 'buyer-item'}"><div class="msg-content">` +
    `<p class="msg-content-box">${text}</p></div></div></div></li>`
  )
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

function defineRects(window: Window & typeof globalThis) {
  for (const node of window.document.querySelectorAll('*')) {
    const marked = node as Element & { __rectFixture?: boolean }
    if (marked.__rectFixture) continue
    Object.defineProperty(node, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({
        x: 321,
        y: 0,
        left: 321,
        top: 0,
        right: 1868,
        bottom: 40,
        width: 1547,
        height: 40,
      }),
    })
    marked.__rectFixture = true
  }
}
function fixture(options: {
  currentUid: string
  conversations?: Conversation[]
  getters?: Record<string, unknown>
  rows?: string[]
  withWebSocket?: boolean
}) {
  const page = new JSDOM(
    `<div id="app"><div class="chat-item-box active" data-random="${options.currentUid}-0-reply"></div></div>` +
      `<div class="middlePanel"><ul class="message-list">${(options.rows ?? []).join('')}</ul></div>`,
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
  const conversations = options.conversations ?? [
    conversation(options.currentUid, [textMessage('initial-1', options.currentUid, '初始问题')]),
  ]
  const current =
    conversations.find((item) => item.userInfo.uid === options.currentUid) ?? conversations[0]!
  Object.assign(window.document.querySelector('#app')!, {
    __vue__: {
      $store: {
        state: {
          selectingChatUid: options.currentUid,
          currentUserInfo: current,
          chatList: conversations,
          todayChatList: conversations,
        },
        getters: options.getters ?? {},
      },
    },
  })
  defineRects(window)
  window.eval(source)
  const created = options.withWebSocket
    ? (new window.WebSocket('wss://example.test') as unknown as FakeWebSocket)
    : undefined
  if (created) socket = created
  return {
    window,
    api: Reflect.get(window, '__pddWeb') as HookApi,
    socket: () => {
      if (!socket) throw new Error('fake WebSocket 未创建')
      return socket
    },
  }
}

function pushCard(
  socket: FakeWebSocket,
  input: {
    id: string
    uid: string
    type: 0 | 41
    productId?: unknown
    title?: unknown
    content: string
    extra?: Record<string, unknown>
  },
) {
  const info =
    input.type === 41
      ? { goods_info: { goods_id: input.productId, goods_name: input.title } }
      : { goodsID: input.productId, goodsName: input.title }
  socket.push({
    msg_id: input.id,
    from: { uid: input.uid, role: 'user' },
    type: input.type,
    content: input.content,
    info,
    ts: Date.now(),
    ...input.extra,
  })
}

it('RED/GREEN target: type41 card flows from normalize through pending, claim, event and goodsContext', () => {
  const f = fixture({ currentUid: A, withWebSocket: true })
  pushCard(f.socket(), {
    id: 'ws-card-41',
    uid: A,
    type: 41,
    productId: Number(P1),
    title: '合成入口卡标题',
    content: '[商品] 合成入口卡标题',
  })
  expect(f.api.pending()[A].goodsId).toBe(P1)
  expect(f.api.pending()[A].goodsTitle).toBe('合成入口卡标题')
  expect(f.api.goodsContext(A)).toMatchObject({ goodsId: P1, goodsTitle: '合成入口卡标题' })
  const event = f.api.drainEvents().events.find((item) => item.msgId === 'ws-card-41')
  expect(event).toMatchObject({ goodsId: P1, goodsTitle: '合成入口卡标题' })
  const claimed = f.api.popPending()
  expect(claimed).toMatchObject({ uid: A, goodsId: P1, goodsTitle: '合成入口卡标题' })
  expect(f.api.goodsContext(A)).toMatchObject({ goodsId: P1, goodsTitle: '合成入口卡标题' })
})

it('type0 share card supports an explicit numeric string ID and keeps the same card title', () => {
  const f = fixture({ currentUid: B, withWebSocket: true })
  pushCard(f.socket(), {
    id: 'ws-card-0',
    uid: B,
    type: 0,
    productId: P2,
    title: '合成分享卡标题',
    content: '[商品] 合成分享卡标题',
  })
  expect(f.api.pending()[B]).toMatchObject({ goodsId: P2, goodsTitle: '合成分享卡标题' })
  expect(f.api.popPending()).toMatchObject({ uid: B, goodsId: P2, goodsTitle: '合成分享卡标题' })
})

it('legacy top-level fields retain priority and their existing string contract', () => {
  const f = fixture({ currentUid: A, withWebSocket: true })
  f.socket().push({
    msg_id: 'ws-legacy',
    from: { uid: A, role: 'user' },
    type: 41,
    content: '[商品] 顶层标题',
    goods_id: 'legacy-product-key',
    goods_name: '顶层标题',
    info: { goods_info: { goods_id: Number(P1), goods_name: '嵌套标题' } },
    ts: Date.now(),
  })
  expect(f.api.pending()[A]).toMatchObject({
    goodsId: 'legacy-product-key',
    goodsTitle: '顶层标题',
  })
  expect(f.api.popPending()).toMatchObject({
    goodsId: 'legacy-product-key',
    goodsTitle: '顶层标题',
  })
})

it('store ingest carries new type41 and type0 cards into their own UID rows', () => {
  const aConversation = conversation(A, [cardMessage('a-store-card', A, 41, P1, 'A 店铺入口卡')])
  const bConversation = conversation(B, [cardMessage('b-store-card', B, 0, P2, 'B 店铺分享卡')])
  const f = fixture({ currentUid: A, conversations: [aConversation, bConversation] })
  f.api.scanNow()
  expect(f.api.pending()[A]).toMatchObject({ goodsId: P1, goodsTitle: 'A 店铺入口卡' })
  expect(f.api.pending()[B]).toMatchObject({ goodsId: P2, goodsTitle: 'B 店铺分享卡' })
  const events = f.api.drainEvents().events
  expect(events.find((event) => event.msgId === 'a-store-card')).toMatchObject({
    goodsId: P1,
    goodsTitle: 'A 店铺入口卡',
  })
  expect(events.find((event) => event.msgId === 'b-store-card')).toMatchObject({
    goodsId: P2,
    goodsTitle: 'B 店铺分享卡',
  })
})

it('A/B alternating cards stay isolated; B arriving before A is claimed cannot overwrite A', () => {
  const f = fixture({ currentUid: A, withWebSocket: true })
  const socket = f.socket()
  pushCard(socket, {
    id: 'a-card-1',
    uid: A,
    type: 41,
    productId: P1,
    title: 'A 商品一',
    content: '[商品] A 商品一',
  })
  pushCard(socket, {
    id: 'b-card-1',
    uid: B,
    type: 0,
    productId: P2,
    title: 'B 商品二',
    content: '[商品] B 商品二',
  })
  expect(f.api.pending()[A]).toMatchObject({ goodsId: P1, goodsTitle: 'A 商品一' })
  expect(f.api.pending()[B]).toMatchObject({ goodsId: P2, goodsTitle: 'B 商品二' })
  expect(f.api.goodsContext(A)).toMatchObject({ goodsId: P1, goodsTitle: 'A 商品一' })

  const first = f.api.popPending()
  expect(first).toMatchObject({ uid: A, goodsId: P1, goodsTitle: 'A 商品一' })
  const second = f.api.popPending()
  expect(second).toMatchObject({ uid: B, goodsId: P2, goodsTitle: 'B 商品二' })
  expect(f.api.goodsContext(A)).toMatchObject({ goodsId: P1, goodsTitle: 'A 商品一' })
  expect(f.api.goodsContext(B)).toMatchObject({ goodsId: P2, goodsTitle: 'B 商品二' })
})

it('a later card only replaces its own UID row; pure text preserves that row binding', () => {
  const f = fixture({ currentUid: A, withWebSocket: true })
  const socket = f.socket()
  pushCard(socket, {
    id: 'a-card-1',
    uid: A,
    type: 41,
    productId: P1,
    title: 'A 商品一',
    content: '[商品] A 商品一',
  })
  pushCard(socket, {
    id: 'b-card-1',
    uid: B,
    type: 41,
    productId: P3,
    title: 'B 商品三',
    content: '[商品] B 商品三',
  })
  pushCard(socket, {
    id: 'a-card-2',
    uid: A,
    type: 0,
    productId: P2,
    title: 'A 商品二',
    content: '[商品] A 商品二',
  })
  expect(f.api.pending()[A]).toMatchObject({ goodsId: P2, goodsTitle: 'A 商品二' })
  expect(f.api.pending()[B]).toMatchObject({ goodsId: P3, goodsTitle: 'B 商品三' })

  socket.push({
    msg_id: 'a-text-after-card',
    from: { uid: A, role: 'user' },
    type: 1,
    content: '这个款式还有别的颜色吗',
    ts: Date.now(),
  })
  expect(f.api.pending()[A]).toMatchObject({ goodsId: P2, goodsTitle: 'A 商品二' })
  expect(f.api.pending()[A].messages.map((item) => item.msgId)).toContain('a-text-after-card')
})

it('DOM card receives goods only from the same UID and the same native msgId in Vuex', () => {
  const bConversation = conversation(B, [cardMessage('b-native-card', B, 41, P2, 'B 同ID商品卡')])
  const aConversation = conversation(A, [cardMessage('a-native-card', A, 0, P1, 'A 其他商品卡')])
  const f = fixture({
    currentUid: B,
    conversations: [aConversation, bConversation],
    getters: { 'l/todayChatFilter': { fiveMinutesList: [aConversation] } },
  })
  f.window.document.querySelector('.message-list')!.innerHTML = row(
    'b-native-card',
    'buyer',
    '[商品] B 同ID商品卡',
  )
  defineRects(f.window)
  const before = Number(f.api.stats().domIdentityBlocked)
  const stats = f.api.scanNow()
  expect(stats.domIdentityBlocked).toBe(before)
  expect(
    f.api.reviewHistory(B),
    JSON.stringify({ stats, history: f.api.reviewHistory(B) }),
  ).toMatchObject({ known: true })
  expect(f.api.pending()[B]).toMatchObject({ goodsId: P2, goodsTitle: 'B 同ID商品卡' })
  expect(f.api.goodsContext(B)).toMatchObject({ goodsId: P2, goodsTitle: 'B 同ID商品卡' })
  // A has its own store-path product; B must not inherit it.
  expect(f.api.goodsContext(A)).toMatchObject({ goodsId: P1, goodsTitle: 'A 其他商品卡' })
})

it('DOM does not borrow a product for another UID, unknown msgId, or a conflicting role', () => {
  const bConversation = conversation(B, [
    cardMessage('b-native-card', B, 41, P2, 'B 同ID商品卡'),
    textMessage('b-native-text', B, 'B 的纯文字问题'),
  ])
  const aConversation = conversation(A, [cardMessage('a-native-card', A, 0, P1, 'A 其他商品卡')])
  const other = fixture({
    currentUid: B,
    conversations: [aConversation, bConversation],
    getters: { 'l/todayChatFilter': { fiveMinutesList: [aConversation] } },
  })
  other.window.document.querySelector('.message-list')!.innerHTML =
    row('b-native-text', 'buyer', 'B 的纯文字问题') + row('b-new-unknown', 'buyer', 'B 的新行')
  defineRects(other.window)
  const otherBefore = Number(other.api.stats().domIdentityBlocked)
  const otherStats = other.api.scanNow()
  expect(otherStats.domIdentityBlocked, JSON.stringify(otherStats)).toBeGreaterThan(otherBefore)
  expect(other.api.pending()[B]).toBeUndefined()
  expect(other.api.goodsContext(B)).toMatchObject({ goodsId: '', goodsTitle: '' })

  const conflict = fixture({
    currentUid: B,
    conversations: [aConversation, bConversation],
    getters: { 'l/todayChatFilter': { fiveMinutesList: [aConversation] } },
  })
  conflict.window.document.querySelector('.message-list')!.innerHTML = row(
    'b-native-card',
    'cs',
    '[商品] B 同ID商品卡',
  )
  defineRects(conflict.window)
  const conflictBefore = Number(conflict.api.stats().domIdentityBlocked)
  const conflictStats = conflict.api.scanNow()
  expect(conflictStats.domIdentityBlocked, JSON.stringify(conflictStats)).toBeGreaterThan(
    conflictBefore,
  )
  expect(conflict.api.reviewHistory(B).known).toBe(false)
  expect(conflict.api.pending()[B]).toBeUndefined()
})

it.each([0, 41] as const)(
  'type%s uses one atomic source for ID and title, never top title plus nested ID',
  (type) => {
    const f = fixture({ currentUid: A, withWebSocket: true })
    pushCard(f.socket(), {
      id: `atomic-${type}`,
      uid: A,
      type,
      productId: P2,
      title: 'nested new title',
      content: `card atomic ${type}`,
      extra: { goods_name: 'unrelated top title' },
    })
    expect(f.api.pending()[A]).toMatchObject({
      goodsId: P2,
      goodsTitle: 'nested new title',
    })
  },
)

it('a legacy top-level ID keeps its own empty title and does not borrow nested title', () => {
  const f = fixture({ currentUid: A, withWebSocket: true })
  f.socket().push({
    msg_id: 'legacy-id-only',
    from: { uid: A, role: 'user' },
    type: 41,
    content: '[商品] 顶层ID',
    goods_id: 'legacy-product-key',
    info: { goods_info: { goods_id: Number(P1), goods_name: '不应拼接的嵌套标题' } },
    ts: Date.now(),
  })
  expect(f.api.pending()[A]).toMatchObject({
    goodsId: 'legacy-product-key',
    goodsTitle: '',
  })
})

it('a new product ID with missing title clears the previous row title', () => {
  const f = fixture({ currentUid: A, withWebSocket: true })
  pushCard(f.socket(), {
    id: 'old-title',
    uid: A,
    type: 41,
    productId: P1,
    title: 'old title',
    content: 'old product',
  })
  pushCard(f.socket(), {
    id: 'new-no-title',
    uid: A,
    type: 41,
    productId: P2,
    content: 'new product',
  })
  expect(f.api.pending()[A]).toMatchObject({ goodsId: P2, goodsTitle: '' })
})

it('title-only metadata never combines with an existing product ID', () => {
  const f = fixture({ currentUid: A, withWebSocket: true })
  pushCard(f.socket(), {
    id: 'id-title',
    uid: A,
    type: 41,
    productId: P1,
    title: 'old title',
    content: 'old product',
  })
  f.socket().push({
    msg_id: 'title-only',
    from: { uid: A, role: 'user' },
    type: 1,
    content: 'ordinary text with unrelated title metadata',
    goods_name: 'title-only metadata',
    ts: Date.now(),
  })
  expect(f.api.pending()[A]).toMatchObject({
    goodsId: P1,
    goodsTitle: 'old title',
  })
})

it('different native product cards with the same placeholder body are not text-deduped', () => {
  const f = fixture({ currentUid: A, withWebSocket: true })
  pushCard(f.socket(), {
    id: 'placeholder-first',
    uid: A,
    type: 41,
    productId: P1,
    title: 'first product',
    content: '[乐高卡片]',
  })
  pushCard(f.socket(), {
    id: 'placeholder-second',
    uid: A,
    type: 41,
    productId: P2,
    title: 'second product',
    content: '[乐高卡片]',
  })
  expect(f.api.pending()[A]).toMatchObject({
    goodsId: P2,
    goodsTitle: 'second product',
  })
  expect(f.api.pending()[A].messages.map((item) => item.msgId)).toContain('placeholder-second')
})

it('plain text with legacy goods metadata keeps normal text dedupe', () => {
  const f = fixture({ currentUid: A, withWebSocket: true })
  const socket = f.socket()
  for (const [id, goodsId] of [
    ['legacy-text-1', 'legacy-key-one'],
    ['legacy-text-2', 'legacy-key-two'],
  ])
    socket.push({
      msg_id: id,
      from: { uid: A, role: 'user' },
      type: 1,
      content: '同一条普通文字',
      goods_id: goodsId,
      goods_name: 'legacy title',
      ts: Date.now(),
    })
  const pendingRow = f.api.pending()[A]
  expect(
    pendingRow.messages.map((item) => item.msgId).filter((id) => id.startsWith('legacy-text')),
  ).toEqual(['legacy-text-1'])
  expect(pendingRow).toMatchObject({
    goodsId: 'legacy-key-one',
    goodsTitle: 'legacy title',
  })
})

it.each([0, 41] as const)('info-only store card type%s enters the queue with goods', (type) => {
  const card = cardMessage(`info-only-${type}`, A, type, P1, 'info only title')
  delete card.content
  const f = fixture({ currentUid: A, conversations: [conversation(A, [card])] })
  f.api.scanNow()
  expect(f.api.pending()[A]).toMatchObject({
    goodsId: P1,
    goodsTitle: 'info only title',
  })
})

it('a same-UID card without explicit goods never borrows another UID product', () => {
  const bConversation = conversation(B, [
    {
      msg_id: 'b-no-goods-card',
      from: { role: 'user', uid: B },
      type: 41,
      content: '[商品] B 无字段卡',
      info: { goods_info: [] },
      ts: Date.now(),
    },
  ])
  const aConversation = conversation(A, [cardMessage('a-native-card', A, 0, P1, 'A 其他商品卡')])
  const f = fixture({
    currentUid: B,
    conversations: [aConversation, bConversation],
    getters: { 'l/todayChatFilter': { fiveMinutesList: [aConversation] } },
  })
  f.window.document.querySelector('.message-list')!.innerHTML = row(
    'b-no-goods-card',
    'buyer',
    '[商品] B 无字段卡',
  )
  defineRects(f.window)
  f.api.scanNow()
  expect(f.api.reviewHistory(B).known).toBe(true)
  expect(f.api.pending()[B]).toMatchObject({ goodsId: '', goodsTitle: '' })
  expect(f.api.goodsContext(B)).toMatchObject({ goodsId: '', goodsTitle: '' })
})

it('release restores the same claimed product; discard removes only that UID claim', () => {
  const f = fixture({ currentUid: A, withWebSocket: true })
  pushCard(f.socket(), {
    id: 'claim-card',
    uid: A,
    type: 41,
    productId: P1,
    title: 'A 认领商品',
    content: '[商品] A 认领商品',
  })
  expect(f.api.popPending()).toMatchObject({ uid: A, goodsId: P1 })
  expect(f.api.goodsContext(A)).toMatchObject({ goodsId: P1, goodsTitle: 'A 认领商品' })
  expect(f.api.releasePendingClaim(A)).toBe(true)
  expect(f.api.goodsContext(A)).toMatchObject({ goodsId: P1, goodsTitle: 'A 认领商品' })
  expect(f.api.popPending()).toMatchObject({ uid: A, goodsId: P1 })
  expect(f.api.goodsContext(B)).toMatchObject({ goodsId: '', goodsTitle: '' })
  expect(f.api.discardClaim(A)).toBe(true)
  expect(f.api.goodsContext(A)).toMatchObject({ goodsId: '', goodsTitle: '' })
})

it('historical card plus a new text does not backfill; a deduped old card cannot pollute the new row', () => {
  const old = Date.now() - 10 * 60 * 1000
  const oldCard = cardMessage('history-card', A, 41, P1, '历史商品卡', old)
  const aConversation = conversation(A, [oldCard])
  const f = fixture({ currentUid: A, conversations: [aConversation] })
  f.api.scanNow()
  expect(f.api.pending()[A]).toBeUndefined()

  aConversation.messageList.push(textMessage('new-text', A, '这个尺寸怎么选'))
  f.api.scanNow()
  expect(f.api.pending()[A]).toMatchObject({ goodsId: '', goodsTitle: '' })
  expect(f.api.goodsContext(A)).toMatchObject({ goodsId: '', goodsTitle: '' })

  // Replaying the old card after the text row exists must be absorbed by the same
  // watermark/seen path and must not attach its product to the new unanswered row.
  aConversation.messageList.push({ ...oldCard })
  f.api.scanNow()
  expect(f.api.pending()[A]).toMatchObject({ goodsId: '', goodsTitle: '' })
  expect(f.api.pending()[A].messages.map((item) => item.msgId)).toEqual(['new-text'])
})

it('malformed nested objects, non-numeric IDs, wrong card types and generic text never infer a product', () => {
  const f = fixture({ currentUid: A, withWebSocket: true })
  const socket = f.socket()
  const cases: Array<{ uid: string; id: string; type: number; info: unknown; content: string }> = [
    {
      uid: 'synthetic-malformed-array',
      id: 'bad-array',
      type: 41,
      info: { goods_info: [] },
      content: '[商品] 数组',
    },
    {
      uid: 'synthetic-malformed-object',
      id: 'bad-object',
      type: 41,
      info: { goods_info: { goods_id: { value: P1 }, goods_name: { text: '对象标题' } } },
      content: '[商品] 对象',
    },
    {
      uid: 'synthetic-nonnumeric',
      id: 'bad-alpha',
      type: 41,
      info: { goods_info: { goods_id: 'product-abc', goods_name: '非数字标题' } },
      content: '[商品] 非数字',
    },
    {
      uid: 'synthetic-float',
      id: 'bad-float',
      type: 0,
      info: { goodsID: 1.2, goodsName: '浮点标题' },
      content: '[商品] 浮点',
    },
    {
      uid: 'synthetic-short',
      id: 'bad-short',
      type: 0,
      info: { goodsID: 12345, goodsName: '过短标题' },
      content: '[商品] 过短',
    },
    {
      uid: 'synthetic-long',
      id: 'bad-long',
      type: 0,
      info: { goodsID: '1'.repeat(33), goodsName: '过长标题' },
      content: '[商品] 过长',
    },
    {
      uid: 'synthetic-wrong-type',
      id: 'bad-type',
      type: 31,
      info: { goods_info: { goods_id: P1, goods_name: '错误类型标题' } },
      content: '[商品] 错误类型',
    },
    {
      uid: 'synthetic-generic',
      id: 'bad-generic',
      type: 1,
      info: { goods_info: { goods_id: P1, goods_name: '泛文本标题' } },
      content: `商品ID ${P1}，标题猜测`,
    },
  ]
  for (const item of cases)
    socket.push({
      msg_id: item.id,
      from: { uid: item.uid, role: 'user' },
      type: item.type,
      content: item.content,
      info: item.info,
      ts: Date.now(),
    })
  for (const item of cases) {
    expect(f.api.pending()[item.uid], item.uid).toMatchObject({ goodsId: '', goodsTitle: '' })
    expect(f.api.goodsContext(item.uid), item.uid).toMatchObject({ goodsId: '', goodsTitle: '' })
  }
  const genericEvent = f.api.drainEvents().events.find((event) => event.msgId === 'bad-generic')
  // An unknown product may have no goodsId property or an empty value; both are unknown.
  expect(genericEvent?.goodsId || '').toBe('')
  expect(genericEvent?.goodsTitle || '').toBe('')
})

import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { afterEach, expect, it } from 'vitest'

// 真实 1.0.62 实店结构（内容为本测试合成，不含客户数据）：
// - 左侧联系人预览：.chat-list ul li .chat-item-box[data-random] p.chat-message-content
// - 中间真实消息行：li#middlePanel_list_<msgId>.clearfix.onemsg
//   > div.merchantMessage（所有行都有的包裹层，不是卖家标记）
//   > div.cs-item（卖家）/ div.buyer-item（买家）
//   > div.msg-content > p.msg-content-box（正文）
// 旧实现把左侧预览当气泡，并把 .merchantMessage 当卖家标记。
const source = readFileSync('vendor/lingtu-runtime/desk-v1/src/injections/pdd-web-hook.js', 'utf8')
const { JSDOM } = createRequire(import.meta.url)('jsdom') as {
  JSDOM: new (
    html: string,
    options: { url: string; runScripts: string },
  ) => { window: Window & typeof globalThis }
}
const pages: Array<{ window: Window & typeof globalThis }> = []
afterEach(() => {
  for (const page of pages.splice(0)) page.window.close()
})

interface StoreMessage {
  msg_id: string
  from?: { role?: string; uid?: string }
  content: string
  ts: number
}
interface Conversation {
  userInfo: { uid: string; nickname?: string }
  messageList: StoreMessage[]
}
interface HookApi {
  pending(): Record<string, { messages: Array<{ msgId?: string; from: string; content: string }> }>
  sent(uid: string): Array<{ from: string; content: string }>
  reviewHistory(uid: string): {
    known: boolean
    messages: Array<{ from: string; content: string }>
    reason?: string
  }
  scanNow(): Record<string, number>
  currentUid(): string
  sendText(uid: string, text: string): Promise<{ ok: boolean; reason?: string }>
}

function preview(uid: string, text: string) {
  return (
    `<div class="chat-item"><div class="chat-item-box" data-random="${uid}-0-reply">` +
    `<div class="bottom-message"><div class="chat-detail">` +
    `<p class="chat-message-content">${text}</p></div></div></div></div>`
  )
}

function row(id: string, side: 'cs' | 'buyer' | 'none', text: string, extra = '') {
  const inner =
    side === 'none'
      ? `<div><div class="msg-content good-card">${text}</div></div>`
      : `<div class="${side === 'cs' ? 'cs-item' : 'buyer-item'}">` +
        `<span><img class="avatar"></span><div><div class="msg-content"><p class="msg-content-box">${text}</p></div></div>` +
        `</div>`
  return `<li id="middlePanel_list_${id}" class="clearfix onemsg">${extra}<div class="merchantMessage">${inner}</div></li>`
}

function mount(options: {
  currentUid: string
  current?: Conversation
  conversations?: Conversation[]
  todayChatList?: Conversation[]
  searchChatList?: Conversation[]
  getters?: Record<string, unknown>
  previews: string[]
  rows: string[]
}) {
  const page = new JSDOM(
    `<div id="app"><div class="chat-list"><ul class="already-unreply">${options.previews.join('')}</ul></div></div>` +
      `<div class="middlePanel"><ul class="message-list">${options.rows.join('')}</ul></div>` +
      `<div class="composer"><div id="editor" contenteditable="true"></div><button id="send">发送</button></div>`,
    { url: 'https://mms.pinduoduo.com/chat-merchant/index.html', runScripts: 'outside-only' },
  )
  pages.push(page)
  const { window } = page
  const editor = window.document.querySelector('#editor')!
  window.document.querySelector('#send')!.addEventListener('click', () => {
    editor.innerHTML = ''
  })
  const all = [
    ...(options.conversations ?? []),
    ...(options.todayChatList ?? []),
    ...(options.searchChatList ?? []),
  ]
  const current =
    options.current ?? all.find((conversation) => conversation.userInfo.uid === options.currentUid)!
  Object.assign(window.document.querySelector('#app')!, {
    __vue__: {
      $store: {
        state: {
          selectingChatUid: options.currentUid,
          currentUserInfo: current,
          chatList: options.conversations ?? [],
          todayChatList: options.todayChatList,
          searchChatList: options.searchChatList,
        },
        getters: options.getters ?? {},
      },
    },
  })
  for (const node of window.document.querySelectorAll('*'))
    Object.defineProperty(node, 'getBoundingClientRect', {
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
  window.eval(source)
  const api = Reflect.get(window, '__pddWeb') as HookApi
  return { window, api }
}

const A = '111111'
const B = '222222'
const now = Date.now()

function convA(): Conversation {
  return {
    userInfo: { uid: A, nickname: 'A' },
    messageList: [
      { msg_id: '9000000000001', from: { role: 'user', uid: A }, content: 'A 的问题', ts: now },
      {
        msg_id: '9000000000002',
        from: { role: 'mall_cs', uid: 'seller1' },
        content: 'A 的答复',
        ts: now + 1,
      },
    ],
  }
}
function convB(): Conversation {
  return {
    userInfo: { uid: B, nickname: 'B' },
    messageList: [
      { msg_id: '8000000000001', from: { role: 'user', uid: B }, content: 'B 的私有问题', ts: now },
    ],
  }
}

it('中间消息行按 ID/正文归属当前买家时 known=true，角色来自同一消息的明确 Vuex role，左侧预览不进入采集', () => {
  const { api } = mount({
    currentUid: A,
    conversations: [convA(), convB()],
    previews: [preview(A, 'A 的问题'), preview(B, 'B 的私有问题'), preview(B, 'B 的隐藏缓存')],
    rows: [row('9000000000001', 'buyer', 'A 的问题'), row('9000000000002', 'cs', 'A 的答复')],
  })
  const history = api.reviewHistory(A)
  expect(history.known).toBe(true)
  expect(history.messages.map((m) => [m.from, m.content])).toEqual([
    ['buyer', 'A 的问题'],
    ['seller', 'A 的答复'],
  ])
  expect(api.pending()[A].messages.map((m) => [m.from, m.content])).toEqual([['buyer', 'A 的问题']])
  expect(api.pending()[A].messages.map((m) => m.content)).not.toContain('B 的私有问题')
  // B 的 Vuex 消息可正常入库，但左侧预览里的隐藏缓存文本不得被当成消息。
  expect(api.pending()[B]?.messages.map((m) => m.content) ?? []).not.toContain('B 的隐藏缓存')
  expect(api.pending()[A].messages.map((m) => m.content)).not.toContain('B 的隐藏缓存')
  expect(api.sent(A).map((m) => m.content)).toEqual(['A 的答复'])
})

it('getter 仅含 A 时，conversationFor 只从原始列表精确补 B，B 基线与 pending 不串 A', () => {
  const currentB = convB()
  const { api } = mount({
    currentUid: B,
    current: currentB,
    conversations: [convA(), currentB],
    getters: { 'l/todayChatFilter': { fiveMinutesList: [convA()] } },
    previews: [preview(A, 'A 的问题'), preview(B, 'B 的私有问题')],
    rows: [row('8000000000001', 'buyer', 'B 的私有问题')],
  })
  const history = api.reviewHistory(B)
  expect(history.known).toBe(true)
  expect(history.messages.map((m) => [m.from, m.content])).toEqual([['buyer', 'B 的私有问题']])
  expect(api.pending()[B].messages.map((m) => m.content)).toEqual(['B 的私有问题'])
  expect(api.pending()[B].messages.map((m) => m.content)).not.toContain('A 的问题')
  // 主采集仍保留原 getter 范围，A 正常入自己的 pending；fallback 只补 B 的精确查询，不串内容。
  expect(api.pending()[A].messages.map((m) => m.content)).toEqual(['A 的问题'])
})

it('目标买家在所有原始列表缺失时，仅 currentUserInfo 不能生成网页基线', () => {
  const currentB = convB()
  const { api } = mount({
    currentUid: B,
    current: currentB,
    conversations: [],
    getters: {},
    previews: [],
    rows: [row('8000000000001', 'buyer', 'B 的私有问题')],
  })
  const history = api.reviewHistory(B)
  expect(history.known).toBe(false)
  expect(history.reason).toBe('conversation_identity_unconfirmed')
  expect(api.pending()[B]).toBeUndefined()
})

it('原始列表唯一副本与 current 的 latestID 不一致时保持 fail closed', () => {
  const currentB = convB()
  const stale = convB()
  stale.messageList[0].msg_id = '8000000000002'
  const { api } = mount({
    currentUid: B,
    current: currentB,
    conversations: [stale],
    getters: { 'l/todayChatFilter': { fiveMinutesList: [convA()] } },
    previews: [],
    rows: [row('8000000000001', 'buyer', 'B 的私有问题')],
  })
  const history = api.reviewHistory(B)
  expect(history.known).toBe(false)
  expect(history.reason).toBe('conversation_identity_unconfirmed')
  expect(api.pending()[B]).toBeUndefined()
})

it('同 UID 的原始列表多份副本 latestID 冲突时不挑选“最像 current”的一份', () => {
  const currentB = convB()
  const newer = convB()
  newer.messageList.push({
    msg_id: '8000000000002',
    from: { role: 'buyer', uid: B },
    content: 'B 的后续问题',
    ts: now + 2,
  })
  const { api } = mount({
    currentUid: B,
    current: currentB,
    conversations: [currentB],
    searchChatList: [newer],
    getters: { 'l/todayChatFilter': { fiveMinutesList: [convA()] } },
    previews: [],
    rows: [row('8000000000001', 'buyer', 'B 的私有问题')],
  })
  const history = api.reviewHistory(B)
  expect(history.known).toBe(false)
  expect(history.reason).toBe('conversation_identity_unconfirmed')
  expect(api.pending()[B]).toBeUndefined()
})

it('fallback 补到 B 后，中间行出现外国 ID 仍 fail closed', () => {
  const currentB = convB()
  const { api } = mount({
    currentUid: B,
    current: currentB,
    conversations: [convA(), currentB],
    getters: { 'l/todayChatFilter': { fiveMinutesList: [convA()] } },
    previews: [],
    rows: [
      row('8000000000001', 'buyer', 'B 的私有问题'),
      row('9000000000001', 'buyer', 'A 的问题'),
    ],
  })
  const history = api.reviewHistory(B)
  expect(history.known).toBe(false)
  expect(history.reason).toBe('conversation_identity_unconfirmed')
  expect(api.pending()[B]).toBeUndefined()
})

it('fallback 补到 B 后，DOM 与同 ID Vuex 角色冲突仍 fail closed', () => {
  const currentB = convB()
  const { api } = mount({
    currentUid: B,
    current: currentB,
    conversations: [currentB],
    getters: { 'l/todayChatFilter': { fiveMinutesList: [convA()] } },
    previews: [],
    rows: [row('8000000000001', 'cs', 'B 的私有问题')],
  })
  const history = api.reviewHistory(B)
  expect(history.known).toBe(false)
  expect(history.reason).toBe('conversation_identity_unconfirmed')
  expect(api.pending()[B]).toBeUndefined()
})

it('fallback 补到 B 后，未知新 ID 仍不进入已知基线', () => {
  const currentB = convB()
  const { api } = mount({
    currentUid: B,
    current: currentB,
    conversations: [currentB],
    getters: { 'l/todayChatFilter': { fiveMinutesList: [convA()] } },
    previews: [],
    rows: [
      row('8000000000001', 'buyer', 'B 的私有问题'),
      row('8000000000009', 'buyer', '未同步的新消息'),
    ],
  })
  const history = api.reviewHistory(B)
  expect(history.known).toBe(false)
  expect(history.reason).toBe('conversation_identity_unconfirmed')
  expect(api.pending()[B]).toBeUndefined()
})

it('中间行 ID 与当前买家已知消息不完全对应时 fail closed，不采信任何预览文本', () => {
  const { api } = mount({
    currentUid: A,
    conversations: [convA(), convB()],
    previews: [preview(A, 'A 的问题'), preview(B, 'B 的私有问题')],
    rows: [
      row('9000000000001', 'buyer', 'A 的问题'),
      row('8000000000001', 'buyer', 'B 的私有问题'),
    ],
  })
  const history = api.reviewHistory(A)
  expect(history.known).toBe(false)
  expect(api.pending()[A].messages.map((m) => m.content)).not.toContain('B 的私有问题')
})

it('已有一条已知消息时，新增一条有 knownId 但无明确角色的可见行仍 fail closed', () => {
  const conversation = convA()
  conversation.messageList.push({ msg_id: '9000000000003', content: '未知新行', ts: now + 2 })
  const { api } = mount({
    currentUid: A,
    conversations: [conversation],
    previews: [],
    rows: [row('9000000000001', 'buyer', 'A 的问题'), row('9000000000003', 'none', '未知新行')],
  })
  const history = api.reviewHistory(A)
  expect(history.known).toBe(false)
  expect(history.reason).toBe('role_unconfirmed')
  expect(history.messages).toEqual([])
  expect(api.pending()[A].messages.map((m) => m.content)).not.toContain('未知新行')
  // 页面不完整时，基线也不能只看已知行。
  expect(api.pending()[A].messages.map((m) => m.content)).not.toContain('未知新行')
})

it('时间、昵称、机器人标签、菜单项、卡片价格和按钮不进入正文指纹', () => {
  const conversation = convA()
  const noisy = (clock: string, nick: string, menu: string) =>
    `<li id="middlePanel_list_9000000000001" class="clearfix onemsg"><div class="merchantMessage">` +
    `<div class="buyer-item"><p class="message-time">${clock}</p><span class="nickname">${nick}</span>` +
    `<span class="robot-text">机器人</span><div class="msg-content">` +
    `<p class="msg-content-box">A 的问题</p>` +
    `<div class="floor_item menu_item disabled">${menu}</div>` +
    `<span class="good-price">￥99</span><button class="btn">按钮</button>` +
    `</div></div></div></li>`
  const { api, window } = mount({
    currentUid: A,
    conversations: [conversation],
    previews: [preview(A, 'A 的问题')],
    rows: [noisy('12:00', '买家昵称', '菜单一')],
  })
  const first = api.reviewHistory(A)
  expect(first.known).toBe(true)
  expect(first.messages.map((m) => m.content)).toEqual(['A 的问题'])
  window.document.querySelector('.message-time')!.textContent = '23:59'
  window.document.querySelector('.nickname')!.textContent = '另一个昵称'
  window.document.querySelector('.menu_item')!.textContent = '菜单二'
  const second = api.reviewHistory(A)
  expect(second.messages).toEqual(first.messages)
})

it('左侧预览同文、买家同文都不算卖家回显候选；旧卖家同文只作为发送前基数', () => {
  const conversation = convA()
  conversation.messageList[0].content = '同文答复'
  conversation.messageList[1].content = '同文答复'
  const { api } = mount({
    currentUid: A,
    conversations: [conversation],
    previews: [preview(A, '同文答复'), preview(B, '同文答复')],
    rows: [row('9000000000001', 'buyer', '同文答复'), row('9000000000002', 'cs', '同文答复')],
  })
  const history = api.reviewHistory(A)
  expect(history.messages.map((m) => [m.from, m.content])).toEqual([
    ['buyer', '同文答复'],
    ['seller', '同文答复'],
  ])
  // 只有目标会话中明确 seller 的行参与回显计数（sellerEchoCount 与 reviewHistory 同口径），
  // 左侧预览从不计数；发送前已有的 seller 同文进入基数，确认时必须看到基数增长。
  expect(history.messages.filter((m) => m.from === 'seller')).toHaveLength(1)
})

it('中间行缺少明确方向标记且已知数据无角色时不能当成买家', () => {
  const conversation = convA()
  delete conversation.messageList[0].from
  conversation.messageList[0].content = '未知方向内容'
  const { api } = mount({
    currentUid: A,
    conversations: [conversation],
    previews: [],
    rows: [row('9000000000001', 'none', '未知方向内容')],
  })
  const history = api.reviewHistory(A)
  expect(history.known).toBe(false)
  expect(history.messages.map((m) => m.from)).not.toContain('buyer')
  expect(api.pending()[A]?.messages.map((m) => m.content) ?? []).not.toContain('未知方向内容')
})

it('回显不认其他买家/旧会话的 cs-item 同文行，发送保持未确认且不补发', async () => {
  const conversation = convA()
  const other = convB()
  other.messageList.push({
    msg_id: '8000000000002',
    from: { role: 'mall_cs', uid: 'seller-b' },
    content: 'approved response',
    ts: now + 5,
  })
  const { api } = mount({
    currentUid: A,
    conversations: [conversation, other],
    previews: [],
    rows: [
      row('9000000000001', 'buyer', 'A 的问题'),
      row('8000000000002', 'cs', 'approved response'),
    ],
  })
  expect(api.reviewHistory(A).known).toBe(false)
  const sending = api.sendText(A, 'approved response')
  await expect(sending).resolves.toMatchObject({ ok: false, reason: 'send_unconfirmed' })
}, 15000)

it('目标会话的新 seller 行先于 Vuex 角色时等待补全，补全后确认一次', async () => {
  const conversation = convA()
  const { api } = mount({
    currentUid: A,
    conversations: [conversation],
    previews: [],
    rows: [row('9000000000001', 'buyer', 'A 的问题'), row('9000000000010', 'cs', '新答复')],
  })
  const sending = api.sendText(A, '新答复')
  await new Promise((resolve) => setTimeout(resolve, 700))
  conversation.messageList.push({
    msg_id: '9000000000010',
    from: { role: 'mall_cs', uid: 'seller-a' },
    content: '新答复',
    ts: now + 6,
  })
  await expect(sending).resolves.toMatchObject({ ok: true })
}, 15000)

it('隐藏菜单/浮层文本不进入正文或待回复', () => {
  const conversation = convA()
  const hidden =
    `<li id="middlePanel_list_9000000000001" class="clearfix onemsg"><div class="merchantMessage">` +
    `<div class="buyer-item"><div class="msg-content"><p class="msg-content-box">A 的问题</p>` +
    `<div class="floor_item text" style="display:none">copy</div></div></div></div></li>`
  const { api } = mount({
    currentUid: A,
    conversations: [conversation],
    previews: [],
    rows: [hidden],
  })
  const history = api.reviewHistory(A)
  expect(history.known).toBe(true)
  expect(history.messages.map((m) => m.content)).toEqual(['A 的问题'])
  expect(api.pending()[A].messages.map((m) => m.content)).toEqual(['A 的问题'])
})

it('延迟 DOM 扫描复用原生 msgId，不以独立前缀重复入队', () => {
  const { api } = mount({
    currentUid: A,
    conversations: [convA()],
    previews: [],
    rows: [row('9000000000001', 'buyer', 'A 的问题')],
  })
  api.scanNow()
  api.scanNow()
  const rows = api.pending()[A].messages.filter((m) => m.content === 'A 的问题')
  expect(rows).toHaveLength(1)
  expect(rows[0].msgId).toBe('9000000000001')
})

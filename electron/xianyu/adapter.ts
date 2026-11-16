import type { WebContents } from 'electron'
import type { XianyuBridgeLogger } from './bridge-client'

/**
 * 闲鱼网页版适配器（Adapter Contract v2）。
 *
 * 页面侧能力来自 kb-port 的原版 bridge.js（见 vendor/xianyu-bridge/PROVENANCE.md），
 * 本文件只做宿主侧决策：什么时候切会话、哪些买家消息算待回复、发送后如何核对。
 *
 * 与拼多多/抖店的差异：
 * - 闲鱼按「买家 × 商品」开会话，没有稳定 buyer id；uid 使用会话列表的昵称键，
 *   同名多项由 activateChat 按未读/当前项挑选，挑不出就报 ambiguous，不猜。
 * - 闲鱼消息没有平台 msgId，也没有绝对时间；msgId 由「时间标签 + 组内序号」合成，
 *   ts 按 HH:MM 换算为当天时间，仅用于排序与恢复窗口，不冒充平台时间。
 * - 「没有待回复」以会话里最后一条是我方消息为准：卖家（人工或 AI）已经回过，
 *   就不再生成新的回复；绝不根据未读红点单独判断内容。
 */

const PLATFORM_ID = 'xianyu'
const PLATFORM_NAME = '闲鱼'
const SEND_TEXT = '发送'
const IMAGE_CONFIRM_TITLE = '确定发送以下图片'
const VERIFICATION_NEEDLES = ['验证', '安全验证', '请完成', '滑动']
const DISCONNECTED_NEEDLES = ['连接失败', '重连', '网络异常', '连接已断开']
const BLOCKED_NICKS = ['闲小蜜', '通知消息', '系统消息']
const DIALOG_ROOTS = '[role="dialog"], .ant-modal, .ant-message, .ant-notification'

export const XIANYU_SELECTORS = Object.freeze({
  chatArea: 'main[class*="chat-main--"]',
  conversationItem: '[class*="conversation-item--"]',
  conversationActive: '[class*="conversation-item-active--"]',
  conversationNick: '.ant-skeleton + div > div:first-child',
  paneNick: '[class*="message-topbar--"] [class*="text1--"]',
  messageContent: '[class*="message-content--"]',
  messageText: '[class*="message-text--"]',
  messageLeft: '[class*="message-text-left--"]',
  messageRight: '[class*="message-text-right--"]',
  messageImage: '[class*="image-container--"] img',
  messageProductCard: '[data-spm="im_item_card"]',
  unreadMarker: 'sup.ant-badge-count:not(.ant-badge-zoom-leave)',
  input: '[class*="sendbox--"] textarea.ant-input',
  sendContainer: '[class*="sendbox-bottom--"]',
  loginModal: '[class*="login-modal-wrap--"]',
})

export type XianyuFailReason =
  | 'hook_not_ready'
  | 'input_not_found'
  | 'input_busy'
  | 'send_unconfirmed'
export type XianyuResult = { ok: true } & Record<string, unknown>
export type XianyuFailure = { ok: false; reason: XianyuFailReason; detail: string }

const ok = (extra: Record<string, unknown> = {}): XianyuResult => ({ ok: true, ...extra })
const fail = (reason: XianyuFailReason, detail: string): XianyuFailure => ({
  ok: false,
  reason,
  detail: detail.slice(0, 300),
})

export interface XianyuStore {
  id: string
  storeName?: string
  platform?: string
}

export interface XianyuBridge {
  invoke(op: string, args?: Record<string, unknown>, timeoutMs?: number): Promise<unknown>
  ensureInjected?(): Promise<void>
  waitEvent?(name: string, timeoutMs?: number): Promise<unknown>
  isAlive?(): boolean
  focus?(): void
  getURL?(): string
  dispose?(): void
}

export interface XianyuAdapterOptions {
  store: XianyuStore
  /** 测试或宿主已建好桥时直接注入。 */
  bridge?: XianyuBridge
  getWebContents?: () => WebContents | null
  createBridge?: (webContents: WebContents) => XianyuBridge
  logger?: XianyuBridgeLogger
  now?: () => number
  /** 测试可注入零等待；生产使用真实定时器。 */
  sleep?: (ms: number) => Promise<void>
  /** 登录成功后由宿主重新执行店铺健康检查，把在线状态刷回快照。 */
  onAuthenticated?: () => void
  /** 登录态复查间隔；默认 5 秒，测试可缩短。 */
  authPollMs?: number
}

export interface XianyuLocalMessage {
  msgId: string
  from: 'buyer' | 'seller'
  type: 'text' | 'image' | 'card'
  content: string
  ts: number
}

export interface XianyuMessageEvent {
  seq: number
  uid: string
  username: string
  from: 'buyer' | 'seller'
  type: string
  content: string
  msgId: string
  ts: number
}

interface XianyuConversation {
  nick: string
  messages: XianyuLocalMessage[]
  productId: string
  productTitle: string
  activeCount: number
}

class XianyuActivationError extends Error {}

const defaultLogger: XianyuBridgeLogger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function isTransportError(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && Reflect.get(error, 'code') === 'bridge_transport'
  )
}

function recordOf(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function squeeze(value: string): string {
  return String(value ?? '').replace(/\s+/g, '')
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

const TIME_TAG = /^(\d{1,2}):(\d{2})(?:#(\d+))?$/

/**
 * 闲鱼只给「HH:MM#组内序号」，没有日期。换算为当天本地时间；比当前时间晚
 * 超过一分钟的时间标签视为昨天的消息（跨零点），组内序号补秒用于稳定排序。
 */
export function xianyuTimestamp(tag: string, now: number): number {
  const match = TIME_TAG.exec(String(tag ?? '').trim())
  if (!match) return now
  const date = new Date(now)
  date.setHours(Number(match[1]), Number(match[2]), 0, 0)
  let value = date.getTime()
  if (value > now + 60_000) value -= 86_400_000
  const order = Number(match[3] ?? 0)
  if (order > 0) value += Math.min(order, 59) * 1000
  return value
}

function contentOf(message: Record<string, unknown>): {
  type: 'text' | 'image' | 'card'
  content: string
} {
  if (message.isImage === true) return { type: 'image', content: '[图片]' }
  if (message.isProduct === true) {
    const title = typeof message.productTitle === 'string' ? message.productTitle.trim() : ''
    return { type: 'card', content: title ? `[商品] ${title}` : '[商品]' }
  }
  return { type: 'text', content: String(message.body ?? '') }
}

/** 把页面 readChat 的消息映射成引擎使用的稳定形状；方向读不出的消息不猜。 */
export function toLocalMessages(uid: string, raw: unknown, now: number): XianyuLocalMessage[] {
  if (!Array.isArray(raw)) return []
  const out: XianyuLocalMessage[] = []
  raw.forEach((item, index) => {
    const message = recordOf(item)
    if (!message) return
    const side = message.side === 'left' ? 'buyer' : message.side === 'right' ? 'seller' : null
    if (!side) return
    const tag = typeof message.ts === 'string' ? message.ts.trim() : ''
    const { type, content } = contentOf(message)
    if (!content) return
    out.push({
      msgId: `xy:${uid}:${tag || `#${index}`}`,
      from: side,
      type,
      content,
      ts: xianyuTimestamp(tag, now),
    })
  })
  return out.sort((left, right) => left.ts - right.ts)
}

/** 买家消息只有落在最后一条我方消息之后才算待回复；卖家已回过就不再生成。 */
export function freshBuyerMessages(messages: XianyuLocalMessage[]): XianyuLocalMessage[] {
  let lastSeller = -1
  for (let index = 0; index < messages.length; index++) {
    if (messages[index]?.from === 'seller') lastSeller = index
  }
  return messages.slice(lastSeller + 1).filter((message) => message.from === 'buyer')
}

function sameBuyer(left: string, right: string): boolean {
  const base = (value: string) => value.split('#')[0] ?? value
  return left === right || base(left) === base(right)
}

function parseConversation(value: unknown, uid: string, now: number): XianyuConversation | null {
  const record = recordOf(value)
  if (!record) return null
  const nick = typeof record.buyerNick === 'string' ? record.buyerNick.trim() : ''
  const activeCount = Number(record.activeCount)
  return {
    nick,
    messages: toLocalMessages(uid, record.messages, now),
    productId: typeof record.productId === 'string' ? record.productId : '',
    productTitle: typeof record.product === 'string' ? record.product : '',
    activeCount: Number.isFinite(activeCount) ? activeCount : 1,
  }
}

export class XianyuAdapter {
  readonly id = PLATFORM_ID
  readonly accessMode = 'webview'
  readonly platform = PLATFORM_ID
  readonly platformName = PLATFORM_NAME
  readonly storeId: string
  readonly storeName: string

  #directBridge: XianyuBridge | undefined
  #bridge: XianyuBridge | undefined
  #bridgeOwner: WebContents | null = null
  #getWebContents: (() => WebContents | null) | undefined
  #createBridge: ((webContents: WebContents) => XianyuBridge) | undefined
  #logger: XianyuBridgeLogger
  #now: () => number
  #sleep: (ms: number) => Promise<void>
  #onAuthenticated: (() => void) | undefined
  #authPollMs: number
  #authTimer: NodeJS.Timeout | undefined
  #authenticated: boolean | null = null
  #claimed = new Set<string>()
  #claimedRows = new Map<string, XianyuLocalMessage[]>()
  #acked = new Map<string, Set<string>>()
  #events: XianyuMessageEvent[] = []
  #seen = new Map<string, Set<string>>()
  #seq = 0
  #lastSampleAt = 0
  #sampling = false

  constructor(options: XianyuAdapterOptions) {
    this.storeId = String(options.store.id)
    this.storeName = String(options.store.storeName || options.store.id)
    this.#directBridge = options.bridge
    this.#getWebContents = options.getWebContents
    this.#createBridge = options.createBridge
    this.#logger = options.logger || defaultLogger
    this.#now = options.now || Date.now
    this.#sleep = options.sleep || sleep
    this.#onAuthenticated = options.onAuthenticated
    this.#authPollMs =
      Number.isFinite(options.authPollMs) && Number(options.authPollMs) > 0
        ? Number(options.authPollMs)
        : 5_000
  }

  supports(): XianyuResult {
    return ok()
  }

  /** 渲染层登录态：null 表示尚未检查，不能把「没检查」显示成「未登录」。 */
  authenticated(): boolean | null {
    return this.#authenticated
  }

  /** 供店铺缩放等宿主能力复用同一个页面对象。 */
  _wc(): WebContents | null {
    if (this.#directBridge) return this.#bridgeOwner
    return this.#getWebContents?.() ?? null
  }

  async ensure(): Promise<XianyuResult | XianyuFailure> {
    try {
      const bridge = this.#ensureBridge()
      await bridge.ensureInjected?.()
      const readiness = await this.#readiness()
      if (!readiness) {
        this.#authenticated = null
        return fail('hook_not_ready', '闲鱼页面尚未就绪')
      }
      this.#authenticated = authenticatedFrom(readiness)
      if (this.#authenticated === true) this.#clearAuthCheck()
      else this.#scheduleAuthCheck()
      if (readiness.loggedOutVisible === true)
        return fail('hook_not_ready', '请先在店铺页面登录闲鱼')
      if (readiness.loginCookieMissing === true && Number(readiness.conversationCount ?? 0) === 0)
        return fail('hook_not_ready', '请先在店铺页面登录闲鱼')
      if (readiness.verificationVisible === true)
        return fail('hook_not_ready', '闲鱼要求先完成安全验证，请在店铺页面处理')
      if (readiness.disconnectedVisible === true)
        return fail('hook_not_ready', '闲鱼页面连接已断开，请在店铺页面重连')
      if (readiness.chatAreaPresent !== true)
        return fail('hook_not_ready', '闲鱼会话区尚未加载完成')
      return ok()
    } catch (error) {
      this.#authenticated = null
      this.#scheduleAuthCheck()
      return fail('hook_not_ready', `闲鱼页面未就绪：${messageOf(error)}`)
    }
  }

  async preparePending(): Promise<XianyuResult | XianyuFailure> {
    try {
      const pending = await this.#pendingChats()
      return ok({ count: pending.pending.length, itemCount: pending.itemCount })
    } catch (error) {
      return fail('hook_not_ready', `读取闲鱼待回复会话失败：${messageOf(error)}`)
    }
  }

  async pendingSnapshot(): Promise<XianyuResult | XianyuFailure> {
    try {
      const pending = await this.#pendingChats()
      return ok({ count: pending.pending.length, uids: pending.pending })
    } catch (error) {
      return fail('hook_not_ready', `读取闲鱼待回复会话失败：${messageOf(error)}`)
    }
  }

  async popPending(): Promise<{
    uid: string
    messages: XianyuLocalMessage[]
    username: string
    claimedAt: number
  } | null> {
    const pending = await this.#pendingChats()
    const targets = [...pending.pending]
    // 当前打开的会话不会保留未读红点，但仍可能有买家新消息；先读当前会话，
    // 否则商家正在看的聊天永远不会交给 AI。
    let active: XianyuConversation | null = null
    try {
      active = await this.#activeConversation()
    } catch (error) {
      this.#logger.debug(`闲鱼当前会话暂不可读：${messageOf(error)}`)
    }
    const activeNick = active?.nick || ''
    if (activeNick && !targets.includes(activeNick) && !BLOCKED_NICKS.includes(activeNick))
      targets.unshift(activeNick)
    for (const target of targets) {
      if (this.#claimed.has(target)) continue
      let conversation: XianyuConversation
      try {
        conversation =
          target === activeNick && active ? active : await this.#readConversation(target, true)
      } catch (error) {
        if (isTransportError(error)) throw error
        this.#logger.debug(`闲鱼会话 ${target} 暂不可读：${messageOf(error)}`)
        continue
      }
      const fresh = freshBuyerMessages(conversation.messages).filter(
        (message) => !this.#acked.get(target)?.has(message.msgId),
      )
      if (!fresh.length) continue
      this.#claimed.add(target)
      this.#claimedRows.set(target, fresh)
      this.#recordEvents(target, conversation.nick || target, conversation.messages)
      return {
        uid: target,
        messages: fresh,
        username: conversation.nick || target,
        claimedAt: this.#now(),
      }
    }
    return null
  }

  async conversationHistory(
    uid: string,
    options: { limit?: number } = {},
  ): Promise<XianyuResult | XianyuFailure> {
    if (!uid) return fail('input_not_found', '缺少买家标识')
    const limit = Number(options.limit) > 0 ? Math.min(Number(options.limit), 100) : 20
    try {
      const conversation = await this.#readConversation(String(uid), true)
      this.#recordEvents(String(uid), conversation.nick || uid, conversation.messages)
      return ok({ messages: conversation.messages.slice(-limit) })
    } catch (error) {
      if (isTransportError(error)) return fail('hook_not_ready', messageOf(error))
      // 切换瞬时态或同名多会话：历史未知是事实，不伪造空历史以外的内容。
      return ok({ messages: [] })
    }
  }

  async release(uid: string): Promise<XianyuResult | XianyuFailure> {
    if (!uid) return fail('input_not_found', '缺少买家标识')
    this.#claimed.delete(String(uid))
    this.#claimedRows.delete(String(uid))
    return ok({ released: true })
  }

  async discard(
    uid: string,
    _options: Record<string, unknown> = {},
  ): Promise<XianyuResult | XianyuFailure> {
    if (!uid) return fail('input_not_found', '缺少买家标识')
    const key = String(uid)
    // 页面没有认领表；成功或明确跳过的消息按 msgId 记入本适配器，
    // 下一轮不再把同一批买家消息重新交给引擎。
    const row = this.#claimedRows.get(key)
    if (row) {
      let acked = this.#acked.get(key)
      if (!acked) {
        acked = new Set<string>()
        this.#acked.set(key, acked)
      }
      for (const message of row) acked.add(message.msgId)
      if (acked.size > 300) this.#acked.set(key, new Set([...acked].slice(-200)))
    }
    this.#claimedRows.delete(key)
    this.#claimed.delete(key)
    return ok({ discarded: true })
  }

  /** 闲鱼没有可靠的客服已发台账；人工回复由会话历史中的最后一条我方消息体现。 */
  async popMerchantSent(): Promise<{ uid: string; message: XianyuLocalMessage }[]> {
    return []
  }

  async syncAiEnabled(_enabled: boolean): Promise<XianyuResult> {
    return ok()
  }

  async focusConversation(uid: string): Promise<XianyuResult | XianyuFailure> {
    if (!uid) return fail('input_not_found', '缺少买家标识')
    try {
      await this.#activate(String(uid))
      this.#ensureBridge().focus?.()
      return ok()
    } catch (error) {
      return fail('input_not_found', `切换到目标会话失败：${messageOf(error)}`)
    }
  }

  async sendText(
    uid: string,
    text: string,
    _options: Record<string, unknown> = {},
  ): Promise<XianyuResult | XianyuFailure> {
    if (!uid) throw new TypeError('sendText: uid 不能为空')
    const content = String(text ?? '').trim()
    if (!content) throw new TypeError('sendText: text 不能为空')
    let committed = false
    try {
      await this.#activate(String(uid))
      // 商家可能正在同一个输入框里写草稿；自动回复不能覆盖人工内容。
      const existing = await this.#inputValue()
      if (squeeze(existing) !== '' && squeeze(existing) !== squeeze(content))
        return fail('input_not_found', '输入框已有未发送草稿，未自动发送')
      const written = recordOf(
        await this.#invoke('write', { input: XIANYU_SELECTORS.input, text: content }, 15_000),
      )
      const readback = typeof written?.readback === 'string' ? written.readback : null
      // 页面改写了正文就不点发送：宁可报未发送，也不能发出与审批内容不同的字。
      if (readback !== null && squeeze(readback) !== squeeze(content)) {
        return fail('input_not_found', '输入框内容被页面改写，未点击发送')
      }
      committed = true
      await this.#invoke(
        'commit',
        { container: XIANYU_SELECTORS.sendContainer, buttonText: SEND_TEXT },
        15_000,
      )
      let echo = await this.#waitForEcho(String(uid), content, 4_000)
      if (echo) return ok({ msgId: echo.msgId, attempts: 1 })
      // 只有输入框仍保留原文才补点一次；已经清空说明页面收到了，等待回显即可，
      // 盲目再点会在慢页面上把同一条审批内容发两遍。
      const remaining = await this.#inputValue().catch(() => null)
      if (remaining === null || squeeze(remaining) !== '') {
        await this.#invoke(
          'commit',
          { container: XIANYU_SELECTORS.sendContainer, buttonText: SEND_TEXT },
          15_000,
        )
        echo = await this.#waitForEcho(String(uid), content, 5_000)
        if (echo) return ok({ msgId: echo.msgId, attempts: 2 })
      }
      return fail('send_unconfirmed', '发送后重读会话没有找到这条消息，请人工核对')
    } catch (error) {
      if (!committed) return fail('input_not_found', `发送前准备失败：${messageOf(error)}`)
      return fail('send_unconfirmed', `发送结果未知：${messageOf(error)}`)
    }
  }

  async sendImage(
    uid: string,
    payload: unknown,
    _options: Record<string, unknown> = {},
  ): Promise<XianyuResult | XianyuFailure> {
    if (!uid) throw new TypeError('sendImage: uid 不能为空')
    const record = recordOf(payload)
    const base64 = record && typeof record.base64 === 'string' ? record.base64 : ''
    if (!base64) return fail('input_not_found', '闲鱼图片发送仅支持 base64 数据')
    let committed = false
    try {
      await this.#activate(String(uid))
      await this.#invoke(
        'pasteImage',
        {
          input: XIANYU_SELECTORS.input,
          base64,
          name: typeof record?.name === 'string' ? record.name : 'image.png',
          mime: typeof record?.mime === 'string' ? record.mime : 'image/png',
        },
        20_000,
      )
      committed = true
      const confirm = recordOf(
        await this.#invoke(
          'confirmImageSend',
          { title: IMAGE_CONFIRM_TITLE, buttonText: SEND_TEXT },
          15_000,
        ),
      )
      if (confirm?.found === true && confirm.clicked !== true) {
        return fail(
          'send_unconfirmed',
          `发图确认框里找不到「${SEND_TEXT}」按钮，已按 Esc，请人工处理`,
        )
      }
      const last = await this.#lastSellerMessage(String(uid))
      return last?.type === 'image'
        ? ok({ msgId: last.msgId })
        : fail('send_unconfirmed', '发送图片后未核对到图片回显，请人工确认')
    } catch (error) {
      if (!committed) return fail('input_not_found', `发送前准备失败：${messageOf(error)}`)
      return fail('send_unconfirmed', `发送图片结果未知：${messageOf(error)}`)
    }
  }

  async sendVideo(
    _uid: string,
    _payload: unknown,
    _options: Record<string, unknown> = {},
  ): Promise<XianyuFailure> {
    return fail('hook_not_ready', '闲鱼网页版不支持发送视频')
  }

  /**
   * 只观测当前打开的会话，不切会话、不认领队列。浏览器里没有全局消息表，
   * 未打开的会话需要 AI 轮询 popPending 或商家点击后才会进入这里。
   */
  async drainEvents(params: { sinceSeq?: number } = {}): Promise<XianyuResult | XianyuFailure> {
    const sinceSeq = Number.isFinite(Number(params.sinceSeq))
      ? Math.max(0, Number(params.sinceSeq))
      : 0
    try {
      await this.#sampleActive()
    } catch (error) {
      if (isTransportError(error)) return fail('hook_not_ready', messageOf(error))
      this.#logger.debug(`闲鱼当前会话采样失败：${messageOf(error)}`)
    }
    return ok({
      seq: this.#seq,
      events: this.#events.filter((event) => event.seq > sinceSeq),
    })
  }

  async probe(): Promise<XianyuResult> {
    return ok({ platform: PLATFORM_ID, accessMode: this.accessMode })
  }

  #ensureBridge(): XianyuBridge {
    if (this.#directBridge) {
      if (this.#directBridge.isAlive?.() === false) throw new Error('闲鱼店铺页面已关闭')
      return this.#directBridge
    }
    const webContents = this.#getWebContents?.() ?? null
    if (!webContents) throw new Error('闲鱼店铺页面尚未打开')
    if (!this.#bridge || this.#bridgeOwner !== webContents) {
      this.#bridge?.dispose?.()
      this.#bridge = this.#createBridge?.(webContents)
      this.#bridgeOwner = webContents
    }
    if (!this.#bridge) throw new Error('闲鱼页面桥接不可用')
    return this.#bridge
  }

  #invoke(op: string, args: Record<string, unknown>, timeoutMs: number): Promise<unknown> {
    return this.#ensureBridge().invoke(op, args, timeoutMs)
  }

  /**
   * 登录页是内嵌站点：商家扫码后页面不会通知宿主。这里低频复查 readiness，
   * 只在从未登录变为已登录时回调一次，让宿主重跑健康检查并刷新在线状态。
   */
  #scheduleAuthCheck(): void {
    if (this.#authTimer || !this.#onAuthenticated) return
    this.#authTimer = setInterval(() => {
      void this.#checkAuthenticated()
    }, this.#authPollMs)
    this.#authTimer.unref?.()
  }

  #clearAuthCheck(): void {
    if (!this.#authTimer) return
    clearInterval(this.#authTimer)
    this.#authTimer = undefined
  }

  async #checkAuthenticated(): Promise<void> {
    if (this.#authenticated === true) {
      this.#clearAuthCheck()
      return
    }
    if (
      (!this.#directBridge && !this.#getWebContents?.()) ||
      this.#ensureBridge().isAlive?.() === false
    ) {
      this.#clearAuthCheck()
      return
    }
    try {
      const readiness = await this.#readiness()
      if (!readiness || !authenticatedFrom(readiness)) return
      this.#authenticated = true
      this.#clearAuthCheck()
      this.#onAuthenticated?.()
    } catch {
      // 页面正在导航、验证或尚未加载完：保持等待，不把一次读取失败当成登录失败。
    }
  }

  async #readiness(): Promise<Record<string, unknown> | null> {
    return recordOf(
      await this.#invoke(
        'readiness',
        {
          chatArea: XIANYU_SELECTORS.chatArea,
          chatPage: XIANYU_SELECTORS.chatArea,
          conversationActive: XIANYU_SELECTORS.conversationActive,
          conversationItem: XIANYU_SELECTORS.conversationItem,
          paneNick: XIANYU_SELECTORS.paneNick,
          input: XIANYU_SELECTORS.input,
          verificationNeedles: VERIFICATION_NEEDLES,
          dialogRoots: DIALOG_ROOTS,
          loggedOutNeedles: ['请重新登录', '登录已过期', '登录失效'],
          loggedOutSelector: XIANYU_SELECTORS.loginModal,
          loginCookie: 'unb',
          disconnectedNeedles: DISCONNECTED_NEEDLES,
          activePlaceholderPrefix: '',
        },
        10_000,
      ),
    )
  }

  async #pendingChats(): Promise<{ itemCount: number; pending: string[] }> {
    const value = recordOf(
      await this.#invoke(
        'pendingChats',
        {
          conversationItem: XIANYU_SELECTORS.conversationItem,
          conversationNick: XIANYU_SELECTORS.conversationNick,
          unreadMarker: XIANYU_SELECTORS.unreadMarker,
          blocklist: BLOCKED_NICKS,
          buyerIdPattern: '',
          buyerIdAttr: '',
        },
        10_000,
      ),
    )
    const pending = Array.isArray(value?.pending)
      ? value.pending.filter((item): item is string => typeof item === 'string' && item !== '')
      : []
    const itemCount = Number(value?.itemCount)
    if (Number.isFinite(itemCount) && itemCount > 0 && pending.length === 0) {
      const hint = Array.isArray(value?.classHint)
        ? value.classHint.filter((item): item is string => typeof item === 'string')
        : []
      this.#logger.debug(
        `闲鱼有 ${itemCount} 个会话但未命中未读标记；看到的类名：${hint.slice(0, 20).join(', ')}`,
      )
    }
    return { itemCount: Number.isFinite(itemCount) ? itemCount : pending.length, pending }
  }

  /** 读取当前打开的会话，不切换页面；同名多会话或未打开时返回 null。 */
  async #activeConversation(): Promise<XianyuConversation | null> {
    const raw = await this.#invoke('readChat', this.#readArgs(), 8_000)
    const record = recordOf(raw)
    if (!record) return null
    const nick = typeof record.buyerNick === 'string' ? record.buyerNick.trim() : ''
    const activeCount = Number(record.activeCount)
    if (!nick || (Number.isFinite(activeCount) && activeCount !== 1)) return null
    return parseConversation(raw, nick, this.#now())
  }

  async #readConversation(target: string, activate: boolean): Promise<XianyuConversation> {
    if (activate) await this.#activate(target)
    const conversation = parseConversation(
      await this.#invoke('readChat', this.#readArgs(), 12_000),
      target,
      this.#now(),
    )
    if (!conversation) throw new XianyuActivationError('闲鱼会话内容读取失败')
    if (!conversation.nick) throw new XianyuActivationError('当前会话买家未知')
    if (!sameBuyer(conversation.nick, target)) {
      throw new XianyuActivationError('当前会话与目标买家不一致，未读取消息')
    }
    return conversation
  }

  async #activate(target: string, timeoutMs = 8_000): Promise<void> {
    const switched = recordOf(
      await this.#invoke(
        'activateChat',
        {
          conversationItem: XIANYU_SELECTORS.conversationItem,
          conversationNick: XIANYU_SELECTORS.conversationNick,
          conversationActive: XIANYU_SELECTORS.conversationActive,
          paneNick: XIANYU_SELECTORS.paneNick,
          input: XIANYU_SELECTORS.input,
          target,
        },
        8_000,
      ),
    )
    if (switched?.switched !== true) {
      const reason = typeof switched?.reason === 'string' ? switched.reason : 'unknown'
      throw new XianyuActivationError(
        reason === 'ambiguous' ? '同名会话有多项且无法确定，未切换' : `切换会话失败：${reason}`,
      )
    }
    const attempts = Math.max(1, Math.ceil(timeoutMs / 250))
    for (let attempt = 0; attempt < attempts; attempt++) {
      const who = recordOf(
        await this.#invoke(
          'activeBuyer',
          {
            conversationActive: XIANYU_SELECTORS.conversationActive,
            conversationNick: XIANYU_SELECTORS.conversationNick,
            paneNick: XIANYU_SELECTORS.paneNick,
            input: XIANYU_SELECTORS.input,
            activePlaceholderPrefix: '',
          },
          4_000,
        ),
      )
      const nick = typeof who?.nick === 'string' ? who.nick : ''
      if (who?.count === 1 && nick && sameBuyer(nick, target)) return
      await this.#sleep(250)
    }
    throw new XianyuActivationError('切换会话后等待当前买家超时')
  }

  async #lastSellerMessage(uid: string): Promise<XianyuLocalMessage | null> {
    const conversation = parseConversation(
      await this.#invoke('readChat', this.#readArgs(), 10_000),
      uid,
      this.#now(),
    )
    if (!conversation) return null
    for (let index = conversation.messages.length - 1; index >= 0; index--) {
      if (conversation.messages[index]?.from === 'seller')
        return conversation.messages[index] ?? null
    }
    return null
  }

  async #inputValue(): Promise<string> {
    const value = recordOf(
      await this.#invoke('inputValue', { input: XIANYU_SELECTORS.input }, 5_000),
    )
    return typeof value?.value === 'string' ? value.value : ''
  }

  /** 发送后按固定次数等待页面回显；不用注入时钟，避免测试或系统时间跳变卡死。 */
  async #waitForEcho(
    uid: string,
    content: string,
    timeoutMs: number,
  ): Promise<XianyuLocalMessage | null> {
    const attempts = Math.max(1, Math.ceil(timeoutMs / 400))
    for (let attempt = 0; attempt < attempts; attempt++) {
      await this.#sleep(400)
      const echo = await this.#lastSellerMessage(uid).catch(() => null)
      if (echo && squeeze(echo.content) === squeeze(content)) return echo
    }
    return null
  }

  async #sampleActive(): Promise<void> {
    const now = this.#now()
    if (this.#sampling || now - this.#lastSampleAt < 1_200) return
    this.#sampling = true
    this.#lastSampleAt = now
    try {
      const conversation = await this.#activeConversation()
      if (conversation)
        this.#recordEvents(conversation.nick, conversation.nick, conversation.messages)
    } finally {
      this.#sampling = false
    }
  }

  #recordEvents(uid: string, username: string, messages: XianyuLocalMessage[]): void {
    let seen = this.#seen.get(uid)
    if (!seen) {
      seen = new Set<string>()
      this.#seen.set(uid, seen)
    }
    for (const message of messages) {
      if (seen.has(message.msgId)) continue
      seen.add(message.msgId)
      this.#events.push({
        seq: ++this.#seq,
        uid,
        username,
        from: message.from,
        type: message.type,
        content: message.content,
        msgId: message.msgId,
        ts: message.ts,
      })
    }
    if (seen.size > 300) {
      const keep = [...seen].slice(-200)
      this.#seen.set(uid, new Set(keep))
    }
    if (this.#events.length > 500) this.#events = this.#events.slice(-300)
  }

  #readArgs(): Record<string, unknown> {
    return {
      chatArea: XIANYU_SELECTORS.chatArea,
      messageContent: XIANYU_SELECTORS.messageContent,
      messageText: XIANYU_SELECTORS.messageText,
      messageLeft: XIANYU_SELECTORS.messageLeft,
      messageRight: XIANYU_SELECTORS.messageRight,
      messageImage: XIANYU_SELECTORS.messageImage,
      messageProductCard: XIANYU_SELECTORS.messageProductCard,
      conversationActive: XIANYU_SELECTORS.conversationActive,
      conversationNick: XIANYU_SELECTORS.conversationNick,
      paneNick: XIANYU_SELECTORS.paneNick,
      input: XIANYU_SELECTORS.input,
      messageTime: '',
      messageIdAttr: '',
      autoMarkers: [],
      activePlaceholderPrefix: '',
    }
  }
}

function authenticatedFrom(readiness: Record<string, unknown>): boolean {
  if (readiness.loggedOutVisible === true) return false
  if (readiness.loginCookieMissing === true && Number(readiness.conversationCount ?? 0) === 0)
    return false
  return true
}

export function createXianyuAdapter(options: XianyuAdapterOptions): XianyuAdapter {
  if (options.store.platform && options.store.platform !== PLATFORM_ID)
    throw new Error(`该店铺不是闲鱼网页版店铺：${options.store.platform}`)
  return new XianyuAdapter(options)
}

export { PLATFORM_ID as XIANYU_PLATFORM_ID, PLATFORM_NAME as XIANYU_PLATFORM_NAME }

import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import type { SimMessage, SimPersona } from '../src/shared/contracts/simulation'

/**
 * 本机模拟店铺的消息中枢。
 *
 * 存在的理由：真实店铺的消息来自平台页面 hook，而模拟店铺没有任何外部页面。
 * 这里承担真实 hook 的最小等价职责——保存顾客身份、消息线程、买家待回复队列与事件流水，
 * 让上游的采集监控器、回复引擎与人工确认门可以在完全相同的链路上运行。
 *
 * 边界：
 * - 只保存本机模拟数据，绝不被解释为真实平台的登录态、在线状态或送达回执；
 * - 队列语义与真实 hook 一致：popPending 认领 → release 归还 / discard 丢弃，避免重复回复；
 * - 事件流水有界（只保留最近若干条），seq 单调递增，监控器据此增量拉取。
 */

/** 模拟侧“买家发来一条消息”的入站事件，字段与上游采集器期望的一致。 */
export interface SimInboundEvent {
  seq: number
  uid: string
  from: 'buyer' | 'seller'
  content: string
  ts: number
  msgId: string
  username: string
  type: 'text'
}

/** 认领到的待回复行；messages 同时可能含客服侧消息，供引擎判断人工是否已回复。 */
export interface SimPendingRow {
  uid: string
  messages: SimMessage[]
  username: string
  claimedAt: number
}

export type SimChangeKind = 'message' | 'persona'
export type SimListener = (change: { storeId: string; kind: SimChangeKind; uid: string }) => void

interface PendingClaim {
  messages: SimMessage[]
  claimedAt: number
}

interface StoreState {
  storeId: string
  storeName: string
  personas: Map<string, SimPersona>
  threads: Map<string, SimMessage[]>
  pending: Map<string, PendingClaim>
  seq: number
  events: SimInboundEvent[]
  open: boolean
}

const MAX_EVENTS = 600
const MAX_THREAD = 200
const MAX_TEXT = 2000
const DEFAULT_PERSONAS = [
  { name: '小雨', note: '新客，问尺码' },
  { name: '阿哲', note: '老顾客，问发货' },
  { name: '陈女士', note: '关心售后' },
]

function cleanText(value: unknown): string {
  return (
    String(value ?? '')
      // 控制字符会让本机记录和页面的单行展示错乱，入库前统一清掉（\p{Cc} 含换行与制表符）。
      .replace(/\p{Cc}/gu, '')
      .trim()
      .slice(0, MAX_TEXT)
  )
}

function cleanName(value: unknown): string {
  return cleanText(value)
    .slice(0, 24)
    .replace(/[\r\n]+/g, ' ')
}

export class SimHub {
  readonly #file: string
  readonly #now: () => number
  readonly #stores = new Map<string, StoreState>()
  readonly #listeners = new Set<SimListener>()
  #persistError = ''

  constructor(options: { file: string; now?: () => number }) {
    this.#file = options.file
    this.#now = options.now ?? Date.now
    this.#restore()
  }

  /** 上次写入失败的人可读原因；空表示没有失败。 */
  get persistError(): string {
    return this.#persistError
  }

  subscribe(listener: SimListener): () => void {
    this.#listeners.add(listener)
    return () => {
      this.#listeners.delete(listener)
    }
  }

  /** 打开模拟店铺：首次打开会生成默认顾客，之后保持顾客与线程不变。 */
  attach(storeId: string, storeName: string): void {
    const existing = this.#stores.get(storeId)
    if (existing) {
      existing.open = true
      existing.storeName = storeName || existing.storeName
      return
    }
    const state: StoreState = {
      storeId,
      storeName: storeName || storeId,
      personas: new Map(),
      threads: new Map(),
      pending: new Map(),
      seq: 0,
      events: [],
      open: true,
    }
    this.#stores.set(storeId, state)
    for (const seed of DEFAULT_PERSONAS) this.#createPersona(state, seed.name, seed.note)
    this.#persist()
  }

  detach(storeId: string): void {
    const state = this.#stores.get(storeId)
    if (!state) return
    state.open = false
    // 关闭店铺不清空数据：重新打开仍能看到同一批模拟顾客与历史，避免验收时反复造数据。
  }

  /** 删除店铺时同步清空本机模拟数据。 */
  forget(storeId: string): void {
    this.#stores.delete(storeId)
    this.#persist()
  }

  isOpen(storeId: string): boolean {
    return this.#stores.get(storeId)?.open === true
  }

  stores(): { storeId: string; storeName: string }[] {
    return [...this.#stores.values()].map((s) => ({ storeId: s.storeId, storeName: s.storeName }))
  }

  personas(storeId: string): SimPersona[] {
    return [...(this.#stores.get(storeId)?.personas.values() ?? [])].map((p) => ({ ...p }))
  }

  addPersona(storeId: string, name: string, note = ''): SimPersona {
    const state = this.#require(storeId)
    const clean = cleanName(name)
    if (!clean) throw new Error('顾客名字不能为空')
    const persona = this.#createPersona(state, clean, cleanText(note))
    this.#persist()
    this.#emit(storeId, 'persona', persona.uid)
    return persona
  }

  renamePersona(storeId: string, uid: string, name: string, note?: string): SimPersona {
    const state = this.#require(storeId)
    const persona = state.personas.get(uid)
    if (!persona) throw new Error('该模拟顾客不存在')
    const clean = cleanName(name)
    if (!clean) throw new Error('顾客名字不能为空')
    persona.name = clean
    if (note !== undefined) persona.note = cleanText(note)
    this.#persist()
    this.#emit(storeId, 'persona', uid)
    return { ...persona }
  }

  removePersona(storeId: string, uid: string): void {
    const state = this.#require(storeId)
    if (!state.personas.delete(uid)) throw new Error('该模拟顾客不存在')
    state.threads.delete(uid)
    state.pending.delete(uid)
    this.#persist()
    this.#emit(storeId, 'persona', uid)
  }

  thread(storeId: string, uid: string, limit = 100): SimMessage[] {
    const list = this.#stores.get(storeId)?.threads.get(uid) ?? []
    return list.slice(-Math.max(1, Math.min(limit, MAX_THREAD))).map((m) => ({ ...m }))
  }

  /** 顾客在模拟页里发一条消息：写入线程、进入待回复队列、追加事件流水。 */
  buyerMessage(storeId: string, uid: string, text: string): SimMessage {
    const state = this.#require(storeId)
    const persona = this.#personaOf(state, uid)
    const content = cleanText(text)
    if (!content) throw new Error('消息不能为空')
    const message: SimMessage = {
      msgId: `sim-${randomUUID()}`,
      from: 'buyer',
      content,
      ts: this.#now(),
    }
    this.#append(state, persona.uid, message)
    const claim = state.pending.get(persona.uid) ?? { messages: [], claimedAt: 0 }
    claim.messages.push(message)
    state.pending.set(persona.uid, claim)
    this.#record(state, persona, message)
    return { ...message }
  }

  /** 客服在模拟页或客服台发出一条回复：只进本机线程，不代表真实平台已送达。 */
  sellerMessage(storeId: string, uid: string, text: string, msgId?: string): SimMessage {
    const state = this.#require(storeId)
    const persona = this.#personaOf(state, uid)
    const content = cleanText(text)
    if (!content) throw new Error('消息不能为空')
    const message: SimMessage = {
      msgId: msgId || `sim-${randomUUID()}`,
      from: 'seller',
      content,
      ts: this.#now(),
    }
    this.#append(state, persona.uid, message)
    this.#record(state, persona, message)
    return { ...message }
  }

  /** 增量事件：监控器按 seq 拉取，seq 回退时由调用方从 0 重拉并按 msgId 去重。 */
  drainEvents(storeId: string, sinceSeq: number): { seq: number; events: SimInboundEvent[] } {
    const state = this.#stores.get(storeId)
    if (!state) return { seq: 0, events: [] }
    const from = Number.isFinite(sinceSeq) && sinceSeq >= 0 ? sinceSeq : 0
    const events = state.events.filter((e) => e.seq > from).map((e) => ({ ...e }))
    return { seq: state.seq, events }
  }

  /** 认领一条待回复会话；同一会话不会并发认领。 */
  claim(storeId: string): SimPendingRow | null {
    const state = this.#stores.get(storeId)
    if (!state) return null
    for (const [uid, claim] of state.pending) {
      if (claim.claimedAt > 0 || claim.messages.length === 0) continue
      claim.claimedAt = this.#now()
      const persona = state.personas.get(uid)
      return {
        uid,
        messages: claim.messages.map((m) => ({ ...m })),
        username: persona?.name ?? '',
        claimedAt: claim.claimedAt,
      }
    }
    return null
  }

  release(storeId: string, uid: string): void {
    const claim = this.#stores.get(storeId)?.pending.get(uid)
    if (!claim) return
    claim.claimedAt = 0
  }

  discard(storeId: string, uid: string): void {
    const state = this.#stores.get(storeId)
    if (!state) return
    state.pending.delete(uid)
  }

  pendingSnapshot(storeId: string): { count: number; uids: string[] } {
    const state = this.#stores.get(storeId)
    if (!state) return { count: 0, uids: [] }
    const uids = [...state.pending.entries()]
      .filter(([, claim]) => claim.messages.length > 0)
      .map(([uid]) => uid)
    return { count: uids.length, uids }
  }

  /**
   * 客服侧已发消息台账：真实适配器用它识别“人工已回复”。
   * 模拟店铺的手工回复都经统一发送入口写入线程，无需再回灌，固定返回空数组。
   */
  popMerchantSent(): [] {
    return []
  }

  #require(storeId: string): StoreState {
    const state = this.#stores.get(storeId)
    if (!state) throw new Error('模拟店铺尚未打开')
    return state
  }

  #personaOf(state: StoreState, uid: string): SimPersona {
    const persona = state.personas.get(String(uid))
    if (!persona) throw new Error('该模拟顾客不存在')
    return persona
  }

  #createPersona(state: StoreState, name: string, note: string): SimPersona {
    const persona: SimPersona = {
      uid: `sim-${randomUUID().slice(0, 8)}`,
      name,
      note,
      createdAt: this.#now(),
    }
    state.personas.set(persona.uid, persona)
    state.threads.set(persona.uid, [])
    return { ...persona }
  }

  #append(state: StoreState, uid: string, message: SimMessage): void {
    const list = state.threads.get(uid) ?? []
    list.push(message)
    state.threads.set(uid, list.slice(-MAX_THREAD))
  }

  #record(state: StoreState, persona: SimPersona, message: SimMessage): void {
    state.seq += 1
    state.events.push({
      seq: state.seq,
      uid: persona.uid,
      from: message.from,
      content: message.content,
      ts: message.ts,
      msgId: message.msgId,
      username: message.from === 'buyer' ? persona.name : '',
      type: 'text',
    })
    if (state.events.length > MAX_EVENTS) state.events.splice(0, state.events.length - MAX_EVENTS)
    this.#emit(state.storeId, 'message', persona.uid)
  }

  #emit(storeId: string, kind: SimChangeKind, uid: string): void {
    for (const listener of this.#listeners) {
      try {
        listener({ storeId, kind, uid })
      } catch {
        /* 单个订阅者异常不能影响消息写入。 */
      }
    }
  }

  #restore(): void {
    let raw: unknown
    try {
      raw = JSON.parse(fs.readFileSync(this.#file, 'utf8')) as unknown
    } catch {
      return // 首次运行或文件缺失都是正常情况，不生成伪数据。
    }
    const parsed = raw as { version?: unknown; stores?: Record<string, unknown> }
    if (!parsed || parsed.version !== 1 || !parsed.stores || typeof parsed.stores !== 'object') {
      this.#persistError = '本机模拟数据文件版本不符，已忽略旧内容'
      return
    }
    for (const [storeId, value] of Object.entries(parsed.stores)) {
      const source = value as { storeName?: unknown; personas?: unknown }
      const state: StoreState = {
        storeId,
        storeName: typeof source.storeName === 'string' ? source.storeName : storeId,
        personas: new Map(),
        threads: new Map(),
        pending: new Map(),
        seq: 0,
        events: [],
        open: false,
      }
      const list = Array.isArray(source.personas) ? source.personas : []
      for (const item of list) {
        const entry = item as { uid?: unknown; name?: unknown; note?: unknown; createdAt?: unknown }
        const uid = typeof entry.uid === 'string' ? entry.uid : ''
        const name = cleanName(entry.name)
        if (!uid || !name) continue
        state.personas.set(uid, {
          uid,
          name,
          note: cleanText(entry.note),
          createdAt: Number(entry.createdAt) || 0,
        })
        state.threads.set(uid, [])
      }
      if (state.personas.size) this.#stores.set(storeId, state)
    }
  }

  #persist(): void {
    const stores: Record<string, { storeName: string; personas: SimPersona[] }> = {}
    for (const [storeId, state] of this.#stores) {
      stores[storeId] = {
        storeName: state.storeName,
        personas: [...state.personas.values()].map((p) => ({ ...p })),
      }
    }
    try {
      fs.mkdirSync(path.dirname(this.#file), { recursive: true })
      fs.writeFileSync(this.#file, JSON.stringify({ version: 1, stores }, null, 2), 'utf8')
      this.#persistError = ''
    } catch (error) {
      this.#persistError = `本机模拟数据保存失败：${error instanceof Error ? error.message : String(error)}`
    }
  }
}

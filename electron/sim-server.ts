import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { SIM_PLATFORM_LABEL, type SimulatorStatus } from '../src/shared/contracts/simulation'
import type { SimHub } from './sim-hub'
import type { SimMessage, SimPersona } from '../src/shared/contracts/simulation'
import { renderSimGatePage, renderSimPage } from './sim-page'

/**
 * 本机模拟顾客服务。
 *
 * 只监听 127.0.0.1，端口默认从 43100 起逐个尝试；每次启动生成一次性口令，
 * 口令只存在于主进程内存与交给用户的页面 URL 上，渲染层拿不到也不需要知道。
 * 这里没有任何外发请求：模拟顾客页读写的都是 SimHub 里的本机数据，
 * 所以“发送成功”只等于本机记录成功，页面必须如实这样说。
 */

const DEFAULT_PORTS = [43100, 43101, 43102, 43103, 43104]
const BODY_LIMIT = 32 * 1024
const MAX_NAME = 40
const MAX_NOTE = 200
const MAX_TEXT = 2000
const MAX_UID = 64
const MAX_THREAD = 200
const SSE_HEARTBEAT_MS = 20_000
const GATE_MESSAGE = '运行口令无效或已过期，请回到桌面端重新打开模拟顾客页。'
/** 页面内联脚本与样式是唯一的“外部依赖”，所以 CSP 只放开这两项，连接只允许回环自身。 */
const PAGE_CSP =
  "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'"
/** 拒绝页没有脚本，也就不给脚本开任何口子。 */
const GATE_CSP =
  "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"

export interface SimServerStore {
  storeId: string
  storeName: string
}

export interface SimServerOptions {
  hub: SimHub
  /** 只列出本机模拟店铺；由主进程从后端快照筛出，避免把真实平台店铺暴露给模拟页。 */
  listStores: () => SimServerStore[]
  /** 请求到达时确认该店铺仍是本机模拟店铺，并确保 SimHub 已登记；返回 false 即拒绝。 */
  ensureStore: (storeId: string) => boolean
  ports?: number[]
  log?: (message: string) => void
}

export interface SimServer {
  start(): Promise<SimulatorStatus>
  status(): SimulatorStatus
  dispose(): Promise<void>
}

/** 交给模拟顾客页的顾客资料：附带最后一条消息与待回复条数，页面无需自己聚合。 */
interface PersonaView extends SimPersona {
  lastMessage: string
  messageCount: number
  unread: number
}

class SimHttpServer implements SimServer {
  readonly #hub: SimHub
  readonly #listStores: () => SimServerStore[]
  readonly #ensureStore: (storeId: string) => boolean
  readonly #ports: number[]
  readonly #log: (message: string) => void
  readonly #streams = new Map<string, Set<ServerResponse>>()
  readonly #unsubscribe: () => void
  #server: Server | undefined
  #token = ''
  #running = false
  #port = 0
  #error = ''
  #heartbeat: NodeJS.Timeout | undefined

  constructor(options: SimServerOptions) {
    this.#hub = options.hub
    this.#listStores = options.listStores
    this.#ensureStore = options.ensureStore
    this.#ports = options.ports?.length ? [...options.ports] : [...DEFAULT_PORTS]
    this.#log = options.log ?? (() => {})
    // 买家/客服消息或顾客资料变化后立刻通知页面；页面据此重新拉取，不把事件当消息内容来源。
    this.#unsubscribe = this.#hub.subscribe((change) => this.#broadcast(change.storeId, change.uid))
  }

  status(): SimulatorStatus {
    const running = this.#running && this.#port > 0
    return {
      running,
      port: this.#port,
      url: running
        ? `http://127.0.0.1:${this.#port}/?token=${encodeURIComponent(this.#token)}`
        : '',
      error: this.#error,
    }
  }

  async start(): Promise<SimulatorStatus> {
    if (this.#running) return this.status()
    const failures: string[] = []
    for (const port of this.#ports) {
      const server = createServer((req, res) => {
        void this.#handle(req, res)
      })
      server.on('clientError', (_error, socket) => socket.destroy())
      try {
        await listen(server, port)
      } catch (error) {
        failures.push(`${port}（${describeListenError(error)}）`)
        server.close()
        continue
      }
      this.#server = server
      this.#token = randomBytes(24).toString('base64url')
      this.#running = true
      // 端口传 0 时由系统分配，必须回读实际端口，否则页面地址会指错。
      const address = server.address()
      this.#port = address && typeof address === 'object' ? address.port : port
      this.#error = ''
      this.#heartbeat = setInterval(() => {
        for (const set of this.#streams.values())
          for (const res of set) if (!res.writableEnded) res.write(': ping\n\n')
      }, SSE_HEARTBEAT_MS)
      this.#heartbeat.unref()
      this.#log(`模拟顾客服务已启动：http://127.0.0.1:${this.#port}/`)
      return this.status()
    }
    // 端口全被占用时如实失败：界面据此提示关掉占用进程，而不是假装已启动。
    this.#error =
      '模拟顾客页无法启动，以下端口都被占用：' +
      failures.join('；') +
      '。请关闭占用这些端口的程序后重新打开模拟顾客页。'
    this.#log(this.#error)
    return this.status()
  }

  async dispose(): Promise<void> {
    this.#unsubscribe()
    if (this.#heartbeat) clearInterval(this.#heartbeat)
    this.#heartbeat = undefined
    for (const set of this.#streams.values())
      for (const res of set) if (!res.writableEnded) res.end()
    this.#streams.clear()
    const server = this.#server
    this.#server = undefined
    this.#running = false
    this.#port = 0
    this.#token = ''
    if (!server) return
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }

  #broadcast(storeId: string, uid: string): void {
    const set = this.#streams.get(storeId)
    if (!set) return
    const payload = `data: ${JSON.stringify({ kind: 'change', uid })}\n\n`
    for (const res of set) if (!res.writableEnded) res.write(payload)
  }

  async #handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    res.setHeader('Cache-Control', 'no-store')
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('Referrer-Policy', 'no-referrer')
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    if (url.pathname === '/' || url.pathname === '/index.html') {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        sendText(res, 405, '模拟顾客页只支持 GET 请求。')
        return
      }
      if (!this.#authorize(url)) {
        // 页面被用户直接粘进浏览器时，给一张能看懂的拒绝页；口令错与口令缺失不做区分。
        res.setHeader('Content-Security-Policy', GATE_CSP)
        res.writeHead(403, { 'Content-Type': 'text/html; charset=utf-8' })
        res.end(req.method === 'HEAD' ? undefined : renderSimGatePage(GATE_MESSAGE))
        return
      }
      res.setHeader('Content-Security-Policy', PAGE_CSP)
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(req.method === 'HEAD' ? undefined : renderSimPage())
      return
    }
    if (!url.pathname.startsWith('/api/')) {
      sendJson(res, 404, { ok: false, message: '没有这个地址' })
      return
    }
    if (!this.#authorize(url)) {
      sendJson(res, 401, { ok: false, message: GATE_MESSAGE })
      return
    }
    try {
      await this.#route(req, res, url)
    } catch (error) {
      sendJson(res, 400, { ok: false, message: messageOf(error) })
    }
  }

  /** 口令只走查询参数；定长比较，避免长度或前缀泄露。 */
  #authorize(url: URL): boolean {
    const given = url.searchParams.get('token') ?? ''
    if (!this.#token || !given) return false
    const expected = Buffer.from(this.#token)
    const actual = Buffer.from(given)
    if (expected.length !== actual.length) return false
    return timingSafeEqual(expected, actual)
  }

  async #route(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
    switch (url.pathname) {
      case '/api/health':
        await requireMethod(req, res, 'GET')
        sendJson(res, 200, { ok: true, running: true, label: SIM_PLATFORM_LABEL })
        return
      case '/api/stores':
        await requireMethod(req, res, 'GET')
        sendJson(res, 200, { ok: true, stores: this.#listStores() })
        return
      case '/api/events': {
        await requireMethod(req, res, 'GET')
        const storeId = this.#store(res, url.searchParams.get('storeId'))
        if (storeId) this.#openStream(storeId, res)
        return
      }
      case '/api/state': {
        await requireMethod(req, res, 'GET')
        const storeId = this.#store(res, url.searchParams.get('storeId'))
        if (!storeId) return
        sendJson(res, 200, {
          ok: true,
          storeId,
          storeName: this.#nameOf(storeId),
          personas: this.#personas(storeId),
        })
        return
      }
      case '/api/thread': {
        await requireMethod(req, res, 'GET')
        const storeId = this.#store(res, url.searchParams.get('storeId'))
        if (!storeId) return
        const uid = text(url.searchParams.get('uid'), MAX_UID, '顾客编号')
        this.#requirePersona(storeId, uid)
        sendJson(res, 200, { ok: true, messages: this.#hub.thread(storeId, uid, MAX_THREAD) })
        return
      }
      case '/api/persona':
        await this.#personaRoute(req, res)
        return
      case '/api/send': {
        await requireMethod(req, res, 'POST')
        const body = await readJson(req)
        const storeId = this.#store(res, body.storeId)
        if (!storeId) return
        if ((body.as ?? 'buyer') !== 'buyer') {
          sendJson(res, 400, {
            ok: false,
            message: '模拟顾客页只能以顾客身份发言；客服回复请在桌面端确认后发出。',
          })
          return
        }
        const uid = text(body.uid, MAX_UID, '顾客编号')
        this.#requirePersona(storeId, uid)
        const content = text(body.text, MAX_TEXT, '消息内容')
        sendJson(res, 200, { ok: true, message: this.#hub.buyerMessage(storeId, uid, content) })
        return
      }
      default:
        sendJson(res, 404, { ok: false, message: '没有这个接口' })
    }
  }

  async #personaRoute(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (req.method !== 'POST' && req.method !== 'PATCH' && req.method !== 'DELETE') {
      res.setHeader('Allow', 'POST, PATCH, DELETE')
      sendJson(res, 405, { ok: false, message: '请使用 POST、PATCH 或 DELETE 请求' })
      return
    }
    const body = await readJson(req)
    const storeId = this.#store(res, body.storeId)
    if (!storeId) return
    if (req.method === 'POST') {
      const name = text(body.name, MAX_NAME, '顾客名字')
      const note = optionalText(body.note, MAX_NOTE, '顾客备注')
      sendJson(res, 200, {
        ok: true,
        persona: this.#view(storeId, this.#hub.addPersona(storeId, name, note)),
      })
      return
    }
    const uid = text(body.uid, MAX_UID, '顾客编号')
    this.#requirePersona(storeId, uid)
    if (req.method === 'PATCH') {
      const name = text(body.name, MAX_NAME, '顾客名字')
      const note =
        body.note === undefined ? undefined : optionalText(body.note, MAX_NOTE, '顾客备注')
      sendJson(res, 200, {
        ok: true,
        persona: this.#view(storeId, this.#hub.renamePersona(storeId, uid, name, note)),
      })
      return
    }
    this.#hub.removePersona(storeId, uid)
    sendJson(res, 200, { ok: true })
  }

  /** 校验 storeId 确实是本机模拟店铺；未知或非模拟店铺一律按“不存在”处理，不泄露真实店铺。 */
  #store(res: ServerResponse, raw: unknown): string {
    const storeId = typeof raw === 'string' ? raw.trim() : ''
    if (!storeId) {
      sendJson(res, 400, { ok: false, message: '缺少 storeId' })
      return ''
    }
    if (
      !this.#listStores().some((store) => store.storeId === storeId) ||
      !this.#ensureStore(storeId)
    ) {
      sendJson(res, 404, { ok: false, message: '该店铺不是本机模拟店铺' })
      return ''
    }
    return storeId
  }

  #nameOf(storeId: string): string {
    return this.#listStores().find((store) => store.storeId === storeId)?.storeName ?? ''
  }

  #requirePersona(storeId: string, uid: string): void {
    if (!this.#hub.personas(storeId).some((persona) => persona.uid === uid))
      throw new Error('顾客不存在或已被删除')
  }

  #view(storeId: string, persona: SimPersona): PersonaView {
    const messages: SimMessage[] = this.#hub.thread(storeId, persona.uid, MAX_THREAD)
    let unread = 0
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      if (messages[index]?.from !== 'buyer') break
      unread += 1
    }
    return {
      ...persona,
      lastMessage: messages.at(-1)?.content ?? '',
      messageCount: messages.length,
      unread,
    }
  }

  #personas(storeId: string): PersonaView[] {
    return this.#hub.personas(storeId).map((persona) => this.#view(storeId, persona))
  }

  #openStream(storeId: string, res: ServerResponse): void {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    })
    res.write(': connected\n\n')
    const existing = this.#streams.get(storeId)
    if (existing) existing.add(res)
    else this.#streams.set(storeId, new Set([res]))
    const cleanup = () => {
      const set = this.#streams.get(storeId)
      if (!set) return
      set.delete(res)
      if (!set.size) this.#streams.delete(storeId)
    }
    res.on('close', cleanup)
    res.on('error', cleanup)
  }
}

function listen(server: Server, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error) => {
      server.removeListener('listening', onListening)
      reject(error)
    }
    const onListening = () => {
      server.removeListener('error', onError)
      resolve()
    }
    server.once('error', onError)
    server.once('listening', onListening)
    server.listen(port, '127.0.0.1')
  })
}

/** 方法不符时抛出即可，由 #handle 统一转成 405 之外的 JSON 错误，避免各处重复返回。 */
async function requireMethod(
  req: IncomingMessage,
  res: ServerResponse,
  method: string,
): Promise<void> {
  if (req.method === method) return
  res.setHeader('Allow', method)
  sendJson(res, 405, { ok: false, message: `请使用 ${method} 请求` })
  throw new Error('method_not_allowed')
}

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  if (res.headersSent) return
  const body = JSON.stringify(payload)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  })
  res.end(body)
}

function sendText(res: ServerResponse, status: number, message: string): void {
  if (res.headersSent) return
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' })
  res.end(message)
}

function describeListenError(error: unknown): string {
  const code = (error as { code?: string } | null)?.code
  if (code === 'EADDRINUSE') return '端口已被占用'
  if (code === 'EACCES') return '没有监听端口的权限'
  return messageOf(error)
}

function messageOf(error: unknown): string {
  if (error instanceof Error && error.message) return error.message
  const text = String(error ?? '').trim()
  return text || '未知错误'
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string)
    size += buffer.length
    if (size > BODY_LIMIT) throw new Error('请求内容过大')
    chunks.push(buffer)
  }
  if (!chunks.length) return {}
  const raw = Buffer.concat(chunks).toString('utf8').trim()
  if (!raw) return {}
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error('请求内容不是合法的 JSON')
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
    throw new Error('请求内容格式不正确')
  return parsed as Record<string, unknown>
}

function text(value: unknown, max: number, label: string): string {
  if (typeof value !== 'string') throw new Error(`${label}不能为空`)
  const trimmed = value.trim()
  if (!trimmed) throw new Error(`${label}不能为空`)
  if (trimmed.length > max) throw new Error(`${label}不能超过 ${max} 个字符`)
  return trimmed
}

function optionalText(value: unknown, max: number, label: string): string {
  if (value === undefined || value === null || value === '') return ''
  if (typeof value !== 'string') throw new Error(`${label}格式不正确`)
  const trimmed = value.trim()
  if (trimmed.length > max) throw new Error(`${label}不能超过 ${max} 个字符`)
  return trimmed
}

export function createSimServer(options: SimServerOptions): SimServer {
  return new SimHttpServer(options)
}

import { readFileSync } from 'node:fs'
import path from 'node:path'
import type { WebContents } from 'electron'

/**
 * 闲鱼页面桥接的 Electron 侧传输层。
 *
 * 页面侧用的是 kb-port 的原版 bridge.js（WebView2 形态）：它把结果写到
 * `window.ipc.postMessage`。Electron 没有这个对象，所以先注入一段最小的
 * shim，把回包按 id 交给 executeJavaScript 返回的 Promise，事件类消息进
 * 有界收件箱，宿主侧定时来取。
 *
 * 纪律与上游一致：只注入 goofish 页面；不碰 WebSocket；页面导航后重新注入，
 * 不把旧页面的消息当成新页面的事实。
 */

export interface XianyuBridgeLogger {
  debug(message: string): void
  info(message: string): void
  warn(message: string): void
  error(message: string): void
}

export interface XianyuBridgeTransportError extends Error {
  code?: 'bridge_transport' | 'bridge_rejected'
}

const DEFAULT_INVOKE_TIMEOUT_MS = 12_000
const INBOX_INTERVAL_MS = 500
const INBOX_LIMIT = 200

const IPC_SHIM = `(function () {
  if (window.__lingtuXianyu) { return; }
  var api = { inbox: [], pending: {} };
  window.__lingtuXianyu = api;
  var ipc = window.ipc;
  if (!ipc || typeof ipc !== 'object') { ipc = {}; window.ipc = ipc; }
  ipc.postMessage = function (raw) {
    var msg;
    try { msg = JSON.parse(String(raw)); } catch (error) { return; }
    if (!msg || typeof msg !== 'object') { return; }
    if (msg.kind === 'reply' && typeof msg.id === 'number' && typeof api.pending[msg.id] === 'function') {
      var done = api.pending[msg.id];
      delete api.pending[msg.id];
      done(msg);
      return;
    }
    if (api.inbox.length < ${INBOX_LIMIT}) { api.inbox.push(msg); }
  };
})();`

const STATE_EXPRESSION = `(function () {
  var api = window.__lingtuXianyu;
  var bridge = window.__shanhui;
  return {
    shim: !!(api && Array.isArray(api.inbox)),
    bridge: !!(bridge && typeof bridge.handle === 'function'),
    version: bridge && typeof bridge.v !== 'undefined' ? String(bridge.v) : ''
  };
})()`

const DRAIN_EXPRESSION = `(function () {
  var api = window.__lingtuXianyu;
  if (!api || !Array.isArray(api.inbox)) { return []; }
  return api.inbox.splice(0, 50);
})()`

interface PageBridgeMessage {
  kind?: unknown
  id?: unknown
  ok?: unknown
  data?: unknown
  err?: unknown
  name?: unknown
  reason?: unknown
  v?: unknown
}

function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

function bridgeError(message: string, code: 'bridge_transport' | 'bridge_rejected'): Error {
  const error = new Error(message) as XianyuBridgeTransportError
  error.code = code
  return error
}

function parseReplyData(data: unknown): unknown {
  if (typeof data !== 'string') return data
  try {
    return JSON.parse(data)
  } catch {
    return data
  }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  const timeout = new Promise<T>((_, reject) => {
    timer = setTimeout(
      () => reject(bridgeError(`${label}超时（${timeoutMs}ms）`, 'bridge_transport')),
      timeoutMs,
    )
    timer.unref?.()
  })
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer)
  })
}

class XianyuEventBus {
  #waiters: {
    name: string
    resolve(data: unknown): void
    reject(error: Error): void
    timer: NodeJS.Timeout
  }[] = []

  wait(name: string, timeoutMs: number): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const waiter = {
        name,
        resolve,
        reject,
        timer: setTimeout(() => {
          this.#waiters = this.#waiters.filter((item) => item !== waiter)
          reject(new Error(`闲鱼页面事件等待超时：${name}`))
        }, timeoutMs),
      }
      waiter.timer.unref?.()
      this.#waiters.push(waiter)
    })
  }

  dispatch(name: string, data: unknown): void {
    for (const waiter of [...this.#waiters]) {
      if (waiter.name !== name) continue
      clearTimeout(waiter.timer)
      this.#waiters = this.#waiters.filter((item) => item !== waiter)
      waiter.resolve(data)
    }
  }

  failAll(error: Error): void {
    for (const waiter of this.#waiters.splice(0)) {
      clearTimeout(waiter.timer)
      waiter.reject(error)
    }
  }
}

export class XianyuPageBridge {
  readonly #webContents: WebContents
  readonly #logger: XianyuBridgeLogger
  readonly #events = new XianyuEventBus()
  #nextId = 1
  #injected = false
  #drainTimer: NodeJS.Timeout | undefined
  #draining = false
  #disposed = false
  #source: string | undefined
  #onLoad: () => void

  constructor(webContents: WebContents, logger: XianyuBridgeLogger) {
    this.#webContents = webContents
    this.#logger = logger
    this.#onLoad = () => {
      // 导航后旧文档里的桥已经没了；下一次调用前重新注入，而不是沿用旧状态。
      this.#injected = false
      void this.ensureInjected().catch((error: unknown) => {
        this.#logger.debug(`闲鱼页面导航后注入未完成：${messageOf(error)}`)
      })
    }
    webContents.on('did-finish-load', this.#onLoad)
    webContents.once('destroyed', () => this.dispose())
  }

  isAlive(): boolean {
    return !this.#disposed && !this.#webContents.isDestroyed()
  }

  getURL(): string {
    if (!this.isAlive()) return ''
    try {
      return this.#webContents.getURL()
    } catch {
      return ''
    }
  }

  focus(): void {
    if (!this.isAlive()) return
    this.#webContents.focus()
  }

  waitEvent(name: string, timeoutMs = 15_000): Promise<unknown> {
    return this.#events.wait(name, timeoutMs)
  }

  async ensureInjected(): Promise<void> {
    const webContents = this.#liveWebContents()
    this.#assertOrigin(webContents)
    if (this.#injected) {
      const probe = (await webContents.executeJavaScript(STATE_EXPRESSION, false)) as
        | { shim?: unknown; bridge?: unknown }
        | undefined
      if (probe?.shim === true && probe.bridge === true) {
        this.#startDrain()
        return
      }
    }
    await webContents.executeJavaScript(this.#bridgeSource(), false)
    const state = (await webContents.executeJavaScript(STATE_EXPRESSION, false)) as
      | { shim?: unknown; bridge?: unknown; version?: unknown }
      | undefined
    if (state?.shim !== true || state.bridge !== true) {
      throw bridgeError(
        '闲鱼页面桥接注入未生效；页面可能已改版或被安全策略拦截',
        'bridge_transport',
      )
    }
    this.#injected = true
    this.#startDrain()
    this.#logger.info(`闲鱼页面桥接已注入 v${String(state.version ?? '')}`)
  }

  async invoke(
    op: string,
    args: Record<string, unknown> = {},
    timeoutMs = DEFAULT_INVOKE_TIMEOUT_MS,
    options?: { isCurrent?: () => boolean },
  ): Promise<unknown> {
    if (options?.isCurrent && !options.isCurrent())
      throw bridgeError('发送授权已失效', 'bridge_rejected')
    const webContents = this.#liveWebContents()
    if (!this.#injected) await this.ensureInjected()
    if (options?.isCurrent && !options.isCurrent())
      throw bridgeError('发送授权已失效', 'bridge_rejected')
    this.#assertOrigin(webContents)
    const id = this.#nextId++
    const request = JSON.stringify({ id, op, args })
    const expression = `(function () {
      return new Promise(function (resolve, reject) {
        var api = window.__lingtuXianyu;
        var bridge = window.__shanhui;
        if (!api || !bridge || typeof bridge.handle !== 'function') {
          reject(new Error('xianyu_bridge_missing'));
          return;
        }
        var timer = setTimeout(function () {
          if (api.pending[${id}]) {
            delete api.pending[${id}];
            reject(new Error('xianyu_bridge_timeout'));
          }
        }, ${timeoutMs});
        api.pending[${id}] = function (message) {
          clearTimeout(timer);
          resolve(message);
        };
        try {
          bridge.handle(${JSON.stringify(request)});
        } catch (error) {
          if (api.pending[${id}]) {
            delete api.pending[${id}];
            clearTimeout(timer);
            reject(error);
          }
        }
      });
    })()`
    let reply: unknown
    try {
      reply = await withTimeout(
        webContents.executeJavaScript(expression, false),
        timeoutMs + 4_000,
        `闲鱼页面调用 ${op}`,
      )
    } catch (error) {
      // 页面导航或注入丢失：标记为未注入，下一次调用重新注入并重试一次。
      this.#injected = false
      if (/xianyu_bridge_missing|xianyu_bridge_timeout/.test(messageOf(error))) {
        this.#logger.debug(`闲鱼页面调用 ${op} 未拿到响应：${messageOf(error)}`)
      }
      throw bridgeError(`闲鱼页面调用失败（${op}）：${messageOf(error)}`, 'bridge_transport')
    }
    const message = reply as PageBridgeMessage | undefined
    if (!message || message.kind !== 'reply' || message.id !== id) {
      throw bridgeError(`闲鱼页面回包异常（${op}）`, 'bridge_transport')
    }
    if (message.ok !== true) {
      throw bridgeError(
        typeof message.err === 'string' && message.err ? message.err : `闲鱼页面拒绝调用（${op}）`,
        'bridge_rejected',
      )
    }
    return parseReplyData(message.data)
  }

  dispose(): void {
    if (this.#disposed) return
    this.#disposed = true
    if (this.#drainTimer) clearInterval(this.#drainTimer)
    this.#drainTimer = undefined
    try {
      this.#webContents.removeListener('did-finish-load', this.#onLoad)
    } catch {
      /* 页面已销毁时无需清理监听 */
    }
    this.#events.failAll(new Error('闲鱼页面已关闭'))
  }

  #liveWebContents(): WebContents {
    if (!this.isAlive()) throw bridgeError('闲鱼店铺页面尚未打开', 'bridge_transport')
    return this.#webContents
  }

  #assertOrigin(webContents: WebContents): void {
    let url: URL
    try {
      url = new URL(webContents.getURL())
    } catch {
      throw bridgeError('闲鱼页面地址不可识别', 'bridge_transport')
    }
    if (
      url.protocol !== 'https:' ||
      !(url.hostname === 'goofish.com' || url.hostname.endsWith('.goofish.com'))
    ) {
      throw bridgeError(`拒绝向非闲鱼页面注入桥接：${url.origin}`, 'bridge_transport')
    }
  }

  #bridgeSource(): string {
    if (!this.#source) {
      const file = path.join(__dirname, '..', 'vendor', 'xianyu-bridge', 'bridge.js')
      try {
        this.#source = `${IPC_SHIM}\n;${readFileSync(file, 'utf8')}`
      } catch {
        throw bridgeError('闲鱼桥接脚本缺失，请重新安装或构建', 'bridge_transport')
      }
    }
    return this.#source
  }

  #startDrain(): void {
    if (this.#drainTimer || this.#disposed) return
    this.#drainTimer = setInterval(() => {
      void this.#drainInbox()
    }, INBOX_INTERVAL_MS)
    this.#drainTimer.unref?.()
  }

  async #drainInbox(): Promise<void> {
    if (this.#draining || this.#disposed || this.#webContents.isDestroyed()) return
    this.#draining = true
    try {
      const messages = (await this.#webContents.executeJavaScript(
        DRAIN_EXPRESSION,
        false,
      )) as unknown
      if (!Array.isArray(messages)) return
      for (const raw of messages) {
        const message = raw as PageBridgeMessage
        const kind = typeof message?.kind === 'string' ? message.kind : ''
        if (kind === 'event') {
          const name = typeof message.name === 'string' ? message.name : ''
          if (name) this.#events.dispatch(name, message.data)
        } else if (kind === 'ready') {
          this.#logger.debug(`闲鱼页面桥接就绪 v${String(message.v ?? '')}`)
        } else if (kind === 'alarm') {
          this.#logger.warn(`闲鱼页面桥接告警：${String(message.reason ?? '')}`)
        }
      }
    } catch {
      // 导航或页面销毁期间读收件箱失败是预期情况；下一次注入会重启通道。
    } finally {
      this.#draining = false
    }
  }
}

export function createXianyuPageBridge(
  webContents: WebContents,
  logger: XianyuBridgeLogger,
): XianyuPageBridge {
  return new XianyuPageBridge(webContents, logger)
}

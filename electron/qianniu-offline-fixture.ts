import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { z } from 'zod'
import type { SimPersona } from '../src/shared/contracts/simulation'
import { SimLocalAdapter, type SimAdapterStore } from './sim-adapter'
import type { SimHub } from './sim-hub'

const sdkFiles = {
  'sidecar.js': '760a21ead04933126ea587458a63f696299a0c374565384bb8f1d92b61d63911',
  'events.js': '8c1f9d7d5a39c81a94d79950d7b6078fe4fd2aafe05d6b31b802e05665d341e0',
  'mock/server.js': 'd38743d0f303217960c1d4da1e986075158bb7e615592c7ed5f07e425a762b1c',
}
const serviceId = 'lingtu-qianniu-offline'
const account = { nick: serviceId, serviceId }
const chatCode = (uid: string) => `offline-${uid}@cntaobao`
const identity = z.string().min(1).max(200)
const bodyText = z.string().trim().min(1).max(2000)
const wireMessage = z.strictObject({
  msgId: identity,
  role: z.enum(['user', 'assistant']),
  msg: bodyText,
})
type WireMessage = z.infer<typeof wireMessage>
const emptyPending = z.strictObject({})
const pendingRow = z.strictObject({
  uid: identity,
  ccode: identity,
  messages: z.array(wireMessage).min(1).max(100),
})
const historyBody = z.object({ messages: z.array(wireMessage).max(100) })
const sentBody = z.strictObject({
  nick: z.literal(serviceId),
  ccode: identity,
  text: bodyText,
  buyer_nick: z.literal(''),
})
const ackBody = z.object({ ok: z.literal(true), mockMessageId: identity })
const echoesBody = z.object({
  messages: z
    .array(
      z.strictObject({
        serviceId: z.literal(serviceId),
        uid: identity,
        ccode: identity,
        role: z.literal('assistant'),
        msgId: identity,
        text: bodyText,
      }),
    )
    .max(100),
})

interface SdkClient {
  popPending(body: typeof account, options: RequestOptions): Promise<unknown>
  chatHistory(body: typeof account & { uid: string }, options: RequestOptions): Promise<unknown>
  popOutbound(body: Record<string, never>, options: RequestOptions): Promise<unknown>
  textToSend(body: z.infer<typeof sentBody>, options: RequestOptions): Promise<unknown>
  dispose(): void
}
interface RequestOptions {
  signal: AbortSignal
  timeoutMs: number
  retries: 0
}
interface Mock {
  start(): Promise<{ controlPort: number; sendPort: number }>
  stop(): Promise<void>
  pushPending(account: string, message: unknown): void
  setChatHistory(account: string, uid: string, messages: WireMessage[]): void
  pushOutbound(message: unknown): void
  script(route: '/textToSend' | '/chatHistory', handler: (body: unknown) => unknown): void
  countFor(route: '/textToSend' | '/popPending' | '/chatHistory' | '/popOutbound'): number
}

/** Load only the reviewed fixture modules, without importing the SDK's live runtime or examples. */
async function loadFixtureSdk(deliveryDir: string) {
  const sdkDir = path.join(deliveryDir, 'sdk')
  const manifest = z
    .object({
      name: z.literal('@qianniu/harness'),
      version: z.literal('0.2.0'),
      type: z.literal('module'),
    })
    .parse(JSON.parse(await fs.readFile(path.join(sdkDir, 'package.json'), 'utf8')))
  const source = await fs.realpath(path.join(sdkDir, 'src'))
  for (const [name, expected] of Object.entries(sdkFiles)) {
    const filename = path.join(source, name)
    const bytes = await fs.readFile(filename)
    assert.equal(
      createHash('sha256').update(bytes).digest('hex'),
      expected,
      `千牛离线 SDK 已变更，请先人工复核：${name}`,
    )
  }
  const { SidecarClient } = (await import(pathToFileURL(path.join(source, 'sidecar.js')).href)) as {
    SidecarClient: new (options: {
      controlUrl: string
      sendUrl: string
      fetchImpl: (url: string, init: RequestInit) => Promise<Response>
    }) => SdkClient
  }
  const { MockSidecar } = (await import(
    pathToFileURL(path.join(source, 'mock/server.js')).href
  )) as {
    MockSidecar: new (options: { host: string; controlPort: 0; sendPort: 0; strict: true }) => Mock
  }
  return { SidecarClient, MockSidecar, version: manifest.version }
}

interface OfflinePort {
  receive(): Promise<z.infer<typeof pendingRow> | null>
  history(uid: string): Promise<WireMessage[]>
  deliver(uid: string, text: string, isCurrent: () => boolean): Promise<string | undefined>
}

/** Reuse the simulator queue but take message input and approval baselines from the SDK mock. */
class QianniuOfflineAdapter extends SimLocalAdapter {
  readonly #scope = randomUUID()
  readonly #seen = new Set<string>()

  constructor(
    store: SimAdapterStore,
    private readonly hub: SimHub,
    private readonly port: OfflinePort,
  ) {
    super(store, hub)
  }

  override async drainEvents(cursor: number | { sinceSeq?: number } = 0) {
    const sinceSeq = typeof cursor === 'number' ? cursor : (cursor.sinceSeq ?? 0)
    if (!this.hub.isOpen(this.storeId)) return super.drainEvents(sinceSeq)
    const row = await this.port.receive()
    if (
      row &&
      this.hub.isOpen(this.storeId) &&
      row.ccode === chatCode(row.uid) &&
      this.hub.personas(this.storeId).some((buyer) => buyer.uid === row.uid)
    ) {
      for (const message of row.messages) {
        const key = `${row.uid}:${message.msgId}`
        // Only explicit buyer rows are eligible. An outbound echo or unknown role is not input.
        if (message.role !== 'user' || this.#seen.has(key)) continue
        this.hub.buyerMessage(this.storeId, row.uid, message.msg)
        this.#seen.add(key)
        const oldest = this.#seen.values().next().value
        if (this.#seen.size > 600 && oldest !== undefined) this.#seen.delete(oldest)
      }
    }
    return super.drainEvents(sinceSeq)
  }

  override async reviewHistory(uid: string) {
    try {
      const history = await this.port.history(uid)
      if (this.hub.isOpen(this.storeId) && history.length)
        return {
          known: true,
          uid,
          page: this.#scope,
          messages: history.map((row) => ({
            from: row.role === 'user' ? 'buyer' : 'seller',
            content: row.msg,
          })),
        }
    } catch {
      // A failed read is unknown, never an empty-but-verified conversation.
    }
    return { known: false, uid, page: '', messages: [] }
  }

  override async sendText(uid: string, text: string, review?: { isCurrent(): boolean }) {
    if (!review?.isCurrent() || !this.hub.isOpen(this.storeId))
      return { ok: false as const, reason: 'hook_not_ready' as const, detail: '模拟候选未放行' }
    try {
      const msgId = await this.port.deliver(
        uid,
        text,
        () => this.hub.isOpen(this.storeId) && review.isCurrent(),
      )
      if (msgId) {
        this.hub.sellerMessage(this.storeId, uid, text, msgId)
        return { ok: true as const, msgId }
      }
    } catch {
      // A timed-out or malformed acknowledgement must not trigger a second send.
    }
    return { ok: false as const, reason: 'send_unconfirmed' as const, detail: '缺少匹配的模拟回显' }
  }
}

/** Only this harness creates the endpoints. No address or credentials are accepted from the caller. */
export async function createQianniuOfflineFixture(deliveryDir: string) {
  const { SidecarClient, MockSidecar, version } = await loadFixtureSdk(deliveryDir)
  const mock = new MockSidecar({ host: '127.0.0.1', controlPort: 0, sendPort: 0, strict: true })
  const { controlPort, sendPort } = await mock.start()
  const controlUrl = `http://127.0.0.1:${controlPort}`
  const sendUrl = `http://127.0.0.1:${sendPort}`
  const allowed = new Set([
    `${controlUrl}/popPending`,
    `${controlUrl}/chatHistory`,
    `${controlUrl}/popOutbound`,
    `${sendUrl}/textToSend`,
  ])
  const client = new SidecarClient({
    controlUrl,
    sendUrl,
    fetchImpl: (url, init) => {
      if (!allowed.has(url) || init.method !== 'POST') throw Error('不允许的千牛离线请求')
      return fetch(url, { ...init, redirect: 'error' })
    },
  })
  const abort = new AbortController()
  const request = { signal: abort.signal, timeoutMs: 2500, retries: 0 } satisfies RequestOptions
  const threads = new Map<string, WireMessage[]>()
  const muteEcho = new Set<string>()
  const unavailableHistory = new Set<string>()
  let buyers: () => SimPersona[] = () => []
  let boundStoreId: string | undefined
  let sending: Promise<void> = Promise.resolve()

  function addMessage(uid: string, message: WireMessage) {
    const history = [...(threads.get(uid) ?? []), message].slice(-100)
    threads.set(uid, history)
    mock.setChatHistory(serviceId, uid, history)
  }

  mock.script('/chatHistory', (input) => {
    const parsed = z.object({ serviceId: z.literal(serviceId), uid: identity }).parse(input)
    return unavailableHistory.has(parsed.uid) ? { ok: false } : undefined
  })
  mock.script('/textToSend', (input) => {
    const body = sentBody.parse(input)
    const uid = buyers().find((buyer) => chatCode(buyer.uid) === body.ccode)?.uid
    assert.ok(uid && threads.has(uid), '只允许回复当前合成买家')
    const msgId = randomUUID()
    if (!muteEcho.has(uid)) {
      addMessage(uid, { msgId, role: 'assistant', msg: body.text })
      mock.pushOutbound({
        serviceId,
        uid,
        ccode: body.ccode,
        role: 'assistant',
        msgId,
        text: body.text,
      })
    }
    // The mock adds a correlation ID. HTTP acceptance by itself is not delivery.
    return { ok: true, mockMessageId: msgId }
  })

  const port: OfflinePort = {
    async receive() {
      const input = await client.popPending(account, request)
      return emptyPending.safeParse(input).success ? null : pendingRow.parse(input)
    },
    history: async (uid) =>
      historyBody.parse(await client.chatHistory({ ...account, uid }, request)).messages,
    deliver(uid, text, isCurrent) {
      // The mock echo queue is shared; reads must not consume another approval's receipt.
      const attempt = sending.then(async () => {
        if (!threads.has(uid) || !isCurrent()) return
        const send = sentBody.parse({ nick: serviceId, ccode: chatCode(uid), text, buyer_nick: '' })
        const ack = ackBody.parse(await client.textToSend(send, request))
        const { messages } = echoesBody.parse(await client.popOutbound({}, request))
        return messages.find(
          (row) =>
            row.msgId === ack.mockMessageId &&
            row.uid === uid &&
            row.ccode === send.ccode &&
            row.text === send.text,
        )?.msgId
      })
      sending = attempt.then(
        () => {},
        () => {},
      )
      return attempt
    },
  }
  return {
    version,
    adapterFactory(store: SimAdapterStore, hub: SimHub) {
      if (boundStoreId && boundStoreId !== store.id) throw Error('离线夹具仅绑定一个模拟店铺')
      boundStoreId = store.id
      buyers = () => hub.personas(store.id)
      return new QianniuOfflineAdapter(store, hub, port)
    },
    buyers: () => buyers(),
    setHistoryAvailable(uid: string, available: boolean) {
      if (available) unavailableHistory.delete(uid)
      else unavailableHistory.add(uid)
    },
    queueBuyer(
      uid: string,
      text: string,
      options: { duplicate?: boolean; muteEcho?: boolean } = {},
    ) {
      assert.ok(
        buyers().some((buyer) => buyer.uid === uid),
        '合成买家不属于当前店铺',
      )
      if (options.muteEcho) muteEcho.add(uid)
      const message = wireMessage.parse({ msgId: randomUUID(), role: 'user', msg: text })
      addMessage(uid, message)
      const pending = { uid, ccode: chatCode(uid), messages: [message] }
      mock.pushPending(serviceId, pending)
      if (options.duplicate) mock.pushPending(serviceId, pending)
    },
    count: (route: Parameters<Mock['countFor']>[0]) => mock.countFor(route),
    async dispose() {
      abort.abort()
      client.dispose()
      await mock.stop()
    },
  }
}

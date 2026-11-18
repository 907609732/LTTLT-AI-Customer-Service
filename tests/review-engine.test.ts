import { createRequire } from 'node:module'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ReviewConsole,
  SEND_DIAGNOSTIC_CODES as REVIEW_DIAGNOSTIC_CODES,
  type SendProposal,
} from '../electron/review-console'
import { emptySnapshot } from '../src/shared/contracts/backend'
import { createConversationThread } from '../electron/conversation-context'
import { configureDomTextAdapter } from '../electron/dom-text-adapter'
import { PlatformWriteCoordinator } from '../electron/platform-write-coordinator'
import { SendModeAuthorizations } from '../electron/send-mode-authorizations'
import { createWelcomeDelayGate } from '../electron/welcome-delay'

interface Worker {
  start(): void
  stop(): void
  tick(): Promise<unknown>
  settle(): Promise<void>
}
const engine = createRequire(import.meta.url)(
  path.resolve('vendor/lingtu-runtime/desk-v1/src/main/reply-engine.js'),
) as {
  StoreWorker: new (options: Record<string, unknown>) => Worker
  SEND_DIAGNOSTIC_CODES: readonly string[]
}
const { StoreWorker } = engine
const cleanup: (() => void)[] = []
afterEach(() => {
  cleanup.splice(0).forEach((stop) => stop())
})

function harness(question = '你好', goods: { goodsId?: string; goodsTitle?: string } = {}) {
  const at = Date.now(),
    snap = emptySnapshot()
  const store = {
    id: 'shop',
    storeName: '测试店',
    platform: 'pdd-web',
    group: '',
    aiEnabled: true,
    runtime: { open: true, online: true },
  }
  const messages = [
    { from: 'buyer' as const, content: question, ts: at, msgId: 'b1', type: 'text' as const },
  ]
  snap.stores.push(store)
  snap.conversations.push({
    storeId: store.id,
    uid: 'buyer',
    name: '买家甲',
    status: 'pending',
    messages,
  })
  const review = new ReviewConsole(
    () => snap,
    () => {},
  )
  const sent: string[] = [],
    queue = [{ uid: 'buyer', messages, ...goods }]
  const ok = async () => ({ ok: true })
  const adapter = {
    id: 'fixture',
    accessMode: 'webview',
    supports: () => true,
    ensure: ok,
    preparePending: ok,
    popPending: async () => queue.shift() || null,
    pendingSnapshot: async () => ({ ok: true, count: queue.length, uids: [] }),
    conversationHistory: async () => ({ ok: true, messages }),
    sendText: async (_uid: string, body: string) => {
      sent.push(body)
      return { ok: true, msgId: 's1' }
    },
    sendImage: ok,
    sendVideo: ok,
    release: ok,
    discard: ok,
    popMerchantSent: async () => [],
    syncAiEnabled: ok,
    focusConversation: ok,
  }
  const cfg = {
    ai: { systemPrompt: '测试规则', timeoutMs: 1000 },
    reply: {
      enabled: true,
      maxInflight: 1,
      pollIntervalMs: 60000,
      staleMs: 0,
      sendJitterMinMs: 0,
      sendJitterMaxMs: 0,
      perUidMinIntervalMs: 0,
      perStorePerMinuteMax: 100,
      fallbackAfterMs: 0,
    },
    safety: { handoffKeywords: ['投诉'], bannedWords: [] },
  }
  const aiClient = {
    reply: vi.fn(async (_input: unknown) => ({ reply: '生成的回复' })),
    beforeSend: (proposal: SendProposal) => review.propose(proposal),
  }
  const worker = new StoreWorker({
    store,
    adapter,
    aiClient,
    getConfig: () => cfg,
    welcomePolicy: { claim: () => '欢迎光临', noteOutbound: () => {} },
    onEvent: (event: unknown) => review.event(event),
  })
  cleanup.push(() => {
    review.dispose()
    worker.stop()
  })
  return { worker, review, sent, store, adapter, queue, snap, aiClient }
}

function approvalHarness(
  blockOnSendingFocus = false,
  prepareResult?: { reason: string; detail: string },
) {
  const at = Date.now(),
    snap = emptySnapshot()
  const store = {
    id: 'shop',
    storeName: '测试店',
    platform: 'pdd-web',
    group: '',
    aiEnabled: true,
    runtime: { open: true, online: true },
  }
  const messages = [
    { from: 'buyer' as const, content: '你好', ts: at, msgId: 'b1', type: 'text' as const },
  ]
  snap.stores.push(store)
  snap.conversations.push({
    storeId: store.id,
    uid: 'buyer',
    name: '买家甲',
    status: 'pending',
    messages,
  })
  const review = new ReviewConsole(
    () => snap,
    () => {},
  )
  const queue = [{ uid: 'buyer', messages }]
  const pageMessages = [{ from: 'buyer', content: '你好', media: [] as string[] }]
  const deliveryFailures: Array<{ reason: string }> = []
  const events: unknown[] = []
  let prepares = 0,
    clicks = 0,
    confirms = 0,
    focusBlocked = false,
    focusReleased = false,
    releaseFocus: (() => void) | undefined
  const ok = async () => ({ ok: true })
  const raw = {
    id: 'fixture',
    accessMode: 'webview',
    supports: () => true,
    ensure: ok,
    preparePending: ok,
    popPending: async () => queue.shift() || null,
    pendingSnapshot: async () => ({ ok: true, count: queue.length, uids: [] }),
    conversationHistory: async () => ({ ok: true, messages }),
    sendImage: ok,
    sendVideo: ok,
    release: ok,
    discard: ok,
    popMerchantSent: async () => [],
    syncAiEnabled: ok,
    async focusConversation() {
      // 批准后 worker 的重新定位发生在这里；只阻塞第一次 sending 定位，避免旧实现
      // 进入 sendText 后再次定位时把测试挂住。
      if (
        blockOnSendingFocus &&
        !focusReleased &&
        review.snapshot().replies.some((row) => row.status === 'sending')
      ) {
        focusBlocked = true
        await new Promise<void>((resolve) => {
          releaseFocus = resolve
        })
      }
      return { ok: true }
    },
    async sendText() {
      return { ok: true }
    },
    _wc() {
      return {
        focus() {},
        sendInputEvent() {
          clicks += 1
        },
      }
    },
    async _callHook(method: string, args: unknown[]) {
      if (method === 'reviewHistory')
        return { known: true, uid: String(args[0]), page: 'page-a', messages: pageMessages }
      if (method === 'prepareNativeTextSend') {
        prepares += 1
        if (prepareResult) return { ok: false, ...prepareResult }
        return { ok: true, token: 'token-a', point: { x: 6, y: 7 } }
      }
      if (method === 'confirmNativeTextSend') {
        confirms += 1
        return { ok: true, msgId: 's1' }
      }
      return { ok: true }
    },
    _sendFailOrThrow(_method: string, error: unknown) {
      throw error
    },
  }
  const authorizations = new SendModeAuthorizations(() => ({ mode: 'review', revision: 0 }))
  const gate = createWelcomeDelayGate({
    readWelcome: () => ({
      text: '',
      enabled: true,
      version: 1,
      delayMinSeconds: 1,
      delayMaxSeconds: 1,
    }),
    readStore: () => ({ online: true, aiEnabled: true }),
    conversation: (storeId, uid) => {
      const rows = snap.conversations.find((row) => row.storeId === storeId && row.uid === uid)
      const current = rows?.messages ?? []
      return {
        fingerprint: JSON.stringify(
          current.map((message) => ({
            from: message.from,
            type: message.type,
            content: message.content,
          })),
        ),
        lastFrom: current.at(-1)?.from ?? '',
      }
    },
    cancel: (proposal, reason) => review.cancelSending(proposal.storeId, proposal.uid, reason),
    releaseSendAuthorization: (storeId, uid) => authorizations.release(storeId, uid),
  })
  const configured = configureDomTextAdapter('pdd-web', raw, 0, (uid, text) =>
    authorizations.consume('shop', uid, text),
  )
  const coordinator = new PlatformWriteCoordinator()
  const adapter = coordinator.bind('shop', configured).backend
  const cfg = {
    ai: { systemPrompt: '测试规则', timeoutMs: 1000 },
    reply: {
      enabled: true,
      maxInflight: 1,
      pollIntervalMs: 60000,
      staleMs: 0,
      sendJitterMinMs: 0,
      sendJitterMaxMs: 0,
      perUidMinIntervalMs: 0,
      perStorePerMinuteMax: 100,
      fallbackAfterMs: 0,
    },
    safety: { handoffKeywords: ['投诉'], bannedWords: [] },
  }
  const aiClient = {
    reply: vi.fn(async (_input: unknown) => ({ reply: '生成的回复' })),
    beforeSend: (proposal: SendProposal) =>
      authorizations.authorize(proposal, async () => {
        const approved = await review.propose(proposal)
        return approved ? gate(proposal, true) : false
      }),
    // 生产始终存在该回调；缺了它会把适配器契约错误误当成普通可重试失败。
    onDeliveryFailure: (event: { reason?: string }) =>
      deliveryFailures.push({ reason: event.reason || 'send_unconfirmed' }),
  }
  const worker = new StoreWorker({
    store,
    adapter,
    aiClient,
    getConfig: () => cfg,
    welcomePolicy: { claim: () => '', noteOutbound: () => {} },
    onEvent: (event: unknown) => {
      events.push(event)
      review.event(event)
    },
  })
  cleanup.push(() => {
    authorizations.dispose()
    coordinator.dispose()
    review.dispose()
    worker.stop()
  })
  return {
    worker,
    review,
    snap,
    queue,
    pageMessages,
    deliveryFailures,
    events,
    get prepares() {
      return prepares
    },
    get clicks() {
      return clicks
    },
    get confirms() {
      return confirms
    },
    get focusBlocked() {
      return focusBlocked
    },
    release() {
      focusReleased = true
      releaseFocus?.()
    },
  }
}

describe('真实回复引擎的确认门', () => {
  it('第一位买家等待审核时，单并发仍可为另一位买家生成候选且不发送', async () => {
    const { worker, review, sent, queue, snap, adapter, aiClient } = harness()
    adapter.conversationHistory = async () => ({ ok: true, messages: [] })
    worker.start()
    await worker.tick()
    await vi.waitFor(() => expect(review.snapshot().replies).toHaveLength(1))
    const messages = [
      {
        from: 'buyer' as const,
        content: '另一位买家的问题',
        ts: Date.now(),
        msgId: 'other-1',
        type: 'text' as const,
      },
    ]
    snap.conversations.push({
      storeId: 'shop',
      uid: 'other',
      name: '买家乙',
      status: 'pending',
      messages,
    })
    queue.push({ uid: 'other', messages })
    await worker.tick()
    await vi.waitFor(() => expect(review.snapshot().replies).toHaveLength(2))
    expect(aiClient.reply).toHaveBeenCalledTimes(2)
    expect(review.snapshot().replies.every((row) => row.status === 'pending')).toBe(true)
    expect(sent).toEqual([])
    for (const row of review.snapshot().replies) await review.decide({ id: row.id, approve: false })
    await worker.settle()
    expect(sent).toEqual([])
  })
  it('历史接口失败仍把本机归档的买家和客服历史交给模型，确认前不发送', async () => {
    const { worker, review, sent, adapter, snap, aiClient } = harness('我刚才询问的商品')
    const at = snap.conversations[0].messages[0].ts
    snap.conversations[0].messages.unshift(
      { from: 'buyer', content: '想买 M8 螺丝', ts: at - 20000, msgId: 'old-b' },
      { from: 'seller', content: '需要多长的？', ts: at - 10000, msgId: 'old-s' },
    )
    Object.assign(aiClient, { resolveThread: createConversationThread(() => snap.conversations) })
    adapter.conversationHistory = async () => ({ ok: false, messages: [] })
    worker.start()
    await worker.tick()
    await vi.waitFor(() => expect(review.snapshot().replies).toHaveLength(1))
    expect(aiClient.reply.mock.calls[0][0]).toMatchObject({
      thread: [
        { from: 'buyer', content: '想买 M8 螺丝' },
        { from: 'seller', content: '需要多长的？' },
        { from: 'buyer', content: '我刚才询问的商品' },
      ],
    })
    expect(sent).toEqual([])
    await review.decide({ id: review.snapshot().replies[0].id, approve: false })
    await worker.settle()
  })
  it('新买家消息使旧候选失效后不永久暂停，会继续生成新候选', async () => {
    const { worker, review, queue, snap } = harness()
    worker.start()
    await worker.tick()
    await vi.waitFor(() => expect(review.snapshot().replies).toHaveLength(1))
    const message = {
      from: 'buyer' as const,
      content: '这是新的问题',
      ts: Date.now() + 1,
      msgId: 'b2',
      type: 'text' as const,
    }
    snap.conversations[0].messages.push(message)
    queue.push({ uid: 'buyer', messages: [message] })
    review.sync()
    await worker.settle()
    expect(review.snapshot().replies[0].status).toBe('expired')
    await worker.tick()
    await vi.waitFor(() => expect(review.snapshot().replies).toHaveLength(2))
    const current = review.snapshot().replies.find((row) => row.status === 'pending')
    expect(current).toBeDefined()
    if (current) await review.decide({ id: current.id, approve: false })
    await worker.settle()
  })
  it('历史接口不可用时，生成前网页基线仍允许确认后发送一次', async () => {
    const { worker, review, sent, adapter } = harness()
    const page = {
      known: true,
      uid: 'buyer',
      page: 'fixture-page',
      messages: [{ from: 'buyer', content: '你好', media: [] }],
    }
    Object.assign(adapter, {
      conversationHistory: async () => ({ ok: false }),
      reviewHistory: async () => structuredClone(page),
    })
    worker.start()
    await worker.tick()
    await vi.waitFor(() => expect(review.snapshot().replies).toHaveLength(1))
    expect(sent).toHaveLength(0)
    await review.decide({ id: review.snapshot().replies[0].id, approve: true })
    await worker.settle()
    expect(sent).toHaveLength(1)
    expect(sent[0]).toContain('生成的回复')
  })
  it('最终欢迎语与正文经过确认前零发送，确认后只发一次', async () => {
    const { worker, review, sent } = harness()
    worker.start()
    await worker.tick()
    await vi.waitFor(() => expect(review.snapshot().replies).toHaveLength(1))
    expect(sent).toEqual([])
    const row = review.snapshot().replies[0]
    expect(row.text).toBe('欢迎光临\n生成的回复')
    await review.decide({ id: row.id, approve: true })
    await worker.settle()
    expect(sent).toEqual([row.text])
    expect(row.status).toBe('sent')
  })
  it('当前咨询商品编号与标题随真实生成上下文进入结构化投影', async () => {
    const { worker, review, aiClient, sent } = harness('这款门锁保修多久', {
      goodsId: '1004116120118',
      goodsTitle: '平台展示门锁',
    })
    worker.start()
    await worker.tick()
    await vi.waitFor(() => expect(review.snapshot().replies).toHaveLength(1))
    expect(aiClient.reply.mock.calls[0][0]).toMatchObject({
      goodsTitle: '平台展示门锁',
      reviewContext: {
        purpose: 'reply',
        storeId: 'shop',
        uid: 'buyer',
        productId: '1004116120118',
        goodsTitle: '平台展示门锁',
      },
    })
    expect(sent).toEqual([])
    await review.decide({ id: review.snapshot().replies[0].id, approve: false })
    await worker.settle()
  })
  it('取消候选后实际适配器不会发送', async () => {
    const { worker, review, sent } = harness()
    worker.start()
    await worker.tick()
    await vi.waitFor(() => expect(review.snapshot().replies).toHaveLength(1))
    await review.decide({ id: review.snapshot().replies[0].id, approve: false })
    await worker.settle()
    expect(sent).toEqual([])
  })
  it('转人工提示也经过同一确认门，等待期间关闭 AI 不发送', async () => {
    const { worker, review, sent, store } = harness('我要投诉')
    worker.start()
    await worker.tick()
    await vi.waitFor(() => expect(review.snapshot().replies).toHaveLength(1))
    expect(sent).toEqual([])
    store.aiEnabled = false
    review.sync()
    await worker.settle()
    expect(sent).toEqual([])
    expect(review.snapshot().replies[0].status).toBe('expired')
  })
})

describe('批准后的会话当前性', () => {
  it('批准后等待重新定位时新买家到达，旧无欢迎候选不填写不点击并可继续处理新消息', async () => {
    const f = approvalHarness(true)
    f.worker.start()
    await f.worker.tick()
    await vi.waitFor(() => expect(f.review.snapshot().replies).toHaveLength(1))
    const row = f.review.snapshot().replies[0]
    const approval = f.review.decide({ id: row.id, approve: true })
    await vi.waitFor(() => expect(f.focusBlocked).toBe(true))

    const newMessage = {
      from: 'buyer' as const,
      content: '批准后到达的新问题',
      ts: Date.now() + 1,
      msgId: 'b2',
      type: 'text' as const,
    }
    f.snap.conversations[0].messages.push(newMessage)
    f.pageMessages.push({ from: 'buyer', content: newMessage.content, media: [] })
    f.queue.push({ uid: 'buyer', messages: [newMessage] })
    f.review.sync()
    f.release()
    await approval
    await f.worker.settle()

    expect(f.prepares).toBe(0)
    expect(f.clicks).toBe(0)
    expect(f.confirms).toBe(0)
    expect(f.deliveryFailures).toEqual([])
    const old = f.review.snapshot().replies.find((item) => item.id === row.id)
    expect(old?.status).not.toBe('sent')
    expect(old?.reason).toContain('新消息')

    await f.worker.tick()
    await vi.waitFor(() =>
      expect(f.review.snapshot().replies.filter((item) => item.status === 'pending')).toHaveLength(
        1,
      ),
    )
    const next = f.review.snapshot().replies.find((item) => item.status === 'pending')
    expect(next).toBeDefined()
    if (next) await f.review.decide({ id: next.id, approve: false })
    await f.worker.settle()
    expect(f.prepares).toBe(0)
  })

  it('批准后网页先到、归档尚未同步时，旧候选不填写不点击，归档同步后仍可生成新候选', async () => {
    const f = approvalHarness(true)
    f.worker.start()
    await f.worker.tick()
    await vi.waitFor(() => expect(f.review.snapshot().replies).toHaveLength(1))
    const row = f.review.snapshot().replies[0]
    const approval = f.review.decide({ id: row.id, approve: true })
    await vi.waitFor(() => expect(f.focusBlocked).toBe(true))

    const newMessage = {
      from: 'buyer' as const,
      content: '网页先到但归档尚未轮询的问题',
      ts: Date.now() + 1,
      msgId: 'page-only-1',
      type: 'text' as const,
    }
    // 只改网页，不改 snap/queue；模拟 message-monitor 尚未把新消息写入归档。
    f.pageMessages.push({ from: 'buyer', content: newMessage.content, media: [] })
    f.review.sync()
    f.release()
    await approval
    await f.worker.settle()

    expect(f.prepares).toBe(0)
    expect(f.clicks).toBe(0)
    expect(f.confirms).toBe(0)
    expect(f.deliveryFailures).toEqual([])
    const old = f.review.snapshot().replies.find((item) => item.id === row.id)
    expect(old?.status).not.toBe('sent')

    f.snap.conversations[0].messages.push(newMessage)
    f.queue.push({ uid: 'buyer', messages: [newMessage] })
    await f.worker.tick()
    await vi.waitFor(() =>
      expect(f.review.snapshot().replies.filter((item) => item.status === 'pending')).toHaveLength(
        1,
      ),
    )
    const next = f.review.snapshot().replies.find((item) => item.status === 'pending')
    expect(next).toBeDefined()
    if (next) await f.review.decide({ id: next.id, approve: false })
    await f.worker.settle()
    expect(f.prepares).toBe(0)
  })

  it('无欢迎的普通回复批准后仍立即发送一次，不引入延迟', async () => {
    const f = approvalHarness()
    f.worker.start()
    await f.worker.tick()
    await vi.waitFor(() => expect(f.review.snapshot().replies).toHaveLength(1))
    const row = f.review.snapshot().replies[0]
    await f.review.decide({ id: row.id, approve: true })
    await f.worker.settle()
    expect(f.prepares).toBe(1)
    expect(f.clicks).toBe(2)
    expect(f.confirms).toBe(1)
    expect(f.review.snapshot().replies[0].status).toBe('sent')
  })

  it('发送失败保留 input_busy 与安全 detail 分类，状态失败且不点击不重发', async () => {
    const f = approvalHarness(false, { reason: 'input_busy', detail: 'send_button_obscured' })
    f.worker.start()
    await f.worker.tick()
    await vi.waitFor(() => expect(f.review.snapshot().replies).toHaveLength(1))
    const row = f.review.snapshot().replies[0]
    await f.review.decide({ id: row.id, approve: true })
    await f.worker.settle()

    expect(f.prepares).toBe(1)
    expect(f.clicks).toBe(0)
    expect(f.confirms).toBe(0)
    expect(f.deliveryFailures).toEqual([{ reason: 'input_busy' }])
    expect(f.review.snapshot().replies[0].status).toBe('failed')
    expect(JSON.stringify(f.events)).toContain('"detail":"send_button_obscured"')
    const log = f.review.snapshot().logs.find((item) => item.kind === 'reply:review-result')
    expect(log?.text).toContain('input_busy')
    expect(log?.text).toContain('发送分类: send_button_obscured')
    const failed = f.review.snapshot().logs.find((item) => item.kind === 'reply:failed')
    expect(failed?.text).toContain('发送分类: send_button_obscured')
    expect(f.review.snapshot().logs.some((item) => item.kind === 'reply:sent')).toBe(false)
  })

  it('恶意 detail 在引擎事件与最终日志中均只留下 unclassified', async () => {
    const raw = '客户私有文本 Bearer fixture-secret https://example.test/?key=sk-secret&body=<html>'
    const f = approvalHarness(false, { reason: 'input_busy', detail: raw })
    f.worker.start()
    await f.worker.tick()
    await vi.waitFor(() => expect(f.review.snapshot().replies).toHaveLength(1))
    const row = f.review.snapshot().replies[0]
    await f.review.decide({ id: row.id, approve: true })
    await f.worker.settle()

    const eventPayload = JSON.stringify(f.events)
    expect(eventPayload).toContain('"detail":"unclassified"')
    expect(eventPayload).not.toContain('客户私有文本')
    expect(eventPayload).not.toContain('fixture-secret')
    expect(eventPayload).not.toContain('sk-secret')
    expect(eventPayload).not.toContain('example.test')
    const logPayload = JSON.stringify(f.review.snapshot().logs)
    expect(logPayload).toContain('发送分类: unclassified')
    expect(logPayload).not.toContain('客户私有文本')
    expect(logPayload).not.toContain('fixture-secret')
    expect(logPayload).not.toContain('sk-secret')
    expect(logPayload).not.toContain('example.test')
    expect(f.review.snapshot().replies[0].status).toBe('failed')
    expect(f.clicks).toBe(0)
    expect(f.confirms).toBe(0)
  })

  it('vendor 与日志边界的发送分类 allowlist 完全一致', () => {
    expect(REVIEW_DIAGNOSTIC_CODES).toEqual(engine.SEND_DIAGNOSTIC_CODES)
  })
})

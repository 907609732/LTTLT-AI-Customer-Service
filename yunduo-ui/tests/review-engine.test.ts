import { createRequire } from 'node:module'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ReviewConsole, type SendProposal } from '../electron/review-console'
import { emptySnapshot } from '../src/shared/contracts/backend'
import { createConversationThread } from '../electron/conversation-context'

interface Worker {
  start(): void
  stop(): void
  tick(): Promise<unknown>
  settle(): Promise<void>
}
const { StoreWorker } = createRequire(import.meta.url)(
  path.resolve('vendor/lingtu-runtime/desk-v1/src/main/reply-engine.js'),
) as { StoreWorker: new (options: Record<string, unknown>) => Worker }
const cleanup: (() => void)[] = []
afterEach(() => {
  cleanup.splice(0).forEach((stop) => stop())
})

function harness(question = '你好') {
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
    queue = [{ uid: 'buyer', messages }]
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

describe('真实回复引擎的确认门', () => {
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

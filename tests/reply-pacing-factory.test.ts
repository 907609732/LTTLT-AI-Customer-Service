import { createRequire } from 'node:module'
import { afterEach, expect, it, vi } from 'vitest'
import { createUidIntervalResolver } from '../electron/reply-pacing'
import type { ReplyPacing } from '../src/shared/contracts/backend'

interface Worker {
  lastSentAt: Map<string, number>
  sendWindow: number[]
  pacingIntervalMs(uid: string): number
  tick(): Promise<unknown>
  settle(): Promise<unknown>
}

interface Engine {
  startStore(storeId: string): Promise<Worker>
  stopAll(): void
}

interface PendingRow {
  uid: string
  messages: { msgId: string; from: 'buyer'; type: 'text'; content: string; ts: number }[]
}

const { ReplyEngine } = createRequire(import.meta.url)(
  '../vendor/lingtu-runtime/desk-v1/src/main/reply-engine.js',
) as { ReplyEngine: new (options: Record<string, unknown>) => Engine }

const engines: Engine[] = []
afterEach(() => {
  for (const engine of engines.splice(0)) engine.stopAll()
})

async function fixture(
  options: {
    readPacing?: () => ReplyPacing
    random?: () => number
    beforeSend?: () => Promise<boolean>
    storeLimit?: number
  } = {},
) {
  const clock = { now: 1_700_000_000_000 }
  const queue: PendingRow[] = []
  const sent: { uid: string; text: string }[] = []
  const events: Record<string, unknown>[] = []
  const sleeps: number[] = []
  const config = {
    ai: { systemPrompt: 'fixture', timeoutMs: 1000 },
    reply: {
      enabled: true,
      // Scheduled timers never fire during these manually advanced tests.
      pollIntervalMs: 60000,
      maxInflight: 6,
      staleMs: 180000,
      recoverWindowMs: 600000,
      fallbackAfterMs: 0,
      fallbackText: '稍等',
      maxReplyChars: 200,
      handoffText: '请联系人工客服',
      perUidMinIntervalMs: 60000,
      sendJitterMinMs: 500,
      sendJitterMaxMs: 2000,
      perStorePerMinuteMax: options.storeLimit ?? 20,
    },
    safety: { handoffKeywords: [], manualReplyKeywords: [] },
  }
  const adapter = {
    id: 'pacing-factory-fixture',
    accessMode: 'webview',
    supports: () => true,
    ensure: async () => ({ ok: true }),
    preparePending: async () => ({ ok: true }),
    popPending: async () => queue.shift() ?? null,
    pendingSnapshot: async () => ({
      ok: true,
      count: queue.length,
      uids: queue.map((row) => row.uid),
    }),
    conversationHistory: async () => ({ ok: true, messages: [] }),
    focusConversation: async () => ({ ok: true }),
    sendText: async (uid: string, text: string) => {
      sent.push({ uid, text })
      return { ok: true, msgId: `sent-${sent.length}` }
    },
    sendImage: async () => ({ ok: true }),
    sendVideo: async () => ({ ok: true }),
    release: async () => ({ ok: true }),
    discard: async () => ({ ok: true }),
    popMerchantSent: async () => [],
    syncAiEnabled: async () => ({ ok: true }),
  }
  const reply = vi.fn(async () => ({
    reply: 'fixture answer',
    images: [],
    videos: [],
    cardActions: [],
    couponName: '',
    handoff: false,
  }))
  const random = vi.fn(options.random ?? (() => 0))
  const engine = new ReplyEngine({
    registry: { get: (id: string) => ({ id, storeName: 'fixture', aiEnabled: true }) },
    adapterFactory: async () => adapter,
    aiClient: {
      reply,
      ...(options.beforeSend ? { beforeSend: options.beforeSend } : {}),
    },
    getConfig: () => config,
    now: () => clock.now,
    random,
    sleep: async (milliseconds: number) => {
      sleeps.push(milliseconds)
    },
    onEvent: (event: Record<string, unknown>) => {
      events.push(event)
    },
    ...(options.readPacing
      ? { resolveUidIntervalMs: createUidIntervalResolver(options.readPacing) }
      : {}),
  })
  engines.push(engine)
  // This constructor -> startStore -> StoreWorker path is deliberately used
  // instead of directly constructing the worker: a dropped factory option must fail.
  const worker = await engine.startStore('pacing-store')
  function enqueue(uid: string, msgId: string) {
    queue.push({
      uid,
      messages: [{ msgId, from: 'buyer', type: 'text', content: 'hello', ts: clock.now - 10 }],
    })
  }
  async function drain() {
    await worker.tick()
    await worker.settle()
  }
  return { engine, worker, clock, config, sent, sleeps, reply, random, events, enqueue, drain }
}

it('forwards the TypeScript resolver through ReplyEngine and removes legacy 60-second and jitter waits', async () => {
  const settings: ReplyPacing = { mode: 'random-1-3', customMinSeconds: 1, customMaxSeconds: 3 }
  const f = await fixture({ readPacing: () => settings, random: () => 0 })
  f.worker.lastSentAt.set('buyer-a', f.clock.now)
  f.clock.now += 1500
  f.enqueue('buyer-a', 'factory-allowed')
  await f.drain()
  expect(f.reply).toHaveBeenCalledTimes(1)
  expect(f.sent).toEqual([{ uid: 'buyer-a', text: 'fixture answer' }])
  expect(f.sleeps).toEqual([])
  expect(f.random).toHaveBeenCalledTimes(1)
})

it('keeps one sampled deadline across polls and send rechecks, independently for each buyer', async () => {
  const settings: ReplyPacing = { mode: 'random-1-3', customMinSeconds: 1, customMaxSeconds: 3 }
  const f = await fixture({ readPacing: () => settings, random: () => 1 })
  const started = f.clock.now
  f.worker.lastSentAt.set('buyer-a', started)
  f.worker.lastSentAt.set('buyer-b', started)
  f.clock.now = started + 1500
  f.enqueue('buyer-a', 'waiting-1')
  await f.drain()
  expect(f.sent).toEqual([])
  expect(f.worker.pacingIntervalMs('buyer-a')).toBe(3000)
  expect(f.worker.pacingIntervalMs('buyer-a')).toBe(3000)
  expect(f.random).toHaveBeenCalledTimes(1)
  expect(f.worker.pacingIntervalMs('buyer-b')).toBe(3000)
  expect(f.random).toHaveBeenCalledTimes(2)
  f.clock.now = started + 2999
  f.enqueue('buyer-a', 'waiting-2')
  await f.drain()
  expect(f.sent).toEqual([])
  expect(f.random).toHaveBeenCalledTimes(2)
  f.clock.now = started + 3000
  f.enqueue('buyer-a', 'ready-at-deadline')
  await f.drain()
  expect(f.sent).toHaveLength(1)
  expect(f.random).toHaveBeenCalledTimes(2)
  expect(f.sleeps).toEqual([])
  // A successful send starts a new interval, rather than reusing the previous one.
  expect(f.worker.pacingIntervalMs('buyer-a')).toBe(3000)
  expect(f.random).toHaveBeenCalledTimes(3)
})

it('uses a newly saved setting in the current waiting cycle without restarting the store', async () => {
  let settings: ReplyPacing = { mode: 'custom', customMinSeconds: 100, customMaxSeconds: 100 }
  const f = await fixture({ readPacing: () => settings })
  f.worker.lastSentAt.set('buyer-a', f.clock.now)
  f.clock.now += 1500
  f.enqueue('buyer-a', 'before-save')
  await f.drain()
  expect(f.sent).toEqual([])
  // The store save changes the resolver's live read; no engine replacement occurs.
  settings = { mode: 'fixed-1', customMinSeconds: 100, customMaxSeconds: 100 }
  f.enqueue('buyer-a', 'after-save')
  await f.drain()
  expect(f.reply).toHaveBeenCalledTimes(1)
  expect(f.sent).toHaveLength(1)
  expect(f.sleeps).toEqual([])
})

it('keeps the uninjected upstream path responsive to fixed-interval configuration changes', async () => {
  const f = await fixture()
  f.worker.lastSentAt.set('buyer-a', f.clock.now)
  f.clock.now += 1500
  f.enqueue('buyer-a', 'legacy-before-save')
  await f.drain()
  expect(f.sent).toEqual([])
  f.config.reply.perUidMinIntervalMs = 1000
  f.enqueue('buyer-a', 'legacy-after-save')
  await f.drain()
  expect(f.sent).toHaveLength(1)
  // No injection means the existing upstream send jitter is still preserved.
  expect(f.sleeps).toEqual([500])
})

it('still requires approval when the new pacing interval has elapsed', async () => {
  const review = vi.fn(async () => false)
  const settings: ReplyPacing = { mode: 'fixed-1', customMinSeconds: 1, customMaxSeconds: 3 }
  const f = await fixture({ readPacing: () => settings, beforeSend: review })
  f.enqueue('buyer-a', 'denied')
  await f.drain()
  expect(f.reply).toHaveBeenCalledTimes(1)
  expect(review).toHaveBeenCalledTimes(1)
  expect(f.sent).toEqual([])
})

it('does not send an approved old candidate after the store stops', async () => {
  let finishReview: (approved: boolean) => void = () => {
    throw new Error('Review was not created')
  }
  const decision = new Promise<boolean>((resolve) => {
    finishReview = resolve
  })
  let awaitingReview = false
  const settings: ReplyPacing = { mode: 'fixed-1', customMinSeconds: 1, customMaxSeconds: 3 }
  const f = await fixture({
    readPacing: () => settings,
    beforeSend: () => {
      awaitingReview = true
      return decision
    },
  })
  f.enqueue('buyer-a', 'cancelled-during-review')
  try {
    await f.worker.tick()
    for (let turn = 0; turn < 1000 && !awaitingReview; turn += 1) await Promise.resolve()
    expect(awaitingReview).toBe(true)
    f.engine.stopAll()
    finishReview(true)
    await f.worker.settle()
    expect(f.sent).toEqual([])
  } finally {
    finishReview(false)
  }
})

it('retains the per-store rate cap instead of treating randomized pacing as a bypass', async () => {
  const settings: ReplyPacing = { mode: 'fixed-1', customMinSeconds: 1, customMaxSeconds: 3 }
  const f = await fixture({ readPacing: () => settings, storeLimit: 1 })
  f.worker.sendWindow.push(f.clock.now - 100)
  f.enqueue('buyer-a', 'store-rate-limited')
  await f.drain()
  expect(f.reply).not.toHaveBeenCalled()
  expect(f.sent).toEqual([])
  expect(
    f.events.some((event) => event.type === 'reply:throttled' && event.reason === 'store_rate'),
  ).toBe(true)
})

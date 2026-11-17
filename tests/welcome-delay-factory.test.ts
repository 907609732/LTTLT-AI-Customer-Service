import { createRequire } from 'node:module'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createWelcomeDelayGate } from '../electron/welcome-delay'
import { normalizeWelcomeSetting } from '../src/shared/contracts/welcome'
import type { SendProposal } from '../electron/review-console'

interface Worker {
  takeOver(uid: string): void
  tick(): Promise<unknown>
  settle(): Promise<unknown>
}
interface Engine {
  startStore(storeId: string): Promise<Worker>
  stopAll(): void
}
interface WelcomeStore {
  snapshot(): Record<string, { text: string; enabled: boolean; version: number }>
  save(
    storeId: string,
    value: Record<string, unknown>,
  ): { text: string; enabled: boolean; version: number }
  observe(input: { storeId: string; uid: string; ts: number; existing?: boolean }): void
  claim(input: { storeId: string; uid: string; thread: unknown }): string
  claimEntry(input: { storeId: string; uid: string; thread: unknown }): {
    text: string
    version: number
  }
  noteOutbound(input: { storeId: string; uid: string }): void
}
const { ReplyEngine } = createRequire(import.meta.url)(
  '../vendor/lingtu-runtime/desk-v1/src/main/reply-engine.js',
) as { ReplyEngine: new (options: Record<string, unknown>) => Engine }
const { createWelcome } = createRequire(import.meta.url)(
  '../vendor/lingtu-runtime/electron/store-welcome.cjs',
) as { createWelcome: (file: string, options: { now: () => number }) => WelcomeStore }

const engines: Engine[] = []
const directories: string[] = []
afterEach(() => {
  for (const engine of engines.splice(0)) engine.stopAll()
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

async function fixture(options: { hook?: boolean; approve?: boolean; onSleep?: () => void } = {}) {
  const directory = mkdtempSync(path.join(tmpdir(), 'welcome-delay-'))
  directories.push(directory)
  const clock = { now: 1_700_000_000_000 }
  const welcome = createWelcome(path.join(directory, 'store-welcome.json'), {
    now: () => clock.now,
  })
  welcome.save('welcome-store', {
    text: '欢迎光临',
    enabled: true,
    version: 0,
    delayMinSeconds: 1,
    delayMaxSeconds: 3,
  })
  clock.now += 1
  const queue: {
    uid: string
    messages: { msgId: string; from: 'buyer'; type: 'text'; content: string; ts: number }[]
  }[] = []
  const sent: { uid: string; text: string }[] = []
  const sleeps: number[] = []
  const proposals: SendProposal[] = []
  const cancelled: string[] = []
  const released: string[] = []
  const random = vi.fn(() => 0)
  const gate = createWelcomeDelayGate({
    readWelcome: (storeId) => {
      const setting = welcome.snapshot()[storeId]
      return setting ? normalizeWelcomeSetting(setting) : undefined
    },
    readStore: () => ({ online: true, aiEnabled: true }),
    conversation: () => ({
      fingerprint: JSON.stringify(queue.at(-1)?.messages ?? []),
      lastFrom: 'buyer',
    }),
    cancel: (_proposal, reason) => cancelled.push(reason),
    releaseSendAuthorization: (storeId, uid) => released.push(`${storeId}:${uid}`),
    random,
    now: () => clock.now,
    sleep: async (milliseconds) => {
      sleeps.push(milliseconds)
      options.onSleep?.()
      clock.now += milliseconds
    },
  })
  const adapter = {
    id: 'welcome-fixture',
    accessMode: 'webview',
    supports: () => true,
    ensure: async () => ({ ok: true }),
    preparePending: async () => ({ ok: true }),
    popPending: async () => queue.shift() ?? null,
    pendingSnapshot: async () => ({ ok: true, count: queue.length, uids: [] }),
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
  const policy: Record<string, unknown> = {
    noteOutbound: (args: { storeId: string; uid: string }) => welcome.noteOutbound(args),
    claim: (args: { storeId: string; uid: string; thread: unknown }) => {
      welcome.observe({
        storeId: args.storeId,
        uid: args.uid,
        ts: clock.now,
        existing: false,
      })
      return welcome.claim(args)
    },
    ...(options.hook === false
      ? {}
      : {
          claimEntry: (args: { storeId: string; uid: string; thread: unknown }) => {
            welcome.observe({
              storeId: args.storeId,
              uid: args.uid,
              ts: clock.now,
              existing: false,
            })
            return welcome.claimEntry(args)
          },
        }),
  }
  const engine = new ReplyEngine({
    registry: {
      get: (id: string) => ({ id, storeName: 'welcome-fixture', aiEnabled: true }),
    },
    adapterFactory: async () => adapter,
    aiClient: {
      reply: vi.fn(async () => ({ reply: '您好' })),
      beforeSend: async (proposal: SendProposal) => {
        proposals.push(proposal)
        const approved = options.approve === false ? false : true
        if (!approved) return false
        return gate(proposal, true)
      },
    },
    welcomePolicy: policy,
    getConfig: () => ({
      ai: { systemPrompt: 'fixture', timeoutMs: 1000 },
      reply: {
        enabled: true,
        pollIntervalMs: 60000,
        maxInflight: 6,
        staleMs: 180000,
        fallbackAfterMs: 0,
        fallbackText: '',
        maxReplyChars: 200,
        handoffText: '人工',
        perUidMinIntervalMs: 0,
        perStorePerMinuteMax: 20,
        sendJitterMinMs: 0,
        sendJitterMaxMs: 0,
      },
      safety: { handoffKeywords: [], manualReplyKeywords: [] },
    }),
    now: () => clock.now,
    random,
  })
  engines.push(engine)
  const worker = await engine.startStore('welcome-store')
  function enqueue(uid: string, msgId: string) {
    queue.push({
      uid,
      messages: [{ msgId, from: 'buyer', type: 'text', content: '在吗', ts: clock.now }],
    })
  }
  async function drain() {
    await worker.tick()
    await worker.settle()
  }
  return {
    engine,
    worker,
    clock,
    sent,
    sleeps,
    proposals,
    cancelled,
    released,
    random,
    enqueue,
    drain,
  }
}

describe('真实厂商欢迎装饰与 TypeScript 延迟门', () => {
  it('欢迎版本随实际附加正文进入候选，批准后等待一次 1～3 秒随机再发送', async () => {
    const f = await fixture()
    f.enqueue('buyer', 'welcome-1')
    await f.drain()
    expect(f.proposals).toHaveLength(1)
    expect(f.proposals[0]!.welcome).toEqual({ version: 1 })
    expect(f.sent).toEqual([{ uid: 'buyer', text: '欢迎光临\n您好' }])
    expect(f.random).toHaveBeenCalledTimes(1)
    expect(f.sleeps.reduce((sum, value) => sum + value, 0)).toBe(1000)
    // 后续同一买家回复没有再次附加欢迎，不进入延迟等待。
    f.enqueue('buyer', 'welcome-2')
    await f.drain()
    expect(f.proposals).toHaveLength(2)
    expect(f.proposals[1]!.welcome).toBeUndefined()
    expect(f.sent).toHaveLength(2)
    expect(f.sent[1]!.text).toBe('您好')
    expect(f.random).toHaveBeenCalledTimes(1)
    expect(f.sleeps.reduce((sum, value) => sum + value, 0)).toBe(1000)
  })
  it('未经 claimEntry 注入的上游路径不产生欢迎元数据也不延迟', async () => {
    const f = await fixture({ hook: false })
    f.enqueue('buyer', 'upstream-1')
    await f.drain()
    expect(f.proposals).toHaveLength(1)
    expect(f.proposals[0]!.welcome).toBeUndefined()
    expect(f.sent[0]!.text).toBe('欢迎光临\n您好')
    expect(f.random).not.toHaveBeenCalled()
    expect(f.sleeps).toEqual([])
  })
  it('候选被拒绝时不等待抽样也不发送', async () => {
    const f = await fixture({ approve: false })
    f.enqueue('buyer', 'rejected-1')
    await f.drain()
    expect(f.proposals).toHaveLength(1)
    expect(f.random).not.toHaveBeenCalled()
    expect(f.sleeps).toEqual([])
    expect(f.sent).toEqual([])
  })
  it('延迟期间停店或人工接管会取消，不发送已批准的欢迎候选', async () => {
    for (const reason of ['stop', 'takeover'] as const) {
      let triggered = false
      const f = await fixture({
        onSleep: () => {
          if (triggered) return
          triggered = true
          if (reason === 'stop') f.engine.stopAll()
          else f.worker.takeOver('buyer')
        },
      })
      f.enqueue('buyer', `cancel-${reason}`)
      await f.drain()
      expect(triggered).toBe(true)
      expect(f.sent).toEqual([])
      expect(f.cancelled).toHaveLength(1)
      expect(f.released).toEqual(['welcome-store:buyer'])
      expect(f.sleeps.length).toBeGreaterThan(0)
    }
  })
})

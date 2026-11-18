// @vitest-environment node
import { createRequire } from 'node:module'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { normalizeManualReplyKeywords } from '../electron/manual-reply-keywords'
import { emptySnapshot, resultSchema, snapshotSchema } from '../src/shared/contracts/backend'

const require = createRequire(import.meta.url)
const { createBackend } = require('../vendor/lingtu-runtime/electron/backend.cjs') as {
  createBackend: (options: Record<string, unknown>) => Backend
}
const { StoreWorker } = require(
  path.resolve('vendor/lingtu-runtime/desk-v1/src/main/reply-engine.js'),
) as { StoreWorker: new (options: Record<string, unknown>) => Worker }

interface Backend {
  snapshot(): unknown
  execute(input: unknown): Promise<unknown>
  dispose(): void
}
interface Worker {
  running: boolean
  manualSuppressed: Set<string>
  tick(): Promise<unknown>
  settle(): Promise<void>
  clearManualSuppression(uid: string, source?: string): boolean
}
interface Message {
  msgId?: string
  from: 'buyer' | 'seller'
  content: string
  ts: number
  type?: 'text'
}
interface Row {
  uid: string
  messages: Message[]
}
interface Merchant {
  uid: string
  message: Message
}
interface Send {
  uid: string
  text: string
}
interface Event {
  type: string
  uid?: string
  keyword?: string
}
interface Proposal {
  isCurrent(): boolean
}
interface AiClient {
  calls: number
  reply(payload: unknown): Promise<{ reply: string }>
  beforeSend?(proposal: Proposal): Promise<boolean>
}

const NOW = 1_700_000_000_000
const workspaceId = '00000000-0000-4000-8000-000000000101'
const directories: string[] = []
const backends: Backend[] = []
afterEach(() => {
  backends.splice(0).forEach((backend) => backend.dispose())
  directories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true }))
})

function backendFixture(): { backend: Backend; dir: string } {
  const dir = mkdtempSync(path.join(tmpdir(), 'lingtu-manual-keywords-'))
  directories.push(dir)
  const backend = createBackend({ dataDir: dir })
  backends.push(backend)
  return { backend, dir }
}
function snapshotOf(backend: Backend) {
  return snapshotSchema.parse({
    ...(backend.snapshot() as Record<string, unknown>),
    workspaceId,
  })
}
async function saveConfig(
  backend: Backend,
  keywords: string[],
  expectedKeywords: string[],
): Promise<unknown> {
  return resultSchema.parse(
    await backend.execute({
      action: 'save-config',
      screenId: 'MANUAL_REPLY_KEYWORDS',
      values: { keywords, expectedKeywords },
    }),
  )
}

describe('manual reply keyword persistence', () => {
  it('normalizes every saved line on the main-process boundary', () => {
    expect(normalizeManualReplyKeywords([' 我来 ', '', '我来', '转人工'])).toEqual([
      '我来',
      '转人工',
    ])
    expect(() => normalizeManualReplyKeywords(['超'.repeat(31)])).toThrow(/30/)
    expect(() =>
      normalizeManualReplyKeywords(Array.from({ length: 101 }, (_, index) => `词${index}`)),
    ).toThrow(/100/)
    expect(() => normalizeManualReplyKeywords('我来')).toThrow(/格式/)
  })

  it('snapshot keeps older account config compatible with an empty list', () => {
    const parsed = snapshotSchema.parse({
      ...emptySnapshot(),
      config: { ...emptySnapshot().config, safety: { handoffKeywords: ['投诉'] } },
    })
    expect(parsed.config.safety.manualReplyKeywords).toEqual([])
    expect(parsed.config.safety.handoffKeywordsEnabled).toBe(true)
    expect(parsed.config.safety.manualReplyKeywordsEnabled).toBe(true)
  })

  it('saves, survives restart and only changes the manual reply field', async () => {
    const { backend, dir } = backendFixture()
    const before = snapshotOf(backend).config
    const saved = await saveConfig(backend, [' 我来接待 ', '', '我来接待', '转人工'], [])
    expect(saved).toMatchObject({ status: 'ok' })
    let config = snapshotOf(backend).config
    expect(config.safety.manualReplyKeywords).toEqual(['我来接待', '转人工'])
    expect(config.safety.handoffKeywords).toEqual(before.safety.handoffKeywords)
    expect(config.reply).toEqual(before.reply)
    expect(config.ai).toEqual(before.ai)

    backend.dispose()
    backends.splice(backends.indexOf(backend), 1)
    const restarted = createBackend({ dataDir: dir })
    backends.push(restarted)
    config = snapshotOf(restarted).config
    expect(config.safety.manualReplyKeywords).toEqual(['我来接待', '转人工'])
    expect(config.safety.handoffKeywords).toEqual(before.safety.handoffKeywords)
  })

  it('buyer handoff keyword saves never erase the seller takeover list', async () => {
    const { backend } = backendFixture()
    await saveConfig(backend, ['我来接待'], [])
    await backend.execute({
      action: 'save-config',
      screenId: 'UX08',
      values: { handoffKeywords: ['投诉', '退款'] },
    })
    const config = snapshotOf(backend).config
    expect(config.safety.manualReplyKeywords).toEqual(['我来接待'])
    expect(config.safety.handoffKeywords).toEqual(['投诉', '退款'])
  })

  it('clears every keyword with an explicit empty save', async () => {
    const { backend } = backendFixture()
    await saveConfig(backend, ['我来接待'], [])
    await saveConfig(backend, [], ['我来接待'])
    expect(snapshotOf(backend).config.safety.manualReplyKeywords).toEqual([])
  })

  it('rejects a stale save instead of overwriting newer keywords', async () => {
    const { backend } = backendFixture()
    await saveConfig(backend, ['我来接待'], [])
    await expect(saveConfig(backend, ['转人工'], [])).rejects.toThrow(/已更新/)
    expect(snapshotOf(backend).config.safety.manualReplyKeywords).toEqual(['我来接待'])
  })

  it('rejects oversized keywords and keeps the saved value', async () => {
    const { backend } = backendFixture()
    await expect(saveConfig(backend, ['超'.repeat(31)], [])).rejects.toThrow()
    await expect(
      saveConfig(
        backend,
        Array.from({ length: 101 }, (_, index) => `词${index}`),
        [],
      ),
    ).rejects.toThrow()
    expect(snapshotOf(backend).config.safety.manualReplyKeywords).toEqual([])
  })

  it('loads an account config without the field as an empty list', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'lingtu-manual-legacy-'))
    directories.push(dir)
    writeFileSync(
      path.join(dir, 'config.json'),
      JSON.stringify({ version: 1, safety: { handoffKeywords: ['投诉'] } }),
    )
    const backend = createBackend({ dataDir: dir })
    backends.push(backend)
    const config = snapshotOf(backend).config
    expect(config.safety.manualReplyKeywords).toEqual([])
    expect(config.safety.handoffKeywords).toEqual(['投诉'])
  })

  it('keeps accounts isolated in their own workspace config', async () => {
    const first = backendFixture()
    const second = backendFixture()
    await saveConfig(first.backend, ['甲账号关键词'], [])
    expect(snapshotOf(first.backend).config.safety.manualReplyKeywords).toEqual(['甲账号关键词'])
    expect(snapshotOf(second.backend).config.safety.manualReplyKeywords).toEqual([])
  })
})

function buyerRow(uid: string, msgId: string, content = '在吗', ts = NOW - 1000): Row {
  return { uid, messages: [{ msgId, from: 'buyer', type: 'text', content, ts }] }
}
function baseConfig(keywords: string[], maxInflight = 2) {
  return {
    ai: { systemPrompt: 'SYS', timeoutMs: 1000 },
    reply: {
      enabled: true,
      pollIntervalMs: 60000,
      maxInflight,
      staleMs: 0,
      recoverWindowMs: 600000,
      fallbackAfterMs: 0,
      fallbackText: '稍等',
      maxReplyChars: 200,
      handoffText: '正在转接人工客服',
      perUidMinIntervalMs: 0,
      sendJitterMinMs: 0,
      sendJitterMaxMs: 0,
      perStorePerMinuteMax: 20,
    },
    safety: { handoffKeywords: [], manualReplyKeywords: keywords },
  }
}
function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
function engineFixture({
  rows,
  keywords,
  ai,
  maxInflight = 2,
}: {
  rows: Row[]
  keywords: string[]
  ai: AiClient
  maxInflight?: number
}) {
  const queue = [...rows]
  const state = {
    queue,
    merchant: [] as Merchant[],
    sent: [] as Send[],
    discarded: [] as string[],
    events: [] as Event[],
  }
  const adapter = {
    id: 'fixture',
    accessMode: 'webview',
    supports: () => true,
    ensure: async () => ({ ok: true }),
    preparePending: async () => ({ ok: true }),
    popPending: async () => queue.shift() ?? null,
    pendingSnapshot: async () => ({ ok: true, count: queue.length, uids: [] }),
    conversationHistory: async () => ({ ok: true, messages: [] }),
    sendText: async (uid: string, text: string) => {
      state.sent.push({ uid, text })
      return { ok: true, msgId: `s-${state.sent.length}` }
    },
    sendImage: async () => ({ ok: true }),
    sendVideo: async () => ({ ok: true }),
    release: async () => ({ ok: true }),
    discard: async (uid: string) => {
      state.discarded.push(uid)
      return { ok: true }
    },
    popMerchantSent: async () => {
      const items = state.merchant
      state.merchant = []
      return items
    },
    syncAiEnabled: async () => ({ ok: true }),
    focusConversation: async () => ({ ok: true }),
  }
  const worker = new StoreWorker({
    store: { id: 'shop-1', storeName: '测试店', aiEnabled: true },
    adapter,
    aiClient: ai,
    getConfig: () => baseConfig(keywords, maxInflight),
    logger: {
      debug() {},
      info() {},
      warn() {},
      error() {},
      child() {
        return this
      },
    },
    onEvent: (event: Event) => state.events.push(event),
    now: () => NOW,
    sleep: async () => {},
    random: () => 0,
  })
  worker.running = true
  return { worker, state, ai }
}
async function waitFor(check: () => boolean, timeoutMs = 1000) {
  const startedAt = Date.now()
  while (!check()) {
    if (Date.now() - startedAt > timeoutMs) throw new Error('waitFor timeout')
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}
function aiFixture(reply = '您好'): AiClient {
  return {
    calls: 0,
    async reply() {
      this.calls += 1
      return { reply }
    },
  }
}

describe('manual reply keyword engine fixture', () => {
  it('a seller keyword pauses only that uid and stays paused until explicit recovery', async () => {
    const ai = aiFixture()
    const { worker, state } = engineFixture({
      rows: [buyerRow('u1', 'b1'), buyerRow('u2', 'b2', '另一个问题')],
      keywords: ['我来接待'],
      ai,
    })
    state.merchant = [
      {
        uid: 'u1',
        message: { msgId: 'm1', from: 'seller', content: '我来接待', ts: NOW },
      },
    ]
    await worker.tick()
    await worker.settle()
    expect(state.sent.map((item) => item.uid)).toEqual(['u2'])
    expect(worker.manualSuppressed.has('u1')).toBe(true)
    expect(worker.manualSuppressed.has('u2')).toBe(false)
    expect(
      state.events.some(
        (event) =>
          event.type === 'reply:manual_suppress' &&
          event.uid === 'u1' &&
          event.keyword === '我来接待',
      ),
    ).toBe(true)

    state.queue.push(buyerRow('u1', 'b3', '还在吗', NOW + 1000))
    await worker.tick()
    await worker.settle()
    expect(ai.calls).toBe(1)
    expect(worker.clearManualSuppression('u1')).toBe(true)
    state.queue.push(buyerRow('u1', 'b4', '有人吗', NOW + 2000))
    await worker.tick()
    await worker.settle()
    expect(ai.calls).toBe(2)
    expect(state.sent.map((item) => item.uid)).toEqual(['u2', 'u1'])
  })

  it('applies a saved keyword while the worker is already running', async () => {
    const keywords: string[] = []
    const ai = aiFixture()
    const { worker, state } = engineFixture({
      rows: [buyerRow('u1', 'b1')],
      keywords,
      ai,
    })
    await worker.tick()
    await worker.settle()
    expect(state.sent).toHaveLength(1)
    keywords.push('我来接待')
    state.merchant = [
      { uid: 'u2', message: { msgId: 'm2', from: 'seller', content: '我来接待', ts: NOW } },
    ]
    state.queue.push(buyerRow('u2', 'b2', '在吗', NOW + 1000))
    await worker.tick()
    await worker.settle()
    expect(ai.calls).toBe(1)
    expect(worker.manualSuppressed.has('u2')).toBe(true)
  })

  it('the same words from a buyer never trigger the seller takeover rule', async () => {
    const ai = aiFixture()
    const { worker, state } = engineFixture({
      rows: [buyerRow('u1', 'b1', '我来接待，可以吗')],
      keywords: ['我来接待'],
      ai,
    })
    await worker.tick()
    await worker.settle()
    expect(ai.calls).toBe(1)
    expect(state.sent).toHaveLength(1)
    expect(worker.manualSuppressed.size).toBe(0)
  })

  it('an AI self-send echo containing the keyword does not pause the conversation', async () => {
    const ai = aiFixture('我来接待')
    const { worker, state } = engineFixture({
      rows: [buyerRow('u1', 'b1')],
      keywords: ['我来接待'],
      ai,
    })
    await worker.tick()
    await worker.settle()
    expect(state.sent).toHaveLength(1)
    state.merchant = [
      { uid: 'u1', message: { msgId: 's-1', from: 'seller', content: '我来接待', ts: NOW } },
    ]
    state.queue.push(buyerRow('u1', 'b2', '还在吗', NOW + 1000))
    await worker.tick()
    await worker.settle()
    expect(worker.manualSuppressed.size).toBe(0)
    expect(state.sent).toHaveLength(2)
  })

  it('cancels the in-flight generation when the seller sends the keyword meanwhile', async () => {
    const gate = deferred()
    const ai = aiFixture()
    ai.reply = async () => {
      ai.calls += 1
      await gate.promise
      return { reply: '您好' }
    }
    const { worker, state } = engineFixture({
      rows: [buyerRow('u1', 'b1')],
      keywords: ['我来接待'],
      ai,
      maxInflight: 1,
    })
    const first = worker.tick()
    await waitFor(() => ai.calls === 1)
    state.merchant = [
      {
        uid: 'u1',
        message: { msgId: 'm1', from: 'seller', content: '我来接待', ts: NOW },
      },
    ]
    await worker.tick()
    expect(worker.manualSuppressed.has('u1')).toBe(true)
    gate.resolve()
    await first
    await worker.settle()
    expect(state.sent).toEqual([])
  })

  it('cancels a candidate even if the unified approval gate returns true afterwards', async () => {
    const approval = deferred()
    let reviewed = false
    const ai = aiFixture('您好')
    ai.beforeSend = async () => {
      reviewed = true
      await approval.promise
      return true
    }
    const { worker, state } = engineFixture({
      rows: [buyerRow('u1', 'b1')],
      keywords: ['我来接待'],
      ai,
      maxInflight: 1,
    })
    const first = worker.tick()
    await waitFor(() => reviewed)
    state.merchant = [
      {
        uid: 'u1',
        message: { msgId: 'm1', from: 'seller', content: '我来接待', ts: NOW },
      },
    ]
    await worker.tick()
    approval.resolve()
    await first
    await worker.settle()
    expect(worker.manualSuppressed.has('u1')).toBe(true)
    expect(state.sent).toEqual([])
  })
})

// @vitest-environment node
import { createRequire } from 'node:module'
import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  createPlatformLearningService,
  type PlatformLearningPort,
} from '../electron/platform-learning-service'
import type {
  PlatformLearningIdentity,
  PlatformLearningPage,
  PlatformLearningProduct,
  PlatformLearningChat,
} from '../src/shared/contracts/platform-learning'
import type { IntentPack } from '../src/shared/contracts/backend'

const require = createRequire(import.meta.url)
interface Knowledge {
  list(): IntentPack[]
  save(value: unknown): IntentPack
  search(storeId: string, query: string, productId?: string): unknown[]
}
const { createIntentKnowledge } =
  require('../vendor/lingtu-runtime/electron/intent-knowledge.cjs') as {
    createIntentKnowledge(file: string): Knowledge
  }
const workspaceId = '00000000-0000-4000-8000-000000000001'
const identity: PlatformLearningIdentity = {
  storeId: 'shop',
  platform: 'pdd',
  accountId: 'seller-1',
  platformStoreId: 'mall-1',
}
const range = { maxPages: 5, maxRecords: 100, productStatus: 'all' as const }
const directories: string[] = []
const services: ReturnType<typeof createPlatformLearningService>[] = []
afterEach(() => {
  for (const service of services.splice(0)) service.dispose()
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})
function page<T>(items: T[], nextCursor: string | null = null): PlatformLearningPage<T> {
  return {
    identity: { ...identity },
    items,
    nextCursor,
    exhausted: nextCursor === null,
    scope: '平台商品列表；所选状态；已核对页面范围',
    capturedAt: 1000,
  }
}
const product: PlatformLearningProduct = {
  id: 'goods-1',
  title: '棉T恤',
  description: '纯棉',
  specifications: 'M：胸围100cm',
}
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'lingtu-platform-learning-'))
  directories.push(directory)
  const knowledge = createIntentKnowledge(join(directory, 'knowledge.json'))
  let active = true
  let current = { ...identity }
  let products = async (_cursor: string | null) => page([product])
  let chats = async (_cursor: string | null): Promise<PlatformLearningPage<PlatformLearningChat>> =>
    page([])
  const cursors: Array<string | null> = []
  const port: PlatformLearningPort = {
    assertActive() {
      if (!active) throw Error('工作区已变化')
    },
    identity: async () => ({ ...current }),
    collectProducts: async (input) => {
      cursors.push(input.cursor)
      return products(input.cursor)
    },
    collectChats: async (input) => chats(input.cursor),
    listPacks: async () => knowledge.list(),
    savePack: async (pack) => knowledge.save(pack),
  }
  const service = createPlatformLearningService({ directory, workspaceId, port, now: () => 2000 })
  services.push(service)
  return {
    directory,
    knowledge,
    port,
    service,
    cursors,
    products: (fn: typeof products) => {
      products = fn
    },
    chats: (fn: typeof chats) => {
      chats = fn
    },
    switchIdentity: () => {
      current = { ...current, accountId: 'seller-2' }
    },
    deactivate: () => {
      active = false
    },
  }
}
async function settled(service: ReturnType<typeof createPlatformLearningService>) {
  await expect
    .poll(() => service.snapshot({ workspaceId }).tasks.some((task) => task.status === 'running'), {
      interval: 5,
    })
    .toBe(false)
  return service.snapshot({ workspaceId })
}

describe('platform learning persisted tasks and review', () => {
  it('collects actual provider pages, deduplicates sources, and persists the original editable candidate', async () => {
    const f = fixture()
    f.products(async (cursor) =>
      cursor
        ? page([product, { ...product, id: 'goods-2', title: '麻衬衫' }])
        : page([product], 'page-2'),
    )
    await f.service.start({ workspaceId, storeId: 'shop', source: 'products', range })
    const snap = await settled(f.service)
    expect(f.cursors).toEqual([null, 'page-2'])
    expect(snap.tasks[0]).toMatchObject({
      status: 'completed',
      pages: 2,
      records: 3,
      duplicates: 1,
      coverage: 'range-complete',
    })
    expect(snap.candidates).toHaveLength(2)
    expect(snap.candidates[0]).toMatchObject({
      status: 'pending',
      identity,
      productIds: ['goods-1'],
    })
    expect(snap.candidates[0]!.answer).toContain('M：胸围100cm')
    expect(f.knowledge.list()).toEqual([])
    const disk = JSON.parse(readFileSync(join(f.directory, 'platform-learning.json'), 'utf8'))
    expect(disk.candidates[0].original.answer).toContain('纯棉')
    await f.service.start({ workspaceId, storeId: 'shop', source: 'products', range })
    expect((await settled(f.service)).candidates).toHaveLength(2)
  })
  it('requires human confirmation and saves a disabled pack with original and edited audit', async () => {
    const f = fixture()
    await f.service.start({ workspaceId, storeId: 'shop', source: 'products', range })
    const candidate = (await settled(f.service)).candidates[0]!
    await expect(
      f.service.review({
        workspaceId,
        candidateId: candidate.id,
        question: '尺码',
        answer: '审核后的规格',
        confirmed: false,
      }),
    ).rejects.toThrow('确认')
    expect(f.knowledge.list()).toEqual([])
    const snap = await f.service.review({
      workspaceId,
      candidateId: candidate.id,
      question: '尺码',
      answer: '审核后的规格',
      confirmed: true,
    })
    const pack = f.knowledge.list()[0]!
    expect(pack.enabled).toBe(false)
    expect(pack.storeIds).toEqual(['shop'])
    expect(pack.productIds).toEqual(['goods-1'])
    expect(pack.entries[0]!.answer).toBe('审核后的规格')
    expect(pack.entries[1]!.enabled).toBe(false)
    const audit = JSON.parse(pack.entries[1]!.answer)
    expect(audit.original.answer).toContain('M：胸围100cm')
    expect(audit.reviewed).toEqual({ question: '尺码', answer: '审核后的规格' })
    expect(audit.identity).toEqual(identity)
    expect(snap.candidates[0]).toMatchObject({ status: 'saved', packId: pack.id })
    expect(f.knowledge.search('shop', '尺码', 'goods-1')).toEqual([])
    f.knowledge.save({ ...pack, enabled: true })
    expect(f.knowledge.search('shop', '尺码', 'goods-1')).toHaveLength(1)
    expect(f.knowledge.search('other', '尺码', 'goods-1')).toEqual([])
  })
  it('retains a failed review for retry and recognizes a committed pack after an uncertain response', async () => {
    const f = fixture()
    await f.service.start({ workspaceId, storeId: 'shop', source: 'products', range })
    const candidate = (await settled(f.service)).candidates[0]!
    let calls = 0
    f.port.savePack = async (pack) => {
      calls++
      f.knowledge.save(pack)
      throw Error('连接在提交后中断')
    }
    const input = {
      workspaceId,
      candidateId: candidate.id,
      question: '尺码',
      answer: 'M码',
      confirmed: true,
    }
    await expect(f.service.review(input)).rejects.toThrow('中断')
    expect(f.service.snapshot({ workspaceId }).candidates[0]!.status).toBe('pending')
    const snap = await f.service.review(input)
    expect(snap.candidates[0]!.status).toBe('saved')
    expect(f.knowledge.list()).toHaveLength(1)
    expect(calls).toBe(1)
  })
  it('pauses unfinished tasks after restart and resumes their durable cursor without mixing identities', async () => {
    const f = fixture()
    let release!: (value: PlatformLearningPage<PlatformLearningProduct>) => void
    f.products(async (cursor) =>
      cursor
        ? new Promise((resolve) => {
            release = resolve
          })
        : page([product], 'page-2'),
    )
    await f.service.start({ workspaceId, storeId: 'shop', source: 'products', range })
    await expect.poll(() => f.cursors.length, { interval: 5 }).toBe(2)
    const restarted = createPlatformLearningService({
      directory: f.directory,
      workspaceId,
      port: f.port,
    })
    services.push(restarted)
    const snap = restarted.snapshot({ workspaceId })
    expect(snap.tasks[0]).toMatchObject({ status: 'paused', cursor: 'page-2', pages: 1 })
    expect(snap.candidates).toHaveLength(1)
    f.service.dispose()
    release(page([{ ...product, id: 'late' }]))
    f.switchIdentity()
    await expect(restarted.resume({ workspaceId, taskId: snap.tasks[0]!.id })).rejects.toThrow(
      '身份',
    )
    expect(restarted.snapshot({ workspaceId }).tasks[0]!.status).toBe('paused')
    expect(restarted.snapshot({ workspaceId }).candidates).toHaveLength(1)
  })
  it('cancels in-flight collection and never accepts a late page after cancellation', async () => {
    const f = fixture()
    let release!: (value: PlatformLearningPage<PlatformLearningProduct>) => void
    f.products(
      async () =>
        new Promise((resolve) => {
          release = resolve
        }),
    )
    const started = await f.service.start({
      workspaceId,
      storeId: 'shop',
      source: 'products',
      range,
    })
    await expect.poll(() => f.cursors.length, { interval: 5 }).toBe(1)
    f.service.cancel({ workspaceId, taskId: started.tasks[0]!.id })
    release(page([product]))
    const snap = await settled(f.service)
    expect(snap.tasks[0]!.status).toBe('cancelled')
    expect(snap.candidates).toEqual([])
  })
  it('rejects mismatched workspace and foreign page identities before storing data', async () => {
    const f = fixture()
    await expect(
      f.service.start({
        workspaceId: '00000000-0000-4000-8000-000000000002',
        storeId: 'shop',
        source: 'products',
        range,
      }),
    ).rejects.toThrow('工作区')
    f.products(async () => ({
      ...page([product]),
      identity: { ...identity, platformStoreId: 'foreign' },
    }))
    await f.service.start({ workspaceId, storeId: 'shop', source: 'products', range })
    const snap = await settled(f.service)
    expect(snap.tasks[0]!.status).toBe('failed')
    expect(snap.tasks[0]!.error).toContain('身份')
    expect(snap.candidates).toEqual([])
    f.deactivate()
    expect(() => f.service.snapshot({ workspaceId })).toThrow('工作区')
  })
  it('keeps limits and interrupted pagination visibly partial and allows explicit retry', async () => {
    const f = fixture()
    f.products(async () => page([product], 'next'))
    await f.service.start({
      workspaceId,
      storeId: 'shop',
      source: 'products',
      range: { ...range, maxPages: 1 },
    })
    const snap = await settled(f.service)
    expect(snap.tasks[0]).toMatchObject({
      status: 'completed',
      coverage: 'partial',
      cursor: 'next',
    })
    expect(snap.tasks[0]!.reason).toContain('上限')
    f.products(async () => {
      throw Error('平台暂时不可读')
    })
    await f.service.start({ workspaceId, storeId: 'shop', source: 'products', range })
    const failed = (await settled(f.service)).tasks[1]!
    expect(failed.status).toBe('failed')
    f.products(async () => page([{ ...product, id: 'recovered' }]))
    await f.service.resume({ workspaceId, taskId: failed.id })
    expect((await settled(f.service)).tasks[1]!.status).toBe('completed')
  })
  it('builds chat candidates from real adjacent text and keeps the declared date range', async () => {
    const f = fixture()
    f.chats(async () => ({
      ...page([
        {
          id: 'thread-1',
          uid: 'buyer-1',
          messages: [
            {
              id: 'q1',
              from: 'buyer',
              text: '多久发货',
              at: Date.parse('2026-11-10T08:00:00+08:00'),
              type: 'text',
            },
            {
              id: 'a1',
              from: 'seller',
              text: '按订单承诺时间',
              at: Date.parse('2026-11-10T08:00:01+08:00'),
              type: 'text',
            },
            {
              id: 'q2',
              from: 'buyer',
              text: '图片',
              at: Date.parse('2026-11-10T08:00:02+08:00'),
              type: 'image',
            },
            {
              id: 'a2',
              from: 'seller',
              text: '收到',
              at: Date.parse('2026-11-10T08:00:03+08:00'),
              type: 'text',
            },
          ],
        },
      ]),
      scope: '2026-11-01至2026-11-14平台可见历史',
    }))
    await f.service.start({
      workspaceId,
      storeId: 'shop',
      source: 'chats',
      range: { ...range, from: '2026-11-01', to: '2026-11-14' },
    })
    const snap = await settled(f.service)
    expect(snap.candidates).toHaveLength(1)
    expect(snap.candidates[0]).toMatchObject({
      question: '多久发货',
      answer: '按订单承诺时间',
      productIds: [],
      evidence: { recordId: 'thread-1', uid: 'buyer-1', messageIds: ['q1', 'a1'] },
    })
    expect(snap.tasks[0]!.range.from).toBe('2026-11-01')
    expect(snap.tasks[0]!.scope).toContain('可见历史')
    const candidate = snap.candidates[0]!
    await f.service.review({
      workspaceId,
      candidateId: candidate.id,
      question: candidate.question,
      answer: candidate.answer,
      confirmed: true,
    })
    const audit = JSON.parse(f.knowledge.list()[0]!.entries[1]!.answer)
    expect(audit.scope).toBe('2026-11-01至2026-11-14平台可见历史')
    expect(audit.range).toMatchObject({ from: '2026-11-01', to: '2026-11-14' })
  })
  it('stops visibly when a page cannot be persisted and retries from the last successful cursor', async () => {
    const f = fixture()
    let release!: (value: PlatformLearningPage<PlatformLearningProduct>) => void
    f.products(
      async () =>
        new Promise((resolve) => {
          release = resolve
        }),
    )
    await f.service.start({ workspaceId, storeId: 'shop', source: 'products', range })
    await expect.poll(() => f.cursors.length, { interval: 5 }).toBe(1)
    const file = join(f.directory, 'platform-learning.json')
    renameSync(file, `${file}.backup`)
    mkdirSync(file)
    release(page([product]))
    const snap = await settled(f.service)
    expect(snap.tasks[0]).toMatchObject({ status: 'failed', pages: 0, cursor: null })
    expect(snap.tasks[0]!.error).toContain('存储')
    expect(snap.candidates).toEqual([])
    rmSync(file, { recursive: true })
    renameSync(`${file}.backup`, file)
    f.products(async () => page([product]))
    await f.service.resume({ workspaceId, taskId: snap.tasks[0]!.id })
    expect((await settled(f.service)).candidates).toHaveLength(1)
  })
  it('retains provider-declared history limits even after every accessible record was read', async () => {
    const f = fixture()
    f.products(async () => ({
      ...page([product]),
      total: 1,
      rangeComplete: false,
      scope: '仅当前可访问商品页，其他范围不可读',
    }))
    await f.service.start({ workspaceId, storeId: 'shop', source: 'products', range })
    const snap = await settled(f.service)
    expect(snap.tasks[0]).toMatchObject({
      status: 'completed',
      coverage: 'partial',
      records: 1,
      total: 1,
    })
    expect(snap.tasks[0]!.reason).toContain('平台可访问范围受限')
  })
  it('preserves earlier page limitations and their source scope after later complete pages', async () => {
    const f = fixture()
    f.products(async (cursor) =>
      cursor
        ? {
            ...page([{ ...product, id: 'goods-2' }]),
            total: 2,
            rangeComplete: true,
            scope: '第二页已核对',
          }
        : {
            ...page([product], 'next'),
            total: 2,
            rangeComplete: false,
            scope: '第一页有不可访问部分',
          },
    )
    await f.service.start({ workspaceId, storeId: 'shop', source: 'products', range })
    const snap = await settled(f.service)
    expect(snap.tasks[0]!.coverage).toBe('partial')
    expect(snap.candidates[0]!.evidence.scope).toBe('第一页有不可访问部分')
  })
  it('does not attribute an older candidate to the task last page when its original scope was not recorded', async () => {
    const f = fixture()
    await f.service.start({ workspaceId, storeId: 'shop', source: 'products', range })
    const candidate = (await settled(f.service)).candidates[0]!
    f.service.dispose()
    const file = join(f.directory, 'platform-learning.json')
    const disk = JSON.parse(readFileSync(file, 'utf8')) as {
      candidates: Array<{ evidence: { scope?: string } }>
    }
    delete disk.candidates[0]!.evidence.scope
    writeFileSync(file, JSON.stringify(disk))
    const restarted = createPlatformLearningService({
      directory: f.directory,
      workspaceId,
      port: f.port,
    })
    services.push(restarted)
    await restarted.review({
      workspaceId,
      candidateId: candidate.id,
      question: candidate.question,
      answer: candidate.answer,
      confirmed: true,
    })
    const audit = JSON.parse(f.knowledge.list()[0]!.entries[1]!.answer)
    expect(audit.scope).toBeUndefined()
    expect(audit.range.productStatus).toBe('all')
  })
})

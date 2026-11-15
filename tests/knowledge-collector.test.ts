import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createKnowledgeRepository } from '../electron/knowledge'
import { createKnowledgeCollector } from '../electron/knowledge/collector'
import { createKnowledgePipelineCoordinator } from '../electron/knowledge/pipeline'
import type {
  PlatformLearningPage,
  PlatformLearningProduct,
} from '../src/shared/contracts/platform-learning'
import { createCollectorMaterials } from '../electron/knowledge/collector-materials'
import type { PlatformProductDetail } from '../src/shared/contracts/platform-product'
const disposals: (() => void)[] = []
afterEach(() =>
  disposals
    .splice(0)
    .reverse()
    .forEach((fn) => fn()),
)
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'knowledge-collector-'))
  disposals.push(() => rmSync(directory, { recursive: true, force: true }))
  const repository = createKnowledgeRepository({ directory, workspaceId: 'w' })
  disposals.push(() => repository.dispose())
  const canonical = repository.saveCanonical({ title: '棉衣' })
  const binding = repository.bindProduct({
    canonicalId: canonical.id,
    storeId: 's',
    productId: '12345678',
    title: '棉衣',
  })
  return { repository, binding, materials: createCollectorMaterials(repository) }
}
function detail(overrides: Partial<PlatformProductDetail> = {}): PlatformProductDetail {
  return {
    productId: '12345678',
    title: '棉衣',
    merchantCode: 'ROOT',
    description: '纯棉',
    attributes: [{ name: '材质', value: '棉' }],
    images: [],
    skus: [
      {
        skuId: 'sku-red',
        specs: [{ name: '颜色', value: '红' }],
        merchantCode: 'RED',
        barcode: '06900',
        price: '19.90',
        stock: 5,
      },
    ],
    sourceUrl: 'https://mms.pinduoduo.com/goods/goods_add/index?goods_id=12345678&type=edit',
    capturedAt: 1000,
    detailStatus: 'complete',
    detailNote: '',
    ...overrides,
  }
}
describe('collector material revisions', () => {
  it('shows actual SKU/specification and original capture expiry on lightweight cards', () => {
    const f = fixture()
    f.materials.write('s', detail())
    const card = f.repository.listProducts({ storeId: 's' }).items[0]!
    expect(card.productSummary).toMatchObject({
      skuCount: 1,
      specifications: ['颜色：红'],
      capturedAt: 1000,
      expired: true,
    })
    expect(JSON.stringify(card)).not.toContain('description')
  })
  it('keeps static citations through timestamp and price-only captures, with SKU-specific dynamic lineage', () => {
    const { repository: r, binding: b, materials: m } = fixture()
    m.write('s', detail())
    const stat = r.listSources({ bindingId: b.id }).find((s) => s.label === '平台静态资料')!
    expect(stat).toBeDefined()
    const v = r.saveDraft({
      scope: { kind: 'canonical', canonicalId: b.canonicalId },
      question: '材质',
      answer: '纯棉',
      sourceRefs: [{ sourceId: stat.id, revision: stat.revision }],
    })
    r.publish({
      entryId: v.id,
      expectedDraftRevision: v.revision,
      expectedSourceRevisions: { [stat.id]: stat.revision },
    })
    const changed = detail({ capturedAt: 2000 })
    changed.skus[0]!.price = '18.00'
    changed.skus[0]!.stock = 0
    m.write('s', changed)
    expect(r.getSource(stat.id)?.revision).toBe(1)
    expect(r.getEntry(v.id)?.status).toBe('approved')
    const sku = r.listBindings().find((row) => row.skuId === 'sku-red')!
    const dynamic = r.listSources({ bindingId: sku.id }).find((s) => s.label === '平台动态快照')!
    expect(JSON.parse(dynamic.text)).toMatchObject({
      skuId: 'sku-red',
      price: '18.00',
      stock: 0,
      capturedAt: 2000,
    })
    const raw = r.listSources({ bindingId: b.id }).find((s) => {
      try {
        return JSON.parse(s.text).capturedAt === 2000 && JSON.parse(s.text).title === '棉衣'
      } catch {
        return false
      }
    })!
    expect(r.sourceVersions(raw.id)).toHaveLength(2)
    expect(
      r.resolveKnowledge({ storeId: 's', productId: '12345678', query: '价格' }).citations,
    ).toHaveLength(0)
  })
  it('withdraws only dependent generated facts on static change and preserves manual text', () => {
    const { repository: r, binding: b, materials: m } = fixture()
    m.write('s', detail())
    const stat = r.listSources({ bindingId: b.id }).find((s) => s.label === '平台静态资料')!
    expect(stat).toBeDefined()
    const generated = r.saveDraft({
      scope: { kind: 'canonical', canonicalId: b.canonicalId },
      question: '材质',
      answer: '纯棉',
      sourceRefs: [{ sourceId: stat.id, revision: stat.revision }],
    })
    const manual = r.saveDraft({
      scope: { kind: 'canonical', canonicalId: b.canonicalId },
      question: '人工说明',
      answer: '人工保留',
    })
    r.publish({
      entryId: generated.id,
      expectedDraftRevision: generated.revision,
      expectedSourceRevisions: { [stat.id]: stat.revision },
    })
    r.publish({
      entryId: manual.id,
      expectedDraftRevision: manual.revision,
      expectedSourceRevisions: {},
    })
    m.write('s', detail({ description: '混纺', capturedAt: 3000 }))
    expect(r.getEntry(generated.id)?.status).toBe('stale')
    expect(r.getEntry(manual.id)?.status).toBe('approved')
    expect(r.getEntry(manual.id)?.approved?.answer).toBe('人工保留')
  })
})

function pipelineFixture(
  readImage?: import('../electron/knowledge/collector').KnowledgeCollectorOptions['readImage'],
) {
  const f = fixture()
  let active = true
  let readGate: Promise<void> | undefined
  let released: () => void = () => {}
  let pages: PlatformLearningPage<PlatformLearningProduct>[] = [
    {
      identity: { storeId: 's', platform: 'pdd-web', accountId: 'a', platformStoreId: 'mall' },
      items: [
        {
          id: '12345678',
          title: '棉衣',
          description: '价格19.90',
          specifications: '',
          sourceUrl: detail().sourceUrl,
        },
      ],
      nextCursor: null,
      exhausted: true,
      total: 1,
      rangeComplete: true,
      capturedAt: 1000,
      scope: '在售中；第1页',
    },
  ]
  const provider = {
    identity: async () => pages[0]!.identity,
    collectProducts: async (
      input: import('../electron/pdd-learning-provider').PddProductCollectInput,
    ) => {
      if (readGate && !input.catalogOnly) await readGate
      const page = pages[input.cursor ? Number(input.cursor) : 0]!
      return {
        ...page,
        items: page.items
          .filter((item) => !input.productIds || input.productIds.includes(item.id))
          .map((item) => ({
            ...item,
            ...(!input.catalogOnly
              ? { platformDetail: detail({ productId: item.id, title: item.title }) }
              : {}),
          })),
      }
    },
  }
  const coordinator = createKnowledgePipelineCoordinator()
  const collector = createKnowledgeCollector({
    repository: f.repository,
    provider,
    readImage,
    assertActive() {
      if (!active) throw Error('工作区变化')
    },
    getStore: (id) => ({ id, platform: 'pdd-web' }),
  })
  coordinator.register(collector)
  disposals.push(() => coordinator.dispose())
  return {
    ...f,
    coordinator,
    provider,
    setPages(value: typeof pages) {
      pages = value
    },
    block() {
      readGate = new Promise((resolve) => {
        released = resolve
      })
    },
    release() {
      released()
    },
    deactivate() {
      active = false
    },
  }
}
async function settle(f: ReturnType<typeof pipelineFixture>, id: string) {
  for (let n = 0; n < 100; n++) {
    const job = f.repository.getJob(id)!
    if (!['queued', 'running'].includes(job.status)) return job
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  throw Error('job did not settle')
}
async function selection(f: ReturnType<typeof pipelineFixture>) {
  const catalog = await f.coordinator.request({ action: 'catalog', storeId: 's' })
  return {
    identityVersion: catalog.identityVersion,
    scopeToken: catalog.scopeToken,
    productIds: ['12345678'],
    allMatching: false,
    total: catalog.total,
  }
}
describe('catalog-first durable collection', () => {
  it('saves verified list codes and picture bytes when detail fields are unavailable', async () => {
    let fail = false
    let thumbnailUrl = 'https://img.pddpic.com/list.png'
    const f = pipelineFixture(async () => {
      if (fail) throw Error('temporary image failure')
      return {
        bytes: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0]),
        mimeType: 'image/png',
      }
    })
    const original = f.provider.collectProducts
    f.provider.collectProducts = async (input) => {
      const page = await original(input)
      return {
        ...page,
        items: page.items.map((item) => ({
          ...item,
          merchantCode: 'XM-YSP',
          thumbnailUrl,
          platformDetail: undefined,
        })),
      }
    }
    const { jobId } = await f.coordinator.request({
      action: 'start',
      kind: 'collect',
      storeId: 's',
      catalog: await selection(f),
    })
    await settle(f, jobId)
    const card = f.repository.listProducts({ storeId: 's' }).items[0]!
    expect(card.productSummary.code).toBe('XM-YSP')
    expect(card.binding.productId).toBe('12345678')
    expect(card.sourceSummary.thumbnailAssetId).toBeTruthy()
    expect([...f.repository.readAsset(card.sourceSummary.thumbnailAssetId!)]).toEqual([
      137, 80, 78, 71, 13, 10, 26, 10, 0,
    ])
    const source = f.repository
      .listSources({ bindingId: card.binding.id })
      .find((s) => s.label === '平台目录快照')!
    expect(JSON.parse(source.text).merchantCode).toBe('XM-YSP')
    fail = true
    const retry = await f.coordinator.request({
      action: 'start',
      kind: 'collect',
      storeId: 's',
      catalog: await selection(f),
    })
    await settle(f, retry.jobId)
    expect(
      f.repository.listProducts({ storeId: 's' }).items[0]?.sourceSummary.thumbnailAssetId,
    ).toBe(card.sourceSummary.thumbnailAssetId)
    thumbnailUrl = 'https://img.pddpic.com/replacement.png'
    const changed = await f.coordinator.request({
      action: 'start',
      kind: 'collect',
      storeId: 's',
      catalog: await selection(f),
    })
    await settle(f, changed.jobId)
    expect(
      f.repository.listProducts({ storeId: 's' }).items[0]?.sourceSummary.thumbnailAssetId,
    ).toBeNull()
  })
  it('provides lazy cached thumbnails and merchant codes only for the verified catalog without creating collection jobs', async () => {
    let reads = 0
    const f = pipelineFixture(async () => {
      reads++
      return { bytes: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0]), mimeType: 'image/png' }
    })
    const page = await f.provider.collectProducts({
      identity: await f.provider.identity(),
      range: { maxPages: 1, maxRecords: 100, productStatus: 'on-sale' },
      cursor: null,
      signal: new AbortController().signal,
      catalogOnly: true,
    })
    f.setPages([
      {
        ...page,
        items: [
          {
            ...page.items[0]!,
            merchantCode: 'XM-YSP',
            thumbnailUrl: 'https://img.pddpic.com/thumb.png',
          },
        ],
      },
    ])
    const catalog = await f.coordinator.request({ action: 'catalog', storeId: 's' })
    expect(catalog.items[0]).toMatchObject({ merchantCode: 'XM-YSP', hasThumbnail: true })
    const input = {
      action: 'catalog-thumbnail' as const,
      storeId: 's',
      scopeToken: catalog.scopeToken,
      identityVersion: catalog.identityVersion,
      productId: '12345678',
    }
    const thumb = await f.coordinator.request(input)
    expect(f.repository.readAsset(thumb.assetId)).toHaveLength(9)
    expect(await f.coordinator.request(input)).toEqual(thumb)
    expect(reads).toBe(1)
    expect(f.repository.rows('jobs')).toHaveLength(0)
    await expect(f.coordinator.request({ ...input, productId: 'unknown' })).rejects.toThrow()
    await expect(f.coordinator.request({ ...input, storeId: 'other' })).rejects.toThrow()
    await f.coordinator.request({ action: 'catalog', storeId: 's' })
    await expect(f.coordinator.request(input)).rejects.toThrow('目录')
  })
  it('rejects a thumbnail completing after its catalog has been replaced and does not register its bytes', async () => {
    let finish!: (value: { bytes: Uint8Array; mimeType: string }) => void
    const f = pipelineFixture(
      () =>
        new Promise((done) => {
          finish = done
        }),
    )
    const page = await f.provider.collectProducts({
      identity: await f.provider.identity(),
      range: { maxPages: 1, maxRecords: 100, productStatus: 'on-sale' },
      cursor: null,
      signal: new AbortController().signal,
      catalogOnly: true,
    })
    f.setPages([
      { ...page, items: [{ ...page.items[0]!, thumbnailUrl: 'https://img.pddpic.com/thumb.png' }] },
    ])
    const c = await f.coordinator.request({ action: 'catalog', storeId: 's' })
    const pending = f.coordinator.request({
      action: 'catalog-thumbnail',
      storeId: 's',
      scopeToken: c.scopeToken,
      identityVersion: c.identityVersion,
      productId: '12345678',
    })
    for (let i = 0; i < 10 && !finish; i++) await Promise.resolve()
    await f.coordinator.request({ action: 'catalog', storeId: 's' })
    finish({ bytes: new Uint8Array([1]), mimeType: 'image/png' })
    await expect(pending).rejects.toThrow()
    expect(f.repository.rows('assets')).toHaveLength(0)
  })
  it('runs a quiet daily comparison for existing bindings without prior UI catalog or AI learning', async () => {
    const f = pipelineFixture()
    const started = await f.coordinator.request({
      action: 'start',
      kind: 'daily-check',
      storeId: 's',
      bindingIds: [f.binding.id],
    })
    const job = await settle(f, started.jobId)
    expect(job.kind).toBe('daily-check')
    expect(job.status).toBe('succeeded')
    expect(f.repository.listEntries().total).toBe(0)
    expect(f.repository.listSources({ bindingId: f.binding.id }).length).toBeGreaterThan(0)
  })
  it('returns jobId while reads are blocked and cancellation immediately prevents late writes', async () => {
    const f = pipelineFixture()
    const catalog = await selection(f)
    f.block()
    const started = await f.coordinator.request({
      action: 'start',
      kind: 'collect',
      storeId: 's',
      catalog,
    })
    expect(f.repository.getJob(started.jobId)).toBeTruthy()
    await new Promise((resolve) => setTimeout(resolve, 10))
    await f.coordinator.request({ action: 'cancel', storeId: 's', jobId: started.jobId })
    expect(f.repository.getJob(started.jobId)?.status).toBe('cancelled')
    f.release()
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(f.repository.listSources()).toHaveLength(0)
    await expect(
      f.coordinator.request({ action: 'resume', storeId: 's', jobId: started.jobId }),
    ).rejects.toThrow('只有')
  })
  it('pins main catalog scope and refuses all-matching until all native pages and totals agree', async () => {
    const f = pipelineFixture()
    const first = await f.provider.collectProducts({
      identity: await f.provider.identity(),
      range: { maxPages: 5, maxRecords: 100, productStatus: 'on-sale' },
      cursor: null,
      signal: new AbortController().signal,
      catalogOnly: true,
    })
    f.setPages([
      { ...first, nextCursor: '1', exhausted: false, total: 2 },
      {
        ...first,
        items: [{ ...first.items[0]!, id: '23456789', title: '另一件' }],
        total: 2,
        scope: '在售中；第2页',
      },
    ])
    const a = await f.coordinator.request({ action: 'catalog', storeId: 's' })
    expect(a.complete).toBe(false)
    await expect(
      f.coordinator.request({
        action: 'start',
        kind: 'collect',
        storeId: 's',
        catalog: {
          identityVersion: a.identityVersion,
          scopeToken: a.scopeToken,
          productIds: [],
          allMatching: true,
          total: a.total,
        },
      }),
    ).rejects.toThrow()
    const b = await f.coordinator.request({
      action: 'catalog',
      storeId: 's',
      cursor: a.nextCursor!,
    })
    expect(b.scopeToken).toBe(a.scopeToken)
    expect(b.complete).toBe(true)
    expect(b.total).toBe(2)
    await expect(
      f.coordinator.request({
        action: 'start',
        kind: 'collect',
        storeId: 's',
        catalog: {
          identityVersion: b.identityVersion,
          scopeToken: b.scopeToken,
          productIds: ['not-seen'],
          allMatching: false,
          total: 2,
        },
      }),
    ).rejects.toThrow('目录')
    const started = await f.coordinator.request({
      action: 'start',
      kind: 'collect',
      storeId: 's',
      catalog: {
        identityVersion: b.identityVersion,
        scopeToken: b.scopeToken,
        productIds: [],
        allMatching: true,
        total: 2,
      },
    })
    const job = await settle(f, started.jobId)
    expect(job.status).toBe('succeeded')
    expect(job.progress).toEqual({ completed: 2, total: 2 })
    expect(f.repository.listProducts({ storeId: 's' }).total).toBe(2)
  })
  it('rechecks account and root binding leases after awaited detail reads', async () => {
    const f = pipelineFixture()
    const catalog = await selection(f)
    f.block()
    const { jobId } = await f.coordinator.request({
      action: 'start',
      kind: 'collect',
      storeId: 's',
      catalog,
    })
    await new Promise((resolve) => setTimeout(resolve, 10))
    f.repository.unlinkBinding(f.binding.id, f.binding.revision)
    f.release()
    const job = await settle(f, jobId)
    expect(job.status).not.toBe('succeeded')
    expect(f.repository.listSources()).toHaveLength(0)
  })
})

describe('collector scope honesty and durable continuation', () => {
  it('rejects repeated native product pages and never enables unknown-total all-selection', async () => {
    const f = pipelineFixture()
    const initial = await f.provider.collectProducts({
      identity: await f.provider.identity(),
      range: { maxPages: 5, maxRecords: 100, productStatus: 'on-sale' },
      cursor: null,
      signal: new AbortController().signal,
      catalogOnly: true,
    })
    f.setPages([{ ...initial, total: undefined, rangeComplete: false }])
    const unknown = await f.coordinator.request({ action: 'catalog', storeId: 's' })
    expect(unknown.total).toBeNull()
    expect(unknown.complete).toBe(false)
    await expect(
      f.coordinator.request({
        action: 'start',
        storeId: 's',
        kind: 'collect',
        catalog: {
          identityVersion: unknown.identityVersion,
          scopeToken: unknown.scopeToken,
          productIds: [],
          allMatching: true,
          total: null,
        },
      }),
    ).rejects.toThrow('范围')
    f.setPages([
      { ...initial, nextCursor: '1', exhausted: false, total: 2 },
      { ...initial, total: 2 },
    ])
    const first = await f.coordinator.request({ action: 'catalog', storeId: 's' })
    await expect(
      f.coordinator.request({ action: 'catalog', storeId: 's', cursor: first.nextCursor! }),
    ).rejects.toThrow('重复')
  })
  it('records partial detail and image failures without pretending raw material is published', async () => {
    const f = pipelineFixture(),
      catalog = await selection(f)
    const original = f.provider.collectProducts
    f.provider.collectProducts = async (input) => {
      const page = await original(input)
      if (!input.catalogOnly)
        page.items[0]!.platformDetail = detail({
          detailStatus: 'partial',
          images: ['https://img.pddpic.com/size.png'],
        })
      return page
    }
    const { jobId } = await f.coordinator.request({
      action: 'start',
      storeId: 's',
      kind: 'collect',
      catalog,
    })
    const job = await settle(f, jobId)
    expect(job.status).toBe('needs-confirmation')
    expect(job.error).toContain('图片')
    expect(f.repository.listEntries().total).toBe(0)
    const coverage = f.repository
      .listSources({ bindingId: f.binding.id })
      .find((s) => s.label === '平台采集范围')!
    expect(JSON.parse(coverage.text).scope).toBe('在售中；第1页')
    expect(JSON.parse(coverage.text).images[0]).toMatchObject({
      url: 'https://img.pddpic.com/size.png',
      error: '图片字节采集尚未接入',
    })
  })
  it('resumes paused checkpoints without duplicating a committed product', async () => {
    const f = pipelineFixture(),
      catalog = await selection(f)
    f.block()
    const { jobId } = await f.coordinator.request({
      action: 'start',
      storeId: 's',
      kind: 'collect',
      catalog,
    })
    await new Promise((resolve) => setTimeout(resolve, 10))
    await f.coordinator.request({ action: 'pause', storeId: 's', jobId })
    f.release()
    await new Promise((resolve) => setTimeout(resolve, 10))
    const resumed = await f.coordinator.request({ action: 'resume', storeId: 's', jobId })
    expect(resumed.jobId).toBe(jobId)
    expect((await settle(f, jobId)).status).toBe('succeeded')
    expect(f.repository.listProducts({ storeId: 's' }).total).toBe(1)
    const raw = f.repository.listSources({ bindingId: f.binding.id }).find((s) => {
      try {
        return JSON.parse(s.text).capturedAt === 1000 && JSON.parse(s.text).title === '棉衣'
      } catch {
        return false
      }
    })!
    expect(f.repository.sourceVersions(raw.id)).toHaveLength(1)
  })
})

it('keeps image/static revisions across signed request metadata and records failed captures separately', () => {
  const { repository: r, binding: b, materials: m } = fixture()
  const asset = r.addAsset(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), {
    name: '图.png',
    mimeType: 'image/png',
  })
  const first = m.write(
    's',
    detail({ images: ['https://img.pddpic.com/size.png?signature=one'] }),
    [{ url: 'https://img.pddpic.com/size.png?signature=one', assetId: asset.id }],
  )
  const second = m.write(
    's',
    detail({
      capturedAt: 2000,
      sourceUrl: detail().sourceUrl + '&requestId=two',
      images: ['https://img.pddpic.com/size.png?signature=two'],
    }),
    [{ url: 'https://img.pddpic.com/size.png?signature=two', error: 'timeout' }],
  )
  expect(second.staticSource.revision).toBe(first.staticSource.revision)
  expect(second.imageSource.revision).toBe(first.imageSource.revision)
  expect(second.imageSource.assetIds).toEqual([asset.id])
  expect(r.readAsset(asset.id)[0]).toBe(137)
  const capture = r
    .listSources({ bindingId: b.id })
    .find((source) => source.label === '平台采集范围')!
  expect(JSON.parse(capture.text).images[0].error).toBe('timeout')
})
it('pauses a persisted queued collect on reopen and retains its checkpoint', () => {
  const directory = mkdtempSync(join(tmpdir(), 'collector-reopen-'))
  disposals.push(() => rmSync(directory, { recursive: true, force: true }))
  const first = createKnowledgeRepository({ directory, workspaceId: 'one' })
  const job = first.createJob({ kind: 'collect', storeId: 's', payload: { explicit: true } })
  first.updateJob(job.id, { expectedRevision: job.revision, checkpoint: { completedIds: ['p'] } })
  first.dispose()
  const next = createKnowledgeRepository({ directory, workspaceId: 'two' })
  disposals.push(() => next.dispose())
  expect(next.getJob(job.id)).toMatchObject({
    status: 'paused',
    checkpoint: { completedIds: ['p'] },
  })
})
it('retries only partial items after an explicit resume and clears their previous limitation', async () => {
  const f = pipelineFixture(),
    catalog = await selection(f),
    original = f.provider.collectProducts
  let partial = true
  f.provider.collectProducts = async (input) => {
    const page = await original(input)
    if (!input.catalogOnly && partial)
      page.items[0]!.platformDetail = detail({ detailStatus: 'partial' })
    return page
  }
  const { jobId } = await f.coordinator.request({
    action: 'start',
    kind: 'collect',
    storeId: 's',
    catalog,
  })
  expect((await settle(f, jobId)).status).toBe('needs-confirmation')
  partial = false
  await f.coordinator.request({ action: 'resume', storeId: 's', jobId })
  expect((await settle(f, jobId)).status).toBe('succeeded')
  expect(f.repository.getJob(jobId)?.checkpoint.issues).toEqual([])
})

it('rejects a new SKU binding inserted while a detail read is awaiting', async () => {
  const f = pipelineFixture(),
    catalog = await selection(f)
  f.block()
  const { jobId } = await f.coordinator.request({
    action: 'start',
    kind: 'collect',
    storeId: 's',
    catalog,
  })
  await new Promise((resolve) => setTimeout(resolve, 10))
  f.repository.bindProduct({
    canonicalId: f.binding.canonicalId,
    storeId: 's',
    productId: '12345678',
    skuId: 'external-new-sku',
  })
  f.release()
  expect((await settle(f, jobId)).status).toBe('paused')
  expect(f.repository.listSources()).toHaveLength(0)
})
it('checkpoints each committed product and resumes the remaining page without a duplicate source revision', async () => {
  const f = pipelineFixture()
  const first = await f.provider.collectProducts({
    identity: await f.provider.identity(),
    range: { maxPages: 5, maxRecords: 100, productStatus: 'on-sale' },
    cursor: null,
    signal: new AbortController().signal,
    catalogOnly: true,
  })
  f.setPages([
    { ...first, nextCursor: '1', exhausted: false, total: 2 },
    { ...first, items: [{ ...first.items[0]!, id: '23456789', title: '另一件' }], total: 2 },
  ])
  const a = await f.coordinator.request({ action: 'catalog', storeId: 's' })
  const b = await f.coordinator.request({ action: 'catalog', storeId: 's', cursor: a.nextCursor! })
  let release: () => void = () => {}
  const blocked = new Promise<void>((resolve) => {
      release = resolve
    }),
    original = f.provider.collectProducts
  let entered = false
  f.provider.collectProducts = async (input) => {
    if (!input.catalogOnly && input.productIds?.includes('23456789')) {
      entered = true
      await blocked
    }
    return original(input)
  }
  const { jobId } = await f.coordinator.request({
    action: 'start',
    kind: 'collect',
    storeId: 's',
    catalog: {
      identityVersion: b.identityVersion,
      scopeToken: b.scopeToken,
      productIds: [],
      allMatching: true,
      total: 2,
    },
  })
  for (let n = 0; n < 100 && !entered; n++) await new Promise((resolve) => setTimeout(resolve, 5))
  expect(f.repository.getJob(jobId)?.checkpoint.completedIds).toEqual(['12345678'])
  await f.coordinator.request({ action: 'pause', storeId: 's', jobId })
  release()
  await new Promise((resolve) => setTimeout(resolve, 10))
  await f.coordinator.request({ action: 'resume', storeId: 's', jobId })
  expect((await settle(f, jobId)).progress).toEqual({ completed: 2, total: 2 })
  const staticSource = f.repository
    .listSources({ bindingId: f.binding.id })
    .find((source) => source.label === '平台静态资料')!
  expect(f.repository.sourceVersions(staticSource.id)).toHaveLength(1)
})

it('cancels every pipeline handler even when an earlier handler cleanup reports an error', () => {
  const pipeline = createKnowledgePipelineCoordinator(),
    state: string[] = []
  const handler = (name: string, fail: boolean) => ({
    handles: () => false,
    async request() {
      return { jobId: 'unused' }
    },
    async capabilities() {
      return {}
    },
    removeStore() {
      state.push(`remove-${name}`)
      if (fail) throw Error('cleanup failed')
    },
    dispose() {
      state.push(`dispose-${name}`)
      if (fail) throw Error('cleanup failed')
    },
  })
  pipeline.register(handler('collector', true))
  pipeline.register(handler('learning', false))
  expect(() => pipeline.removeStore('s')).toThrow('清理')
  expect(state).toEqual(['remove-collector', 'remove-learning'])
  expect(() => pipeline.dispose()).toThrow('清理')
  expect(state).toEqual([
    'remove-collector',
    'remove-learning',
    'dispose-collector',
    'dispose-learning',
  ])
})

it('withdraws old SKU dynamic facts when a new complete platform snapshot no longer contains the SKU', () => {
  const { repository: r, materials: m } = fixture()
  m.write('s', detail())
  const sku = r.listBindings().find((binding) => binding.skuId === 'sku-red')!
  const source = r
    .listSources({ bindingId: sku.id })
    .find((source) => source.label === '平台动态快照')!
  const draft = r.saveDraft({
    scope: { kind: 'binding', bindingId: sku.id },
    question: '价格',
    answer: '19.90',
    field: 'price',
    sourceRefs: [{ sourceId: source.id, revision: source.revision }],
    expiresAt: Date.now() + 60000,
  })
  r.publish({
    entryId: draft.id,
    expectedDraftRevision: draft.revision,
    expectedSourceRevisions: { [source.id]: source.revision },
  })
  m.write('s', detail({ capturedAt: 2000, skus: [] }))
  expect(r.getEntry(draft.id)?.status).toBe('stale')
  expect(JSON.parse(r.getSource(source.id)!.text)).toMatchObject({
    skuId: 'sku-red',
    availability: 'not-listed',
    capturedAt: 2000,
  })
  expect(r.getBinding(sku.id)?.active).toBe(true)
})

it('keeps collection unavailable when the real repository is in migration read-only mode', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'collector-readonly-'))
  disposals.push(() => rmSync(directory, { recursive: true, force: true }))
  writeFileSync(join(directory, 'product-knowledge.json'), '{corrupt')
  const repository = createKnowledgeRepository({ directory, workspaceId: 'w' })
  disposals.push(() => repository.dispose())
  const collector = createKnowledgeCollector({
    repository,
    assertActive() {},
    getStore: (id) => ({ id, platform: 'pdd-web' }),
    provider: {
      async identity() {
        return { storeId: 's', platform: 'pdd-web', accountId: 'account', platformStoreId: 'mall' }
      },
      async collectProducts() {
        throw Error('unexpected read')
      },
    },
  })
  disposals.push(() => collector.dispose())
  expect(repository.readOnly).toBe(true)
  expect(await collector.capabilities('s')).toMatchObject({ collect: false })
})

it.each(['none', 'membership', 'revision'] as const)(
  'retains all first-collection partial-product leases across retry, pause and reopen (%s)',
  async (mutation) => {
    const f = pipelineFixture(),
      original = f.provider.collectProducts
    const catalogPage = await original({
      identity: await f.provider.identity(),
      range: { maxPages: 5, maxRecords: 100, productStatus: 'on-sale' },
      cursor: null,
      signal: new AbortController().signal,
      catalogOnly: true,
    })
    f.setPages([
      {
        ...catalogPage,
        total: 2,
        items: [
          { ...catalogPage.items[0]!, id: '34567890', title: '新商品A' },
          { ...catalogPage.items[0]!, id: '45678901', title: '新商品B' },
        ],
      },
    ])
    let partial = true,
      blockB = false,
      enteredB = false,
      release: () => void = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    f.provider.collectProducts = async (input) => {
      if (!input.catalogOnly && blockB && input.productIds?.includes('45678901')) {
        enteredB = true
        await gate
      }
      const page = await original(input)
      for (const item of page.items)
        if (item.platformDetail) item.platformDetail.detailStatus = partial ? 'partial' : 'complete'
      return page
    }
    const catalog = await f.coordinator.request({ action: 'catalog', storeId: 's' })
    const { jobId } = await f.coordinator.request({
      action: 'start',
      storeId: 's',
      kind: 'collect',
      catalog: {
        identityVersion: catalog.identityVersion,
        scopeToken: catalog.scopeToken,
        productIds: [],
        allMatching: true,
        total: 2,
      },
    })
    const initial = await settle(f, jobId)
    expect(initial.status).toBe('needs-confirmation')
    expect(initial.checkpoint.completedIds).toEqual(['34567890', '45678901'])
    const initialLeases = initial.checkpoint.bindingLeases as { id: string; revision: number }[]
    expect(initialLeases).toHaveLength(4)
    partial = false
    blockB = true
    await f.coordinator.request({ action: 'resume', storeId: 's', jobId })
    try {
      for (let n = 0; n < 100 && !enteredB; n++)
        await new Promise((resolve) => setTimeout(resolve, 5))
      const retriedA = f.repository.getJob(jobId)!
      expect(retriedA.checkpoint.completedIds).toEqual(['34567890'])
      // B's persisted root/SKU are still owned by this job even while B awaits a retry.
      expect(retriedA.checkpoint.bindingLeases).toEqual(initialLeases)
      expect(enteredB).toBe(true)
      await f.coordinator.request({ action: 'pause', storeId: 's', jobId })
    } finally {
      release()
    }
    await new Promise((resolve) => setTimeout(resolve, 10))
    f.coordinator.dispose()
    const directory = f.repository.directory
    f.repository.dispose()
    const reopened = createKnowledgeRepository({ directory, workspaceId: 'reopened-lease' })
    disposals.push(() => reopened.dispose())
    const coordinator = createKnowledgePipelineCoordinator()
    coordinator.register(
      createKnowledgeCollector({
        repository: reopened,
        provider: f.provider,
        assertActive() {},
        getStore: (id) => ({ id, platform: 'pdd-web' }),
      }),
    )
    disposals.push(() => coordinator.dispose())
    expect(reopened.getJob(jobId)).toMatchObject({
      status: 'paused',
      checkpoint: { completedIds: ['34567890'], bindingLeases: initialLeases },
    })
    const rootB = reopened
      .listBindings()
      .find((binding) => binding.productId === '45678901' && !binding.skuId)!
    if (mutation === 'membership')
      reopened.bindProduct({
        canonicalId: rootB.canonicalId,
        storeId: 's',
        productId: rootB.productId,
        skuId: 'external-sku',
      })
    if (mutation === 'revision')
      reopened.bindProduct({
        id: rootB.id,
        expectedRevision: rootB.revision,
        canonicalId: rootB.canonicalId,
        storeId: 's',
        productId: rootB.productId,
        title: '外部修改',
      })
    blockB = false
    await coordinator.request({ action: 'resume', storeId: 's', jobId })
    const final = await settle({ ...f, repository: reopened, coordinator }, jobId)
    if (mutation === 'none') {
      expect(final.status).toBe('succeeded')
      expect(final.progress).toEqual({ completed: 2, total: 2 })
      expect(final.checkpoint.issues).toEqual([])
      for (const productId of ['34567890', '45678901']) {
        const root = reopened
          .listBindings()
          .find((binding) => binding.productId === productId && !binding.skuId)!
        const source = reopened
          .listSources({ bindingId: root.id })
          .find((source) => source.label === '平台静态资料')!
        expect(reopened.sourceVersions(source.id)).toHaveLength(1)
      }
    } else {
      expect(final.status).toBe('paused')
      expect(final.error).toContain('绑定')
      expect(final.checkpoint.completedIds).toEqual(['34567890'])
      const capture = reopened
        .listSources({ bindingId: rootB.id })
        .find((source) => source.label === '平台采集范围')!
      expect(JSON.parse(capture.text).detailStatus).toBe('partial')
    }
    expect(final.checkpoint.bindingLeases).toEqual(initialLeases)
  },
)

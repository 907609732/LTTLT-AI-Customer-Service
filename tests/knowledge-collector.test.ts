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

function pipelineFixture() {
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

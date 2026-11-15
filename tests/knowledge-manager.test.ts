import { afterEach, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { defineComponent, h } from 'vue'
import { useRuntimeStore } from '../src/shared/state/runtime'
import { useKnowledgeManager } from '../src/modules/knowledge/manager-controller'
import type {
  KnowledgeDraftInput,
  KnowledgeEntry,
  KnowledgeVersion,
} from '../src/shared/contracts/knowledge'
import KnowledgeCatalogDialog from '../src/modules/knowledge/components/KnowledgeCatalogDialog.vue'
import KnowledgeManagerView from '../src/modules/knowledge/components/KnowledgeManagerView.vue'
const fake = vi.hoisted(() => ({
  asset: vi.fn(),
  query: vi.fn(),
  general: vi.fn(),
  command: vi.fn(),
  saveDraft: vi.fn(),
  publish: vi.fn(),
  pipeline: vi.fn(),
  context: vi.fn(),
  hide: vi.fn(),
  onContext: vi.fn(),
  onCloseRequest: vi.fn(),
  sourceHistory: vi.fn(),
  backup: vi.fn(),
}))
vi.mock('../src/modules/knowledge/manager-service', () => ({ createKnowledgeClient: () => fake }))
afterEach(() => vi.clearAllMocks())
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
function savedVersion(input: KnowledgeDraftInput, revision = 1): KnowledgeVersion {
  return {
    id: input.id || 'saved',
    revision,
    scope: input.scope,
    question: input.question,
    answer: input.answer,
    keywords: input.keywords || [],
    field: input.field || 'fact',
    origin: input.origin || 'manual',
    conflictKey: input.conflictKey || input.question,
    sourceRefs: input.sourceRefs || [],
    expiresAt: input.expiresAt ?? null,
    updatedAt: revision,
  }
}
async function setup(controller = false) {
  const pinia = createPinia()
  setActivePinia(pinia)
  const runtime = useRuntimeStore()
  runtime.snapshot.workspaceId = 'w'
  runtime.snapshot.stores = ['a', 'b'].map((id) => ({
    id,
    storeName: id,
    platform: 'pdd-web',
    group: '',
    aiEnabled: false,
    runtime: { open: false, online: false },
  }))
  runtime.selectedStoreId = 'a'
  fake.saveDraft
    .mockReset()
    .mockImplementation(async (input: KnowledgeDraftInput) =>
      savedVersion(input, (input.expectedRevision || 0) + 1),
    )
  fake.hide.mockReset().mockResolvedValue(undefined)
  fake.publish.mockReset().mockResolvedValue({ affectedBindings: [] })
  fake.sourceHistory.mockReset().mockResolvedValue([])
  fake.backup.mockReset().mockResolvedValue({ directory: 'test-backup' })
  fake.context.mockResolvedValue({ workspaceId: 'w', storeId: 'a', revision: 1 })
  fake.onContext.mockReturnValue(() => {})
  fake.onCloseRequest.mockReturnValue(() => {})
  fake.pipeline.mockResolvedValue({
    catalog: false,
    collect: false,
    import: false,
    learn: false,
    dailyCheck: false,
    reason: '未接入',
  })
  fake.general.mockResolvedValue({ items: [], total: 0, revision: 1 })
  fake.query.mockImplementation(async (input: { type: string }) =>
    input.type === 'summary'
      ? {
          products: 0,
          entries: 0,
          pending: 0,
          jobs: 0,
          misses: 0,
          readOnly: false,
          migration: { error: '' },
        }
      : input.type === 'settings'
        ? { dynamicTtlMinutes: 60, dailyCheckTime: '09:00', dailyCheckEnabled: true }
        : { items: [], total: 0, revision: 1 },
  )
  let manager: ReturnType<typeof useKnowledgeManager> | undefined
  const root = controller
    ? defineComponent({
        setup() {
          manager = useKnowledgeManager()
          return () => h('div')
        },
      })
    : KnowledgeManagerView
  const wrapper = mount(root, { global: { plugins: [pinia] } })
  await flushPromises()
  return { wrapper, runtime, manager }
}
it('has two main tabs and switching knowledge shops never changes reception selection', async () => {
  const { wrapper, runtime } = await setup()
  expect(wrapper.text()).toContain('通用问答')
  expect(wrapper.text()).toContain('商品')
  await wrapper.get('[data-testid="knowledge-store"]').setValue('b')
  await flushPromises()
  expect(runtime.selectedStoreId).toBe('a')
  expect(fake.query).toHaveBeenCalledWith(
    expect.objectContaining({ type: 'products', page: expect.objectContaining({ storeId: 'b' }) }),
  )
  wrapper.unmount()
})
it('autosaves a manual general answer as draft only and retains it on a stale conflict', async () => {
  const { wrapper } = await setup()
  await wrapper.get('[data-testid="general-tab"]').trigger('click')
  await flushPromises()
  await wrapper.get('[data-testid="write-one"]').trigger('click')
  await flushPromises()
  await wrapper.get('[data-testid="draft-question"]').setValue('多久发货')
  await wrapper.get('[data-testid="draft-answer"]').setValue('48小时内')
  fake.saveDraft.mockRejectedValueOnce(Error('revision conflict'))
  await wrapper.get('form.knowledge-editor').trigger('submit')
  await flushPromises()
  expect(wrapper.text()).toContain('revision conflict')
  expect((wrapper.get('[data-testid="draft-answer"]').element as HTMLTextAreaElement).value).toBe(
    '48小时内',
  )
  expect(fake.publish).not.toHaveBeenCalled()
  wrapper.unmount()
})

it('keeps a draft through normal snapshots and publishes only after explicit review', async () => {
  const { wrapper, runtime } = await setup()
  fake.saveDraft.mockImplementation(async (input) => ({
    id: 'saved',
    revision: 1,
    scope: input.scope,
    question: input.question,
    answer: input.answer,
    keywords: [],
    field: 'fact',
    origin: 'manual',
    conflictKey: input.question,
    sourceRefs: [],
    expiresAt: null,
    updatedAt: 1,
  }))
  fake.publish.mockResolvedValue({ affectedBindings: [] })
  await wrapper.get('[data-testid="general-tab"]').trigger('click')
  await flushPromises()
  await wrapper.get('[data-testid="write-one"]').trigger('click')
  await flushPromises()
  await wrapper.get('[data-testid="draft-question"]').setValue('可退货吗')
  await wrapper.get('[data-testid="draft-answer"]').setValue('审核后的退货说明')
  await wrapper.get('form.knowledge-editor').trigger('submit')
  await flushPromises()
  runtime.snapshot = { ...runtime.snapshot, revision: runtime.snapshot.revision + 1 }
  await flushPromises()
  expect((wrapper.get('[data-testid="draft-answer"]').element as HTMLTextAreaElement).value).toBe(
    '审核后的退货说明',
  )
  expect(fake.publish).not.toHaveBeenCalled()
  await wrapper
    .findAll('button')
    .find((button) => button.text() === '审核并发布…')!
    .trigger('click')
  await flushPromises()
  expect(wrapper.get('[aria-label="审核发布"]').text()).toContain('受影响店铺：a')
  expect(fake.publish).not.toHaveBeenCalled()
  await wrapper
    .findAll('button')
    .find((button) => button.text() === '明确审核并发布所选条目')!
    .trigger('click')
  await flushPromises()
  expect(fake.publish).toHaveBeenCalledOnce()
  wrapper.unmount()
})

it('explicit window shop context clears previous product identity before writing a new general answer', async () => {
  const { wrapper } = await setup()
  const originalQuery = fake.query.getMockImplementation()!
  const canonical = { id: 'shared-a', title: 'a店商品', code: '', revision: 1, updatedAt: 1 },
    binding = {
      id: 'binding-a',
      canonicalId: 'shared-a',
      storeId: 'a',
      productId: 'product-a',
      skuId: '',
      title: 'a店商品',
      revision: 1,
      active: true,
      updatedAt: 1,
    }
  fake.query.mockImplementation(async (input) =>
    input.type === 'products' && input.page?.storeId === 'a'
      ? {
          items: [
            {
              canonical,
              binding,
              sources: 0,
              approved: 0,
              drafts: 0,
              sourceSummary: { count: 0, kinds: [], thumbnailAssetId: null },
            },
          ],
          total: 1,
          revision: 1,
        }
      : input.type === 'detail'
        ? { canonical, bindings: [binding], entries: [], sources: [] }
        : originalQuery(input),
  )
  await wrapper
    .findAll('button')
    .find((button) => button.text() === '刷新')!
    .trigger('click')
  await flushPromises()
  await wrapper
    .findAll('button')
    .find((button) => button.text() === '编辑')!
    .trigger('click')
  await flushPromises()
  expect(wrapper.get('.knowledge-workspace').text()).toContain('product-a')
  const listener = fake.onContext.mock.calls[0]![0] as (context: {
    workspaceId: string
    storeId: string
    revision: number
  }) => void
  listener({ workspaceId: 'w', storeId: 'b', revision: 2 })
  await flushPromises()
  await wrapper.get('[data-testid="general-tab"]').trigger('click')
  await flushPromises()
  await wrapper.get('[data-testid="write-one"]').trigger('click')
  await flushPromises()
  await wrapper.get('[data-testid="draft-question"]').setValue('b店问题')
  await wrapper.get('[data-testid="draft-answer"]').setValue('b店答案')
  await wrapper.get('form.knowledge-editor').trigger('submit')
  await flushPromises()
  expect(fake.saveDraft).toHaveBeenLastCalledWith(
    expect.objectContaining({ scope: { kind: 'store', storeId: 'b' } }),
  )
  wrapper.unmount()
})

it.each(['jobs', 'misses'] as const)(
  'clears private %s and every secondary dialog on account change, including late responses',
  async (view) => {
    const { wrapper, runtime, manager: state } = await setup(true),
      manager = state!
    const original = fake.query.getMockImplementation()!
    fake.query.mockImplementation(async (input) =>
      input.type === view
        ? {
            items: [
              {
                id: 'private-old',
                question: '旧账号问题',
                kind: 'learn',
                status: 'paused',
                progress: { completed: 0, total: 1 },
                conversationIds: [],
              },
            ],
            total: 1,
            revision: 1,
          }
        : original(input),
    )
    await manager.showView(view)
    expect(view === 'jobs' ? manager.jobs.value : manager.misses.value).toHaveLength(1)
    const late = deferred<{
      identityVersion: string
      scopeToken: string
      items: { productId: string; title: string }[]
      nextCursor: null
      total: number
      complete: boolean
      range: string
    }>()
    fake.pipeline.mockImplementation((input) =>
      input.action === 'catalog'
        ? late.promise
        : Promise.resolve({
            catalog: true,
            collect: true,
            import: true,
            learn: true,
            dailyCheck: true,
            reason: '',
          }),
    )
    manager.catalog.value = {
      identityVersion: 'old',
      scopeToken: 'old',
      items: [{ productId: 'private', title: '旧账号目录' }],
      nextCursor: null,
      total: 1,
      complete: true,
      range: '旧账号范围',
    }
    manager.catalogOpen.value = true
    manager.catalogIds.value = ['private']
    manager.catalogAll.value = true
    manager.estimate.value = {
      estimateId: 'private-estimate',
      sources: 1,
      images: 1,
      characters: 2,
      estimatedTokens: 3,
      message: '旧账号用量',
    }
    manager.addingProduct.value = true
    manager.newTitle.value = '旧账号商品'
    manager.newProductId.value = 'old-id'
    manager.canonicals.value = [
      { id: 'private', title: '旧共享商品', code: 'secret', revision: 1, updatedAt: 1 },
    ]
    manager.settings.value = {
      dynamicTtlMinutes: 60,
      dailyCheckTime: '09:00',
      timezone: 'Asia/Shanghai',
      dailyCheckEnabled: true,
      lastDailyCheckAt: 1,
    }
    const reading = manager.run(() => manager.loadCatalog())
    await flushPromises()
    runtime.snapshot = { ...runtime.snapshot, workspaceId: 'new-account', stores: [] }
    await flushPromises()
    expect(manager.jobs.value).toEqual([])
    expect(manager.misses.value).toEqual([])
    expect(manager.summary.value).toBeUndefined()
    expect(manager.settings.value).toBeUndefined()
    expect(manager.catalog.value).toBeUndefined()
    expect(manager.catalogIds.value).toEqual([])
    expect(manager.catalogOpen.value).toBe(false)
    expect(manager.catalogAll.value).toBe(false)
    expect(manager.estimate.value).toBeUndefined()
    expect(manager.addingProduct.value).toBe(false)
    expect(manager.newTitle.value).toBe('')
    expect(manager.newProductId.value).toBe('')
    expect(manager.canonicals.value).toEqual([])
    expect(manager.view.value).toBe('library')
    expect(manager.storeId.value).toBe('')
    late.resolve({
      identityVersion: 'late-old',
      scopeToken: 'late-old',
      items: [{ productId: 'private', title: '迟到旧账号目录' }],
      nextCursor: null,
      total: 1,
      complete: true,
      range: '旧资料',
    })
    await reading
    await flushPromises()
    expect(manager.catalog.value).toBeUndefined()
    expect(manager.catalogOpen.value).toBe(false)
    expect(manager.error.value).not.toContain('已丢弃旧结果')
    wrapper.unmount()
  },
)

it.each(['close', 'hide'] as const)(
  'persists edits typed while a save is pending before %s',
  async (action) => {
    const { wrapper, manager: state } = await setup(true),
      manager = state!
    manager.tab.value = 'general'
    await manager.writeOne()
    manager.draft.value!.question = '发货问题'
    manager.draft.value!.answer = '第一版'
    manager.changed()
    const first = deferred<KnowledgeVersion>()
    fake.saveDraft.mockImplementationOnce(() => first.promise)
    const closing = action === 'close' ? manager.closeEditor() : manager.hide()
    await flushPromises()
    const input = fake.saveDraft.mock.calls[0]![0] as KnowledgeDraftInput
    manager.draft.value!.answer = '保存期间继续输入的最新答案'
    manager.changed()
    first.resolve(savedVersion(input, 1))
    await closing
    await flushPromises()
    expect(fake.saveDraft).toHaveBeenCalledTimes(2)
    expect(fake.saveDraft.mock.calls[1]![0]).toMatchObject({
      answer: '保存期间继续输入的最新答案',
      expectedRevision: 1,
    })
    if (action === 'close') expect(manager.draft.value).toBeUndefined()
    else expect(fake.hide).toHaveBeenCalledOnce()
    wrapper.unmount()
  },
)

it.each(['estimate', 'source', 'backup'] as const)(
  'drops late private %s responses after an account change',
  async (kind) => {
    const { wrapper, runtime, manager: state } = await setup(true),
      manager = state!
    const late = deferred<unknown>()
    let reading: Promise<void>
    if (kind === 'estimate') {
      const original = fake.query.getMockImplementation()!
      fake.query.mockImplementation(async (input) =>
        input.type === 'detail'
          ? { canonical: null, bindings: [], entries: [], sources: [] }
          : original(input),
      )
      fake.pipeline.mockImplementation((input) =>
        input.action === 'estimate'
          ? late.promise
          : Promise.resolve({
              catalog: false,
              collect: false,
              import: false,
              learn: false,
              dailyCheck: false,
              reason: '',
            }),
      )
      reading = manager.run(() =>
        manager.learnProduct({
          id: 'binding-a',
          canonicalId: 'shared',
          storeId: 'a',
          productId: 'product',
          skuId: '',
          title: 'private-old',
          revision: 1,
          active: true,
          updatedAt: 1,
        }),
      )
    } else if (kind === 'source') {
      fake.sourceHistory.mockReturnValue(late.promise)
      reading = manager.run(async () => {
        manager.sourceVersions.value = await manager.client().sourceHistory('private-source')
      })
    } else {
      fake.backup.mockReturnValue(late.promise)
      reading = manager.run(manager.backup)
    }
    await flushPromises()
    runtime.snapshot = { ...runtime.snapshot, workspaceId: 'new-account', stores: [] }
    await flushPromises()
    late.resolve(
      kind === 'estimate'
        ? {
            estimateId: 'private',
            sources: 1,
            images: 1,
            characters: 1,
            estimatedTokens: 1,
            message: '旧账号模型费用',
          }
        : kind === 'source'
          ? [{ id: 'private-source', text: '旧账号来源文本' }]
          : { directory: 'C:/private-old-account/backup' },
    )
    await reading
    await flushPromises()
    expect(manager.estimate.value).toBeUndefined()
    expect(manager.sources.value).toEqual([])
    expect(manager.detailBinding.value).toBeUndefined()
    expect(manager.sourceVersions.value).toEqual([])
    expect(manager.notice.value).toBe('')
    expect(manager.busy.value).toBe(false)
    wrapper.unmount()
  },
)

function pendingEntry(index: number): KnowledgeEntry {
  const draft = savedVersion({
    id: `entry-${index}`,
    scope:
      index % 2 ? { kind: 'binding', bindingId: 'binding-a' } : { kind: 'store', storeId: 'a' },
    question: `待审核问题${index}`,
    answer: `答案${index}`,
  })
  return { id: draft.id, revision: 1, status: 'draft', draft, approved: null }
}
it('uses the same mixed pending query for display, cross-page select all and bulk review', async () => {
  const { wrapper, manager: state } = await setup(true),
    manager = state!,
    all = Array.from({ length: 25 }, (_, index) => pendingEntry(index))
  const original = fake.query.getMockImplementation()!
  fake.query.mockImplementation(async (input) =>
    input.type === 'entries'
      ? {
          items: all.slice(
            input.page.offset || 0,
            (input.page.offset || 0) + (input.page.limit || 50),
          ),
          total: all.length,
          revision: 7,
        }
      : original(input),
  )
  fake.general.mockResolvedValue({
    items: [{ ...pendingEntry(99), status: 'approved' }],
    total: 1,
    revision: 7,
  })
  manager.search.value = '待审核'
  await manager.showView('review')
  expect(manager.entries.value).toHaveLength(20)
  await manager.selectAll()
  expect(manager.selection.value).toEqual(all.map((entry) => entry.id))
  await manager.bulkReview()
  expect(manager.reviewEntries.value.map((entry) => entry.id)).toEqual(all.map((entry) => entry.id))
  expect(fake.general).not.toHaveBeenCalled()
  for (const [input] of fake.query.mock.calls.filter(([input]) => input.type === 'entries'))
    expect(input).toMatchObject({ status: 'draft', page: { storeId: 'a', search: '待审核' } })
  wrapper.unmount()
})

it('reopens product entry A after saving A then B with its newest persisted text and revision', async () => {
  const { wrapper, manager: state } = await setup(true),
    manager = state!
  const a = pendingEntry(1),
    b = pendingEntry(3)
  const revisions = new Map([
    [a.id, 1],
    [b.id, 1],
  ])
  fake.saveDraft.mockImplementation(async (input: KnowledgeDraftInput) => {
    const current = revisions.get(input.id!)!
    if (input.expectedRevision !== current) throw Error('revision conflict')
    const version = savedVersion(input, current + 1)
    revisions.set(version.id, version.revision)
    return version
  })
  manager.detail.value = {
    canonical: { id: 'canonical', title: '商品', code: '', revision: 1, updatedAt: 1 },
    bindings: [],
    sources: [],
    entries: [a, b],
  }
  manager.editEntry(a)
  manager.draft.value!.answer = 'A编辑保存'
  manager.changed()
  await manager.saveDraft()
  manager.editEntry(b)
  manager.draft.value!.answer = 'B编辑保存'
  manager.changed()
  await manager.saveDraft()
  // A click queued before the list re-render may still hold the old DTO.
  manager.editEntry(a)
  expect(manager.draft.value).toMatchObject({ answer: 'A编辑保存', expectedRevision: 2 })
  manager.draft.value!.answer = 'A再次修改'
  manager.changed()
  await manager.saveDraft()
  expect(fake.saveDraft.mock.calls.at(-1)![0]).toMatchObject({
    id: a.id,
    answer: 'A再次修改',
    expectedRevision: 2,
  })
  expect(manager.detail.value.entries.find((entry) => entry.id === a.id)?.draft).toMatchObject({
    answer: 'A再次修改',
    revision: 3,
  })
  wrapper.unmount()
})

it('refuses unknown catalog all-selection and preserves its original filter across pages', async () => {
  const { wrapper, manager: state } = await setup(true),
    manager = state!
  manager.search.value = '棉衣'
  fake.pipeline.mockResolvedValue({
    identityVersion: 'identity',
    scopeToken: 'scope',
    items: [{ productId: 'p', title: '棉衣' }],
    nextCursor: 'next',
    total: null,
    complete: false,
    range: '在售；范围未知',
  })
  await manager.loadCatalog()
  manager.catalogAll.value = true
  await expect(manager.collectCatalog()).rejects.toThrow('完整')
  manager.catalogAll.value = false
  manager.search.value = '另一商品'
  await manager.loadCatalog('next')
  expect(
    fake.pipeline.mock.calls.filter(([input]) => input.action === 'catalog').at(-1)?.[0],
  ).toMatchObject({ search: '棉衣', cursor: 'next' })
  wrapper.unmount()
})

it('renders a disabled unknown-scope shortcut while keeping explicit cross-page selection visible', async () => {
  const wrapper = mount(KnowledgeCatalogDialog, {
    props: {
      catalog: {
        identityVersion: 'i',
        scopeToken: 's',
        items: [{ productId: 'p2', title: '当前页商品' }],
        nextCursor: 'next',
        total: null,
        complete: false,
        range: '第2页；已核对2项',
      },
      storeName: '测试店',
      search: '棉',
      busy: false,
      selected: ['p1'],
      all: false,
    },
  })
  expect(wrapper.get('input[type="checkbox"]').attributes('disabled')).toBeDefined()
  expect(wrapper.text()).toContain('已明确选择 1 项（含其他目录页的选择）')
  expect(wrapper.text()).toContain('全部筛选采集须先核对全部页及总量')
  await wrapper.setProps({
    catalog: {
      identityVersion: 'i',
      scopeToken: 's',
      items: [{ productId: 'p2', title: '当前页商品' }],
      nextCursor: null,
      total: 2,
      complete: true,
      range: '完整两页',
    },
  })
  expect(wrapper.get('input[type="checkbox"]').attributes('disabled')).toBeUndefined()
  wrapper.unmount()
})

it('clears the previous shop catalog and selected scope when the manager context changes', async () => {
  const { wrapper, manager: state } = await setup(true),
    manager = state!
  fake.pipeline.mockResolvedValue({
    identityVersion: 'a-identity',
    scopeToken: 'a-scope',
    items: [{ productId: 'a-product', title: 'A商品' }],
    nextCursor: null,
    total: 1,
    complete: true,
    range: 'A店范围',
  })
  await manager.loadCatalog()
  manager.catalogIds.value = ['a-product']
  manager.catalogAll.value = true
  await manager.changeStore('b')
  expect(manager.catalogOpen.value).toBe(false)
  expect(manager.catalog.value).toBeUndefined()
  expect(manager.catalogIds.value).toEqual([])
  expect(manager.catalogAll.value).toBe(false)
  wrapper.unmount()
})

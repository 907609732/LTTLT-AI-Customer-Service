import { afterEach, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { defineComponent, h } from 'vue'
import { useRuntimeStore } from '../src/shared/state/runtime'
import { useKnowledgeManager } from '../src/modules/knowledge/manager-controller'
import type {
  KnowledgeDraftInput,
  KnowledgeEntry,
  KnowledgeProductCard,
  KnowledgeVersion,
  KnowledgeJob,
} from '../src/shared/contracts/knowledge'
import KnowledgeCatalogDialog from '../src/modules/knowledge/components/KnowledgeCatalogDialog.vue'
import KnowledgeProductCards from '../src/modules/knowledge/components/KnowledgeProductCards.vue'
import KnowledgeToolbar from '../src/modules/knowledge/components/KnowledgeToolbar.vue'
import KnowledgeManagerView from '../src/modules/knowledge/components/KnowledgeManagerView.vue'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createKnowledgeRepository } from '../electron/knowledge/repository'
import { inspectKnowledgeBackup, restoreKnowledgeBackup } from '../electron/knowledge/backup'
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
  entryHistory: vi.fn(),
  backup: vi.fn(),
  export: vi.fn(),
  restorePreview: vi.fn(),
  clearPreview: vi.fn(),
  clear: vi.fn(),
  restore: vi.fn(),
}))
it('shows the saved shop product code on the knowledge card', () => {
  const directory = mkdtempSync(join(tmpdir(), 'knowledge-card-code-'))
  const repository = createKnowledgeRepository({ directory, workspaceId: 'w' })
  try {
    const canonical = repository.saveCanonical({ title: '商品' })
    repository.bindProduct({
      canonicalId: canonical.id,
      storeId: 's',
      productId: '123',
      title: '商品',
    })
    const card = repository.listProducts({ storeId: 's' }).items[0]!
    card.productSummary!.code = 'XM-YSP'
    const wrapper = mount(KnowledgeProductCards, {
      props: {
        products: [card],
        selection: [],
        page: 0,
        canLearn: false,
        loadAsset: async () => '',
      },
    })
    expect(wrapper.text()).toContain('XM-YSP')
    wrapper.unmount()
  } finally {
    repository.dispose()
    rmSync(directory, { recursive: true, force: true })
  }
})
it('renders a catalog table with thumbnail, explicit product ID, actual merchant code and missing-code state', async () => {
  const load = vi.fn(async () => 'data:image/png;base64,cG5n')
  const wrapper = mount(KnowledgeCatalogDialog, {
    props: {
      catalog: {
        identityVersion: 'i',
        scopeToken: 's',
        items: [
          { productId: '123', title: '商品一', merchantCode: 'XM-YSP', hasThumbnail: true },
          { productId: '456', title: '商品二', merchantCode: '' },
        ],
        nextCursor: null,
        total: 2,
        complete: true,
        range: '在售',
      },
      storeName: '米配匠',
      search: '',
      busy: false,
      selected: [],
      all: false,
      loadThumbnail: load,
    },
  })
  await flushPromises()
  expect(wrapper.get('thead').text()).toContain('商品 ID')
  expect(wrapper.get('thead').text()).toContain('商品编码')
  expect(wrapper.get('tbody').text()).toContain('XM-YSP')
  expect(wrapper.get('tbody').text()).toContain('暂无编码')
  expect(wrapper.get('tbody').text()).toContain('123')
  expect(wrapper.find('img').exists()).toBe(true)
  expect(load).toHaveBeenCalledWith('123')
  await wrapper.get('img').trigger('error')
  expect(wrapper.get('tbody').text()).toContain('不可用')
  await wrapper.get('tbody input[type="checkbox"]').setValue(true)
  expect(wrapper.emitted('update:selected')?.at(-1)).toEqual([['123']])
  wrapper.unmount()
})
vi.mock('../src/modules/knowledge/manager-service', () => ({ createKnowledgeClient: () => fake }))
afterEach(() => vi.clearAllMocks())
it('首次快照未完成就离开时，不再注册已卸载知识库的订阅', async () => {
  const late = deferred<void>()
  let refresh: ReturnType<typeof vi.spyOn> | undefined
  const { wrapper } = await setup(true, false, () => {
    refresh = vi.spyOn(useRuntimeStore(), 'refresh').mockImplementationOnce(() => late.promise)
  })
  wrapper.unmount()
  late.resolve()
  await flushPromises()
  expect(fake.onContext).not.toHaveBeenCalled()
  expect(fake.onCloseRequest).not.toHaveBeenCalled()
  refresh?.mockRestore()
})
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
async function setup(controller = false, canLearn = false, prepare?: () => void) {
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
  fake.entryHistory.mockReset().mockResolvedValue([])
  fake.backup.mockReset().mockResolvedValue({ directory: 'test-backup' })
  fake.context.mockResolvedValue({ workspaceId: 'w', storeId: 'a', revision: 1 })
  fake.onContext.mockReturnValue(() => {})
  fake.onCloseRequest.mockReturnValue(() => {})
  fake.pipeline.mockResolvedValue({
    catalog: false,
    collect: false,
    import: false,
    learn: canLearn,
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
  prepare?.()
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
it('removes the header subtitle and the capability explanation row', async () => {
  const reason = '仅采集原料；学习与审核发布独立执行'
  const { wrapper } = await setup(false, false, () => {
    fake.pipeline.mockResolvedValue({
      catalog: true,
      collect: false,
      import: false,
      learn: false,
      dailyCheck: false,
      reason,
    })
  })
  expect(wrapper.get('.knowledge-top').text()).toContain('知识库')
  expect(wrapper.get('.knowledge-top').text()).not.toContain('审核后使用')
  expect(wrapper.text()).not.toContain(reason)
  expect(wrapper.find('p.capability').exists()).toBe(false)
  wrapper.unmount()
})
function productCard(id: string, title: string): KnowledgeProductCard {
  return {
    canonical: { id: `canonical-${id}`, title, code: '', revision: 1, updatedAt: 1 },
    binding: {
      id,
      canonicalId: `canonical-${id}`,
      storeId: 'a',
      productId: id,
      skuId: '',
      title,
      revision: 1,
      active: true,
      updatedAt: 1,
    },
    sources: 0,
    approved: 0,
    drafts: 0,
    sourceSummary: { count: 0, kinds: [], thumbnailAssetId: null },
  }
}
it('keeps product selection and batch learning visible before choosing cards', async () => {
  const { wrapper } = await setup(false, false, () => {
    const original = fake.query.getMockImplementation()!
    fake.query.mockImplementation(async (input) =>
      input.type === 'products'
        ? {
            items: [productCard('p1', '商品一'), productCard('p2', '商品二')],
            total: 2,
            revision: 1,
          }
        : original(input),
    )
  })
  const cardCheckboxes = () => wrapper.findAll('.knowledge-card > input[type="checkbox"]')
  expect(cardCheckboxes()).toHaveLength(2)
  expect(wrapper.find('.knowledge-selection').exists()).toBe(true)
  await cardCheckboxes()[0]!.setValue(true)
  await flushPromises()
  const bar = wrapper.get('.knowledge-selection')
  expect(bar.text()).toContain('已选 1 项')
  expect(bar.text()).toContain('全选本页')
  expect(bar.text()).toContain('全选当前筛选')
  expect(bar.text()).toContain('全不选')
  expect(bar.text()).toContain('学习选中的 1 件商品')
  expect(bar.text()).toContain('审核所选草稿')
  expect(bar.text()).not.toContain('店铺：')
  expect(bar.text()).not.toContain('筛选：')
  expect(cardCheckboxes()).toHaveLength(2)
  await cardCheckboxes()[0]!.setValue(false)
  await flushPromises()
  expect(wrapper.find('.knowledge-selection').exists()).toBe(true)
  expect(cardCheckboxes()).toHaveLength(2)
  wrapper.unmount()
})
it('previews only selected products for batch learning and keeps single-product learning independent', async () => {
  const rows = [productCard('p1', '商品一'), productCard('p2', '商品二')]
  const { wrapper, manager } = await setup(true, true, () => {
    const original = fake.query.getMockImplementation()!
    fake.query.mockImplementation(async (input) =>
      input.type === 'products'
        ? { items: rows, total: rows.length, revision: 1 }
        : input.type === 'detail'
          ? { sources: [], bindings: rows.map((row) => row.binding) }
          : original(input),
    )
  })
  fake.pipeline.mockResolvedValue({ estimateId: 'batch' })
  await manager!.selectAll()
  await manager!.learnSelected()
  expect(fake.pipeline).toHaveBeenLastCalledWith(
    expect.objectContaining({ action: 'estimate', bindingIds: ['p1', 'p2'] }),
  )
  await manager!.learnProduct(rows[1]!.binding)
  await manager!.startLearn()
  expect(fake.pipeline).toHaveBeenCalledWith(
    expect.objectContaining({ action: 'start', bindingIds: ['p2'] }),
  )
  manager!.clearSelection()
  expect(manager!.selection.value).toEqual([])
  expect(manager!.allScope.value).toBe(false)
  wrapper.unmount()
})
it('discards a batch preview when search changes during detail loading', async () => {
  const late = deferred<{ sources: []; bindings: [] }>()
  const { wrapper, manager } = await setup(true, true, () => {
    const original = fake.query.getMockImplementation()!
    fake.query.mockImplementation(async (input) =>
      input.type === 'products'
        ? { items: [productCard('p1', '商品一')], total: 1, revision: 1 }
        : input.type === 'detail'
          ? late.promise
          : original(input),
    )
  })
  manager!.select('p1', true)
  const pending = manager!.learnSelected()
  await flushPromises()
  manager!.search.value = 'changed'
  late.resolve({ sources: [], bindings: [] })
  await expect(pending).rejects.toThrow('筛选范围已变化')
  expect(manager!.estimate.value).toBeUndefined()
  expect(fake.pipeline).not.toHaveBeenCalledWith(expect.objectContaining({ action: 'estimate' }))
  wrapper.unmount()
})
it('selects and previews products across pages without adding unselected products', async () => {
  const rows = Array.from({ length: 101 }, (_, i) => productCard(`p${i}`, `商品${i}`))
  const { wrapper, manager } = await setup(true, true, () => {
    const original = fake.query.getMockImplementation()!
    fake.query.mockImplementation(async (input) =>
      input.type === 'products'
        ? {
            items: rows.slice(input.page.offset, input.page.offset + input.page.limit),
            total: rows.length,
            revision: 1,
          }
        : input.type === 'detail'
          ? { sources: [], bindings: [] }
          : original(input),
    )
  })
  fake.pipeline.mockResolvedValue({ estimateId: 'cross-page' })
  await manager!.selectAll()
  expect(manager!.selection.value).toHaveLength(101)
  manager!.select('p50', false)
  await manager!.learnSelected()
  const estimateCall = fake.pipeline.mock.calls.find(([input]) => input.action === 'estimate')![0]
  expect(estimateCall.bindingIds).toHaveLength(100)
  expect(estimateCall.bindingIds).toContain('p100')
  expect(estimateCall.bindingIds).not.toContain('p50')
  wrapper.unmount()
})
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
it('labels received-fragment regeneration as paid and keeps uncertain jobs on their separate confirmation path', async () => {
  const { wrapper } = await setup()
  const original = fake.query.getMockImplementation()!
  const jobs: KnowledgeJob[] = ['received', 'submitted'].map((state, index) => ({
    id: `job-${index}`,
    storeId: 'a',
    kind: 'learn',
    revision: 1,
    status: index === 0 ? 'failed' : 'needs-confirmation',
    payload: {},
    checkpoint: { state },
    progress: { completed: 1, total: 3 },
    error: '格式或状态待处理',
    createdAt: 1,
    updatedAt: 1,
  }))
  fake.query.mockImplementation(async (input) =>
    input.type === 'jobs' ? { items: jobs, total: 2, revision: 1 } : original(input),
  )
  await wrapper.get('nav button').trigger('click')
  await flushPromises()
  const buttons = wrapper.findAll('button').filter((b) => b.text() === '重新生成本片段（会计费）')
  expect(buttons).toHaveLength(1)
  await buttons[0]!.trigger('click')
  await flushPromises()
  expect(fake.pipeline).toHaveBeenCalledWith({
    action: 'retry-received',
    storeId: 'a',
    jobId: 'job-0',
  })
  expect(
    fake.pipeline.mock.calls.some(
      ([input]) => input.action === 'retry-received' && input.jobId === 'job-1',
    ),
  ).toBe(false)
  wrapper.unmount()
})
it('offers the first-import actions for an empty shop and reads a fresh full backend catalog without collecting automatically', async () => {
  const { wrapper } = await setup()
  const start = wrapper.get('[data-testid="knowledge-first-import"]')
  expect(start.text()).toContain('还没有商品')
  expect(start.text()).toContain('从店铺后台读取')
  expect(start.text()).toContain('自己写一件')
  expect(start.text()).toContain('未接入')
  fake.pipeline.mockImplementation(async (input: { action: string }) =>
    input.action === 'catalog'
      ? {
          identityVersion: 'i',
          scopeToken: 'scope',
          items: [{ productId: 'p', title: '后台商品' }],
          nextCursor: null,
          total: 1,
          complete: true,
          range: '全部在售商品',
        }
      : {
          catalog: false,
          collect: false,
          import: false,
          learn: false,
          dailyCheck: false,
          reason: '未接入',
        },
  )
  await wrapper.get('[aria-label="搜索商品或问答"]').setValue('旧筛选')
  await start.get('[data-testid="read-store-products"]').trigger('click')
  await flushPromises()
  expect(fake.pipeline).toHaveBeenCalledWith({
    action: 'catalog',
    storeId: 'a',
    cursor: '',
    search: '',
  })
  expect(wrapper.text()).toContain('选择在售商品后采集')
  expect(wrapper.text()).toContain('后台商品')
  expect(fake.pipeline.mock.calls.some(([input]) => input.action === 'start')).toBe(false)
  wrapper.unmount()
})
it('does not confuse a filtered empty result with a shop that needs first import', async () => {
  const { wrapper } = await setup()
  fake.query.mockImplementation(async (input: { type: string }) =>
    input.type === 'summary'
      ? {
          products: 4,
          entries: 0,
          pending: 0,
          jobs: 0,
          misses: 0,
          readOnly: false,
          migration: { error: '' },
        }
      : { items: [], total: 0, revision: 1 },
  )
  await wrapper.get('[aria-label="搜索商品或问答"]').setValue('无匹配')
  await wrapper
    .findAll('button')
    .find((b) => b.text() === '刷新')!
    .trigger('click')
  await flushPromises()
  expect(wrapper.find('[data-testid="knowledge-first-import"]').exists()).toBe(false)
  expect(wrapper.text()).toContain('没有匹配的商品')
  wrapper.unmount()
})
it('clears the transient workspace-change warning after the owner supplies a verified new shop context', async () => {
  const { wrapper, runtime, manager } = await setup(true)
  runtime.snapshot.workspaceId = 'replacement'
  await flushPromises()
  expect(manager!.error.value).toContain('账号工作区已改变')
  const receive = fake.onContext.mock.calls.at(-1)![0] as (context: {
    workspaceId: string
    storeId: string
    revision: number
  }) => void
  receive({ workspaceId: 'replacement', storeId: 'a', revision: 3 })
  await flushPromises()
  expect(manager!.storeId.value).toBe('a')
  expect(manager!.error.value).toBe('')
  wrapper.unmount()
})

it.each(['clear', 'restore'] as const)(
  'waits for the actual replacement snapshot during two consecutive %s operations',
  async (operation) => {
    const { wrapper, runtime, manager: state } = await setup(true)
    const manager = state!
    const refresh = vi.spyOn(runtime, 'refresh').mockResolvedValue(undefined)
    try {
      for (let index = 0; index < 2; index++) {
        const workspaceId = `replacement-${index}`
        const message = operation === 'clear' ? '知识库已清除' : '知识库已恢复'
        fake[operation].mockResolvedValueOnce({
          workspaceId,
          recovered: false,
          message,
          context: { workspaceId, storeId: 'a', revision: index + 2 },
        })
        if (operation === 'clear') {
          manager.clearPreview.value = {
            token: 'clear',
            scope: { kind: 'store', storeId: 'a' },
            label: 'a',
            confirmation: '清除当前店铺',
            products: 0,
            entries: 0,
            jobs: 0,
            misses: 0,
            message: '',
          }
          manager.clearConfirmation.value = '清除当前店铺'
        } else {
          fake.restorePreview.mockResolvedValueOnce({
            token: 'restore',
            targetStoreId: 'a',
            scope: '本店备份：a',
            stores: ['a'],
            bindings: [],
            originalFiles: [],
            message: '',
          })
          await manager.chooseStoreRestore()
        }
        let finished = false
        const replacing = (
          operation === 'clear' ? manager.clearKnowledge() : manager.restoreBackup()
        ).then(() => {
          finished = true
        })
        await flushPromises()
        expect(finished).toBe(false)
        expect(manager.notice.value).not.toBe(message)
        // A newer refresh wins only after the operation's own refresh has resolved.
        runtime.snapshot.workspaceId = workspaceId
        await flushPromises()
        await replacing
        expect(manager.storeId.value).toBe('a')
        expect(manager.notice.value).toBe(message)
        await flushPromises()
        expect(manager.notice.value).toBe(message)
        expect(manager.error.value).not.toContain('账号工作区已改变')
      }
    } finally {
      wrapper.unmount()
      refresh.mockRestore()
    }
  },
)

it('cancels a replacement context wait when the manager closes without restoring an old shop', async () => {
  const { wrapper, runtime, manager: state } = await setup(true)
  const manager = state!
  const refresh = vi.spyOn(runtime, 'refresh').mockResolvedValue(undefined)
  fake.restorePreview.mockResolvedValueOnce({
    token: 'restore',
    targetStoreId: 'a',
    scope: '本店备份：a',
    stores: ['a'],
    bindings: [],
    originalFiles: [],
    message: '',
  })
  await manager.chooseStoreRestore()
  fake.restore.mockResolvedValueOnce({
    context: { workspaceId: 'replacement', storeId: 'a', revision: 2 },
    message: '知识库已恢复',
  })
  const replacing = manager.restoreBackup()
  const rejected = expect(replacing).rejects.toThrow(/关闭|取消/)
  await flushPromises()
  runtime.snapshot.workspaceId = 'another-account'
  await flushPromises()
  wrapper.unmount()
  await rejected
  expect(manager.storeId.value).toBe('')
  expect(manager.notice.value).not.toContain('已恢复')
  refresh.mockRestore()
})

it('bounds a missing replacement snapshot without reporting success or applying it later', async () => {
  const { wrapper, runtime, manager: state } = await setup(true)
  const manager = state!
  const refresh = vi.spyOn(runtime, 'refresh').mockResolvedValue(undefined)
  vi.useFakeTimers()
  try {
    fake.restorePreview.mockResolvedValueOnce({
      token: 'restore',
      targetStoreId: 'a',
      scope: '本店备份：a',
      stores: ['a'],
      bindings: [],
      originalFiles: [],
      message: '',
    })
    await manager.chooseStoreRestore()
    fake.restore.mockResolvedValueOnce({
      context: { workspaceId: 'missing', storeId: 'a', revision: 2 },
      message: '知识库已恢复',
    })
    const replacing = manager.restoreBackup()
    const rejected = expect(replacing).rejects.toThrow('工作区交接尚未完成')
    await flushPromises()
    await vi.advanceTimersByTimeAsync(10000)
    await rejected
    runtime.snapshot.workspaceId = 'missing'
    await flushPromises()
    expect(manager.storeId.value).toBe('')
    expect(manager.notice.value).not.toContain('已恢复')
  } finally {
    wrapper.unmount()
    refresh.mockRestore()
    vi.useRealTimers()
  }
})

it('does not report replacement success after closing during the final context refresh', async () => {
  const { wrapper, runtime, manager: state } = await setup(true)
  const manager = state!
  const refresh = vi.spyOn(runtime, 'refresh').mockResolvedValue(undefined)
  const pending = deferred<unknown>()
  const originalQuery = fake.query.getMockImplementation()!
  fake.query.mockImplementation((input: { type: string }) =>
    input.type === 'summary' ? pending.promise : originalQuery(input),
  )
  fake.restorePreview.mockResolvedValueOnce({
    token: 'restore',
    targetStoreId: 'a',
    scope: '本店备份：a',
    stores: ['a'],
    bindings: [],
    originalFiles: [],
    message: '',
  })
  await manager.chooseStoreRestore()
  fake.restore.mockResolvedValueOnce({
    context: { workspaceId: 'replacement', storeId: 'a', revision: 2 },
    message: '知识库已恢复',
  })
  const replacing = manager.restoreBackup()
  const rejected = expect(replacing).rejects.toThrow(/关闭/)
  await flushPromises()
  runtime.snapshot.workspaceId = 'replacement'
  await flushPromises()
  expect(manager.storeId.value).toBe('a')
  wrapper.unmount()
  pending.resolve({ products: 0, entries: 0, pending: 0, jobs: 0, misses: 0, readOnly: false })
  await rejected
  expect(manager.notice.value).not.toContain('已恢复')
  refresh.mockRestore()
})
it('drops an A store restore preview when the same account context switches to B before confirmation', async () => {
  const { wrapper, manager: state } = await setup(true)
  const manager = state!
  const preview = {
    token: 'store-a',
    targetStoreId: 'a',
    scope: '本店备份：a',
    stores: ['a'],
    bindings: [],
    originalFiles: [],
    message: '',
  }
  fake.restorePreview.mockResolvedValueOnce(preview)
  await manager.chooseStoreRestore()
  expect(manager.restorePreview.value?.targetStoreId).toBe('a')
  const receive = fake.onContext.mock.calls.at(-1)![0] as (context: {
    workspaceId: string
    storeId: string
    revision: number
  }) => void
  receive({ workspaceId: 'w', storeId: 'b', revision: 2 })
  await flushPromises()
  expect(manager.storeId.value).toBe('b')
  expect(manager.restorePreview.value).toBeUndefined()
  // Even if an old rendered confirmation still holds the preview object, the confirm path rejects.
  manager.restorePreview.value = preview
  await expect(manager.restoreBackup()).rejects.toThrow(/上下文|店铺/)
  expect(fake.restore).not.toHaveBeenCalled()
  wrapper.unmount()
})

it('drops an old preview when the same shop receives a newer external context lease', async () => {
  const { wrapper, manager: state } = await setup(true)
  const manager = state!
  const preview = {
    token: 'store-a',
    targetStoreId: 'a',
    scope: '本店备份：a',
    stores: ['a'],
    bindings: [],
    originalFiles: [],
    message: '',
  }
  fake.restorePreview.mockResolvedValueOnce(preview)
  await manager.chooseStoreRestore()
  const receive = fake.onContext.mock.calls.at(-1)![0] as (context: {
    workspaceId: string
    storeId: string
    revision: number
  }) => void
  receive({ workspaceId: 'w', storeId: 'a', revision: 2 })
  await flushPromises()
  expect(manager.storeId.value).toBe('a')
  expect(manager.restorePreview.value).toBeUndefined()
  manager.restorePreview.value = preview
  await expect(manager.restoreBackup()).rejects.toThrow(/上下文|店铺/)
  expect(fake.restore).not.toHaveBeenCalled()
  wrapper.unmount()
})

it('closes an advanced full-backup preview on an external context change instead of treating it as a store restore', async () => {
  const { wrapper, manager: state } = await setup(true)
  const manager = state!
  const preview = {
    token: 'full-restore',
    scope: '完整知识库（覆盖当前库）',
    stores: [],
    bindings: [],
    originalFiles: [],
    message: '',
  }
  fake.restorePreview.mockResolvedValueOnce(preview)
  await manager.chooseRestore()
  expect(manager.restorePreview.value?.scope).toContain('完整知识库')
  const receive = fake.onContext.mock.calls.at(-1)![0] as (context: {
    workspaceId: string
    storeId: string
    revision: number
  }) => void
  receive({ workspaceId: 'w', storeId: 'b', revision: 2 })
  await flushPromises()
  expect(manager.restorePreview.value).toBeUndefined()
  manager.restorePreview.value = preview
  await expect(manager.restoreBackup()).rejects.toThrow(/上下文|店铺/)
  expect(fake.restore).not.toHaveBeenCalled()
  wrapper.unmount()
})

it('rejects confirmation when a store preview target no longer matches the current shop', async () => {
  const { wrapper, manager: state } = await setup(true)
  const manager = state!
  fake.restorePreview.mockResolvedValueOnce({
    token: 'store-a',
    targetStoreId: 'a',
    scope: '本店备份：a',
    stores: ['a'],
    bindings: [],
    originalFiles: [],
    message: '',
  })
  await manager.chooseStoreRestore()
  manager.restorePreview.value!.targetStoreId = 'b'
  await expect(manager.restoreBackup()).rejects.toThrow(/店铺/)
  expect(fake.restore).not.toHaveBeenCalled()
  wrapper.unmount()
})

it('defaults clearing to the current shop, previews account scope separately, and never clears on cancel or an incomplete phrase', async () => {
  const { wrapper } = await setup()
  const settingsButton = wrapper.findAll('button').find((b) => b.text() === '设置')!
  await settingsButton.trigger('click')
  await flushPromises()
  const scope = wrapper.get('.knowledge-clear-settings select')
  expect((scope.element as HTMLSelectElement).value).toBe('store')
  fake.clearPreview.mockResolvedValue({
    token: 't',
    scope: { kind: 'store', storeId: 'a' },
    label: '当前店铺：a',
    confirmation: '清除当前店铺',
    products: 1,
    entries: 2,
    jobs: 0,
    misses: 0,
    message: '自动备份',
  })
  const previewButton = wrapper.findAll('button').find((b) => b.text() === '预览清除范围')!
  await previewButton.trigger('click')
  await flushPromises()
  expect(fake.clearPreview).toHaveBeenLastCalledWith({ kind: 'store', storeId: 'a' })
  const dialog = wrapper.get('[aria-label="确认清除知识库"]')
  const confirm = dialog.findAll('button').find((b) => b.text() === '备份并清除')!
  expect(confirm.attributes('disabled')).toBeDefined()
  await dialog.get('input').setValue('清除')
  expect(confirm.attributes('disabled')).toBeDefined()
  await dialog.get('input').setValue('清除当前店铺')
  expect(confirm.attributes('disabled')).toBeUndefined()
  await dialog
    .findAll('button')
    .find((b) => b.text() === '取消')!
    .trigger('click')
  expect(fake.clear).not.toHaveBeenCalled()
  await scope.setValue('account')
  await previewButton.trigger('click')
  await flushPromises()
  expect(fake.clearPreview).toHaveBeenLastCalledWith({ kind: 'account' })
  await wrapper.get('[data-testid="knowledge-store"]').setValue('b')
  await flushPromises()
  expect(wrapper.find('[aria-label="确认清除知识库"]').exists()).toBe(false)
  expect(fake.clear).not.toHaveBeenCalled()
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
    if (view === 'jobs') await manager.refresh()
    else await manager.showView(view)
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

it.each(['close', 'hide', 'leave'] as const)(
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
    const closing =
      action === 'close'
        ? manager.closeEditor()
        : action === 'hide'
          ? manager.hide()
          : manager.prepareLeave()
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
    else if (action === 'hide') expect(fake.hide).toHaveBeenCalledOnce()
    else {
      expect(await closing).toBe(true)
      expect(fake.hide).not.toHaveBeenCalled()
    }
    wrapper.unmount()
  },
)
it('内嵌离开时保存失败保留草稿并阻止导航，处理中的操作同样阻止离开', async () => {
  const { wrapper, manager: state } = await setup(true)
  const manager = state!
  manager.tab.value = 'general'
  await manager.writeOne()
  manager.draft.value!.question = '发货问题'
  manager.draft.value!.answer = '保留编辑'
  manager.changed()
  fake.saveDraft.mockRejectedValueOnce(Error('disk unavailable'))
  expect(await manager.prepareLeave()).toBe(false)
  expect(manager.draft.value!.answer).toBe('保留编辑')
  expect(manager.error.value).toContain('草稿未保存')
  expect(await manager.prepareLeave()).toBe(true)
  manager.busy.value = true
  expect(await manager.prepareLeave()).toBe(false)
  wrapper.unmount()
})

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
  a.draft.scope = { kind: 'canonical', canonicalId: 'canonical' }
  b.draft.scope = { kind: 'canonical', canonicalId: 'canonical' }
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

it.each([
  ['collect', 1],
  ['collect', 2],
  ['daily-check', 1],
  ['daily-check', 2],
] as const)(
  'continues incomplete %s with 1/%s processed without enabling uncertain paid or cancelled resume',
  async (kind, total) => {
    const { wrapper } = await setup()
    const original = fake.query.getMockImplementation()!
    const base: KnowledgeJob = {
      id: 'partial',
      kind,
      storeId: 'a',
      revision: 1,
      status: 'needs-confirmation',
      checkpoint: {},
      payload: {},
      progress: { completed: 1, total },
      error: '图片读取不完整',
      createdAt: 1,
      updatedAt: 1,
    }
    fake.query.mockImplementation(async (input) =>
      input.type === 'jobs'
        ? {
            items: [
              base,
              { ...base, id: 'paid', kind: 'learn', checkpoint: { state: 'submitted' } },
              { ...base, id: 'cancelled', status: 'cancelled' },
            ],
            total: 3,
            revision: 1,
          }
        : original(input),
    )
    await wrapper.get('nav button').trigger('click')
    await flushPromises()
    const cards = wrapper.findAll('.knowledge-inline-status > .knowledge-job-progress')
    expect(cards).toHaveLength(2)
    const resume = cards[0]!.findAll('button').find((button) => button.text() === '继续')
    expect(resume).toBeDefined()
    expect(cards[1]!.findAll('button').some((button) => button.text() === '继续')).toBe(false)
    await resume!.trigger('click')
    await flushPromises()
    expect(fake.pipeline).toHaveBeenCalledWith({ action: 'resume', storeId: 'a', jobId: 'partial' })
    expect(fake.pipeline.mock.calls.filter(([input]) => input.action === 'resume')).toHaveLength(1)
    wrapper.unmount()
  },
)

function sharedFamilyFixture() {
  const canonical = { id: 'family', title: 'shared family', code: '', revision: 1, updatedAt: 1 }
  const bindings = [
    { id: 'a-root', storeId: 'a', productId: 'pa', skuId: '' },
    { id: 'a-sku', storeId: 'a', productId: 'pa', skuId: 'red' },
    { id: 'b-root', storeId: 'b', productId: 'pb', skuId: '' },
    { id: 'b-sku', storeId: 'b', productId: 'pb', skuId: 'red' },
    { id: 'a-other', storeId: 'a', productId: 'another-product', skuId: '' },
  ].map((b) => ({
    ...b,
    canonicalId: canonical.id,
    title: b.id,
    revision: 1,
    active: true,
    updatedAt: 1,
  }))
  const entries: KnowledgeEntry[] = ['shared', ...bindings.map((b) => b.id)].map((id) => {
    const draft = savedVersion({
      id,
      scope:
        id === 'shared'
          ? { kind: 'canonical', canonicalId: canonical.id }
          : { kind: 'binding', bindingId: id },
      question: `question-${id}`,
      answer: `answer-${id}`,
      sourceRefs: id === 'shared' ? [{ sourceId: 'b-origin', revision: 1 }] : [],
    })
    return { id, revision: 1, status: 'draft', draft, approved: null }
  })
  const sources = [
    { id: 'a-origin', storeId: 'a', bindingId: 'a-root' },
    { id: 'b-origin', storeId: 'b', bindingId: 'b-root' },
    { id: 'b-private', storeId: 'b', bindingId: 'b-sku' },
  ].map((s) => ({
    ...s,
    label: s.id,
    kind: 'manual' as const,
    revision: 1,
    text: `text-${s.id}`,
    hash: 'hash',
    locator: {},
    assetIds: [],
    removed: false,
    updatedAt: 1,
  }))
  const row = {
    canonical,
    binding: bindings[0]!,
    sources: 1,
    approved: 0,
    drafts: entries.length,
    sourceSummary: { count: 1, kinds: [], thumbnailAssetId: null },
  }
  return { detail: { canonical, bindings, entries, sources }, row }
}

it('shows only current product overrides, saves to A and keeps B-origin shared evidence inspectable', async () => {
  const { wrapper } = await setup()
  const original = fake.query.getMockImplementation()!
  const fixture = sharedFamilyFixture()
  fake.query.mockImplementation(async (input) =>
    input.type === 'products'
      ? {
          items: [
            {
              ...fixture.row,
              binding:
                input.page.storeId === 'b' ? fixture.detail.bindings[2]! : fixture.row.binding,
            },
          ],
          total: 1,
          revision: 1,
        }
      : input.type === 'detail'
        ? structuredClone(fixture.detail)
        : original(input),
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
  expect(wrapper.findAll('.knowledge-entry').map((row) => row.text())).toEqual([
    expect.stringContaining('question-shared'),
    expect.stringContaining('question-a-root'),
    expect.stringContaining('question-a-sku'),
  ])
  const evidence = wrapper.get('.knowledge-entry-list').text()
  expect(evidence).toContain('text-b-origin')
  expect(evidence).toContain('来源店铺：b')
  expect(evidence).not.toContain('text-b-private')
  await wrapper
    .findAll('.knowledge-entry')
    .find((row) => row.text().includes('question-a-root'))!
    .trigger('click')
  await flushPromises()
  await wrapper.get('[data-testid="draft-answer"]').setValue('edited in A')
  await wrapper.get('form.knowledge-editor').trigger('submit')
  await flushPromises()
  expect(fake.saveDraft).toHaveBeenLastCalledWith(
    expect.objectContaining({
      id: 'a-root',
      scope: { kind: 'binding', bindingId: 'a-root' },
      answer: 'edited in A',
    }),
  )
  expect(wrapper.get('form.knowledge-editor').text()).not.toContain('another-product')
  await wrapper
    .findAll('button')
    .find((button) => button.text() === '原始资料 / 来源版本')!
    .trigger('click')
  await wrapper
    .findAll('button')
    .find((button) => button.text() === '刷新')!
    .trigger('click')
  await flushPromises()
  const origin = wrapper
    .findAll('.knowledge-sources article')
    .find((row) => row.text().includes('b-origin'))
  expect(origin?.text()).toContain('来源店铺：b')
  await origin!.find('button').trigger('click')
  await flushPromises()
  expect(fake.sourceHistory).toHaveBeenCalledWith('b-origin')
  await wrapper.get('[data-testid="knowledge-store"]').setValue('b')
  await flushPromises()
  await wrapper
    .findAll('button')
    .find((button) => button.text() === '编辑')!
    .trigger('click')
  await flushPromises()
  expect(wrapper.findAll('.knowledge-entry').map((row) => row.text())).toEqual([
    expect.stringContaining('question-shared'),
    expect.stringContaining('question-b-root'),
    expect.stringContaining('question-b-sku'),
  ])
  await wrapper
    .findAll('.knowledge-entry')
    .find((row) => row.text().includes('question-b-sku'))!
    .trigger('click')
  await flushPromises()
  await wrapper.get('[data-testid="draft-answer"]').setValue('edited in B')
  await wrapper.get('form.knowledge-editor').trigger('submit')
  await flushPromises()
  expect(fake.saveDraft).toHaveBeenLastCalledWith(
    expect.objectContaining({
      id: 'b-sku',
      scope: { kind: 'binding', bindingId: 'b-sku' },
      answer: 'edited in B',
    }),
  )
  wrapper.unmount()
})

it('clears entry-owned history when selecting, creating or discarding a draft', async () => {
  const { wrapper, manager: state } = await setup(true)
  const manager = state!
  manager.tab.value = 'general'
  const version = savedVersion({
    id: 'a',
    scope: { kind: 'store', storeId: 'a' },
    question: 'A',
    answer: 'A',
  })
  const entry: KnowledgeEntry = {
    id: 'a',
    revision: 1,
    status: 'draft',
    draft: version,
    approved: null,
  }
  manager.entryHistory.value = [{ version, reviewed: false }]
  manager.editEntry(entry)
  expect(manager.entryHistory.value).toEqual([])
  manager.entryHistory.value = [{ version, reviewed: false }]
  await manager.writeOne()
  expect(manager.entryHistory.value).toEqual([])
  manager.entryHistory.value = [{ version, reviewed: false }]
  manager.discardDraft()
  expect(manager.entryHistory.value).toEqual([])
  wrapper.unmount()
})

it('ignores delayed history from A after B or a new A draft session is selected', async () => {
  const { wrapper, manager: state } = await setup(true)
  const manager = state!
  const entries = ['A', 'B'].map(
    (id): KnowledgeEntry => ({
      id,
      revision: 1,
      status: 'draft',
      approved: null,
      draft: savedVersion({ id, scope: { kind: 'store', storeId: 'a' }, question: id, answer: id }),
    }),
  )
  manager.editEntry(entries[0]!)
  const pending = deferred<{ version: KnowledgeVersion; reviewed: boolean }[]>()
  fake.entryHistory.mockReturnValueOnce(pending.promise)
  const loaded = manager.loadEntryHistory()
  manager.editEntry(entries[1]!)
  manager.editEntry(entries[0]!)
  pending.resolve([{ version: entries[0]!.draft, reviewed: false }])
  await loaded
  expect(manager.entryHistory.value).toEqual([])
  fake.entryHistory.mockResolvedValueOnce([{ version: entries[0]!.draft, reviewed: true }])
  await manager.loadEntryHistory()
  expect(manager.entryHistory.value[0]?.reviewed).toBe(true)
  wrapper.unmount()
})

it('persists only the current-shop override through the manager and round trips its long shared question through publication and backups', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'knowledge-manager-sqlite-'))
  let repo = createKnowledgeRepository({ directory: join(directory, 'live'), workspaceId: 'w' })
  const { wrapper, manager: state } = await setup(true)
  const manager = state!
  try {
    const canonical = repo.saveCanonical({ title: 'shared' })
    const a = repo.bindProduct({ canonicalId: canonical.id, storeId: 'a', productId: 'pa' })
    const b = repo.bindProduct({
      canonicalId: canonical.id,
      storeId: 'b',
      productId: 'pb',
      skuId: 'blue',
    })
    const origin = repo.saveSource({
      storeId: 'b',
      bindingId: b.id,
      kind: 'manual',
      label: 'B evidence',
      text: 'B source',
    })
    const privateB = repo.saveDraft({
      scope: { kind: 'binding', bindingId: b.id },
      question: 'B private',
      answer: 'unchanged B',
    })
    const localA = repo.saveDraft({
      scope: { kind: 'binding', bindingId: a.id },
      question: 'A local',
      answer: 'old A',
    })
    fake.query.mockImplementation(async (query) => repo.query(query))
    fake.saveDraft.mockImplementation(async (input: KnowledgeDraftInput) => repo.saveDraft(input))
    fake.publish.mockImplementation(async (v: KnowledgeVersion) =>
      repo.publish({
        entryId: v.id,
        expectedDraftRevision: v.revision,
        expectedSourceRevisions: Object.fromEntries(
          v.sourceRefs.map((r) => [r.sourceId, r.revision]),
        ),
      }),
    )
    await manager.openProduct(repo.listProducts({ storeId: 'a' }).items[0]!)
    expect(manager.detail.value?.bindings).toHaveLength(2)
    expect(manager.editableEntries.value.map((e) => e.id)).toEqual([localA.id])
    expect(() => manager.editEntry(repo.getEntry(privateB.id)!)).toThrow('所属店铺')
    manager.editEntry(repo.getEntry(localA.id)!)
    manager.draft.value!.answer = 'saved A'
    manager.changed()
    await manager.saveDraft()
    expect(repo.getEntry(localA.id)?.draft.answer).toBe('saved A')
    expect(repo.getEntry(privateB.id)?.draft).toEqual(privateB)
    // A stale or injected editor scope cannot autosave into B, even though the full family is retained.
    manager.draft.value!.scope = { kind: 'binding', bindingId: b.id }
    manager.changed()
    await expect(manager.saveDraft()).rejects.toThrow('所属店铺')
    manager.discardDraft()
    await manager.writeOne()
    manager.setScope('canonical')
    manager.draft.value!.question = '完整问题'.repeat(1000)
    manager.draft.value!.answer = 'shared answer'
    manager.draft.value!.sourceRefs = [{ sourceId: origin.id, revision: 1 }]
    manager.changed()
    await manager.saveDraft()
    const id = manager.draft.value!.id!
    await manager.prepareReview()
    expect(manager.affected.value.sort()).toEqual(['a', 'b'])
    await manager.confirmPublish()
    expect(repo.getEntry(id)?.status).toBe('approved')
    await manager.closeEditor()
    repo.dispose()
    repo = createKnowledgeRepository({ directory: join(directory, 'live'), workspaceId: 'reopen' })
    await manager.openProduct(repo.listProducts({ storeId: 'a' }).items[0]!)
    expect(manager.sources.value.map((s) => s.id)).toContain(origin.id)
    manager.editEntry(repo.getEntry(id)!)
    manager.draft.value!.answer = 'reopened edit'
    manager.changed()
    await manager.saveDraft()
    expect(repo.getEntry(id)?.draft.question).toHaveLength(4000)
    for (const scope of [undefined, { canonicalId: canonical.id }]) {
      const backup = repo.createBackup(join(directory, 'backups'), scope)
      inspectKnowledgeBackup(backup.directory)
      repo.dispose()
      restoreKnowledgeBackup({
        directory: join(directory, 'live'),
        backupDirectory: backup.directory,
      })
      repo = createKnowledgeRepository({
        directory: join(directory, 'live'),
        workspaceId: 'restored',
      })
      expect(repo.getEntry(id)?.draft.answer).toBe('reopened edit')
      expect(repo.getEntry(id)?.approved?.answer).toBe('shared answer')
      expect(repo.getEntry(privateB.id)?.draft).toEqual(privateB)
    }
  } finally {
    wrapper.unmount()
    repo.dispose()
    rmSync(directory, { recursive: true, force: true })
  }
})
it('keeps learning on the product list and removes task navigation', async () => {
  const { wrapper, manager: state } = await setup(true)
  const manager = state!
  fake.pipeline.mockResolvedValue({ jobId: 'learning-one' })
  manager.estimate.value = {
    estimateId: 'estimate',
    sources: 1,
    images: 0,
    characters: 1,
    estimatedTokens: 1,
    message: '',
  }
  // Prepare the same single-product selection used by the actual card action.
  const original = fake.query.getMockImplementation()!
  fake.query.mockImplementation(async (input) =>
    input.type === 'detail' ? { sources: [], bindings: [] } : original(input),
  )
  await manager.learnProduct({
    id: 'one',
    canonicalId: 'c',
    storeId: 'a',
    productId: 'p',
    skuId: '',
    title: 'one',
    revision: 1,
    active: true,
    updatedAt: 1,
  })
  manager.estimate.value = {
    estimateId: 'estimate',
    sources: 1,
    images: 0,
    characters: 1,
    estimatedTokens: 1,
    message: '',
  }
  await manager.startLearn()
  expect(manager.view.value).toBe('library')
  expect(fake.pipeline).toHaveBeenCalledWith(
    expect.objectContaining({ action: 'start', bindingIds: ['one'] }),
  )
  wrapper.unmount()
  const screen = await setup()
  expect(screen.wrapper.findAll('nav button').some((b) => b.text().startsWith('任务'))).toBe(false)
  screen.wrapper.unmount()
})
it('shows loading and progress only on the owning product and preserves recovery actions inline', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'knowledge-inline-'))
  const repo = createKnowledgeRepository({ directory, workspaceId: 'w' })
  try {
    for (const productId of ['one', 'two']) {
      const c = repo.saveCanonical({ title: productId })
      repo.bindProduct({ canonicalId: c.id, storeId: 'a', productId, title: productId })
    }
    const products = repo.listProducts({ storeId: 'a' }).items
    const binding = products[0]!.binding
    const job: KnowledgeJob = {
      id: 'job',
      storeId: 'a',
      kind: 'learn',
      revision: 1,
      status: 'running',
      payload: { bindingIds: [binding.id] },
      checkpoint: {},
      progress: { completed: 2, total: 8 },
      error: '',
      createdAt: 1,
      updatedAt: 1,
    }
    const wrapper = mount(KnowledgeProductCards, {
      props: {
        products,
        selection: [],
        page: 0,
        canLearn: true,
        loadAsset: async () => '',
        jobs: [job],
        pending: false,
      },
    })
    const cards = wrapper.findAll('article')
    expect(cards[0]!.find('.knowledge-card-media .knowledge-job-progress').exists()).toBe(true)
    expect(cards[0]!.find('.knowledge-job-progress--compact').exists()).toBe(true)
    expect(cards[0]!.find('progress').attributes('value')).toBe('2')
    expect(cards[0]!.find('.progress-spinner').exists()).toBe(true)
    expect(cards[0]!.text()).toContain('资料步数')
    expect(cards[1]!.find('progress').exists()).toBe(false)
    expect(
      cards[0]!
        .findAll('button')
        .find((b) => b.text() === '开始学习')!
        .attributes('disabled'),
    ).toBeDefined()
    await cards[0]!
      .findAll('button')
      .find((b) => b.text() === '暂停')!
      .trigger('click')
    expect(wrapper.emitted('job-action')?.[0]).toEqual([
      { action: 'pause', storeId: 'a', jobId: 'job' },
    ])
    await wrapper.setProps({
      jobs: [{ ...job, status: 'succeeded', progress: { completed: 8, total: 8 } }],
    })
    expect(wrapper.find('.progress-spinner').exists()).toBe(false)
    expect(wrapper.text()).toContain('待审核')
    await wrapper.setProps({
      jobs: [
        { ...job, id: 'newer-completed', status: 'succeeded', createdAt: 2 },
        { ...job, status: 'failed', checkpoint: { state: 'received' } },
      ],
    })
    expect(wrapper.findAll('button').some((button) => button.text().includes('计费'))).toBe(true)
    await wrapper.setProps({ jobs: [{ ...job, storeId: 'other' }] })
    expect(wrapper.find('progress').exists()).toBe(false)
    wrapper.unmount()
  } finally {
    repo.dispose()
    rmSync(directory, { recursive: true, force: true })
  }
})
it('refreshes inline running progress and stops polling after unmount', async () => {
  const { wrapper, manager: state } = await setup(true)
  const manager = state!
  const original = fake.query.getMockImplementation()!
  fake.query.mockImplementation(async (input) =>
    input.type === 'jobs'
      ? {
          items: [
            {
              id: 'running',
              kind: 'learn',
              storeId: 'a',
              payload: { bindingIds: ['one'] },
              checkpoint: {},
              status: 'running',
              progress: { completed: 1, total: 8 },
            },
          ],
          total: 1,
          revision: 1,
        }
      : original(input),
  )
  vi.useFakeTimers()
  try {
    await manager.refresh()
    const count = () => fake.query.mock.calls.filter(([input]) => input.type === 'jobs').length
    const before = count()
    await vi.advanceTimersByTimeAsync(1500)
    expect(count()).toBe(before + 1)
    wrapper.unmount()
    const stopped = count()
    await vi.advanceTimersByTimeAsync(3000)
    expect(count()).toBe(stopped)
  } finally {
    vi.useRealTimers()
  }
})
it('loads every page of unfinished progress rather than losing older recovery controls', async () => {
  const { wrapper, manager: state } = await setup(true)
  const manager = state!
  const original = fake.query.getMockImplementation()!
  const jobs = Array.from({ length: 101 }, (_, i) => ({
    id: `paused-${i}`,
    storeId: 'a',
    kind: 'learn',
    status: 'paused',
    payload: { bindingIds: ['one'] },
    checkpoint: {},
    progress: { completed: 0, total: 2 },
  }))
  fake.query.mockImplementation(async (input) =>
    input.type === 'jobs'
      ? {
          items: jobs.slice(input.page.offset || 0, (input.page.offset || 0) + 100),
          total: 101,
          revision: 1,
        }
      : original(input),
  )
  await manager.refresh()
  expect(manager.jobs.value).toHaveLength(101)
  wrapper.unmount()
})

it('toolbar events preserve imports and use current-shop export, backup and restore scope', async () => {
  const { wrapper } = await setup(),
    toolbar = wrapper.findComponent(KnowledgeToolbar)
  // These fixtures verify routing only, and intentionally stop before real collection/export.
  fake.pipeline.mockRejectedValue(new Error('fixture stops before external operation'))
  for (const [event, action] of [
    ['catalog', 'catalog'],
    ['sources', 'choose-sources'],
  ] as const) {
    toolbar.vm.$emit(event)
    await flushPromises()
    expect(fake.pipeline).toHaveBeenCalledWith(expect.objectContaining({ action, storeId: 'a' }))
  }
  toolbar.vm.$emit('archive')
  await flushPromises()
  expect(wrapper.find('[aria-label="选择归档聊天范围"]').exists()).toBe(true)
  fake.export.mockRejectedValue(new Error('fixture stops before file download'))
  for (const [event, format] of [
    ['exportJson', 'json'],
    ['exportCsv', 'csv'],
  ] as const) {
    toolbar.vm.$emit(event)
    await flushPromises()
    expect(fake.export).toHaveBeenCalledWith('a', format, undefined)
  }
  toolbar.vm.$emit('backup')
  await flushPromises()
  expect(fake.backup).toHaveBeenLastCalledWith(undefined, 'a')
  fake.restorePreview.mockResolvedValue(undefined)
  toolbar.vm.$emit('restore')
  await flushPromises()
  expect(fake.restorePreview).toHaveBeenCalledWith('a')
  expect(fake.restore).not.toHaveBeenCalled()
  wrapper.unmount()
})

it('keeps learning outside import and avoids paid estimates when this shop has no materials', async () => {
  const { wrapper } = await setup(false, true)
  await wrapper
    .findAll('button')
    .find((b) => b.text().includes('通用问答'))!
    .trigger('click')
  await flushPromises()
  fake.pipeline.mockClear().mockResolvedValue({ sourceIds: [] })
  await wrapper.get('[data-testid="learn-store-materials"]').trigger('click')
  await flushPromises()
  expect(fake.pipeline).toHaveBeenCalledWith({ action: 'store-materials', storeId: 'a' })
  expect(fake.pipeline).not.toHaveBeenCalledWith(expect.objectContaining({ action: 'estimate' }))
  expect(wrapper.text()).toContain('请先通过“导入”添加资料文件')
  wrapper.unmount()
})
it('explicit shop exports ignore an open product detail and store backup uses the current shop', async () => {
  const { wrapper, manager } = await setup(true)
  manager!.detail.value = {
    canonical: { id: 'family' },
    bindings: [],
    entries: [],
  } as unknown as NonNullable<ReturnType<typeof useKnowledgeManager>['detail']['value']>
  fake.export.mockRejectedValue(Error('stop download'))
  await manager!.run(() => manager!.exportEntries('csv', 'shop'))
  expect(fake.export).toHaveBeenLastCalledWith('a', 'csv', undefined)
  await manager!.backupStore()
  expect(fake.backup).toHaveBeenLastCalledWith(undefined, 'a')
  wrapper.unmount()
})

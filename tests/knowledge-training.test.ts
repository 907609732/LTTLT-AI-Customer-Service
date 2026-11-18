import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia, type Pinia } from 'pinia'
import ElementPlus from 'element-plus'
import { emptySnapshot } from '../src/shared/contracts/backend'
import type { KnowledgeProductCard } from '../src/shared/contracts/knowledge'
import { useRuntimeStore } from '../src/shared/state/runtime'
import KnowledgeManagerView from '../src/modules/knowledge/components/KnowledgeManagerView.vue'
import ShopTrainingPanel from '../src/modules/knowledge/components/ShopTrainingPanel.vue'

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
}))
vi.mock('../src/modules/knowledge/manager-service', () => ({
  createKnowledgeClient: () => fake,
  openKnowledgeManager: vi.fn(),
}))
const backend = vi.hoisted(() => ({
  snapshot: vi.fn(),
  execute: vi.fn(),
  subscribe: vi.fn(),
  presentStore: vi.fn(),
}))
vi.mock('../src/shared/platform/backend', () => ({ getBackendBridge: () => backend }))

function productCard(storeId: string, productId: string, title = `商品${productId}`) {
  return {
    canonical: {
      id: `canonical-${storeId}-${productId}`,
      title,
      code: '',
      revision: 1,
      updatedAt: 1,
    },
    binding: {
      id: `binding-${storeId}-${productId}`,
      canonicalId: `canonical-${storeId}-${productId}`,
      storeId,
      productId,
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
  } satisfies KnowledgeProductCard
}

function page<T>(items: T[], total = items.length) {
  return { items, total, revision: 1 }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((done, fail) => {
    resolve = done
    reject = fail
  })
  return { promise, resolve, reject }
}

const catalogs: Record<string, KnowledgeProductCard[]> = {}
function listProducts(input: {
  page?: { storeId?: string; offset?: number; limit?: number; search?: string }
}) {
  const pageInput = input.page || {}
  const all = (catalogs[pageInput.storeId || ''] || []).filter((row) => {
    const search = (pageInput.search || '').trim().toLowerCase()
    return (
      !search ||
      (row.binding.title || row.canonical.title).toLowerCase().includes(search) ||
      row.binding.productId.toLowerCase().includes(search)
    )
  })
  const offset = pageInput.offset || 0
  const limit = pageInput.limit || 20
  return Promise.resolve(page(all.slice(offset, offset + limit), all.length))
}

let pinia: Pinia
beforeEach(async () => {
  pinia = createPinia()
  setActivePinia(pinia)
  const snapshot = emptySnapshot()
  snapshot.workspaceId = 'w'
  snapshot.stores = ['a', 'b'].map((id) => ({
    id,
    storeName: `店铺${id.toUpperCase()}`,
    platform: 'pdd-web',
    group: '',
    aiEnabled: false,
    runtime: { open: false, online: false },
  }))
  backend.snapshot.mockImplementation(async () => structuredClone(snapshot))
  backend.execute.mockResolvedValue({ status: 'ok', message: '', data: { reply: '测试回复' } })
  backend.subscribe.mockReturnValue(() => {})
  backend.presentStore.mockResolvedValue(undefined)
  await useRuntimeStore().refresh()
  catalogs.a = Array.from({ length: 125 }, (_, index) =>
    productCard('a', `P${index + 1}`, `训练商品${index + 1}`),
  )
  catalogs.b = [productCard('b', 'B1', 'B店商品')]
  fake.query.mockReset()
  fake.query.mockImplementation(async (input: { type: string; page?: Record<string, unknown> }) => {
    if (input.type === 'summary')
      return {
        revision: 1,
        products: 125,
        entries: 0,
        generalEntries: 0,
        pending: 0,
        jobs: 0,
        misses: 0,
        readOnly: false,
        migration: { status: 'complete', error: '' },
      }
    if (input.type === 'jobs') return page([])
    if (input.type === 'settings') return { dynamicTtlMinutes: 60, dailyCheckTime: '09:00' }
    if (input.type === 'products') return listProducts(input)
    return page([])
  })
  fake.pipeline.mockResolvedValue({
    catalog: true,
    collect: false,
    import: false,
    learn: false,
    dailyCheck: false,
    reason: '',
  })
  fake.general.mockResolvedValue(page([]))
  fake.context.mockResolvedValue({ workspaceId: 'w', storeId: 'a', revision: 1 })
  fake.onContext.mockReturnValue(() => {})
  fake.onCloseRequest.mockReturnValue(() => {})
  fake.hide.mockResolvedValue(undefined)
  fake.asset.mockResolvedValue('')
})

afterEach(() => {
  vi.clearAllMocks()
  document.body.innerHTML = ''
})

async function mountManager() {
  const wrapper = mount(KnowledgeManagerView, {
    global: { plugins: [ElementPlus, pinia] },
  })
  await flushPromises()
  return wrapper
}

function trainingTab(wrapper: ReturnType<typeof mount>) {
  return wrapper
    .findAll('.knowledge-tabs button')
    .find((button) => button.text().includes('AI训练场'))!
}

describe('knowledge AI training tab', () => {
  it('preserves typed questions during an ordinary backend snapshot refresh', async () => {
    const wrapper = await mountManager()
    await trainingTab(wrapper).trigger('click')
    await flushPromises()
    await wrapper.get('[aria-label="模拟买家问题"]').setValue('保留输入')
    await useRuntimeStore().refresh()
    await flushPromises()
    expect((wrapper.get('[aria-label="模拟买家问题"]').element as HTMLTextAreaElement).value).toBe(
      '保留输入',
    )
    await wrapper
      .findAll('.knowledge-tabs button')
      .find((b) => b.text().startsWith('待审核'))!
      .trigger('click')
    await flushPromises()
    expect(wrapper.find('.knowledge-pagination').exists()).toBe(true)
    wrapper.unmount()
  })

  it('invalidates a pending reply on hide and starts fresh on same-product reopen', async () => {
    const old = deferred<{ status: string; message: string; data: { reply: string } }>()
    backend.execute.mockImplementationOnce(() => old.promise)
    const wrapper = await mountManager()
    await wrapper
      .findAll('.knowledge-card-actions button')
      .find((b) => b.text() === 'AI训练场')!
      .trigger('click')
    await flushPromises()
    await wrapper.get('[aria-label="模拟买家问题"]').setValue('隐藏前问题')
    await wrapper.get('form.runtime-form').trigger('submit')
    await flushPromises()
    await wrapper.get('[aria-label="关闭知识库"]').trigger('click')
    await flushPromises()
    old.resolve({ status: 'ok', message: '', data: { reply: '隐藏后的旧回复' } })
    await flushPromises()
    expect(wrapper.text()).not.toContain('隐藏后的旧回复')
    const listener = fake.onContext.mock.calls[0]![0]
    listener({ workspaceId: 'w', storeId: 'a', tab: 'training', productId: 'P1', revision: 2 })
    await flushPromises()
    expect(wrapper.text()).not.toContain('隐藏前问题')
    expect(wrapper.text()).not.toContain('隐藏后的旧回复')
    wrapper.unmount()
  })
  it('places the training tab next to products, loads every product page and filters by name or code', async () => {
    const wrapper = await mountManager()
    const tabs = wrapper.findAll('.knowledge-tabs button')
    expect(tabs[0]!.text()).toContain('商品')
    expect(tabs[1]!.text()).toContain('AI训练场')
    await trainingTab(wrapper).trigger('click')
    await flushPromises()
    await flushPromises()
    const requests = fake.query.mock.calls
      .map(([input]) => input)
      .filter((input) => input.type === 'products' && input.page.limit === 100)
    expect(requests.map((input) => input.page.offset)).toEqual([0, 100])
    expect(wrapper.get('[aria-label="训练商品"]').text()).toContain('训练商品125 · P125')
    expect(
      wrapper
        .findAll('[aria-label="训练商品"] option')
        .some((option) => option.attributes('value') === 'P125'),
    ).toBe(true)
    await wrapper.get('[aria-label="搜索训练商品"]').setValue('P125')
    const filtered = wrapper.findAll('[aria-label="训练商品"] option')
    expect(filtered.map((option) => option.attributes('value'))).toEqual(['', 'P125'])
    expect(backend.execute).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('opens from a product card with that store/product selected and does not call the model before send', async () => {
    const runtime = useRuntimeStore()
    runtime.selectedStoreId = 'b'
    const wrapper = await mountManager()
    const firstTrainingButton = wrapper
      .findAll('.knowledge-card-actions button')
      .find((button) => button.text() === 'AI训练场')!
    await firstTrainingButton.trigger('click')
    await flushPromises()
    await flushPromises()
    expect(trainingTab(wrapper).classes()).toContain('active')
    expect((wrapper.get('[aria-label="训练商品"]').element as HTMLSelectElement).value).toBe('P1')
    expect(backend.execute).not.toHaveBeenCalled()
    await wrapper.get('[aria-label="模拟买家问题"]').setValue('这个商品怎么安装？')
    await wrapper.get('form.runtime-form').trigger('submit')
    await flushPromises()
    expect(backend.execute).toHaveBeenCalledTimes(1)
    expect(backend.execute.mock.calls[0]![0]).toMatchObject({
      action: 'start-training',
      storeId: 'a',
      values: { question: '这个商品怎么安装？', productId: 'P1' },
    })
    expect(wrapper.text()).toContain('测试回复')
    wrapper.unmount()
  })

  it('drops a delayed A reply when the knowledge shop changes to B and then sends with B identity', async () => {
    const oldReply = deferred<{ status: string; message: string; data: { reply: string } }>()
    backend.execute.mockImplementationOnce(() => oldReply.promise)
    const wrapper = await mountManager()
    const firstTrainingButton = wrapper
      .findAll('.knowledge-card-actions button')
      .find((button) => button.text() === 'AI训练场')!
    await firstTrainingButton.trigger('click')
    await flushPromises()
    await wrapper.get('[aria-label="模拟买家问题"]').setValue('A店问题')
    await wrapper.get('form.runtime-form').trigger('submit')
    await flushPromises()
    expect(backend.execute).toHaveBeenCalledTimes(1)
    await wrapper.get('[data-testid="knowledge-store"]').setValue('b')
    await flushPromises()
    await flushPromises()
    expect((wrapper.get('[aria-label="训练商品"]').element as HTMLSelectElement).value).toBe('')
    oldReply.resolve({ status: 'ok', message: '', data: { reply: '迟到A回复' } })
    await flushPromises()
    expect(wrapper.text()).not.toContain('迟到A回复')
    backend.execute.mockResolvedValueOnce({
      status: 'ok',
      message: '',
      data: { reply: 'B店回复' },
    })
    await wrapper.get('[aria-label="模拟买家问题"]').setValue('B店问题')
    await wrapper.get('form.runtime-form').trigger('submit')
    await flushPromises()
    expect(backend.execute.mock.calls.at(-1)![0]).toMatchObject({
      action: 'start-training',
      storeId: 'b',
      values: { question: 'B店问题' },
    })
    expect(wrapper.text()).toContain('B店回复')
    expect(wrapper.text()).not.toContain('A店问题')
    wrapper.unmount()
  })

  it('applies an owner-opened training tab and product preset without generating', async () => {
    let contextListener:
      | ((context: {
          workspaceId: string
          storeId: string
          tab: 'training'
          productId: string
          revision: number
        }) => void)
      | undefined
    fake.onContext.mockImplementation((listener) => {
      contextListener = listener
      return () => {}
    })
    const wrapper = await mountManager()
    contextListener!({
      workspaceId: 'w',
      storeId: 'a',
      tab: 'training',
      productId: 'P120',
      revision: 2,
    })
    await flushPromises()
    await flushPromises()
    expect(trainingTab(wrapper).classes()).toContain('active')
    expect((wrapper.get('[aria-label="训练商品"]').element as HTMLSelectElement).value).toBe('P120')
    expect(backend.execute).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('keeps the newest product list when an older store load resolves late', async () => {
    const delayedA = deferred<ReturnType<typeof page<KnowledgeProductCard>>>()
    const original = fake.query.getMockImplementation()!
    fake.query.mockImplementation(async (input) => {
      if (input.type === 'products' && input.page.limit === 100 && input.page.storeId === 'a')
        return delayedA.promise
      return original(input)
    })
    const wrapper = await mountManager()
    await trainingTab(wrapper).trigger('click')
    await flushPromises()
    await wrapper.get('[data-testid="knowledge-store"]').setValue('b')
    await flushPromises()
    await flushPromises()
    expect(wrapper.get('[aria-label="训练商品"]').text()).toContain('B店商品 · B1')
    delayedA.resolve(page(catalogs.a!))
    await flushPromises()
    expect(wrapper.get('[aria-label="训练商品"]').text()).toContain('B店商品 · B1')
    expect(wrapper.get('[aria-label="训练商品"]').text()).not.toContain('训练商品1 · P1')
    wrapper.unmount()
  })
})

describe('shop training panel isolation', () => {
  const options = { global: { plugins: [ElementPlus] } }

  it('rejects missing or unvalidated product presets without falling back to generic training', async () => {
    const wrapper = mount(ShopTrainingPanel, {
      ...options,
      props: { storeId: 'a', products: [], productId: 'MISSING' },
    })
    await wrapper.get('[aria-label="模拟买家问题"]').setValue('商品问题')
    await wrapper.get('form.runtime-form').trigger('submit')
    await flushPromises()
    expect(backend.execute).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('商品不可用')
    expect(wrapper.get('[aria-label="训练商品"]').attributes('disabled')).toBeUndefined()
    await wrapper.get('[aria-label="训练商品"]').setValue('')
    expect(wrapper.emitted('update:productId')?.at(-1)).toEqual([''])
    await wrapper.setProps({ products: [productCard('a', 'MISSING')], productLoading: true })
    await wrapper.get('form.runtime-form').trigger('submit')
    await flushPromises()
    expect(backend.execute).not.toHaveBeenCalled()
    await wrapper.setProps({ productId: '', productLoading: false })
    await wrapper.get('[aria-label="模拟买家问题"]').setValue('通用问题')
    await wrapper.get('form.runtime-form').trigger('submit')
    await flushPromises()
    expect(backend.execute).toHaveBeenCalledTimes(1)
    expect(backend.execute.mock.calls[0]![0].values).not.toHaveProperty('productId')
    wrapper.unmount()
  })

  it('shows an unreviewed product error without a second generic request', async () => {
    backend.execute.mockRejectedValueOnce(new Error('商品知识尚未审核'))
    const wrapper = mount(ShopTrainingPanel, {
      ...options,
      props: { storeId: 'a', products: [productCard('a', 'P1')], productId: 'P1' },
    })
    await wrapper.get('[aria-label="模拟买家问题"]').setValue('商品问题')
    await wrapper.get('form.runtime-form').trigger('submit')
    await flushPromises()
    expect(backend.execute).toHaveBeenCalledTimes(1)
    expect(wrapper.text()).toContain('商品知识尚未审核')
    wrapper.unmount()
  })

  it('uses the knowledge shop rather than the shared runtime selection and clears chat when the product changes', async () => {
    const runtime = useRuntimeStore()
    runtime.selectedStoreId = 'b'
    const first = deferred<{ status: string; message: string; data: { reply: string } }>()
    backend.execute.mockImplementationOnce(() => first.promise)
    const wrapper = mount(ShopTrainingPanel, {
      ...options,
      props: {
        storeId: 'a',
        storeName: '店铺A',
        products: [productCard('a', 'P1'), productCard('a', 'P2')],
        productId: 'P1',
      },
    })
    await wrapper.get('[aria-label="模拟买家问题"]').setValue('旧商品问题')
    await wrapper.get('form.runtime-form').trigger('submit')
    await flushPromises()
    expect(backend.execute).toHaveBeenCalledTimes(1)
    await wrapper.setProps({ productId: 'P2' })
    first.resolve({ status: 'ok', message: '', data: { reply: '旧商品迟到回复' } })
    await flushPromises()
    expect(wrapper.text()).not.toContain('旧商品迟到回复')
    expect(wrapper.text()).not.toContain('旧商品问题')
    backend.execute.mockResolvedValueOnce({
      status: 'ok',
      message: '',
      data: { reply: '新商品回复' },
    })
    await wrapper.get('[aria-label="模拟买家问题"]').setValue('新商品问题')
    await wrapper.get('form.runtime-form').trigger('submit')
    await flushPromises()
    expect(backend.execute.mock.calls.at(-1)![0]).toMatchObject({
      action: 'start-training',
      storeId: 'a',
      values: { productId: 'P2', question: '新商品问题' },
    })
    expect(wrapper.text()).toContain('新商品回复')
    expect(wrapper.text()).not.toContain('测试店铺')
    wrapper.unmount()
  })

  it('keeps image testing, stale error suppression and history clearing', async () => {
    const old = deferred<{ status: string; message: string; data: { reply: string } }>()
    backend.execute.mockImplementationOnce(() => old.promise)
    const wrapper = mount(ShopTrainingPanel, {
      ...options,
      props: { storeId: 'a', storeName: '店铺A', products: [], productId: '' },
    })
    await wrapper.get('[aria-label="模拟买家问题"]').setValue('看图')
    await wrapper.get('[aria-label="测试图片地址"]').setValue('https://img.example/a.png')
    await wrapper.get('form.runtime-form').trigger('submit')
    await flushPromises()
    expect(backend.execute.mock.calls[0]![0].values.images).toEqual(['https://img.example/a.png'])
    await wrapper.setProps({ storeId: 'b' })
    old.reject(new Error('旧店铺错误'))
    await flushPromises()
    expect(wrapper.text()).not.toContain('旧店铺错误')
    backend.execute.mockResolvedValueOnce({
      status: 'ok',
      message: '',
      data: { reply: '可清空回复' },
    })
    await wrapper.get('[aria-label="模拟买家问题"]').setValue('新店铺')
    await wrapper.get('form.runtime-form').trigger('submit')
    await flushPromises()
    expect(wrapper.text()).toContain('可清空回复')
    const clear = wrapper.findAll('button').find((button) => button.text() === '清空模拟对话')!
    await clear.trigger('click')
    expect(wrapper.text()).not.toContain('可清空回复')
    expect(wrapper.get('[aria-label="测试图片地址"]').element.tagName).toBe('TEXTAREA')
    wrapper.unmount()
  })
})

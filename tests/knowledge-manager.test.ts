import { afterEach, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { useRuntimeStore } from '../src/shared/state/runtime'
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
}))
vi.mock('../src/modules/knowledge/manager-service', () => ({ createKnowledgeClient: () => fake }))
afterEach(() => vi.clearAllMocks())
async function setup() {
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
  const wrapper = mount(KnowledgeManagerView, { global: { plugins: [pinia] } })
  await flushPromises()
  return { wrapper, runtime }
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

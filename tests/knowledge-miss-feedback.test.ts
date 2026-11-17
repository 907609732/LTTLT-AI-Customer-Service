import { afterEach, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createKnowledgeRepository } from '../electron/knowledge/repository'
import { useRuntimeStore } from '../src/shared/state/runtime'
import KnowledgeManagerView from '../src/modules/knowledge/components/KnowledgeManagerView.vue'
import type { KnowledgeMiss, KnowledgePage } from '../src/shared/contracts/knowledge'

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
vi.mock('../src/modules/knowledge/manager-service', () => ({ createKnowledgeClient: () => fake }))

const cleanups: (() => void)[] = []
afterEach(() => {
  vi.clearAllMocks()
  for (const cleanup of cleanups.splice(0).reverse()) cleanup()
})
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (cause: unknown) => void
  const promise = new Promise<T>((done, fail) => {
    resolve = done
    reject = fail
  })
  return { promise, resolve, reject }
}
function repositoryFixture() {
  const directory = mkdtempSync(join(tmpdir(), 'knowledge-miss-feedback-'))
  let time = 1_000
  const repository = createKnowledgeRepository({
    directory,
    workspaceId: 'w',
    now: () => ++time,
  })
  cleanups.push(() => rmSync(directory, { recursive: true, force: true }))
  cleanups.push(() => repository.dispose())
  return repository
}
function seedMisses(repository: ReturnType<typeof createKnowledgeRepository>, count = 122) {
  for (let index = 0; index < count; index++)
    repository.recordMiss({
      storeId: 'a',
      productId: 'p',
      question: `问题 ${index}`,
      conversationId: `buyer-${index}`,
    })
  const history = repository.listMisses({ storeId: 'a', limit: 2 }).items
  repository.updateMiss(history[0]!.id, 'resolved')
  repository.updateMiss(history[1]!.id, 'ignored')
  return repository.listMisses({ storeId: 'a', limit: 2 }).items
}
function wireRepository(repository: ReturnType<typeof createKnowledgeRepository>) {
  const command = vi.fn(async (input: Parameters<typeof repository.execute>[0]) =>
    repository.execute(input),
  )
  fake.query.mockImplementation(async (input: { type: string; storeId?: string }) => {
    if (input.type === 'summary') return { ...repository.summary(input.storeId), generalEntries: 0 }
    if (input.type === 'settings') return repository.getSettings()
    if (input.type === 'misses')
      return repository.query(input as Parameters<typeof repository.query>[0])
    return { items: [], total: 0, revision: repository.revision }
  })
  fake.command.mockImplementation(command)
  fake.saveDraft.mockResolvedValue(undefined)
  fake.publish.mockResolvedValue({ affectedBindings: [] })
  fake.asset.mockResolvedValue('')
  fake.entryHistory.mockResolvedValue([])
  fake.sourceHistory.mockResolvedValue([])
  fake.backup.mockResolvedValue({ directory: 'test-backup' })
  fake.general.mockResolvedValue({ items: [], total: 0, revision: repository.revision })
  fake.pipeline.mockResolvedValue({
    catalog: false,
    collect: false,
    import: false,
    learn: false,
    dailyCheck: false,
    reason: '',
  })
  fake.context.mockResolvedValue({ workspaceId: 'w', storeId: 'a', revision: 1 })
  fake.onContext.mockReturnValue(() => {})
  fake.onCloseRequest.mockReturnValue(() => {})
  fake.hide.mockResolvedValue(undefined)
  return command
}
async function mountManager(repository: ReturnType<typeof createKnowledgeRepository>) {
  wireRepository(repository)
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
  const wrapper = mount(KnowledgeManagerView, { global: { plugins: [pinia] } })
  await flushPromises()
  return { wrapper, runtime }
}
function button(wrapper: ReturnType<typeof mount>, text: string) {
  const found = wrapper.findAll('button').find((candidate) => candidate.text() === text)
  if (!found) throw Error(`missing button: ${text}`)
  return found
}
function missQuery(call = -1) {
  const calls = fake.query.mock.calls.filter(([input]) => input.type === 'misses')
  return calls.at(call)?.[0] as
    | { type: 'misses'; page: { status?: string; search?: string; offset: number; limit: number } }
    | undefined
}

it('filters misses by status in the query layer, pages beyond 100 and counts only open in the summary', () => {
  const repository = repositoryFixture()
  seedMisses(repository)

  const open = repository.listMisses({ storeId: 'a', status: 'open', limit: 20 })
  expect(open.total).toBe(120)
  expect(open.items).toHaveLength(20)
  expect(open.items.every((miss) => miss.status === 'open')).toBe(true)
  const laterPage = repository.query({
    type: 'misses',
    page: { storeId: 'a', status: 'open', offset: 100, limit: 20 },
  }) as KnowledgePage<KnowledgeMiss>
  expect(laterPage.items).toHaveLength(20)
  expect(laterPage.items.every((miss) => miss.status === 'open')).toBe(true)
  expect(repository.listMisses({ storeId: 'a', status: 'resolved' }).total).toBe(1)
  expect(repository.listMisses({ storeId: 'a', status: 'ignored' }).total).toBe(1)
  expect(repository.listMisses({ storeId: 'a' }).total).toBe(122)
  expect(repository.listMisses({ storeId: 'a', status: 'open', search: '问题 117' }).items).toEqual(
    [expect.objectContaining({ question: '问题 117', status: 'open' })],
  )
  expect(repository.summary('a').misses).toBe(120)
})

it('returns to the preceding page after resolving the final item on the last page', async () => {
  const repository = repositoryFixture()
  for (let index = 0; index < 21; index++)
    repository.recordMiss({ storeId: 'a', question: `末页问题 ${index}` })
  const { wrapper } = await mountManager(repository)
  await button(wrapper, '待学问题 21').trigger('click')
  await flushPromises()
  await button(wrapper, '下一页').trigger('click')
  await flushPromises()
  expect(wrapper.findAll('.knowledge-card')).toHaveLength(1)
  await wrapper.get('[data-testid="miss-resolve"]').trigger('click')
  await flushPromises()
  expect(wrapper.get('.knowledge-pagination').text()).toContain('1 / 1')
  expect(wrapper.findAll('.knowledge-card')).toHaveLength(20)
  wrapper.unmount()
})

it('shows three status entries, defaults to open, keeps the header count open-only and pages over 100 items', async () => {
  const repository = repositoryFixture()
  seedMisses(repository)
  const { wrapper } = await mountManager(repository)

  expect(wrapper.get('.knowledge-tabs').text()).toContain('待学问题 120')
  await button(wrapper, '待学问题 120').trigger('click')
  await flushPromises()
  expect(wrapper.get('.knowledge-miss-filters').text()).toContain('待处理')
  expect(wrapper.get('.knowledge-miss-filters').text()).toContain('已解决')
  expect(wrapper.get('.knowledge-miss-filters').text()).toContain('已忽略')
  expect(wrapper.get('[data-testid="miss-filter-open"]').classes()).toContain('active')
  expect(wrapper.get('.knowledge-pagination').text()).toContain('共 120 项')
  expect(wrapper.get('.knowledge-pagination').text()).toContain('1 / 6')
  expect(missQuery()).toMatchObject({
    page: { status: 'open', offset: 0, limit: 20, storeId: 'a' },
  })

  for (let index = 0; index < 5; index++) {
    await button(wrapper, '下一页').trigger('click')
    await flushPromises()
  }
  expect(wrapper.get('.knowledge-pagination').text()).toContain('6 / 6')
  expect(missQuery()).toMatchObject({ page: { status: 'open', offset: 100, limit: 20 } })

  await wrapper.get('input[aria-label="搜索商品或问答"]').setValue('问题 117')
  await flushPromises()
  expect(wrapper.get('.knowledge-pagination').text()).toContain('共 1 项')
  expect(missQuery()).toMatchObject({
    page: { status: 'open', offset: 0, limit: 20, search: '问题 117' },
  })
  wrapper.unmount()
})

it('changes status at page zero, shows Chinese labels and reopens a resolved history item', async () => {
  const repository = repositoryFixture()
  const [resolved] = seedMisses(repository, 23)
  const { wrapper } = await mountManager(repository)
  await button(wrapper, '待学问题 21').trigger('click')
  await flushPromises()
  await button(wrapper, '下一页').trigger('click')
  await flushPromises()
  expect(missQuery()).toMatchObject({ page: { status: 'open', offset: 20 } })

  await wrapper.get('[data-testid="miss-filter-resolved"]').trigger('click')
  await flushPromises()
  expect(wrapper.get('[data-testid="miss-filter-resolved"]').classes()).toContain('active')
  expect(missQuery()).toMatchObject({ page: { status: 'resolved', offset: 0 } })
  expect(wrapper.get('.knowledge-pagination').text()).toContain('1 / 1')
  expect(wrapper.text()).toContain('已解决')
  expect(wrapper.text()).not.toContain('resolved')

  await wrapper.get('[data-testid="miss-reopen"]').trigger('click')
  await flushPromises()
  expect(wrapper.get('.knowledge-alert').text()).toContain('已重新打开')
  expect(fake.command).toHaveBeenLastCalledWith({
    type: 'update-miss',
    missId: resolved!.id,
    status: 'open',
  })
  await wrapper.get('[data-testid="miss-filter-open"]').trigger('click')
  await flushPromises()
  expect(wrapper.text()).toContain(resolved!.question)
  wrapper.unmount()
})

it('disables the acting miss while updating, prevents duplicate commands and removes a resolved item from open', async () => {
  const repository = repositoryFixture()
  seedMisses(repository, 3)
  const target = repository.listMisses({ storeId: 'a', status: 'open', limit: 1 }).items[0]!
  const pending = deferred<unknown>()
  const { wrapper } = await mountManager(repository)
  await button(wrapper, '待学问题 1').trigger('click')
  await flushPromises()
  const command = fake.command.getMockImplementation()!
  fake.command.mockImplementationOnce(() => pending.promise)

  const resolve = wrapper.get('[data-testid="miss-resolve"]')
  await resolve.trigger('click')
  await flushPromises()
  expect(resolve.attributes('disabled')).toBeDefined()
  expect(resolve.text()).toContain('处理中')
  await resolve.trigger('click')
  await flushPromises()
  expect(fake.command).toHaveBeenCalledTimes(1)

  pending.resolve(
    repository.execute({ type: 'update-miss', missId: target.id, status: 'resolved' }),
  )
  await flushPromises()
  fake.command.mockImplementation(command)
  expect(wrapper.get('.knowledge-alert').text()).toContain('已标记为已解决')
  expect(wrapper.get('.knowledge-content').text()).not.toContain(target.question)
  expect(wrapper.get('.knowledge-tabs').text()).toContain('待学问题 0')
  expect(wrapper.text()).toContain('不会生成或发布答案')
  wrapper.unmount()
})

it('reports a failed update without pretending success or removing the open item', async () => {
  const repository = repositoryFixture()
  seedMisses(repository, 3)
  const target = repository.listMisses({ storeId: 'a', status: 'open', limit: 1 }).items[0]!
  const { wrapper } = await mountManager(repository)
  await button(wrapper, '待学问题 1').trigger('click')
  await flushPromises()
  fake.command.mockRejectedValueOnce(Error('写入失败'))

  await wrapper.get('[data-testid="miss-resolve"]').trigger('click')
  await flushPromises()
  expect(wrapper.get('.knowledge-alert.error').text()).toContain('写入失败')
  expect(wrapper.get('.knowledge-content').text()).toContain(target.question)
  expect(wrapper.text()).not.toContain('已标记为已解决')
  expect(wrapper.get('[data-testid="miss-resolve"]').attributes('disabled')).toBeUndefined()
  wrapper.unmount()
})

it('resets the miss filter and keeps late results from polling a newly selected store', async () => {
  const repository = repositoryFixture()
  seedMisses(repository, 3)
  const target = repository.listMisses({ storeId: 'a', status: 'open', limit: 1 }).items[0]!
  const pending = deferred<unknown>()
  const { wrapper } = await mountManager(repository)
  await button(wrapper, '待学问题 1').trigger('click')
  await flushPromises()
  await wrapper.get('[data-testid="miss-filter-resolved"]').trigger('click')
  await flushPromises()
  await wrapper.get('[data-testid="miss-filter-open"]').trigger('click')
  await flushPromises()
  const command = fake.command.getMockImplementation()!
  fake.command.mockImplementationOnce(() => pending.promise)

  await wrapper.get('[data-testid="miss-resolve"]').trigger('click')
  await flushPromises()
  const listener = fake.onContext.mock.calls[0]![0] as (context: {
    workspaceId: string
    storeId: string
    revision: number
  }) => void
  listener({ workspaceId: 'w', storeId: 'b', revision: 2 })
  await flushPromises()
  pending.resolve(
    repository.execute({ type: 'update-miss', missId: target.id, status: 'resolved' }),
  )
  await flushPromises()
  fake.command.mockImplementation(command)

  expect((wrapper.get('[data-testid="knowledge-store"]').element as HTMLSelectElement).value).toBe(
    'b',
  )
  expect(wrapper.find('.knowledge-alert.error').exists()).toBe(false)
  expect(wrapper.text()).not.toContain('店铺或账号已改变')
  await button(wrapper, '待学问题 0').trigger('click')
  await flushPromises()
  expect(wrapper.get('[data-testid="miss-filter-open"]').classes()).toContain('active')
  wrapper.unmount()
})

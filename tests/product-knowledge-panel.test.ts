import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import ElementPlus, { ElMessageBox } from 'element-plus'
import { createRouter, createMemoryHistory } from 'vue-router'
import ShopGoodsPanel from '../src/modules/shops/components/ShopGoodsPanel.vue'
import { useRuntimeStore } from '../src/shared/state/runtime'
import { platformLearningTransportKey } from '../src/modules/knowledge'
const service = vi.hoisted(() => ({
  list: vi.fn(),
  save: vi.fn(),
  preview: vi.fn(),
  setCodes: vi.fn(),
}))
vi.mock('../src/modules/shops/services', () => ({ useProductService: () => service }))
const row = {
  id: 'p1',
  version: 1,
  updatedAt: 1,
  storeId: 's1',
  productId: 'platform-1',
  title: '测试商品',
  description: '原说明',
  specifications: '原规格',
  price: '10',
  enabled: true,
  merchantCode: 'ABC',
}
const collection = {
  start: vi.fn(),
  snapshot: vi.fn(),
  pause: vi.fn(),
  resume: vi.fn(),
  cancel: vi.fn(),
  review: vi.fn(),
}
function collectionSnapshot(status: 'running' | 'completed' | 'failed' = 'completed') {
  return {
    version: 1,
    workspaceId: '299929d3-1fba-4907-bffa-1dfcd21217dc',
    candidates: [],
    tasks: [
      {
        id: '00000000-0000-4000-8000-000000000001',
        identity: {
          storeId: 's1',
          platform: 'pdd-web',
          accountId: 'account',
          platformStoreId: 'mall',
        },
        source: 'products',
        range: { maxPages: 100, maxRecords: 10000, productStatus: 'all' },
        status,
        cursor: null,
        pages: 1,
        records: 7,
        candidates: 7,
        duplicates: 0,
        skipped: 0,
        total: 7,
        coverage: 'range-complete',
        scope: '平台商品',
        reason: '',
        error: status === 'failed' ? '平台页面读取失败' : '',
        createdAt: 1,
        updatedAt: 2,
      },
    ],
  }
}
const wrappers: ReturnType<typeof mount>[] = []
beforeEach(() => {
  vi.clearAllMocks()
  collection.start.mockResolvedValue(collectionSnapshot())
  collection.snapshot.mockResolvedValue(collectionSnapshot())
  service.list.mockResolvedValue({ revision: 1, codesRevision: 2, total: 1, items: [{ ...row }] })
  service.save.mockResolvedValue(row)
  service.setCodes.mockResolvedValue({ revision: 3 })
})
afterEach(() => {
  for (const w of wrappers.splice(0)) w.unmount()
  document.body.innerHTML = ''
  vi.useRealTimers()
})
async function setup() {
  const pinia = createPinia()
  setActivePinia(pinia)
  const runtime = useRuntimeStore()
  runtime.available = true
  runtime.snapshot.workspaceId = '299929d3-1fba-4907-bffa-1dfcd21217dc'
  runtime.snapshot.stores = ['s1', 's2'].map((id) => ({
    id,
    storeName: id === 's1' ? '甲店' : '乙店',
    platform: 'pdd-web',
    group: '',
    aiEnabled: false,
    runtime: { open: true, online: true },
  }))
  runtime.selectedStoreId = 's1'
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/shop/manage', component: { template: '<div />' } }],
  })
  await router.push('/shop/manage?panel=goods')
  const wrapper = mount(ShopGoodsPanel, {
    attachTo: document.body,
    global: {
      plugins: [pinia, ElementPlus, router],
      provide: { [platformLearningTransportKey as symbol]: collection },
    },
  })
  wrappers.push(wrapper)
  await flushPromises()
  return { wrapper, runtime, router }
}
it('紧凑商品页移除重复标题和店铺选择，采集位于新增左侧并真实开始而非只跳转', async () => {
  const { wrapper, router } = await setup()
  expect(wrapper.findAll('.el-table')).toHaveLength(1)
  expect(wrapper.find('.goods-heading').exists()).toBe(false)
  expect(wrapper.find('.goods-store').exists()).toBe(false)
  expect(wrapper.find('[aria-label="当前店铺"]').exists()).toBe(false)
  expect(wrapper.text()).toContain('已启用')
  const tools = wrapper
    .get('.goods-tools')
    .findAll('button')
    .map((button) => button.text())
  expect(tools.indexOf('采集平台商品')).toBeLessThan(tools.indexOf('新增商品知识'))
  await wrapper.get('[data-goods-learn]').trigger('click')
  await flushPromises()
  expect(collection.start).toHaveBeenCalledWith({
    workspaceId: '299929d3-1fba-4907-bffa-1dfcd21217dc',
    storeId: 's1',
    source: 'products',
    range: { maxPages: 100, maxRecords: 10000, productStatus: 'all' },
  })
  expect(router.currentRoute.value.query.panel).toBe('goods')
  expect(wrapper.text()).toContain('采集完成')
  expect(wrapper.text()).toContain('1 页 / 7 条')
  expect(service.list).toHaveBeenCalledTimes(2)
})
it('采集失败明确显示原因，恢复可点击状态', async () => {
  collection.start.mockResolvedValue(collectionSnapshot('failed'))
  const { wrapper } = await setup()
  await wrapper.get('[data-goods-learn]').trigger('click')
  await flushPromises()
  expect(wrapper.get('[aria-label="商品采集进度"]').text()).toContain('平台页面读取失败')
  expect(wrapper.get('[data-goods-learn]').attributes('disabled')).toBeUndefined()
  expect(service.list).toHaveBeenCalledTimes(2)
})
it('空商品列表说明直接采集入列，无进度时预留分页空间', async () => {
  service.list.mockResolvedValue({ revision: 1, codesRevision: 2, total: 0, items: [] })
  const { wrapper } = await setup()
  expect(wrapper.get('.goods-table-empty').text()).toContain('点击“采集平台商品”将实际商品加入列表')
  expect(wrapper.text()).not.toContain('平台采集结果请到候选审核查看')
  expect(wrapper.getComponent({ name: 'ElTable' }).props('height')).toBe(
    'max(220px, calc(100vh - 380px))',
  )
})
it('采集中禁止重复点击，切店后丢弃迟到的采集结果', async () => {
  let resolve!: (value: unknown) => void
  collection.start.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done
      }),
  )
  const { wrapper, runtime } = await setup()
  await wrapper.get('[data-goods-learn]').trigger('click')
  expect(wrapper.get('[data-goods-learn]').attributes('disabled')).toBeDefined()
  await wrapper.get('[data-goods-learn]').trigger('click')
  expect(collection.start).toHaveBeenCalledTimes(1)
  runtime.selectedStoreId = 's2'
  await flushPromises()
  resolve(collectionSnapshot())
  await flushPromises()
  expect(wrapper.find('[aria-label="商品采集进度"]').exists()).toBe(false)
  expect(service.list).toHaveBeenLastCalledWith('s2', 1, {
    pageSize: 20,
    query: '',
    merchantCode: '',
  })
})
it('运行任务轮询至完成并刷新列表，卸载后不继续轮询', async () => {
  const { wrapper } = await setup()
  vi.useFakeTimers()
  collection.start.mockResolvedValue(collectionSnapshot('running'))
  await wrapper.get('[data-goods-learn]').trigger('click')
  await flushPromises()
  expect(wrapper.text()).toContain('正在采集')
  await vi.advanceTimersByTimeAsync(1000)
  await flushPromises()
  expect(collection.snapshot).toHaveBeenCalledTimes(1)
  expect(wrapper.text()).toContain('采集完成')
  wrapper.unmount()
  await vi.advanceTimersByTimeAsync(2000)
  expect(collection.snapshot).toHaveBeenCalledTimes(1)
})
it('查询向服务传全店筛选条件，重置恢复第一页，分页清除勾选', async () => {
  const { wrapper } = await setup()
  await wrapper.get('input[aria-label="商品名称或平台编号"]').setValue('新名称')
  await wrapper.get('input[aria-label="商家编码筛选"]').setValue('XM')
  await wrapper.get('[data-goods-query]').trigger('submit')
  await flushPromises()
  expect(service.list).toHaveBeenLastCalledWith('s1', 1, {
    pageSize: 20,
    query: '新名称',
    merchantCode: 'XM',
  })
  await wrapper.get('[data-goods-reset]').trigger('click')
  await flushPromises()
  expect(service.list).toHaveBeenLastCalledWith('s1', 1, {
    pageSize: 20,
    query: '',
    merchantCode: '',
  })
})
it('取消删除不执行任何删除命令', async () => {
  const { wrapper, runtime } = await setup()
  const run = vi.spyOn(runtime, 'run')
  vi.spyOn(ElMessageBox, 'confirm').mockRejectedValue('cancel')
  await wrapper.get('[data-product-delete="p1"]').trigger('click')
  await flushPromises()
  expect(run).not.toHaveBeenCalled()
})
it('商家编码独立保存，保留平台商品编号与编码修订号', async () => {
  const { wrapper } = await setup()
  await wrapper.get('[data-product-code="p1"]').trigger('click')
  await flushPromises()
  const input = document.querySelector<HTMLInputElement>('input[aria-label="商家编码 platform-1"]')!
  expect(input).toBeTruthy()
  input.value = 'XM-YSP'
  input.dispatchEvent(new Event('input', { bubbles: true }))
  await flushPromises()
  ;(document.querySelector('[data-save-codes]') as HTMLButtonElement).click()
  await flushPromises()
  expect(service.setCodes).toHaveBeenCalledWith('s1', {
    revision: 2,
    rows: [{ id: 'p1', version: 1, merchantCode: 'XM-YSP' }],
    confirmed: true,
  })
  expect(service.save).not.toHaveBeenCalled()
})
it('批量编辑只改勾选字段，部分失败准确列出，不重试成功项', async () => {
  service.list.mockResolvedValue({
    revision: 1,
    codesRevision: 2,
    total: 2,
    items: [{ ...row }, { ...row, id: 'p2', productId: 'platform-2', title: '第二商品' }],
  })
  const { wrapper } = await setup()
  const table = wrapper.findComponent({ name: 'ElTable' })
  ;(table.vm as unknown as { toggleAllSelection(): void }).toggleAllSelection()
  await flushPromises()
  await vi.waitFor(() => expect(wrapper.text()).toContain('已选 2 项'))
  const button = wrapper.findAll('button').find((b) => b.text() === '批量编辑')!
  expect(button.attributes('disabled')).toBeUndefined()
  await button.trigger('click')
  await flushPromises()
  const checkbox = Array.from(document.querySelectorAll('.batch-fields label'))
    .find((l) => l.textContent?.includes('修改价格资料'))!
    .querySelector<HTMLInputElement>('input[type=checkbox]')!
  checkbox.click()
  const price = document.querySelector<HTMLInputElement>('input[aria-label="批量价格资料"]')!
  price.value = '20'
  price.dispatchEvent(new Event('input', { bubbles: true }))
  service.save
    .mockRejectedValueOnce(new Error('版本冲突'))
    .mockResolvedValueOnce({ ...row, id: 'p2' })
  ;(document.querySelector('[data-save-batch]') as HTMLButtonElement).click()
  await flushPromises()
  expect(service.save).toHaveBeenCalledTimes(2)
  expect(service.save.mock.calls[0][1]).toMatchObject({
    price: '20',
    description: '原说明',
    specifications: '原规格',
    title: '测试商品',
  })
  expect(wrapper.get('[aria-label="批量操作结果"]').text()).toContain('版本冲突')
  expect(wrapper.text()).toContain('成功 1 项，失败 1 项，未执行 0 项')
})
it('切店后丢弃旧请求，清理勾选和筛选', async () => {
  const { wrapper, runtime } = await setup()
  let resolveOld: (value: unknown) => void = () => {}
  service.list.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        resolveOld = resolve
      }),
  )
  await wrapper.get('input[aria-label="商品名称或平台编号"]').setValue('旧搜索')
  await wrapper.get('[data-goods-query]').trigger('submit')
  service.list.mockResolvedValue({ revision: 2, codesRevision: 0, total: 0, items: [] })
  runtime.selectedStoreId = 's2'
  await flushPromises()
  resolveOld({ revision: 1, codesRevision: 2, total: 1, items: [row] })
  await flushPromises()
  expect(service.list).toHaveBeenLastCalledWith('s2', 1, {
    pageSize: 20,
    query: '',
    merchantCode: '',
  })
  expect(wrapper.text()).not.toContain('测试商品')
  expect(
    (wrapper.get('input[aria-label="商品名称或平台编号"]').element as HTMLInputElement).value,
  ).toBe('')
  expect(wrapper.text()).toContain('已选 0 项')
})
it('保存商品失败时保留编辑草稿与明确错误', async () => {
  const { wrapper } = await setup()
  await wrapper.get('[data-product-edit="p1"]').trigger('click')
  await flushPromises()
  const input = document.querySelector<HTMLInputElement>('input[aria-label="商品名称"]')!
  input.value = '未保存标题'
  input.dispatchEvent(new Event('input', { bubbles: true }))
  service.save.mockRejectedValueOnce(new Error('磁盘不可写'))
  document
    .querySelector<HTMLFormElement>('.goods-editor')!
    .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  await flushPromises()
  expect(document.querySelector<HTMLInputElement>('input[aria-label="商品名称"]')!.value).toBe(
    '未保存标题',
  )
  expect(document.body.textContent).toContain('磁盘不可写')
})
it('翻页清空本页勾选，不把上一页选择带入后续批量操作', async () => {
  service.list.mockResolvedValue({ revision: 1, codesRevision: 2, total: 50, items: [{ ...row }] })
  const { wrapper } = await setup()
  const table = wrapper.findComponent({ name: 'ElTable' })
  ;(table.vm as unknown as { toggleAllSelection(): void }).toggleAllSelection()
  await vi.waitFor(() => expect(wrapper.text()).toContain('已选 1 项'))
  wrapper.findComponent({ name: 'ElPagination' }).vm.$emit('current-change', 2)
  await flushPromises()
  expect(service.list).toHaveBeenLastCalledWith('s1', 2, {
    pageSize: 20,
    query: '',
    merchantCode: '',
  })
  expect(wrapper.text()).toContain('已选 0 项')
})
it('批量执行中切换账号时停止剩余商品，不在新账号显示旧结果', async () => {
  service.list.mockResolvedValue({
    revision: 1,
    codesRevision: 2,
    total: 2,
    items: [{ ...row }, { ...row, id: 'p2', productId: 'platform-2' }],
  })
  const { wrapper, runtime } = await setup()
  ;(
    wrapper.findComponent({ name: 'ElTable' }).vm as unknown as { toggleAllSelection(): void }
  ).toggleAllSelection()
  await vi.waitFor(() => expect(wrapper.text()).toContain('已选 2 项'))
  await wrapper
    .findAll('button')
    .find((b) => b.text() === '批量编辑')!
    .trigger('click')
  await flushPromises()
  const checkbox = Array.from(document.querySelectorAll('.batch-fields label'))
    .find((l) => l.textContent?.includes('修改使用状态'))!
    .querySelector<HTMLInputElement>('input[type=checkbox]')!
  checkbox.click()
  let finish: (value: unknown) => void = () => {}
  service.save.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve
      }),
  )
  ;(document.querySelector('[data-save-batch]') as HTMLButtonElement).click()
  await flushPromises()
  expect(service.save).toHaveBeenCalledTimes(1)
  runtime.snapshot.workspaceId = '399929d3-1fba-4907-bffa-1dfcd21217dc'
  service.list.mockResolvedValue({ revision: 2, codesRevision: 0, total: 0, items: [] })
  await flushPromises()
  finish(row)
  await flushPromises()
  expect(service.save).toHaveBeenCalledTimes(1)
  expect(wrapper.find('[aria-label="批量操作结果"]').exists()).toBe(false)
})

it('仍在采集时卸载页面会撤销本地轮询', async () => {
  const { wrapper } = await setup()
  vi.useFakeTimers()
  collection.start.mockResolvedValue(collectionSnapshot('running'))
  await wrapper.get('[data-goods-learn]').trigger('click')
  await flushPromises()
  wrapper.unmount()
  await vi.advanceTimersByTimeAsync(2000)
  expect(collection.snapshot).not.toHaveBeenCalled()
})

it('同一毫秒创建的历史任务不会遮住本次新任务', async () => {
  const { wrapper } = await setup()
  vi.useFakeTimers()
  const snapshot = collectionSnapshot('running')
  const latest = { ...snapshot.tasks[0], id: '00000000-0000-4000-8000-000000000002' }
  snapshot.tasks = [{ ...snapshot.tasks[0], status: 'completed' }, latest]
  collection.start.mockResolvedValue(snapshot)
  await wrapper.get('[data-goods-learn]').trigger('click')
  await flushPromises()
  expect(wrapper.text()).toContain('正在采集')
  expect(wrapper.get('[data-goods-learn]').attributes('disabled')).toBeDefined()
})

import { afterEach, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import ShopHomePanel from '../src/modules/shops/components/ShopHomePanel.vue'
import { useRuntimeStore } from '../src/shared/state/runtime'
import { emptySnapshot, type BackendResult } from '../src/shared/contracts/backend'
import { downloadText } from '../src/shared/platform/files'
import { emptyReportingCounts } from '../src/shared/contracts/reporting'

vi.mock('../src/shared/platform/files', () => ({ downloadText: vi.fn() }))

it('marks observed report scope and keeps buyer details out of the actual export action', async () => {
  const { wrapper, runtime } = await fixture()
  const now = Date.now()
  const report = {
    start: now - 1,
    end: now + 1,
    observedSince: now,
    persistence: 'ready' as const,
    truncated: false,
    source: 'local-observed-events' as const,
    complete: false as const,
    real: { ...emptyReportingCounts(), 'ai-sent': 3 },
    simulated: { ...emptyReportingCounts(), 'ai-sent': 777 },
  }
  runtime.snapshot.reporting = {
    today: report,
    yesterday: report,
    week: report,
    month: report,
    aftersales: [
      {
        storeId: 'a',
        platform: 'pdd-web',
        status: 'success',
        complete: true,
        total: 2,
        observed: 2,
        lastSyncedAt: now,
        scope: 'current-merchant-pending',
      },
    ],
  }
  runtime.snapshot.conversations = [
    {
      storeId: 'a',
      uid: 'PRIVATE_UID',
      name: 'PRIVATE_NAME',
      status: 'pending',
      messages: [{ from: 'buyer', content: 'PRIVATE_BODY', ts: now }],
    },
  ]
  await flushPromises()
  expect(wrapper.get('[data-report-scope]').text()).toContain('不代表平台完整数据')
  expect(wrapper.get('[data-metric="aftersale"]').text()).toContain('非周期新增')
  await wrapper.get('[data-action="export"]').trigger('click')
  const payload = vi.mocked(downloadText).mock.calls.at(-1)?.[1] || ''
  expect(payload).not.toMatch(/PRIVATE_UID|PRIVATE_NAME|PRIVATE_BODY/)
  expect(JSON.parse(payload).observedEvents.simulated['ai-sent']).toBe(777)
  runtime.snapshot.managed.active.mode = 'managed'
  runtime.snapshot.managed.restartRequired = true
  await flushPromises()
  expect(wrapper.text()).not.toContain('777')
  expect(wrapper.get('[data-action="export"]').attributes('disabled')).toBeDefined()
  wrapper.unmount()
})
afterEach(() => {
  vi.useRealTimers()
  document.body.innerHTML = ''
})
async function fixture(available = true) {
  setActivePinia(createPinia())
  const runtime = useRuntimeStore()
  runtime.available = available
  runtime.snapshot.workspaceId = available ? 'one' : ''
  runtime.snapshot.stores = [
    {
      id: 'a',
      storeName: '真实店铺',
      platform: 'pdd-web',
      group: '',
      aiEnabled: false,
      runtime: { online: false, open: false },
    },
  ]
  const run = vi
    .spyOn(runtime, 'run')
    .mockResolvedValue({ status: 'ok', message: '', data: { packs: [], revision: 0 } })
  const refresh = vi.spyOn(runtime, 'refresh').mockResolvedValue()
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/:pathMatch(.*)*', component: { template: '<div />' } }],
  })
  await router.push('/shop/manage?panel=home')
  const wrapper = mount(ShopHomePanel, { global: { plugins: [router] } })
  await flushPromises()
  return { runtime, run, refresh, router, wrapper }
}
it('renders screenshot sections with real zeros and explicit unavailable metrics', async () => {
  const { wrapper, run } = await fixture()
  expect(wrapper.text()).toContain('实时值守')
  expect(wrapper.text()).toContain('待回积压店铺')
  expect(wrapper.text()).toContain('风险待办')
  expect(wrapper.get('[data-metric="pending"]').text()).toContain('0')
  expect(wrapper.get('[data-metric="aftersale"]').text()).toContain('未接入')
  expect(wrapper.get('[data-metric="coverage"]').text()).toContain('0/1')
  expect(run).toHaveBeenCalledOnce()
  wrapper.unmount()
})
it('preview never presents fabricated zero metrics or starts desktop commands', async () => {
  const { wrapper, run } = await fixture(false)
  expect(wrapper.text()).toContain('界面预览')
  expect(wrapper.get('[data-metric="pending"]').text()).toContain('—')
  expect(wrapper.get('[data-action="export"]').attributes('disabled')).toBeDefined()
  expect(run).not.toHaveBeenCalled()
  wrapper.unmount()
})
it('partial failure is visible and preserves last successful coverage as old data', async () => {
  const { wrapper, run } = await fixture()
  run.mockRejectedValueOnce(new Error('知识读取失败'))
  await wrapper.get('[data-action="refresh"]').trigger('click')
  await flushPromises()
  expect(wrapper.text()).toContain('知识读取失败')
  expect(wrapper.get('[data-metric="coverage"]').text()).toContain('上次读取')
  await wrapper.get('[data-action="export"]').trigger('click')
  const payload = JSON.parse(vi.mocked(downloadText).mock.calls.at(-1)?.[1] ?? '{}')
  expect(payload.freshness.stale).toBe(true)
  expect(payload.freshness.errors).toEqual(['意图包读取失败'])
  expect(JSON.stringify(payload)).not.toContain('知识读取失败')
  wrapper.unmount()
})
it('discards previous workspace intent results and prevents repeated snapshot refresh loops', async () => {
  const { wrapper, runtime, run } = await fixture()
  let resolve: ((value: BackendResult) => void) | undefined
  run.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done
      }),
  )
  await wrapper.get('[data-action="refresh"]').trigger('click')
  await flushPromises()
  runtime.snapshot = { ...emptySnapshot(), workspaceId: 'two' }
  await flushPromises()
  resolve?.({
    status: 'ok',
    message: '',
    data: {
      revision: 0,
      packs: [
        {
          id: 'p',
          version: 1,
          name: 'old',
          enabled: true,
          storeIds: ['a'],
          productIds: [],
          entries: [{ question: 'q', keywords: [], answer: 'a', enabled: true }],
        },
      ],
    },
  })
  await flushPromises()
  expect(wrapper.get('[data-metric="coverage"]').text()).toContain('0/0')
  expect(run.mock.calls.length).toBe(3)
  wrapper.unmount()
})
it('keeps real-time metrics while selecting period and exports only aggregate scope', async () => {
  const { wrapper } = await fixture()
  await wrapper.get('[data-period="yesterday"]').trigger('click')
  expect(wrapper.get('[data-metric="pending"]').text()).toContain('0')
  await wrapper.get('[data-action="export"]').trigger('click')
  expect(downloadText).toHaveBeenCalledWith(
    expect.stringContaining('.json'),
    expect.stringContaining('非完整经营报表'),
  )
  const payload = JSON.parse(vi.mocked(downloadText).mock.calls.at(-1)?.[1] ?? '{}')
  expect(payload.period).toBe('昨天')
  expect(payload.unavailable).toContain('平台售后')
  wrapper.unmount()
})
it('risk navigation uses current panels and backlog selects store before auxiliary navigation', async () => {
  const { wrapper, runtime, router } = await fixture()
  await wrapper.get('[data-risk="offline"]').trigger('click')
  await flushPromises()
  expect(router.currentRoute.value.query.panel).toBe('shops')
  runtime.snapshot.conversations.push({
    storeId: 'a',
    uid: 'u',
    name: '',
    status: 'pending',
    messages: [],
  })
  await flushPromises()
  await wrapper.get('[data-backlog="a"]').trigger('click')
  await flushPromises()
  expect(runtime.selectedStoreId).toBe('a')
  expect(router.currentRoute.value.path).toBe('/float/assist')
  wrapper.unmount()
})
it('aggregate cards select the store with the matching problem instead of an unrelated selected store', async () => {
  const { wrapper, runtime } = await fixture()
  runtime.snapshot.stores[0]!.runtime.online = true
  runtime.snapshot.welcomeByStore.a = { enabled: true, text: '欢迎', version: 1 }
  runtime.snapshot.stores.push({
    id: 'b',
    storeName: '待办店',
    platform: 'pdd-web',
    group: '',
    aiEnabled: false,
    runtime: { online: false, open: false },
  })
  runtime.snapshot.conversations.push({
    storeId: 'b',
    uid: 'b',
    name: '',
    status: 'pending',
    messages: [],
  })
  runtime.selectedStoreId = 'a'
  await flushPromises()
  await wrapper.get('[data-metric="pending"]').trigger('click')
  expect(runtime.selectedStoreId).toBe('b')
  runtime.selectedStoreId = 'a'
  await wrapper.get('[data-risk="offline"]').trigger('click')
  expect(runtime.selectedStoreId).toBe('b')
  runtime.selectedStoreId = 'a'
  await wrapper.get('[data-risk="welcome"]').trigger('click')
  expect(runtime.selectedStoreId).toBe('b')
  wrapper.unmount()
})
it('masked managed workspace never appears as true zero and recovers with the same workspace id', async () => {
  const { wrapper, runtime, run } = await fixture()
  runtime.snapshot.managed.active.mode = 'managed'
  runtime.snapshot.capabilities.modelMode = 'managed'
  await flushPromises()
  expect(wrapper.get('[data-metric="pending"]').text()).toContain('—')
  expect(wrapper.get('[data-action="export"]').attributes('disabled')).toBeDefined()
  expect(wrapper.text()).toContain('托管工作区尚不可用')
  runtime.snapshot.managed.session.account = {
    userId: 1,
    displayName: '测试',
    trial: { limit: 1, used: 0, reserved: 0, remaining: 1, expiresAt: Date.now() / 1000 + 1000 },
  }
  runtime.snapshot.managed.session.status = 'offline'
  await flushPromises()
  expect(wrapper.get('[data-metric="pending"]').text()).toContain('0')
  expect(wrapper.get('[data-metric="quota"]').text()).toContain('—')
  expect(run.mock.calls.length).toBe(2)
  runtime.snapshot.managed.restartRequired = true
  await flushPromises()
  expect(wrapper.get('[data-metric="pending"]').text()).toContain('—')
  expect(wrapper.text()).toContain('请重启客户端')
  wrapper.unmount()
})
it('snapshot replacement after each command does not create an intent refresh loop', async () => {
  const { wrapper, runtime, run } = await fixture()
  let reads = 0
  run.mockImplementation(async () => {
    // A bound limits the regression test itself if the old watcher starts looping.
    if (++reads < 5) runtime.snapshot = { ...runtime.snapshot }
    return { status: 'ok', message: '', data: { packs: [], revision: 0 } }
  })
  await wrapper.get('[data-action="refresh"]').trigger('click')
  await flushPromises()
  expect(reads).toBe(1)
  expect(run.mock.calls.length).toBe(2)
  expect(wrapper.get('[data-action="refresh"]').attributes('disabled')).toBeUndefined()
  wrapper.unmount()
})

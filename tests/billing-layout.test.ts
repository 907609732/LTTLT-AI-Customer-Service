import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import ElementPlus from 'element-plus'
import BillingDashboard from '../src/modules/billing/components/BillingDashboard.vue'
import { billingTransportKey } from '../src/modules/billing/services'
import DashboardView from '../src/modules/workbench/components/DashboardView.vue'
import { createRouter, createMemoryHistory } from 'vue-router'
import { servicesKey } from '../src/shared/contracts/services'
import { createDemoServices } from '../src/app/services'
import { useRuntimeStore } from '../src/shared/state/runtime'

const pool = { limit: 100, used: 20, reserved: 1, remaining: 79, expires_at: 2000000000 }
const plan = {
  id: 'p',
  name: '体验包 · 小小心意',
  currency: 'cny',
  amount: 990,
  calls: 1000,
  valid_days: 365,
}
const order = { id: 'order_1', plan, state: 'paid', channel: 'alipay', created_at: 1, paid_at: 2 }
function setup(state = 'paid', compact = false) {
  const pinia = createPinia()
  setActivePinia(pinia)
  const runtime = useRuntimeStore()
  runtime.snapshot.managed.active.mode = 'managed'
  runtime.snapshot.managed.session.status = 'signed_in'
  runtime.snapshot.managed.session.account = {
    userId: 1,
    displayName: 'A',
    trial: { limit: 100, used: 20, reserved: 1, remaining: 79, expiresAt: 2000000000 },
  }
  const run = vi.spyOn(runtime, 'run').mockResolvedValue({ status: 'ok', message: '', data: {} })
  const request = vi.fn(async (_method: string, path: string) =>
    path.endsWith('/orders')
      ? { orders: [{ ...order, state }] }
      : {
          ready: true,
          reason: '',
          plans: [
            plan,
            { ...plan, id: 'support_100000', name: '共创支持包', amount: 100000, calls: 100000 },
          ],
          channels: [{ id: 'alipay', ready: true, reason: '' }],
          quota: { trial: pool, paid: pool, remaining: 158 },
        },
  )
  const wrapper = mount(BillingDashboard, {
    attachTo: document.body,
    props: { section: compact ? 'orders' : 'plans', compact },
    global: {
      plugins: [pinia, ElementPlus],
      provide: {
        [billingTransportKey as symbol]: { request, openCheckout: vi.fn() },
      },
    },
  })
  return { wrapper, runtime, request, run }
}
const wrappers: ReturnType<typeof setup>['wrapper'][] = []
afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount())
  vi.restoreAllMocks()
})
describe('简化充值页', () => {
  it('首页支持我们入口导航到充值页', async () => {
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/', component: { template: '<div />' } },
        { path: '/shop/recharge', component: { template: '<div />' } },
      ],
    })
    await router.push('/')
    const wrapper = mount(DashboardView, {
      global: {
        plugins: [router, ElementPlus],
        provide: { [servicesKey as symbol]: createDemoServices() },
        stubs: { AddShopDialog: true, ContactQrTrigger: true },
      },
    })
    wrappers.push(wrapper)
    const support = wrapper.get('.home-support-card')
    expect(support.text()).toContain('您的支持是我们的动力')
    await support.trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/shop/recharge')
  })
  it('千元套餐使用金色卡片，展示一对一服务并进入对应收银台', async () => {
    const { wrapper, request } = setup()
    wrappers.push(wrapper)
    await flushPromises()
    const card = wrapper.get('.billing-plan--premium')
    expect(card.text()).toContain('¥1000.00')
    expect(card.text()).toContain('一对一客服')
    expect(card.text()).toContain('程序开发者一对一对接')
    await card.get('button').trigger('click')
    expect(wrapper.get('[role="dialog"]').text()).toContain('共创支持包')
    expect(request.mock.calls.every((call) => call[0] !== 'POST')).toBe(true)
  })
  it('默认收起明细与已完成记录，仅保留统一刷新，并展示支持开源文案', async () => {
    const { wrapper, request, run } = setup()
    wrappers.push(wrapper)
    await flushPromises()
    expect(wrapper.get('.quota-remaining').text()).toContain('158')
    expect(wrapper.get('.quota-details').isVisible()).toBe(false)
    expect(wrapper.get('.orders-content').isVisible()).toBe(false)
    expect(wrapper.text()).toContain('帮助灵兔开源项目加快开发与完善')
    const buttons = wrapper.findAll('button')
    expect(buttons.filter((b) => b.text().includes('刷新'))).toHaveLength(1)
    await wrapper.get('[aria-controls="billing-quota-details"]').trigger('click')
    expect(wrapper.get('.quota-details').isVisible()).toBe(true)
    await wrapper.get('[aria-controls="billing-orders-content"]').trigger('click')
    expect(wrapper.get('.orders-content').isVisible()).toBe(true)
    request.mockClear()
    run.mockClear()
    await buttons.find((b) => b.text() === '刷新')!.trigger('click')
    await flushPromises()
    expect(request.mock.calls.map((call) => call[1])).toEqual([
      '/api/client/billing',
      '/api/client/billing/orders',
    ])
    expect(run).toHaveBeenCalledOnce()
    run.mockRejectedValueOnce(new Error('offline'))
    await buttons.find((b) => b.text() === '刷新')!.trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('额度可能未更新')
  })
  it.each(['pending', 'reconciling'])('自动展开%s订单，切账号时重置明细', async (state) => {
    const { wrapper, runtime } = setup(state)
    wrappers.push(wrapper)
    await flushPromises()
    expect(wrapper.get('.orders-content').isVisible()).toBe(true)
    expect(wrapper.text()).toContain('查询 / 继续支付')
    await wrapper.get('[aria-controls="billing-quota-details"]').trigger('click')
    runtime.snapshot.managed.session.account!.userId = 2
    await flushPromises()
    expect(wrapper.get('.quota-details').isVisible()).toBe(false)
  })
  it('账户弹窗直接显示订单且不出现套餐或支付操作', async () => {
    const { wrapper, request } = setup('pending', true)
    wrappers.push(wrapper)
    await flushPromises()
    expect(wrapper.get('.orders-content').isVisible()).toBe(true)
    expect(wrapper.text()).not.toContain('选择套餐')
    expect(wrapper.text()).not.toContain('继续支付')
    expect(request.mock.calls.every((call) => call[1].endsWith('/orders'))).toBe(true)
  })
})

import { afterEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import ElementPlus from 'element-plus'
import BillingDashboard from '../src/modules/billing/components/BillingDashboard.vue'
import { billingTransportKey, type BillingTransport } from '../src/modules/billing/services'
import DashboardView from '../src/modules/workbench/components/DashboardView.vue'
import { createRouter, createMemoryHistory } from 'vue-router'
import { servicesKey } from '../src/shared/contracts/services'
import { createDemoServices } from '../src/app/services'
import { useRuntimeStore } from '../src/shared/state/runtime'

const pool = { limit: 100, used: 20, reserved: 1, remaining: 79, expires_at: 2000000000 }
const experience = {
  id: 'usage_1000',
  name: '体验包 · 小小心意',
  currency: 'cny',
  amount: 990,
  list_amount: 1000,
  calls: 1000,
  valid_days: 365,
}
const standard = {
  id: 'usage_10000',
  name: '标准包 · 支持一份',
  currency: 'cny',
  amount: 10000,
  list_amount: 10000,
  calls: 20000,
  valid_days: 365,
}
const support = {
  id: 'support_100000',
  name: '共创支持包',
  currency: 'cny',
  amount: 100000,
  calls: 300000,
  valid_days: 365,
  permanent: true,
}
// 已创建订单继续使用下单时的快照，不随目录额度更新。
const legacyStandard = { ...standard, calls: 10000 }
interface TestOrder {
  id: string
  plan: {
    id: string
    name: string
    currency: string
    amount: number
    list_amount?: number
    calls: number
    valid_days: number
    permanent?: boolean
  }
  state: string
  channel: string
  created_at: number
  paid_at: number
}
const order: TestOrder = {
  id: 'order_1',
  plan: legacyStandard,
  state: 'paid',
  channel: 'alipay',
  created_at: 1,
  paid_at: 2,
}
// 稳定 ID 不变但额度已调整：旧待付订单仍是 100000 次。
const legacySupportOrder: TestOrder = {
  ...order,
  id: 'order_support',
  plan: { ...support, calls: 100000 },
  state: 'pending',
}
const defaultPlans = [experience, standard, support]
function setup(
  state = 'paid',
  compact = false,
  snapshot: TestOrder = order,
  availablePlans = defaultPlans,
) {
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
  const request = vi.fn<BillingTransport['request']>(async (method, path, body) => {
    if (method === 'POST' && path.endsWith('/close'))
      return { order: { ...snapshot, state: 'closed' }, checkout_url: '' }
    if (method === 'POST') {
      const plan =
        body?.plan_id === 'support_100000'
          ? support
          : body?.plan_id === 'usage_10000'
            ? standard
            : experience
      return {
        order: { ...snapshot, id: 'order_new', plan, state: 'pending', paid_at: 0 },
        checkout_url: '',
        qr_code: 'weixin://test',
      }
    }
    if (path.endsWith('/orders')) return { orders: [{ ...snapshot, state }] }
    if (path.includes('/orders/'))
      return {
        order: { ...snapshot, state: 'pending' },
        checkout_url: '',
        qr_code: 'weixin://test',
      }
    return {
      ready: true,
      reason: '',
      plans: availablePlans,
      channels: [
        { id: 'alipay', ready: true, reason: '' },
        { id: 'wechat', ready: true, reason: '' },
      ],
      quota: { trial: pool, paid: pool, remaining: 158 },
    }
  })
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
  it('千元套餐使用金色卡片，展示新额度、中文读数和相对体验包增幅', async () => {
    const { wrapper, request } = setup()
    wrappers.push(wrapper)
    await flushPromises()
    const [experienceCard, standardCard, card] = wrapper.findAll('.billing-plan')
    expect(card.classes()).toContain('billing-plan--premium')
    expect(experienceCard.text()).toContain('1000（一千）次')
    expect(experienceCard.text()).toContain('¥9.90')
    expect(experienceCard.text()).not.toContain('同等金额')
    expect(standardCard.text()).toContain('20000（两万）次')
    expect(standardCard.text()).toContain('¥5.00')
    expect(standardCard.get('.plan-value-basis').text()).toBe('同等金额对比体验包')
    expect(standardCard.get('.plan-value-gain').text()).toContain('多')
    expect(standardCard.get('.plan-value strong').text()).toBe('98%')
    expect(standardCard.text()).toContain('365 天')
    expect(card.text()).toContain('¥1000.00')
    expect(card.text()).toContain('永久有效')
    expect(card.text()).toContain('300000（三十万）次')
    expect(card.text()).toContain('约¥3.33')
    expect(card.get('.plan-value strong').text()).toBe('197%')
    expect(card.text()).toContain('一对一客服')
    expect(card.text()).toContain('程序开发者一对一对接')
    await card.get('button').trigger('click')
    expect(document.querySelector('.billing-cashier-dialog')?.textContent).toContain('共创支持包')
    expect(document.querySelector('.billing-cashier-dialog')?.textContent).toContain(
      '300000（三十万）次',
    )
    expect(document.querySelector('.billing-cashier-dialog')?.textContent).toContain('永久有效')
    expect(request.mock.calls.filter((call) => call[0] === 'POST')).toHaveLength(1)
  })
  it('旧待付订单在收银台保留原额度并加中文括注', async () => {
    const { wrapper } = setup('pending')
    wrappers.push(wrapper)
    await flushPromises()
    const resume = wrapper
      .findAll('button')
      .find((button) => button.text().includes('查询 / 继续支付'))!
    await resume.trigger('click')
    await flushPromises()
    const text = document.querySelector('.billing-cashier-dialog')?.textContent ?? ''
    expect(text).toContain('标准包 · 支持一份')
    expect(text).toContain('¥100.00')
    expect(text).toContain('10000（一万）次')
    expect(text).not.toContain('20000（两万）次')
  })
  it('同 ID 旧订单额度较小时提示按原条款结算，不自动换新套餐', async () => {
    const { wrapper, request } = setup('pending', false, legacySupportOrder)
    wrappers.push(wrapper)
    await flushPromises()
    await wrapper.get('.billing-plan--premium button').trigger('click')
    await flushPromises()
    const text = document.querySelector('.billing-cashier-dialog')?.textContent ?? ''
    expect(text).toContain('仍按下单时的价格和额度结算')
    expect(text).toContain('100000（十万）次')
    expect(text).not.toContain('300000（三十万）次')
    expect(request.mock.calls.filter((call) => call[0] === 'POST')).toHaveLength(0)
    expect(request).toHaveBeenCalledWith('GET', '/api/client/billing/orders/order_support')
  })
  it('创建返回的订单快照优先于点击时的目录价格', async () => {
    const { wrapper, request } = setup()
    wrappers.push(wrapper)
    await flushPromises()
    // 目录在点击和创建之间变化：响应快照才是二维码对应的真实价格/额度。
    const changed = { ...standard, amount: 12000, calls: 24000 }
    request.mockImplementationOnce(async () => ({
      order: { ...order, id: 'order_changed', plan: changed, state: 'pending', paid_at: 0 },
      checkout_url: '',
      qr_code: 'weixin://test',
    }))
    await wrapper.findAll('.billing-plan')[1].get('button').trigger('click')
    await flushPromises()
    const text = document.querySelector('.billing-cashier-dialog')?.textContent ?? ''
    expect(text).toContain('24000（两万四千）次')
    expect(text).toContain('¥120.00')
    expect(text).not.toContain('20000（两万）次')
    expect(text).not.toContain('¥100.00')
  })
  it('关闭旧单并换渠道创建新单后不残留原订单提示', async () => {
    const { wrapper, request } = setup('pending', false, legacySupportOrder)
    wrappers.push(wrapper)
    await flushPromises()
    await wrapper.get('.billing-plan--premium button').trigger('click')
    await flushPromises()
    expect(document.querySelector('.billing-cashier-dialog')?.textContent).toContain('仍按下单时')
    const wechat = document.querySelector<HTMLInputElement>(
      '.billing-channels input[value="wechat"]',
    )!
    wechat.click()
    await flushPromises()
    const switchButton = [
      ...document.querySelectorAll<HTMLButtonElement>('.billing-cashier-dialog button'),
    ].find((button) => button.textContent?.includes('关闭原订单并切换支付方式'))!
    switchButton.click()
    await flushPromises()
    const text = document.querySelector('.billing-cashier-dialog')?.textContent ?? ''
    const posts = request.mock.calls.filter((call) => call[0] === 'POST')
    expect(posts.some((call) => call[1].endsWith('/close'))).toBe(true)
    expect(posts.some((call) => call[1] === '/api/client/billing/orders')).toBe(true)
    expect(text).toContain('300000（三十万）次')
    expect(text).not.toContain('仍按下单时')
  })
  it('额度括注和比较文案在窄卡片内换行，不顶开额度与按钮', async () => {
    const source = readFileSync('src/modules/billing/components/BillingDashboard.vue', 'utf8')
    expect(source).toMatch(/\.plan-details dd\s*\{[^}]*overflow-wrap: anywhere/)
    expect(source).toMatch(/\.plan-value\s*\{[^}]*overflow-wrap: anywhere/)
    const { wrapper } = setup()
    wrappers.push(wrapper)
    await flushPromises()
    const card = wrapper.findAll('.billing-plan')[1]
    expect(card.get('.plan-value-basis').text()).toBe('同等金额对比体验包')
    expect(card.get('.plan-value-gain').text()).toContain('多')
    expect(card.get('.plan-value strong').text()).toBe('98%')
    expect(card.get('.plan-value').text()).toContain('额度')
    expect(
      card.get('.plan-price').element.compareDocumentPosition(card.get('.plan-value').element) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
    expect(
      card.get('.plan-value').element.compareDocumentPosition(card.get('.plan-details').element) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
    expect(card.get('.plan-details').text()).toContain('20000（两万）次')
    expect(card.findAll('button')).toHaveLength(1)
  })
  it('近似增幅显示约多与小数，体验包或无正收益套餐不补空白框', async () => {
    const near = { ...standard, calls: 24001 }
    const noGain = { ...support, calls: 1100 }
    const { wrapper } = setup('paid', false, order, [experience, near, noGain])
    wrappers.push(wrapper)
    await flushPromises()
    const [experienceCard, nearCard, noGainCard] = wrapper.findAll('.billing-plan')
    expect(experienceCard.find('.plan-value').exists()).toBe(false)
    expect(nearCard.get('.plan-value-gain').text()).toContain('约多')
    expect(nearCard.get('.plan-value strong').text()).toBe('137.6%')
    expect(noGainCard.find('.plan-value').exists()).toBe(false)
    expect(noGainCard.get('.plan-details').text()).toContain('1100（一千一百）次')
  })
  it('进入充值页自动展示额度与已完成订单，仅收起额度明细', async () => {
    const { wrapper, request, run } = setup()
    wrappers.push(wrapper)
    await flushPromises()
    expect(wrapper.get('.quota-remaining').text()).toContain('158')
    expect(wrapper.get('.quota-details').isVisible()).toBe(false)
    expect(wrapper.get('.orders-content').isVisible()).toBe(true)
    expect(wrapper.find('[aria-controls="billing-orders-content"]').exists()).toBe(false)
    expect(wrapper.get('.orders-content').text()).toContain(order.plan.name)
    expect(request.mock.calls.map((call) => call[1])).toEqual([
      '/api/client/billing',
      '/api/client/billing/orders',
    ])
    expect(run).toHaveBeenCalledOnce()
    expect(wrapper.text()).toContain('帮助灵兔开源项目加快开发与完善')
    const buttons = wrapper.findAll('button')
    expect(buttons.filter((b) => b.text().includes('刷新'))).toHaveLength(1)
    await wrapper.get('[aria-controls="billing-quota-details"]').trigger('click')
    expect(wrapper.get('.quota-details').isVisible()).toBe(true)
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
  it.each(['pending', 'reconciling'])('默认显示%s订单，切账号时重置明细', async (state) => {
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
  it('紧凑订单视图直接显示订单且不出现套餐或支付操作', async () => {
    const { wrapper, request } = setup('pending', true)
    wrappers.push(wrapper)
    await flushPromises()
    expect(wrapper.get('.orders-content').isVisible()).toBe(true)
    expect(wrapper.text()).not.toContain('选择套餐')
    expect(wrapper.text()).not.toContain('继续支付')
    expect(request.mock.calls.every((call) => call[1].endsWith('/orders'))).toBe(true)
  })
})

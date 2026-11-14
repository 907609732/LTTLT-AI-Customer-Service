import { describe, expect, it, vi } from 'vitest'
import { defineComponent } from 'vue'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { useRuntimeStore } from '../src/shared/state/runtime'
import { useBilling } from '../src/modules/billing/use-billing'
import { billingTransportKey } from '../src/modules/billing/services'
import BillingDashboard from '../src/modules/billing/components/BillingDashboard.vue'
import ShopAccountPanel from '../src/modules/billing/components/ShopAccountPanel.vue'
import { createRouter, createMemoryHistory } from 'vue-router'
import { createBillingClient, type BillingTransport } from '../src/modules/billing/services'

describe('billing transport boundary', () => {
  it('uses the existing account entry to render the actual order and usage components', async () => {
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/', component: { template: '<div />' } }],
    })
    const wrapper = mount(ShopAccountPanel, {
      props: { viewKey: 'orders' },
      global: {
        plugins: [createPinia(), router],
        stubs: { OrdersPanel: true, UsagePanel: true, RuntimePanel: true, ElButton: true },
      },
    })
    expect(wrapper.find('orders-panel-stub').exists()).toBe(true)
    await wrapper.setProps({ viewKey: 'usage' })
    expect(wrapper.find('usage-panel-stub').exists()).toBe(true)
    expect(wrapper.find('orders-panel-stub').exists()).toBe(false)
    wrapper.unmount()
  })
  it('does not open a delayed checkout after the user leaves the page', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const runtime = useRuntimeStore()
    runtime.snapshot.managed.active.mode = 'managed'
    runtime.snapshot.managed.session.status = 'signed_in'
    runtime.snapshot.managed.session.account = {
      userId: 1,
      displayName: 'A',
      trial: { limit: 0, used: 0, reserved: 0, remaining: 0, expiresAt: 2000000000 },
    }
    let release: ((value: unknown) => void) | undefined
    const openCheckout = vi.fn(async () => {})
    const transport: BillingTransport = {
      request: () =>
        new Promise((resolve) => {
          release = resolve
        }),
      openCheckout,
    }
    let controller: ReturnType<typeof useBilling> | undefined
    const wrapper = mount(
      defineComponent({
        setup() {
          controller = useBilling()
          return () => null
        },
      }),
      { global: { plugins: [pinia], provide: { [billingTransportKey as symbol]: transport } } },
    )
    if (!controller) throw new Error('controller unavailable')
    const plan = {
      id: 'p',
      name: 'P',
      currency: 'cny' as const,
      amount: 100,
      calls: 10,
      valid_days: 1,
    }
    controller.catalog.value = { ready: true, reason: '', plans: [plan] }
    const operation = controller.checkout(plan)
    wrapper.unmount()
    if (!release) throw new Error('response unavailable')
    release({
      order: { id: 'o', plan, state: 'pending', created_at: 1, paid_at: 0 },
      checkout_url: 'https://checkout.stripe.com/c/pay/test',
    })
    await operation
    expect(openCheckout).not.toHaveBeenCalled()
  })
  it('does not retain a late order response after the account changes', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const runtime = useRuntimeStore()
    runtime.snapshot.managed.active.mode = 'managed'
    runtime.snapshot.managed.session.status = 'signed_in'
    runtime.snapshot.managed.session.account = {
      userId: 1,
      displayName: 'A',
      trial: { limit: 10, used: 0, reserved: 0, remaining: 10, expiresAt: 2000000000 },
    }
    vi.spyOn(runtime, 'run').mockResolvedValue({ status: 'ok', message: '', data: {} })
    let release: ((value: unknown) => void) | undefined
    const transport: BillingTransport = {
      request: async (_method, path) =>
        path.endsWith('/orders')
          ? new Promise((resolve) => {
              release = resolve
            })
          : { ready: false, reason: 'payment_not_configured', plans: [] },
      openCheckout: async () => {},
    }
    let controller: ReturnType<typeof useBilling> | undefined
    const harness = defineComponent({
      setup() {
        controller = useBilling()
        return () => null
      },
    })
    const wrapper = mount(harness, {
      global: { plugins: [pinia], provide: { [billingTransportKey as symbol]: transport } },
    })
    if (!controller) throw new Error('controller unavailable')
    const refresh = controller.refresh()
    await flushPromises()
    runtime.snapshot.managed.session.account.userId = 2
    if (!release) throw new Error('response unavailable')
    release({
      orders: [
        {
          id: 'o',
          plan: { id: 'p', name: 'P', currency: 'cny', amount: 100, calls: 10, valid_days: 1 },
          state: 'paid',
          created_at: 1,
          paid_at: 2,
        },
      ],
    })
    await refresh
    expect(controller.orders.value).toEqual([])
    expect(controller.catalog.value).toBeNull()
    expect(runtime.run).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('renders an honest local-key state with no invented package or payment success', () => {
    const pinia = createPinia()
    const wrapper = mount(BillingDashboard, {
      props: { section: 'plans' },
      global: {
        plugins: [pinia],
        stubs: {
          ElAlert: { props: ['title'], template: '<p>{{ title }}</p>' },
          ElButton: { template: '<button><slot /></button>' },
          ElEmpty: true,
          ElTable: true,
          ElTableColumn: true,
        },
      },
    })
    expect(wrapper.text()).toContain('本机 Key 的费用由模型服务商管理')
    expect(wrapper.text()).not.toContain('充值成功')
    expect(wrapper.text()).not.toContain('40,000')
    expect(wrapper.findAll('.billing-plan')).toHaveLength(0)
    wrapper.unmount()
  })
  it('rejects invented prices, fractional amounts and untrusted checkout URLs', async () => {
    const transport: BillingTransport = {
      request: async () => ({
        ready: true,
        reason: '',
        plans: [{ id: 'p', name: 'P', currency: 'cny', amount: 1.5, calls: 10, valid_days: 1 }],
      }),
      openCheckout: async () => {},
    }
    await expect(createBillingClient(transport).catalog()).rejects.toThrow()
    transport.request = async () => ({
      order: {
        id: 'o',
        plan: { id: 'p', name: 'P', currency: 'cny', amount: 100, calls: 10, valid_days: 1 },
        state: 'pending',
        created_at: 1,
        paid_at: 0,
      },
      checkout_url: 'https://evil.example/pay',
    })
    await expect(createBillingClient(transport).checkout('p', 'request')).rejects.toThrow()
  })
  it('sends only the plan and stable request identity; never a client price or user id', async () => {
    const calls: unknown[] = []
    const transport: BillingTransport = {
      request: async (...args) => {
        calls.push(args)
        return {
          order: {
            id: 'o',
            plan: { id: 'p', name: 'P', currency: 'cny', amount: 100, calls: 10, valid_days: 1 },
            state: 'pending',
            created_at: 1,
            paid_at: 0,
          },
          checkout_url: 'https://checkout.stripe.com/c/pay/test',
        }
      },
      openCheckout: async (url) => {
        calls.push(url)
      },
    }
    const result = await createBillingClient(transport).checkout('p', 'request')
    expect(result.order.state).toBe('pending')
    expect(calls).toEqual([
      ['POST', '/api/client/billing/orders', { plan_id: 'p', request_id: 'request' }],
    ])
  })
})

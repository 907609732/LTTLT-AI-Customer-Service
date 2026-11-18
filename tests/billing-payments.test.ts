import { afterEach, describe, expect, it, vi } from 'vitest'
import { defineComponent } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import ElementPlus from 'element-plus'
import { useRuntimeStore } from '../src/shared/state/runtime'
import {
  billingTransportKey,
  createBillingClient,
  type BillingTransport,
} from '../src/modules/billing/services'
import { useBilling } from '../src/modules/billing/use-billing'
import BillingDashboard from '../src/modules/billing/components/BillingDashboard.vue'

const plan = {
  id: 'usage_1000',
  name: '1000次',
  currency: 'cny' as const,
  amount: 990,
  calls: 1000,
  valid_days: 365,
}
const order = {
  id: 'order_1',
  plan,
  state: 'pending',
  channel: 'alipay',
  created_at: 1,
  paid_at: 0,
}
function signedInAccount(userId: number | string) {
  const pinia = createPinia()
  setActivePinia(pinia)
  const runtime = useRuntimeStore()
  runtime.snapshot.managed.active.mode = 'managed'
  runtime.snapshot.managed.session.status = 'signed_in'
  runtime.snapshot.managed.session.account = {
    userId,
    displayName: 'A',
    trial: { limit: 0, used: 0, reserved: 0, remaining: 0, expiresAt: 0 },
  }
  vi.spyOn(runtime, 'run').mockResolvedValue({ status: 'ok', message: '', data: {} })
  return { pinia, runtime }
}
function setup(request: BillingTransport['request']) {
  const { pinia, runtime } = signedInAccount(1)
  let billing!: ReturnType<typeof useBilling>
  const wrapper = mount(
    defineComponent({
      setup() {
        billing = useBilling()
        return () => null
      },
    }),
    {
      global: {
        plugins: [pinia],
        provide: { [billingTransportKey as symbol]: { request, openCheckout: async () => {} } },
      },
    },
  )
  return { billing, wrapper, runtime }
}
afterEach(() => vi.useRealTimers())

describe('扫码渠道收银台', () => {
  it('关闭订单时如果已经付款，立即刷新额度且不再创建另一笔订单', async () => {
    const { billing, wrapper, runtime } = setup(async (method, path) => {
      if (path === '/api/client/billing') return { ready: false, reason: '', plans: [] }
      if (method === 'POST' && path.endsWith('/close'))
        return { order: { ...order, state: 'paid', paid_at: 100 }, checkout_url: '' }
      return { order, checkout_url: '' }
    })
    await billing.resumeOrder({ ...order, state: 'pending', channel: 'alipay' })
    expect(await billing.closePayment()).toBe(false)
    expect(billing.activePayment.value?.order.state).toBe('paid')
    expect(runtime.run).toHaveBeenCalledWith({ action: 'managed-refresh' })
    expect(billing.paymentError.value).toBe('')
    wrapper.unmount()
  })
  it('continues polling when a ledger refresh overlaps the scheduled query', async () => {
    vi.useFakeTimers()
    let release!: (value: unknown) => void
    let reads = 0
    const { billing, wrapper } = setup(async (_method, path) => {
      if (path === '/api/client/billing')
        return new Promise((resolve) => {
          release = resolve
        })
      if (path.endsWith('/orders')) return { orders: [] }
      reads++
      return { order, checkout_url: '' }
    })
    await billing.resumeOrder({ ...order, state: 'pending', channel: 'alipay' })
    const refreshing = billing.refresh()
    await vi.advanceTimersByTimeAsync(3000)
    release({ ready: false, reason: '', plans: [] })
    await refreshing
    await vi.advanceTimersByTimeAsync(6000)
    expect(reads).toBeGreaterThan(1)
    wrapper.unmount()
  })
  it('shows unavailable plans honestly and disables an unconfigured channel in the cashier', async () => {
    const { pinia } = signedInAccount(1)
    const wrapper = mount(BillingDashboard, {
      global: {
        plugins: [pinia, ElementPlus],
        stubs: { RouterLink: { template: '<a><slot /></a>' } },
        provide: {
          [billingTransportKey as symbol]: {
            request: async (method: string, path: string) =>
              method === 'POST'
                ? { order, checkout_url: '', qr_code: 'alipay://test' }
                : path.endsWith('/orders')
                  ? { orders: [] }
                  : {
                      ready: true,
                      reason: '',
                      plans: [{ ...plan, list_amount: 1000 }],
                      channels: [
                        { id: 'alipay', ready: true, reason: '' },
                        { id: 'wechat', ready: false, reason: '商户支付尚未配置' },
                      ],
                    },
            openCheckout: async () => {},
          },
        },
      },
    })
    await flushPromises()
    expect(wrapper.text()).toContain('¥9.90')
    expect(wrapper.text()).toContain('¥10.00')
    const choose = wrapper.findAll('button').find((button) => button.text() === '支持我们')
    expect(choose, 'native channel needs a plan entry').toBeDefined()
    await choose?.trigger('click')
    await flushPromises()
    expect(
      document.querySelector<HTMLInputElement>('.billing-cashier-dialog input[value="wechat"]')
        ?.disabled,
    ).toBe(true)
    expect(document.querySelector('.billing-cashier-dialog')?.textContent).toContain(
      '商户支付尚未配置',
    )
    expect(wrapper.text()).not.toContain('USDT')
    wrapper.unmount()
  })
  it('allows a further recharge after an already paid order', async () => {
    const paths: string[] = []
    const { billing, wrapper } = setup(async (_method, path) => {
      paths.push(path)
      return { order: { ...order, state: 'paid' }, checkout_url: '' }
    })
    billing.catalog.value = {
      ready: true,
      reason: '',
      plans: [plan],
      channels: [{ id: 'alipay', ready: true, reason: '' }],
    }
    await billing.checkout(plan, 'alipay')
    await billing.checkout(plan, 'alipay')
    expect(paths).toEqual(['/api/client/billing/orders', '/api/client/billing/orders'])
    wrapper.unmount()
  })
  it('blocks changing channel after an unknown create response and hides transport errors', async () => {
    let creates = 0
    const { billing, wrapper } = setup(async () => {
      creates++
      throw new Error('Electron IPC secret')
    })
    billing.catalog.value = {
      ready: true,
      reason: '',
      plans: [plan],
      channels: [
        { id: 'alipay', ready: true, reason: '' },
        { id: 'wechat', ready: true, reason: '' },
      ],
    }
    await billing.checkout(plan, 'alipay')
    await billing.checkout(plan, 'wechat')
    expect(creates).toBe(1)
    expect(billing.checkoutError.value).not.toContain('IPC')
    expect(billing.checkoutError.value).not.toBe('')
    wrapper.unmount()
  })
  it('does not store a paid catalog response after identity changes', async () => {
    let release!: (value: unknown) => void
    const { billing, runtime, wrapper } = setup(async (_method, path) =>
      path === '/api/client/billing'
        ? new Promise((resolve) => {
            release = resolve
          })
        : { order: { ...order, state: 'paid' }, checkout_url: '' },
    )
    await billing.resumeOrder({ ...order, state: 'pending', channel: 'alipay' })
    const checking = billing.checkPayment()
    await flushPromises()
    runtime.snapshot.managed.session.account!.userId = 2
    release({ ready: true, reason: '', plans: [plan] })
    await checking
    expect(billing.catalog.value).toBeNull()
    wrapper.unmount()
  })
  it('validates order identifiers before transport and sends only channel, plan and request', async () => {
    const request = vi.fn(async () => ({
      order,
      qr_code: 'weixin://pay/test',
      checkout_url: '',
      expires_at: 2000000000,
    }))
    const client = createBillingClient({ request, openCheckout: async () => {} })
    await client.checkout(plan.id, 'request_1', 'alipay')
    expect(request).toHaveBeenLastCalledWith('POST', '/api/client/billing/orders', {
      plan_id: 'usage_1000',
      request_id: 'request_1',
      channel: 'alipay',
    })
    await expect(client.order('../evil')).rejects.toThrow()
    expect(request).toHaveBeenCalledTimes(1)
  })
  it('blocks a replacement payment when closing the old order is uncertain', async () => {
    const paths: string[] = []
    const { billing, wrapper } = setup(async (_method, path) => {
      paths.push(path)
      return {
        order: { ...order, state: path.endsWith('/close') ? 'reconciling' : 'pending' },
        qr_code: 'pay',
        checkout_url: '',
      }
    })
    billing.catalog.value = {
      ready: true,
      reason: '',
      plans: [plan],
      channels: [
        { id: 'alipay', ready: true, reason: '' },
        { id: 'wechat', ready: true, reason: '' },
      ],
    }
    await billing.checkout(plan, 'alipay')
    await billing.checkout(plan, 'wechat')
    expect(paths).toEqual([
      '/api/client/billing/orders',
      '/api/client/billing/orders/order_1/close',
    ])
    expect(billing.paymentError.value).toContain('核实')
    wrapper.unmount()
  })
  it('recovers pending orders, polls after three seconds and stops on identity change', async () => {
    vi.useFakeTimers()
    let reads = 0
    const { billing, runtime, wrapper } = setup(async () => {
      reads++
      return { order, qr_code: 'pay', checkout_url: '' }
    })
    await billing.resumeOrder({ ...order, state: 'pending', channel: 'alipay' })
    expect(billing.activePayment.value?.order.id).toBe('order_1')
    await vi.advanceTimersByTimeAsync(3000)
    await flushPromises()
    expect(reads).toBe(2)
    runtime.snapshot.managed.session.account!.userId = 2
    await vi.advanceTimersByTimeAsync(6000)
    expect(reads).toBe(2)
    expect(billing.activePayment.value).toBeNull()
    wrapper.unmount()
  })
  it('pauses automatic queries after fifteen minutes and allows explicit retry', async () => {
    vi.useFakeTimers()
    let reads = 0
    const { billing, wrapper } = setup(async () => {
      reads++
      return { order, qr_code: 'pay', checkout_url: '' }
    })
    await billing.resumeOrder({ ...order, state: 'pending', channel: 'alipay' })
    await vi.advanceTimersByTimeAsync(15 * 60 * 1000)
    const stoppedAt = reads
    expect(billing.pollingExpired.value).toBe(true)
    await vi.advanceTimersByTimeAsync(6000)
    expect(reads).toBe(stoppedAt)
    await billing.checkPayment(true)
    expect(reads).toBe(stoppedAt + 1)
    wrapper.unmount()
  })
})

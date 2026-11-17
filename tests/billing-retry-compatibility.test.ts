import { expect, it, vi } from 'vitest'
import { defineComponent } from 'vue'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { useRuntimeStore } from '../src/shared/state/runtime'
import { billingTransportKey, type BillingTransport } from '../src/modules/billing/services'
import { useBilling } from '../src/modules/billing/use-billing'

const plan = {
  id: 'usage_1000',
  name: '1000次',
  currency: 'cny' as const,
  amount: 990,
  calls: 1000,
  valid_days: 365,
}
const order = { id: 'order_1', plan, state: 'pending', created_at: 1, paid_at: 0 }
function fixture(request: BillingTransport['request']) {
  const pinia = createPinia()
  setActivePinia(pinia)
  const runtime = useRuntimeStore()
  runtime.snapshot.managed.active.mode = 'managed'
  runtime.snapshot.managed.session.status = 'signed_in'
  runtime.snapshot.managed.session.account = {
    userId: 1,
    displayName: '测试',
    trial: { limit: 0, used: 0, reserved: 0, remaining: 0, expiresAt: 0 },
  }
  vi.spyOn(runtime, 'run').mockResolvedValue({ status: 'ok', message: '', data: {} })
  let billing!: ReturnType<typeof useBilling>
  const openCheckout = vi.fn(async () => {})
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
        provide: { [billingTransportKey as symbol]: { request, openCheckout } },
      },
    },
  )
  billing.catalog.value = {
    ready: true,
    reason: '',
    plans: [plan],
    channels: [
      { id: 'alipay', ready: true, reason: '' },
      { id: 'wechat', ready: true, reason: '' },
    ],
  }
  return { billing, wrapper, openCheckout }
}

it('重复打开待付 Stripe 订单沿用原请求号和支付地址，不调用原生关闭接口', async () => {
  const request = vi.fn(async (_method: string, path: string) => {
    if (path === '/api/client/billing/orders')
      return {
        order: { ...order, channel: 'stripe' },
        checkout_url: 'https://checkout.stripe.com/c/pay_fixture',
      }
    return { order: { ...order, channel: 'stripe' }, checkout_url: '' }
  })
  const { billing, wrapper, openCheckout } = fixture(request)
  try {
    await billing.checkout(plan)
    await billing.checkout(plan)
    expect(openCheckout).toHaveBeenCalledTimes(2)
    const calls = request.mock.calls.filter(([, path]) => path === '/api/client/billing/orders')
    expect(calls).toHaveLength(2)
    expect(request).not.toHaveBeenCalledWith('POST', expect.stringContaining('/close'))
    const bodies = vi
      .mocked(request as BillingTransport['request'])
      .mock.calls.map((call) => call[2])
    expect(bodies[0]?.request_id).toBe(bodies[1]?.request_id)
  } finally {
    wrapper.unmount()
  }
})

it('上一笔已付后新建结果未知仍禁止切换渠道，并用同一请求号恢复查询', async () => {
  const bodies: { request_id: string; channel?: string }[] = []
  const { billing, wrapper } = fixture(async (_method, path, body) => {
    if (path === '/api/client/billing/orders' && body) {
      bodies.push(body)
      if (bodies.length === 1)
        return {
          order: { ...order, channel: 'alipay', state: 'paid', paid_at: 2 },
          checkout_url: '',
        }
      throw new Error('结果未知')
    }
    if (path.endsWith('/older_pending/close'))
      return {
        order: { ...order, id: 'older_pending', channel: 'wechat', state: 'closed' },
        checkout_url: '',
      }
    if (path.endsWith('/older_pending'))
      return { order: { ...order, id: 'older_pending', channel: 'wechat' }, checkout_url: '' }
    throw new Error('unexpected request')
  })
  try {
    await billing.checkout(plan, 'alipay')
    await billing.checkout(plan, 'alipay')
    await billing.resumeOrder({
      ...order,
      id: 'older_pending',
      state: 'pending',
      channel: 'wechat',
    })
    await billing.closePayment()
    await billing.checkPayment()
    await billing.checkout(plan, 'wechat')
    expect(bodies).toHaveLength(2)
    await billing.checkout(plan, 'alipay')
    expect(bodies).toHaveLength(3)
    expect(bodies[2]?.request_id).toBe(bodies[1]?.request_id)
  } finally {
    wrapper.unmount()
  }
})

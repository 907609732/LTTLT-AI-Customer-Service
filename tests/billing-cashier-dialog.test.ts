import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import ElementPlus from 'element-plus'
import BillingDashboard from '../src/modules/billing/components/BillingDashboard.vue'
import { billingTransportKey, type BillingTransport } from '../src/modules/billing/services'
import { useRuntimeStore } from '../src/shared/state/runtime'

vi.mock('../src/modules/billing/payment-code', () => ({
  paymentCodeImage: vi.fn(async () => 'data:image/png;base64,dGVzdA=='),
}))
const plan = {
  id: 'usage_1000',
  name: '体验包 · 小小心意',
  currency: 'cny',
  amount: 990,
  calls: 1000,
  valid_days: 365,
}
const payment = {
  order: { id: 'qr_order', plan, state: 'pending', channel: 'wechat', created_at: 1, paid_at: 0 },
  checkout_url: '',
  qr_code: 'weixin://test',
  expires_at: 2000000000,
}
const mounted: ReturnType<typeof mount>[] = []
function setup(
  create?: BillingTransport['request'],
  initialOrders: (typeof payment.order)[] = [],
  ordersUnavailable = false,
  failRecovery = false,
) {
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
  const request = vi.fn<BillingTransport['request']>(async (method, path, body) => {
    if (method === 'POST') return create ? create(method, path, body) : payment
    if (path.endsWith('/orders')) {
      if (ordersUnavailable) throw Object.assign(new Error('offline'), { code: 'offline' })
      return { orders: initialOrders }
    }
    if (path.includes('/orders/')) {
      if (failRecovery) {
        failRecovery = false
        throw new Error('offline')
      }
      return payment
    }
    return {
      ready: true,
      reason: '',
      plans: [
        plan,
        { ...plan, id: 'support_100000', name: '共创支持包', amount: 100000, calls: 100000 },
      ],
      channels: [{ id: 'wechat', ready: true, reason: '' }],
    }
  })
  const wrapper = mount(BillingDashboard, {
    attachTo: document.body,
    props: { section: 'plans' },
    global: {
      plugins: [pinia, ElementPlus],
      provide: { [billingTransportKey as symbol]: { request, openCheckout: vi.fn() } },
    },
  })
  mounted.push(wrapper)
  return {
    wrapper,
    request,
    runtime,
    allowOrders: () => {
      ordersUnavailable = false
    },
  }
}
function dialog() {
  const node = document.querySelector<HTMLElement>('.billing-cashier-dialog')
  expect(node, '收银台必须居中弹出，不能藏在页面底部').not.toBeNull()
  return node!
}
afterEach(() => {
  mounted.splice(0).forEach((w) => w.unmount())
  vi.restoreAllMocks()
})

describe('扫码收银台弹窗', () => {
  it('点击支持按钮直接创建扫码订单并显示二维码', async () => {
    const { wrapper, request } = setup()
    await flushPromises()
    await wrapper.get('.billing-plan button').trigger('click')
    await flushPromises()
    expect(dialog().closest('[role="dialog"]')?.getAttribute('aria-modal')).toBe('true')
    expect(request).toHaveBeenCalledWith(
      'POST',
      '/api/client/billing/orders',
      expect.objectContaining({ plan_id: plan.id, channel: 'wechat' }),
    )
    expect(dialog().querySelector('img[alt="支付二维码"]')?.getAttribute('src')).toContain(
      'data:image/png',
    )
  })
  it('生成中显示加载提示，连续点击不重复建单，重新打开继续原订单', async () => {
    let resolve!: (value: unknown) => void
    const { wrapper, request } = setup(
      () =>
        new Promise((done) => {
          resolve = done
        }),
    )
    await flushPromises()
    await wrapper.get('.billing-plan button').trigger('click')
    await wrapper.get('.billing-plan button').trigger('click')
    expect(dialog().textContent).toContain('正在加载支付二维码')
    expect(request.mock.calls.filter((c) => c[0] === 'POST')).toHaveLength(1)
    resolve(payment)
    await flushPromises()
    dialog().querySelector<HTMLButtonElement>('.el-dialog__headerbtn')!.click()
    await flushPromises()
    await wrapper.get('.billing-plan button').trigger('click')
    await flushPromises()
    expect(request.mock.calls.filter((c) => c[0] === 'POST')).toHaveLength(1)
    expect(request).toHaveBeenCalledWith('GET', '/api/client/billing/orders/qr_order')
    expect(dialog().querySelector('img[alt="支付二维码"]')).not.toBeNull()
  })
  it.each(['pending', 'reconciling'])(
    '重进页面已有%s订单时恢复原单，不再创建另一笔订单',
    async (state) => {
      const { wrapper, request } = setup(undefined, [{ ...payment.order, state }])
      await flushPromises()
      await wrapper.get('.billing-plan--premium button').trigger('click')
      await flushPromises()
      expect(request.mock.calls.filter((c) => c[0] === 'POST')).toHaveLength(0)
      expect(request).toHaveBeenCalledWith('GET', '/api/client/billing/orders/qr_order')
      expect(dialog().textContent).toContain('您有一笔未完成的订单')
      expect(dialog().querySelector('img[alt="支付二维码"]')).not.toBeNull()
    },
  )
  it('已有其他套餐的待付订单时先展示原订单，不自动关单或换单', async () => {
    const { wrapper, request } = setup()
    await flushPromises()
    await wrapper.get('.billing-plan button').trigger('click')
    await flushPromises()
    dialog().querySelector<HTMLButtonElement>('.el-dialog__headerbtn')!.click()
    await flushPromises()
    await wrapper.get('.billing-plan--premium button').trigger('click')
    await flushPromises()
    expect(dialog().textContent).toContain('您有一笔未完成的订单')
    expect(dialog().textContent).toContain('体验包 · 小小心意')
    expect(request.mock.calls.filter((c) => c[0] === 'POST')).toHaveLength(1)
  })
  it('订单列表读取失败时不建新单，刷新成功后恢复已有订单', async () => {
    const rows: (typeof payment.order)[] = []
    const { wrapper, request, allowOrders } = setup(undefined, rows, true)
    await flushPromises()
    await wrapper.get('.billing-plan button').trigger('click')
    await flushPromises()
    expect(dialog().textContent).toContain('暂时无法核实充值订单')
    expect(request.mock.calls.filter((c) => c[0] === 'POST')).toHaveLength(0)
    rows.push(payment.order)
    allowOrders()
    const retry = [...dialog().querySelectorAll('button')].find((b) =>
      b.textContent?.includes('刷新订单并重试'),
    )!
    retry.click()
    await flushPromises()
    expect(request.mock.calls.filter((c) => c[0] === 'POST')).toHaveLength(0)
    expect(dialog().querySelector('img[alt="支付二维码"]')).not.toBeNull()
  })
  it('已知旧订单恢复失败后重试仍只恢复原订单，不创建第二单', async () => {
    const { wrapper, request } = setup(undefined, [payment.order], false, true)
    await flushPromises()
    await wrapper.get('.billing-plan--premium button').trigger('click')
    await flushPromises()
    expect(dialog().textContent).toContain('暂时无法恢复订单')
    const retry = [...dialog().querySelectorAll('button')].find((b) =>
      b.textContent?.includes('重试加载二维码'),
    )!
    retry.click()
    await flushPromises()
    expect(request.mock.calls.filter((c) => c[0] === 'POST')).toHaveLength(0)
    expect(dialog().querySelector('img[alt="支付二维码"]')).not.toBeNull()
  })
  it('创建失败在弹窗内显示错误，同一请求号重试', async () => {
    let attempt = 0
    const { wrapper, request } = setup(async () => {
      if (!attempt++) throw Object.assign(new Error('offline'), { code: 'offline' })
      return payment
    })
    await flushPromises()
    await wrapper.get('.billing-plan button').trigger('click')
    await flushPromises()
    expect(dialog().textContent).toContain('暂时无法连接托管服务')
    const retry = [...dialog().querySelectorAll('button')].find((b) =>
      b.textContent?.includes('重试加载二维码'),
    )!
    retry.click()
    await flushPromises()
    const posts = request.mock.calls.filter((c) => c[0] === 'POST')
    expect(posts).toHaveLength(2)
    expect(posts[0][2]?.request_id).toBe(posts[1][2]?.request_id)
    expect(dialog().querySelector('img[alt="支付二维码"]')).not.toBeNull()
  })
  it('切换账号后关闭弹窗并丢弃旧订单的迟到二维码', async () => {
    let resolve!: (value: unknown) => void
    const { wrapper, runtime } = setup(
      () =>
        new Promise((done) => {
          resolve = done
        }),
    )
    await flushPromises()
    await wrapper.get('.billing-plan button').trigger('click')
    runtime.snapshot.managed.session.account!.userId = 2
    await flushPromises()
    resolve(payment)
    await flushPromises()
    expect(document.querySelector('img[alt="支付二维码"]')).toBeNull()
  })
})

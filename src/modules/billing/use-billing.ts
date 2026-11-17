import { computed, inject, onBeforeUnmount, ref, watch } from 'vue'
import { useRuntimeStore } from '@/shared/state/runtime'
import { billingTransportKey, createBillingClient } from './services'
import { billingErrorMessage } from './errors'
import type {
  BillingCatalog,
  BillingChannel,
  BillingOrder,
  BillingPayment,
  BillingPlan,
} from './contracts'

/** 3 秒一次主动查单，只用于等待渠道结果；不涉及轮询服务端其他端点。 */
const PAYMENT_POLL_INTERVAL_MS = 3000
/** 15 分钟后停止自动查单，避免无人值守时长期占用网络；可手动重试。 */
const PAYMENT_POLL_WINDOW_MS = 15 * 60 * 1000
const paymentOpen = (order: BillingOrder) =>
  order.state === 'pending' || order.state === 'reconciling'

export function useBilling() {
  const runtime = useRuntimeStore()
  const transport = inject(billingTransportKey, null)
  const client = transport ? createBillingClient(transport) : null
  const catalog = ref<BillingCatalog | null>(null),
    orders = ref<BillingOrder[]>([])
  const catalogPending = ref(false),
    ordersPending = ref(false),
    ledgerPending = ref(false),
    checkoutPending = ref(false),
    paymentPending = ref(false)
  const catalogError = ref(''),
    ordersError = ref(''),
    ledgerError = ref(''),
    checkoutError = ref(''),
    paymentError = ref('')
  const ordersLoaded = ref(false),
    ledgerSyncedAt = ref<number | null>(null)
  // 扫码收银台状态：活动订单只保留最近一笔，关闭弹窗后仍继续查单直到离开本页。
  const activePayment = ref<BillingPayment | null>(null)
  const pollingExpired = ref(false)
  const pending = computed(
    () =>
      catalogPending.value ||
      ordersPending.value ||
      ledgerPending.value ||
      checkoutPending.value ||
      paymentPending.value,
  )
  const managed = computed(() => runtime.snapshot.managed)
  const signedIn = computed(
    () =>
      managed.value.active.mode === 'managed' &&
      !managed.value.restartRequired &&
      managed.value.session.status === 'signed_in',
  )
  const account = computed(() => (signedIn.value ? managed.value.session.account : null))
  const identity = computed(
    () =>
      `${runtime.snapshot.workspaceId}|${managed.value.active.apiOrigin}|${signedIn.value ? account.value?.userId : ''}|${managed.value.active.mode}`,
  )
  let generation = 0
  let timer: ReturnType<typeof setTimeout> | undefined
  let deadline = 0
  const retries = new Map<string, string>()
  // 创建结果未知（网络中断/超时）的“套餐|渠道”：只允许用同一请求号重试，不能换渠道再付款。
  let unresolvedCreateKey: string | undefined
  function stopPolling() {
    clearTimeout(timer)
    timer = undefined
  }
  onBeforeUnmount(() => {
    generation++
    stopPolling()
    retries.clear()
    unresolvedCreateKey = undefined
  })
  watch(
    identity,
    () => {
      generation++
      stopPolling()
      catalog.value = null
      orders.value = []
      activePayment.value = null
      ordersLoaded.value = false
      ledgerSyncedAt.value = null
      pollingExpired.value = false
      deadline = 0
      for (const state of [catalogError, ordersError, ledgerError, checkoutError, paymentError])
        state.value = ''
      for (const state of [
        catalogPending,
        ordersPending,
        ledgerPending,
        checkoutPending,
        paymentPending,
      ])
        state.value = false
      retries.clear()
      unresolvedCreateKey = undefined
    },
    { flush: 'sync' },
  )

  async function refreshCatalog() {
    if (!signedIn.value || !client || catalogPending.value) return
    const ticket = generation
    catalogPending.value = true
    catalogError.value = ''
    try {
      const next = await client.catalog()
      if (ticket === generation) catalog.value = next
    } catch (cause) {
      if (ticket === generation) catalogError.value = billingErrorMessage(cause)
    } finally {
      if (ticket === generation) catalogPending.value = false
    }
  }
  async function refreshOrders() {
    if (!signedIn.value || !client || ordersPending.value) return
    const ticket = generation
    ordersPending.value = true
    ordersError.value = ''
    try {
      const next = await client.orders()
      if (ticket === generation) {
        orders.value = next
        ordersLoaded.value = true
      }
    } catch (cause) {
      if (ticket === generation) ordersError.value = billingErrorMessage(cause)
    } finally {
      if (ticket === generation) ordersPending.value = false
    }
  }
  async function refreshLedger() {
    if (!signedIn.value || ledgerPending.value) return
    const ticket = generation
    ledgerPending.value = true
    ledgerError.value = ''
    try {
      const result = await runtime.run({ action: 'managed-refresh' })
      if (result.status !== 'ok') throw new Error('ledger refresh failed')
      if (ticket === generation) ledgerSyncedAt.value = Date.now()
    } catch (cause) {
      if (ticket === generation) ledgerError.value = billingErrorMessage(cause)
    } finally {
      if (ticket === generation) ledgerPending.value = false
    }
  }
  async function refresh() {
    if (!signedIn.value || pending.value) return
    const ticket = generation
    await Promise.all([refreshCatalog(), refreshOrders()])
    if (ticket === generation) await refreshLedger()
  }
  /** 收银台结果的唯一本地落点：同时把订单并入列表，不新增第二份订单状态。 */
  function accept(result: BillingPayment) {
    activePayment.value = result
    orders.value = [
      result.order,
      ...orders.value.filter((order) => order.id !== result.order.id),
    ].slice(0, 100)
    ordersLoaded.value = true
  }
  function schedule() {
    stopPolling()
    const current = activePayment.value
    if (!current || !paymentOpen(current.order)) return
    if (Date.now() >= deadline) {
      pollingExpired.value = true
      return
    }
    timer = setTimeout(() => {
      void checkPayment()
    }, PAYMENT_POLL_INTERVAL_MS)
  }
  /** 与服务端账本重新核对：只在 paid 状态刷新额度，不以本地状态推断入账。 */
  async function syncPaid(ticket: number) {
    if (!client) return
    const nextCatalog = await client.catalog()
    if (ticket !== generation) return
    catalog.value = nextCatalog
    await refreshLedger()
  }
  async function checkPayment(retry = false) {
    if (unresolvedCreateKey) {
      paymentError.value = '订单创建结果尚未核实，请先用原套餐和渠道重试。'
      return
    }
    if (!client || !signedIn.value || !activePayment.value || paymentPending.value) return
    // 刷新账本或创建订单期间不并发查单，安排到下一轮，保持 3 秒节奏。
    if (pending.value) {
      schedule()
      return
    }
    if (retry) {
      deadline = Date.now() + PAYMENT_POLL_WINDOW_MS
      pollingExpired.value = false
    }
    const id = activePayment.value.order.id,
      ticket = generation
    paymentPending.value = true
    paymentError.value = ''
    try {
      const result = await client.order(id)
      if (ticket !== generation) return
      accept(result)
      if (result.order.state === 'paid') {
        retries.clear()
        await syncPaid(ticket)
        return
      }
      if (result.order.state === 'closed') activePayment.value = null
    } catch {
      if (ticket === generation)
        paymentError.value = '暂时无法核实支付结果，请勿重复付款，可重试查询。'
    } finally {
      if (ticket === generation) {
        paymentPending.value = false
        schedule()
      }
    }
  }
  /** 关闭原订单只用于换渠道或放弃付款；已付款时返回 false 并刷新额度。 */
  async function closePayment() {
    if (unresolvedCreateKey) {
      paymentError.value = '订单创建结果尚未核实，请先用原套餐和渠道重试。'
      return false
    }
    const current = activePayment.value
    if (!client || !signedIn.value || !current || pending.value) return false
    const ticket = generation
    paymentPending.value = true
    stopPolling()
    paymentError.value = ''
    try {
      const result = await client.close(current.order.id)
      if (ticket !== generation) return false
      accept(result)
      if (result.order.state === 'paid') {
        retries.clear()
        await syncPaid(ticket)
        return false
      }
      if (result.order.state !== 'closed') {
        paymentError.value = '原订单尚未确认关闭，请先核实支付结果。'
        return false
      }
      activePayment.value = null
      retries.clear()
      deadline = 0
      pollingExpired.value = false
      return true
    } catch {
      if (ticket === generation) paymentError.value = '无法确认原订单已关闭，请先核实支付结果。'
      return false
    } finally {
      if (ticket === generation) {
        paymentPending.value = false
        schedule()
      }
    }
  }
  async function checkout(plan: BillingPlan, channel?: BillingChannel) {
    if (!client || !signedIn.value || !catalog.value?.ready || catalogError.value || pending.value)
      return
    // 渠道未在服务端 ready 时不创建订单，也不落回其他渠道。
    if (channel && !catalog.value.channels?.some((item) => item.id === channel && item.ready))
      return
    const key = `${plan.id}|${channel ?? 'stripe'}`
    // 上次创建结果未知时只允许同一套餐 + 渠道用同一请求号重试，避免换渠道重复付款。
    if (unresolvedCreateKey && unresolvedCreateKey !== key) {
      checkoutError.value = '原订单状态尚未核实，请先用原套餐和渠道重试查询。'
      return
    }
    if (activePayment.value && paymentOpen(activePayment.value.order)) {
      const current = activePayment.value
      const replayStripe =
        !channel &&
        (!current.order.channel || current.order.channel === 'stripe') &&
        current.order.plan.id === plan.id &&
        retries.has(key)
      // 原生关单接口不会关闭 Stripe 会话；同一待付会话沿用原请求号重新打开。
      if (!replayStripe && !(await closePayment())) return
    }
    const ticket = generation
    checkoutPending.value = true
    checkoutError.value = ''
    stopPolling()
    const request = retries.get(key) ?? crypto.randomUUID()
    retries.set(key, request)
    unresolvedCreateKey = key
    try {
      const result = await client.checkout(plan.id, request, channel)
      if (ticket !== generation) return
      unresolvedCreateKey = undefined
      accept(result)
      deadline = Date.now() + PAYMENT_POLL_WINDOW_MS
      pollingExpired.value = false
      if (result.order.state === 'paid') {
        retries.delete(key)
        // 已有入账结果时只核对账本，不再请求套餐或打开任何支付页面。
        await refreshLedger()
      } else if (result.order.state === 'closed') {
        retries.delete(key)
        activePayment.value = null
      } else if (!channel && result.checkout_url) {
        // 历史 stripe 网页收银台保持原行为：只在仍属当前身份时打开真实地址。
        await client.openCheckout(result.checkout_url)
      }
    } catch (cause) {
      // 结果未知：保留同一请求号，只允许同套餐 + 渠道重试核对，不换渠道再付款。
      if (ticket === generation) checkoutError.value = billingErrorMessage(cause)
    } finally {
      if (ticket === generation) {
        checkoutPending.value = false
        schedule()
      }
    }
  }
  /** 关闭收银台后从最近订单恢复查单，二维码需要重新向服务端读取。 */
  async function resumeOrder(order: BillingOrder) {
    if (unresolvedCreateKey) {
      paymentError.value = '订单创建结果尚未核实，请先用原套餐和渠道重试。'
      return
    }
    if (!client || !signedIn.value || pending.value) return
    if (activePayment.value && paymentOpen(activePayment.value.order)) {
      if (activePayment.value.order.id !== order.id && !(await closePayment())) return
    }
    const ticket = generation
    paymentPending.value = true
    paymentError.value = ''
    stopPolling()
    try {
      const result = await client.order(order.id)
      if (ticket !== generation) return
      accept(result)
      if (!paymentOpen(result.order)) return
      deadline = Date.now() + PAYMENT_POLL_WINDOW_MS
      pollingExpired.value = false
    } catch {
      if (ticket === generation) paymentError.value = '暂时无法恢复订单，请重试查询。'
    } finally {
      if (ticket === generation) {
        paymentPending.value = false
        schedule()
      }
    }
  }
  return {
    runtime,
    transport,
    identity,
    signedIn,
    account,
    catalog,
    orders,
    pending,
    catalogPending,
    ordersPending,
    ledgerPending,
    checkoutPending,
    paymentPending,
    catalogError,
    ordersError,
    ledgerError,
    checkoutError,
    paymentError,
    ordersLoaded,
    ledgerSyncedAt,
    activePayment,
    pollingExpired,
    refresh,
    refreshCatalog,
    refreshOrders,
    refreshLedger,
    checkout,
    checkPayment,
    closePayment,
    resumeOrder,
  }
}

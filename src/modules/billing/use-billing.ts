import { computed, inject, onBeforeUnmount, ref, watch } from 'vue'
import { useRuntimeStore } from '@/shared/state/runtime'
import { billingTransportKey, createBillingClient } from './services'
import { billingErrorMessage } from './errors'
import type { BillingCatalog, BillingOrder, BillingPlan } from './contracts'

export function useBilling() {
  const runtime = useRuntimeStore()
  const transport = inject(billingTransportKey, null)
  const client = transport ? createBillingClient(transport) : null
  const catalog = ref<BillingCatalog | null>(null),
    orders = ref<BillingOrder[]>([])
  const catalogPending = ref(false),
    ordersPending = ref(false),
    ledgerPending = ref(false),
    checkoutPending = ref(false)
  const catalogError = ref(''),
    ordersError = ref(''),
    ledgerError = ref(''),
    checkoutError = ref('')
  const ordersLoaded = ref(false),
    ledgerSyncedAt = ref<number | null>(null)
  const pending = computed(
    () =>
      catalogPending.value || ordersPending.value || ledgerPending.value || checkoutPending.value,
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
  const retries = new Map<string, string>()
  onBeforeUnmount(() => {
    generation++
    retries.clear()
  })
  watch(
    identity,
    () => {
      generation++
      catalog.value = null
      orders.value = []
      ordersLoaded.value = false
      ledgerSyncedAt.value = null
      for (const state of [catalogError, ordersError, ledgerError, checkoutError]) state.value = ''
      for (const state of [catalogPending, ordersPending, ledgerPending, checkoutPending])
        state.value = false
      retries.clear()
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
  async function checkout(plan: BillingPlan) {
    if (!client || !signedIn.value || !catalog.value?.ready || catalogError.value || pending.value)
      return
    const ticket = generation
    checkoutPending.value = true
    checkoutError.value = ''
    const request = retries.get(plan.id) ?? crypto.randomUUID()
    retries.set(plan.id, request)
    try {
      const result = await client.checkout(plan.id, request)
      if (ticket !== generation) return
      orders.value = [
        result.order,
        ...orders.value.filter((order) => order.id !== result.order.id),
      ].slice(0, 100)
      ordersLoaded.value = true
      if (result.order.state === 'paid') {
        retries.delete(plan.id)
        await refreshLedger()
      } else if (result.checkout_url) await client.openCheckout(result.checkout_url)
    } catch (cause) {
      if (ticket === generation) checkoutError.value = billingErrorMessage(cause)
    } finally {
      if (ticket === generation) checkoutPending.value = false
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
    catalogError,
    ordersError,
    ledgerError,
    checkoutError,
    ordersLoaded,
    ledgerSyncedAt,
    refresh,
    refreshCatalog,
    refreshOrders,
    refreshLedger,
    checkout,
  }
}

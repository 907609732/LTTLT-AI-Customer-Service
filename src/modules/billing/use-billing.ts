import { computed, inject, onBeforeUnmount, ref, watch } from 'vue'
import { useRuntimeStore } from '@/shared/state/runtime'
import { billingTransportKey, createBillingClient } from './services'
import type { BillingCatalog, BillingOrder, BillingPlan } from './contracts'

export function useBilling() {
  const runtime = useRuntimeStore()
  const transport = inject(billingTransportKey, null)
  const client = transport ? createBillingClient(transport) : null
  const catalog = ref<BillingCatalog | null>(null),
    orders = ref<BillingOrder[]>([])
  const pending = ref(false),
    error = ref('')
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
      `${managed.value.active.apiOrigin}|${signedIn.value ? account.value?.userId : ''}|${managed.value.active.mode}`,
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
      error.value = ''
      retries.clear()
      pending.value = false
    },
    { flush: 'sync' },
  )
  async function refresh() {
    if (!signedIn.value || pending.value) return
    const ticket = generation
    pending.value = true
    error.value = ''
    try {
      if (client) {
        const nextCatalog = await client.catalog()
        const nextOrders = await client.orders()
        if (ticket !== generation) return
        catalog.value = nextCatalog
        orders.value = nextOrders
      }
      if (ticket !== generation) return
      await runtime.run({ action: 'managed-refresh' })
    } catch (cause) {
      if (ticket === generation)
        error.value = cause instanceof Error ? cause.message : String(cause)
    } finally {
      if (ticket === generation) pending.value = false
    }
  }
  async function checkout(plan: BillingPlan) {
    if (!client || !signedIn.value || !catalog.value?.ready || pending.value) return
    const ticket = generation
    pending.value = true
    error.value = ''
    const request = retries.get(plan.id) ?? crypto.randomUUID()
    retries.set(plan.id, request)
    try {
      const result = await client.checkout(plan.id, request)
      if (ticket !== generation) return
      orders.value = [
        result.order,
        ...orders.value.filter((order) => order.id !== result.order.id),
      ].slice(0, 100)
      if (result.order.state === 'paid') retries.delete(plan.id)
      else if (result.checkout_url) await client.openCheckout(result.checkout_url)
    } catch (cause) {
      if (ticket === generation)
        error.value = cause instanceof Error ? cause.message : String(cause)
    } finally {
      if (ticket === generation) pending.value = false
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
    error,
    refresh,
    checkout,
  }
}

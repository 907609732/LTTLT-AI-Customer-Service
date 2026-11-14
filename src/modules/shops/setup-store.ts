import { computed, ref, watch } from 'vue'
import { defineStore } from 'pinia'
import { useRuntimeStore } from '@/shared/state/runtime'

/** 引导仅记录当前窗口的操作位置，不将看过页面冒充已经配置。 */
export const useShopSetupStore = defineStore('shop-setup', () => {
  const runtime = useRuntimeStore()
  const storeId = ref(''),
    workspaceId = ref(''),
    visible = ref(false),
    step = ref(0)
  const returnAvailable = ref(false),
    awaitingLogin = ref(false),
    pending = ref(false),
    error = ref('')
  let version = 0
  const shop = computed(() => runtime.snapshot.stores.find((item) => item.id === storeId.value))
  function valid() {
    return Boolean(
      storeId.value && workspaceId.value === runtime.snapshot.workspaceId && shop.value,
    )
  }
  function finish() {
    version++
    storeId.value = ''
    workspaceId.value = ''
    visible.value = false
    returnAvailable.value = false
    awaitingLogin.value = false
    pending.value = false
    error.value = ''
  }
  function open(id: string) {
    finish()
    if (!runtime.snapshot.workspaceId || !runtime.snapshot.stores.some((item) => item.id === id))
      return
    workspaceId.value = runtime.snapshot.workspaceId
    storeId.value = id
    step.value = shop.value?.runtime.online ? 1 : 0
    visible.value = true
  }
  function resume() {
    if (!valid()) return finish()
    awaitingLogin.value = false
    visible.value = true
    returnAvailable.value = false
  }
  function pauseForConfiguration() {
    if (!valid()) return finish()
    runtime.selectedStoreId = storeId.value
    visible.value = false
    returnAvailable.value = true
  }
  async function connect(navigate: () => Promise<void>) {
    if (!valid() || pending.value) return
    const lease = version,
      id = storeId.value
    const current = () =>
      lease === version && valid() && storeId.value === id && runtime.selectedStoreId === id
    pending.value = true
    error.value = ''
    visible.value = false
    awaitingLogin.value = true
    returnAvailable.value = true
    try {
      runtime.selectedStoreId = id
      await runtime.run({ action: 'open-store', storeId: id })
      if (!current()) return
      await navigate()
      if (!current()) return
      runtime.platformStoreId = id
      if (shop.value?.runtime.online) {
        step.value = 1
        resume()
      }
    } catch (cause) {
      if (current()) {
        error.value = cause instanceof Error ? cause.message : String(cause)
        resume()
      }
    } finally {
      if (current()) pending.value = false
    }
  }
  watch(
    () => [runtime.snapshot.workspaceId, shop.value?.id],
    () => {
      if (storeId.value && !valid()) finish()
    },
    { flush: 'sync' },
  )
  watch(
    () => runtime.selectedStoreId,
    (selected) => {
      // 登录只是当前店铺的引导租约；用户切店后，迟到登录不得抢回原生页面。
      if (awaitingLogin.value && selected !== storeId.value) finish()
    },
    { flush: 'sync' },
  )
  watch(
    () => shop.value?.runtime.online,
    (online) => {
      if (online && awaitingLogin.value && valid() && runtime.selectedStoreId === storeId.value) {
        step.value = 1
        resume()
      }
    },
  )
  return {
    storeId,
    visible,
    step,
    returnAvailable,
    awaitingLogin,
    pending,
    error,
    shop,
    open,
    resume,
    pauseForConfiguration,
    connect,
    finish,
    dismiss: finish,
  }
})

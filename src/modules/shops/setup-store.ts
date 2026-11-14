import { computed, ref, watch } from 'vue'
import { defineStore } from 'pinia'
import { useRuntimeStore } from '@/shared/state/runtime'
import { createBlankSetupDraft, createSetupRules, type SetupDraft } from './setup-rules'

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
  const draft = ref(createBlankSetupDraft()),
    loading = ref(false),
    loaded = ref(false),
    saving = ref(false),
    saved = ref(false)
  let rules: ReturnType<typeof createSetupRules> | undefined
  const sessionDrafts = new Map<string, { draft: SetupDraft; step: number }>()
  let cacheWorkspace = runtime.snapshot.workspaceId,
    restoreDraft = false
  let version = 0
  const shop = computed(() => runtime.snapshot.stores.find((item) => item.id === storeId.value))
  function valid() {
    return Boolean(
      storeId.value && workspaceId.value === runtime.snapshot.workspaceId && shop.value,
    )
  }
  function resetSession() {
    version++
    storeId.value = ''
    workspaceId.value = ''
    visible.value = false
    returnAvailable.value = false
    awaitingLogin.value = false
    pending.value = false
    error.value = ''
    loading.value = false
    loaded.value = false
    saving.value = false
    rules = undefined
  }
  function finish() {
    sessionDrafts.delete(storeId.value)
    resetSession()
  }
  function dismiss() {
    if (valid() && !saved.value && (loaded.value || !runtime.available)) {
      sessionDrafts.set(storeId.value, {
        draft: {
          ...draft.value,
          origins: [...draft.value.origins],
          carriers: [...draft.value.carriers],
        },
        step: Math.min(step.value, 4),
      })
    }
    resetSession()
  }
  function open(id: string) {
    if (storeId.value) dismiss()
    else resetSession()
    if (!runtime.snapshot.workspaceId || !runtime.snapshot.stores.some((item) => item.id === id))
      return
    workspaceId.value = runtime.snapshot.workspaceId
    storeId.value = id
    const previous = sessionDrafts.get(id)
    step.value = previous?.step ?? 0
    draft.value = previous
      ? {
          ...previous.draft,
          origins: [...previous.draft.origins],
          carriers: [...previous.draft.carriers],
        }
      : createBlankSetupDraft()
    restoreDraft = Boolean(previous)
    saved.value = false
    visible.value = true
  }
  async function loadRules() {
    if (!valid() || loading.value || saving.value) return
    const lease = version,
      id = storeId.value
    const current = () => lease === version && valid() && storeId.value === id
    const assertCurrent = () => {
      if (!current()) throw Error('店铺工作区已改变，请重新打开引导')
    }
    const service = createSetupRules({ execute: (command) => runtime.run(command), assertCurrent })
    const keepDraft = restoreDraft
    restoreDraft = false
    loading.value = true
    loaded.value = false
    error.value = ''
    rules = undefined
    try {
      const next = await service.load(id)
      if (!current()) return
      if (!keepDraft) draft.value = next
      rules = service
      loaded.value = true
    } catch (cause) {
      if (current()) error.value = cause instanceof Error ? cause.message : String(cause)
    } finally {
      if (current()) loading.value = false
    }
  }
  async function saveRules(): Promise<boolean> {
    if (!valid() || loading.value || saving.value) return false
    if (!rules) {
      error.value = '请先载入店铺设置后再保存'
      return false
    }
    const lease = version,
      id = storeId.value
    const current = () => lease === version && valid() && storeId.value === id
    saving.value = true
    error.value = ''
    try {
      await rules.save(id, draft.value)
      if (!current()) return false
      draft.value = await rules.load(id)
      if (!current()) return false
      saved.value = true
      sessionDrafts.delete(id)
      return true
    } catch (cause) {
      if (current()) error.value = cause instanceof Error ? cause.message : String(cause)
      return false
    } finally {
      if (current()) saving.value = false
    }
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
        step.value = 0
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
      if (cacheWorkspace !== runtime.snapshot.workspaceId) {
        sessionDrafts.clear()
        cacheWorkspace = runtime.snapshot.workspaceId
      }
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
        step.value = 0
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
    draft,
    loading,
    loaded,
    saving,
    saved,
    loadRules,
    saveRules,
    shop,
    open,
    resume,
    pauseForConfiguration,
    connect,
    finish,
    dismiss,
  }
})

import { computed, ref, type Ref } from 'vue'
import type { KnowledgeProductCard } from '@/shared/contracts/knowledge'
import type {
  KnowledgeProductProfile,
  KnowledgeProductProfileForm,
  KnowledgeStagedProductImage,
} from '@/shared/contracts/knowledge-product-profile'
import type { createKnowledgeClient } from './manager-service'

/**
 * The profile dialog owns only product-profile form/view state. Manager remains the
 * lifecycle owner for workspace/store leases, route leave, refresh and the Q&A editor.
 */
export function useKnowledgeProductProfile(options: {
  client: () => Pick<
    ReturnType<typeof createKnowledgeClient>,
    | 'productProfile'
    | 'stageProductImages'
    | 'discardProductImages'
    | 'discardStagedProductImages'
    | 'saveProductProfile'
  >
  storeId: Ref<string>
  refresh(): Promise<void>
  notice: Ref<string>
  error: Ref<string>
}) {
  const profile = ref<KnowledgeProductProfile>(),
    form = ref<KnowledgeProductProfileForm>(),
    staged = ref<KnowledgeStagedProductImage[]>([]),
    loading = ref(false),
    saving = ref(false),
    staging = ref(false),
    profileError = ref('')
  let generation = 0,
    baseline = '',
    returnFocus: HTMLElement | undefined
  const reason = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause))
  const dirty = computed(
    () => Boolean(form.value && JSON.stringify(form.value) !== baseline) || staged.value.length > 0,
  )
  async function discardTokens(tokens: string[]) {
    if (!tokens.length) return
    try {
      // The staging-cleanup bridge is intentionally not wrapped in the renderer lease guard:
      // a late native picker result still needs cleanup, while main IPC rechecks the workspace.
      await options.client().discardStagedProductImages(tokens)
    } catch {
      // Expired/workspace-changed staging is also bounded and reclaimed by the main-process TTL.
    }
  }
  async function close(discard = true) {
    if (saving.value) return false
    generation++
    const tokens = staged.value.map((image) => image.token)
    staged.value = []
    profile.value = undefined
    form.value = undefined
    baseline = ''
    profileError.value = ''
    loading.value = false
    staging.value = false
    if (discard) await discardTokens(tokens)
    return true
  }
  async function open(row: KnowledgeProductCard, trigger?: HTMLElement) {
    if (saving.value) return
    const owner = ++generation,
      shop = options.storeId.value
    loading.value = true
    profileError.value = ''
    returnFocus = trigger
    try {
      const next = await options.client().productProfile(shop, row.binding.id)
      if (owner !== generation || shop !== options.storeId.value) return
      if (next.storeId !== shop || next.binding.id !== row.binding.id)
        throw Error('商品资料与当前店铺不符，请刷新后重试')
      profile.value = next
      form.value = {
        title: next.title,
        manualPrice: next.manualPrice,
        notes: next.notes,
        copy: next.copy,
      }
      baseline = JSON.stringify(form.value)
      staged.value = []
    } catch (cause) {
      if (owner === generation) profileError.value = reason(cause)
    } finally {
      if (owner === generation) loading.value = false
    }
  }
  function updateForm(next: KnowledgeProductProfileForm) {
    if (profile.value) form.value = { ...next }
  }
  async function addImages() {
    if (!profile.value || saving.value || staging.value) return
    const owner = generation,
      shop = options.storeId.value,
      current = profile.value,
      service = options.client()
    staging.value = true
    profileError.value = ''
    try {
      const images = await service.stageProductImages({
        storeId: shop,
        bindingId: current.binding.id,
        expectedBindingRevision: current.binding.revision,
        expectedManualSourceId: current.manualSourceId,
        expectedManualSourceRevision: current.manualSourceRevision,
      })
      if (
        owner !== generation ||
        shop !== options.storeId.value ||
        profile.value?.binding.id !== current.binding.id
      ) {
        await service.discardStagedProductImages(images.map((image) => image.token)).catch(() => {})
        return
      }
      staged.value = [...staged.value, ...images]
    } catch (cause) {
      if (owner === generation) profileError.value = reason(cause)
    } finally {
      if (owner === generation) staging.value = false
    }
  }
  async function removeStaged(token: string) {
    staged.value = staged.value.filter((image) => image.token !== token)
    await discardTokens([token])
  }
  async function save() {
    if (!profile.value || !form.value || saving.value) return false
    const owner = generation,
      shop = options.storeId.value,
      current = profile.value,
      title = form.value.title.trim()
    if (!title) {
      profileError.value = '请填写商品标题'
      return false
    }
    saving.value = true
    profileError.value = ''
    let result: KnowledgeProductProfile
    try {
      result = await options.client().saveProductProfile({
        storeId: shop,
        bindingId: current.binding.id,
        expectedBindingRevision: current.binding.revision,
        expectedManualSourceId: current.manualSourceId,
        expectedManualSourceRevision: current.manualSourceRevision,
        title,
        manualPrice: form.value.manualPrice,
        notes: form.value.notes,
        copy: form.value.copy,
        imageTokens: staged.value.map((image) => image.token),
      })
    } catch (cause) {
      if (owner === generation) profileError.value = reason(cause)
      saving.value = false
      return false
    }
    if (owner !== generation || shop !== options.storeId.value) {
      saving.value = false
      return false
    }
    // The write is committed. Closing/refreshing is presentation-only and must never be
    // reported as a write failure or leave a re-submittable form.
    staged.value = []
    profile.value = result
    options.notice.value = '商品资料已保存'
    profileError.value = ''
    saving.value = false
    await close(false)
    try {
      await options.refresh()
    } catch (cause) {
      options.error.value = `商品资料已保存，但列表刷新失败：${reason(cause)}`
    }
    return true
  }
  async function prepareLeave() {
    if (!profile.value) return true
    if (saving.value) {
      options.error.value = '正在保存商品资料，请稍候再切换'
      return false
    }
    if (staging.value) {
      options.error.value = '正在选择商品图片，请稍候再切换'
      return false
    }
    if (dirty.value) {
      options.error.value = '商品资料有未保存修改，请先保存或取消商品编辑'
      return false
    }
    await close(false)
    return true
  }
  function setError(message: string) {
    profileError.value = message
  }
  function reset() {
    void close()
    returnFocus = undefined
  }
  return {
    profile,
    form,
    staged,
    loading,
    saving,
    staging,
    error: profileError,
    dirty,
    returnFocus: () => returnFocus,
    open,
    close,
    updateForm,
    addImages,
    removeStaged,
    save,
    prepareLeave,
    setError,
    reset,
  }
}

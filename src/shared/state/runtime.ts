import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { getBackendBridge } from '../platform/backend'
import { emptySnapshot, type CommandInput } from '../contracts/backend'

/** 跨页面只共享真实快照与店铺选择，表单草稿属于各业务模块。 */
export const useRuntimeStore = defineStore('local-runtime', () => {
  const snapshot = ref(emptySnapshot()),
    loading = ref(false),
    error = ref(''),
    selected = ref('')
  const platformStoreId = ref('')
  const bridge = getBackendBridge(),
    available = Boolean(bridge)
  let ticket = 0,
    off: (() => void) | undefined,
    timer: ReturnType<typeof setTimeout> | undefined
  const selectedStoreId = computed({
    get: () =>
      snapshot.value.stores.some((s) => s.id === selected.value)
        ? selected.value
        : snapshot.value.selection.storeId || snapshot.value.stores[0]?.id || '',
    set: (id: string) => {
      selected.value = id
    },
  })
  const currentStore = computed(() =>
    snapshot.value.stores.find((s) => s.id === selectedStoreId.value),
  )
  async function refresh(): Promise<void> {
    if (!bridge) return
    const current = ++ticket
    loading.value = true
    try {
      const next = await bridge.snapshot()
      if (current === ticket) {
        snapshot.value = next
        error.value = ''
      }
    } catch (cause) {
      if (current === ticket) error.value = cause instanceof Error ? cause.message : String(cause)
    } finally {
      if (current === ticket) loading.value = false
    }
  }
  function start(): void {
    if (!bridge || off) return
    off = bridge.subscribe(() => {
      if (!timer)
        timer = setTimeout(() => {
          timer = undefined
          void refresh()
        }, 80)
    })
    void refresh()
  }
  async function run(command: CommandInput) {
    if (!bridge) throw new Error('此操作需要桌面版；浏览器仅提供界面预览')
    if (!snapshot.value.workspaceId) await refresh()
    if (!snapshot.value.workspaceId) throw new Error(error.value || '本地服务尚未就绪')
    try {
      return await bridge.execute({
        ...command,
        values: command.values ?? {},
        workspaceId: snapshot.value.workspaceId,
      })
    } finally {
      await refresh()
    }
  }
  async function presentStore(storeId: string, visible: boolean): Promise<void> {
    if (bridge) await bridge.presentStore(storeId, visible)
  }
  function dispose(): void {
    ticket++
    off?.()
    off = undefined
    clearTimeout(timer)
    timer = undefined
  }
  return {
    snapshot,
    available,
    loading,
    error,
    selectedStoreId,
    currentStore,
    platformStoreId,
    refresh,
    run,
    start,
    dispose,
    presentStore,
  }
})

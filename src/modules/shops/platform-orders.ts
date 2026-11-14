import { computed, inject, onBeforeUnmount, ref, watch, type InjectionKey } from 'vue'
import { useRuntimeStore } from '@/shared/state/runtime'
import { downloadText } from '@/shared/platform/files'
import {
  platformOrderSnapshotSchema,
  summarizeOrders,
  type PlatformOrderRequest,
  type PlatformOrderSnapshot,
  type PlatformOrderTransport,
} from '@/shared/contracts/platform-orders'

export const platformOrderTransportKey: InjectionKey<PlatformOrderTransport> = Symbol(
  'platform-order-transport',
)
const today = () =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
const errorMessage = (cause: unknown) =>
  (cause instanceof Error ? cause.message : '订单读取失败').replace(
    /^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/,
    '',
  )
export function usePlatformOrders() {
  const runtime = useRuntimeStore()
  const transport = inject(platformOrderTransportKey, null)
  const state = ref<PlatformOrderSnapshot | null>(null),
    error = ref(''),
    busy = ref(false)
  const from = ref(today()),
    to = ref(today()),
    importConfirmed = ref(false),
    page = ref(1)
  const identity = computed(() => `${runtime.snapshot.workspaceId}|${runtime.selectedStoreId}`)
  let epoch = 0,
    disposed = false,
    refreshingEpoch: number | null = null
  const request = async (input: PlatformOrderRequest) => {
    if (!transport) throw Error('平台订单服务尚未连接，请使用桌面版')
    const current = epoch
    const value = platformOrderSnapshotSchema.parse(await transport.request(input))
    if (disposed || current !== epoch) return
    if (
      value.workspaceId !== runtime.snapshot.workspaceId ||
      value.storeId !== runtime.selectedStoreId
    )
      return
    state.value = value
  }
  async function refresh() {
    if (
      !transport ||
      !runtime.selectedStoreId ||
      !runtime.snapshot.workspaceId ||
      refreshingEpoch === epoch
    )
      return
    const current = epoch
    refreshingEpoch = current
    try {
      await request({
        type: 'snapshot',
        workspaceId: runtime.snapshot.workspaceId,
        storeId: runtime.selectedStoreId,
      })
      if (current === epoch) error.value = ''
    } catch (cause) {
      if (current === epoch) error.value = errorMessage(cause)
    } finally {
      if (refreshingEpoch === current) refreshingEpoch = null
    }
  }
  async function action(type: 'read' | 'cancel') {
    if (!transport || busy.value || !runtime.selectedStoreId) return
    const current = epoch
    busy.value = true
    error.value = ''
    try {
      const common = { workspaceId: runtime.snapshot.workspaceId, storeId: runtime.selectedStoreId }
      if (type === 'read')
        await request({
          ...common,
          type,
          range: {
            from: from.value,
            to: to.value,
            timezone: 'Asia/Shanghai',
            timeField: 'created',
            status: 'all',
          },
        })
      else if (state.value?.task) await request({ ...common, type, taskId: state.value.task.id })
    } catch (cause) {
      if (current === epoch) error.value = errorMessage(cause)
    } finally {
      if (current === epoch) busy.value = false
    }
  }
  async function importFile(file: File) {
    if (!transport || !importConfirmed.value || !runtime.selectedStoreId || busy.value) return
    if (file.size > 8 * 1024 * 1024) {
      error.value = 'CSV文件不能超过8 MiB'
      return
    }
    const current = epoch,
      storeId = runtime.selectedStoreId,
      workspaceId = runtime.snapshot.workspaceId
    busy.value = true
    error.value = ''
    try {
      const csv = await file.text()
      if (current !== epoch || disposed) return
      await request({
        type: 'import',
        workspaceId,
        storeId,
        csv,
        confirmed: true,
        range: {
          from: from.value,
          to: to.value,
          timezone: 'Asia/Shanghai',
          timeField: 'created',
          status: 'all',
        },
      })
    } catch (cause) {
      if (current === epoch) error.value = errorMessage(cause)
    } finally {
      if (current === epoch) busy.value = false
    }
  }
  watch(
    identity,
    () => {
      epoch++
      state.value = null
      error.value = ''
      busy.value = false
      page.value = 1
      importConfirmed.value = false
      void refresh()
    },
    { immediate: true, flush: 'sync' },
  )
  const timer = setInterval(() => {
    if (state.value?.task?.state === 'reading') void refresh()
  }, 2000)
  onBeforeUnmount(() => {
    disposed = true
    epoch++
    clearInterval(timer)
  })
  const report = computed(() => state.value?.report ?? null)
  const summary = computed(() => (report.value ? summarizeOrders(report.value.records) : null))
  const rows = computed(
    () => report.value?.records.slice((page.value - 1) * 50, page.value * 50) ?? [],
  )
  const reading = computed(() => state.value?.task?.state === 'reading')
  const exportReport = () => {
    if (!report.value || busy.value || reading.value) return
    downloadText(
      `platform-orders-${report.value.range.from}-${report.value.range.to}.json`,
      JSON.stringify(
        {
          ...report.value,
          exportedAt: new Date().toISOString(),
          amountMeaning: report.value.receivedLabel,
          netRevenue: null,
          completenessNote: report.value.complete
            ? '原生查询范围和平台总数已核对'
            : 'CSV文件未与平台总数核对，不代表完整平台订单',
        },
        null,
        2,
      ),
    )
  }
  return {
    runtime,
    transport,
    state,
    report,
    summary,
    rows,
    from,
    to,
    page,
    error,
    busy,
    reading,
    importConfirmed,
    refresh,
    action,
    importFile,
    exportReport,
  }
}

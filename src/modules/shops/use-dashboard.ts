import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useRuntimeStore } from '@/shared/state/runtime'
import { intentsSchema, type IntentPack } from '@/shared/contracts/backend'
import { downloadText } from '@/shared/platform/files'
import { buildDashboard, dashboardExport, type DashboardPeriod } from './dashboard'

/** 意图包读取通过现有命令，按工作区与请求序号隔离，避免快照刷新触发读取循环。 */
export function useDashboard() {
  const runtime = useRuntimeStore()
  const period = ref<DashboardPeriod>('today'),
    now = ref(Date.now())
  const packs = ref<IntentPack[] | null>(null),
    intentError = ref(''),
    intentLoading = ref(false)
  const intentReadAt = ref<number | null>(null),
    snapshotReadAt = ref<number | null>(null)
  const refreshing = ref(false)
  let request = 0,
    disposed = false
  const workspaceAccessible = computed(() => {
    const managed = runtime.snapshot.managed
    return (
      managed.active.mode === 'local' ||
      (!managed.restartRequired &&
        managed.session.account !== null &&
        ['signed_in', 'offline'].includes(managed.session.status))
    )
  })
  const ready = computed(
    () => runtime.available && Boolean(runtime.snapshot.workspaceId) && workspaceAccessible.value,
  )
  const accessMessage = computed(() =>
    runtime.snapshot.managed.restartRequired
      ? '账号或模型来源已切换，请重启客户端后读取当前工作区。'
      : '托管工作区尚不可用，请登录并验证账号后读取数据。',
  )
  const summary = computed(() =>
    buildDashboard(runtime.snapshot, packs.value, period.value, now.value),
  )
  const timer = setInterval(() => {
    now.value = Date.now()
  }, 10000)
  watch(
    () => runtime.snapshot,
    () => {
      if (ready.value && !runtime.error) snapshotReadAt.value = Date.now()
    },
    { immediate: true },
  )
  async function loadIntents() {
    if (!ready.value) return
    const workspaceId = runtime.snapshot.workspaceId,
      current = ++request
    intentLoading.value = true
    intentError.value = ''
    try {
      const result = await runtime.run({ action: 'list-intent-packs' })
      if (disposed || current !== request || workspaceId !== runtime.snapshot.workspaceId) return
      packs.value = intentsSchema.parse(result.data).packs
      intentReadAt.value = Date.now()
    } catch (cause) {
      if (!disposed && current === request && workspaceId === runtime.snapshot.workspaceId)
        intentError.value = cause instanceof Error ? cause.message : String(cause)
    } finally {
      if (!disposed && current === request) intentLoading.value = false
    }
  }
  watch(
    [
      () => runtime.snapshot.workspaceId,
      () => ready.value,
      () => runtime.snapshot.managed.session.account?.userId,
    ],
    () => {
      request++
      packs.value = null
      intentError.value = ''
      intentReadAt.value = null
      snapshotReadAt.value = ready.value && !runtime.error ? Date.now() : null
      intentLoading.value = false
      void loadIntents()
    },
    { immediate: true },
  )
  async function refresh() {
    if (refreshing.value || !runtime.available) return
    refreshing.value = true
    try {
      await runtime.refresh()
      if (ready.value && !runtime.error) snapshotReadAt.value = Date.now()
      await loadIntents()
      now.value = Date.now()
    } finally {
      refreshing.value = false
    }
  }
  const errors = computed(() => [runtime.error, intentError.value].filter(Boolean).join('；'))
  const busy = computed(() => refreshing.value || runtime.loading || intentLoading.value)
  function exportSummary() {
    if (!ready.value || busy.value) return
    const payload = {
      ...dashboardExport(summary.value, period.value, Date.now()),
      freshness: {
        snapshotReadAt: snapshotReadAt.value,
        intentReadAt: intentReadAt.value,
        stale: Boolean(errors.value),
        errors: [
          runtime.error ? '快照读取失败' : '',
          intentError.value ? '意图包读取失败' : '',
        ].filter(Boolean),
      },
    }
    downloadText(
      `数据看板-${new Date(now.value).toISOString().slice(0, 10)}.json`,
      JSON.stringify(payload, null, 2),
    )
  }
  onBeforeUnmount(() => {
    disposed = true
    request++
    clearInterval(timer)
  })
  return {
    runtime,
    period,
    now,
    ready,
    workspaceAccessible,
    accessMessage,
    summary,
    busy,
    errors,
    intentError,
    intentReadAt,
    snapshotReadAt,
    refresh,
    exportSummary,
  }
}

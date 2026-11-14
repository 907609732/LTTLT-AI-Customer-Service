import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { getDesktop } from '@/shared/platform/desktop'
import { useRuntimeStore } from '@/shared/state/runtime'
import { useTask } from '@/shared/ui/use-task'
import {
  defaultAssistPreferences,
  type AssistPreferencesPatch,
  type AssistWindowState,
} from '@/shared/contracts/assist'
import type { Conversation, WorkOrder } from '@/shared/contracts/backend'
import type {
  PlatformItemsSnapshot,
  PlatformItem,
  PlatformItemsStore,
} from '@/shared/contracts/platform-items'
import { browseGenericPhrases, type GenericPhrase } from '@/shared/customer-service/library'
import {
  conversationKey,
  conversationVersion,
  conversationTime,
  createAssistAlertTracker,
  type AssistTab,
} from './assist-model'
import { playAssistSound } from './services/assist-sound'

export function useAssistCenter() {
  const runtime = useRuntimeStore(),
    desktop = getDesktop(),
    task = useTask(),
    router = useRouter()
  const tab = ref<AssistTab>('consult'),
    consultStatus = ref('pending'),
    ticketMode = ref('platform')
  const storeFilter = ref(''),
    chosen = ref(''),
    text = ref(''),
    hidden = ref<Record<string, string>>({})
  const preferences = ref<AssistWindowState>({
    ...defaultAssistPreferences(),
    workspaceId: '',
    open: false,
    isAssistWindow: false,
  })
  const settingsOpen = ref(false),
    soundOpen = ref(false),
    closeOpen = ref(false),
    phrasesOpen = ref(false)
  const correctionOpen = ref(false),
    correctionMessageTs = ref<number>(),
    correctionAnswer = ref(''),
    correctionConfirmed = ref(false)
  const phraseQuery = ref(''),
    workOrder = ref<WorkOrder>(),
    orderNote = ref('')
  const platform = ref<PlatformItemsSnapshot>({ workspaceId: '', stores: [] }),
    platformBusy = ref(false),
    platformError = ref('')
  const drafts = new Map<string, string>(),
    dirtyDrafts = new Set<string>(),
    alertTracker = createAssistAlertTracker(),
    platformTrackers = new Map<string, ReturnType<typeof createAssistAlertTracker>>()
  let epoch = 0,
    disposed = false,
    offState: (() => void) | undefined,
    offClose: (() => void) | undefined,
    timer: ReturnType<typeof setInterval> | undefined
  const scoped = computed(() =>
    runtime.snapshot.conversations.filter(
      (row) =>
        runtime.snapshot.stores.some((shop) => shop.id === row.storeId) &&
        (!storeFilter.value || storeFilter.value === row.storeId),
    ),
  )
  const byStatus = (status: string) => scoped.value.filter((row) => row.status === status)
  const pending = computed(() => byStatus('pending')),
    replied = computed(() => byStatus('replied')),
    handoffs = computed(() => byStatus('handoff'))
  const rows = computed(() =>
    (tab.value === 'handoff'
      ? handoffs.value
      : consultStatus.value === 'pending'
        ? pending.value
        : replied.value
    )
      .filter((row) => hidden.value[conversationKey(row)] !== conversationVersion(row))
      .sort((a, b) =>
        preferences.value.sort === 'newest'
          ? conversationTime(b) - conversationTime(a)
          : conversationTime(a) - conversationTime(b),
      ),
  )
  const current = computed(() => scoped.value.find((row) => conversationKey(row) === chosen.value))
  const currentStore = computed(() =>
    runtime.snapshot.stores.find((shop) => shop.id === current.value?.storeId),
  )
  const canSend = computed(
    () =>
      runtime.available &&
      Boolean(current.value && currentStore.value?.runtime.online && text.value.trim()) &&
      !task.pending.value,
  )
  const orders = computed(() =>
    runtime.snapshot.workOrders.filter(
      (row) =>
        row.status !== 'done' &&
        runtime.snapshot.stores.some((shop) => shop.id === row.storeId) &&
        (!storeFilter.value || row.storeId === storeFilter.value),
    ),
  )
  const platformKind = computed(() =>
    tab.value === 'aftersale' ? ('aftersale' as const) : ('ticket' as const),
  )
  const platformStores = computed(() =>
    platform.value.workspaceId === runtime.snapshot.workspaceId
      ? platform.value.stores.filter(
          (row) =>
            row.kind === platformKind.value &&
            (!storeFilter.value || row.storeId === storeFilter.value),
        )
      : [],
  )
  const platformCount = (kind: 'ticket' | 'aftersale') => {
    const records =
      platform.value.workspaceId === runtime.snapshot.workspaceId
        ? platform.value.stores.filter(
            (row) => row.kind === kind && (!storeFilter.value || row.storeId === storeFilter.value),
          )
        : []
    return !records.length || records.some((row) => row.total === null || row.status !== 'success')
      ? '—'
      : String(records.reduce((sum, row) => sum + (row.total ?? 0), 0))
  }
  const phrases = computed(() => browseGenericPhrases(phraseQuery.value).slice(0, 30))
  const ticketCount = computed(() => {
    const count = platformCount('ticket')
    return count === '—' ? '—' : String(Number(count) + orders.value.length)
  })
  const buyerMessages = computed(
    () =>
      current.value?.messages.filter(
        (message) => message.from === 'buyer' && (!message.type || message.type === 'text'),
      ) ?? [],
  )
  const qualityRecord = computed(() =>
    runtime.snapshot.quality.find(
      (row) => row.storeId === current.value?.storeId && row.uid === current.value?.uid,
    ),
  )
  const storeName = (id: string) =>
    runtime.snapshot.stores.find((shop) => shop.id === id)?.storeName || '店铺已移除'
  const storePlatform = (id: string) =>
    runtime.snapshot.stores.find((shop) => shop.id === id)?.platform || ''
  function receptionState(row: Conversation): string {
    const shop = runtime.snapshot.stores.find((item) => item.id === row.storeId)
    if (!shop?.runtime.online) return '离线'
    if (row.status === 'handoff') return '待人工'
    if (!shop.aiEnabled) return 'AI关闭'
    if (runtime.snapshot.engine[row.storeId]?.paused) return 'AI暂停'
    if (!runtime.snapshot.engine[row.storeId]?.running) return '待就绪'
    return '接待'
  }
  function runTask(job: () => Promise<void>) {
    const version = epoch
    return task.run(async () => {
      try {
        await job()
      } catch (error) {
        if (version === epoch && !disposed) throw error
      }
    })
  }
  function remember() {
    if (current.value && dirtyDrafts.has(conversationKey(current.value)))
      drafts.set(conversationKey(current.value), text.value)
  }
  function markDraftEdited() {
    if (!current.value) return
    dirtyDrafts.add(conversationKey(current.value))
    drafts.set(conversationKey(current.value), text.value)
  }
  async function select(row: Conversation) {
    if (task.pending.value) return
    remember()
    const version = epoch,
      workspace = runtime.snapshot.workspaceId
    const ok = await runTask(async () => {
      runtime.selectedStoreId = row.storeId
      try {
        await runtime.run({
          action: 'select-conversation',
          storeId: row.storeId,
          conversationId: row.uid,
        })
      } catch (error) {
        if (version === epoch) throw error
      }
    })
    if (ok && version === epoch && workspace === runtime.snapshot.workspaceId) {
      chosen.value = conversationKey(row)
      text.value =
        drafts.get(chosen.value) ??
        runtime.snapshot.auxiliary.drafts.find(
          (draft) => draft.storeId === row.storeId && draft.uid === row.uid,
        )?.text ??
        ''
    }
  }
  async function saveDraft() {
    const row = current.value,
      draft = text.value,
      version = epoch
    if (!row) return
    remember()
    await runTask(async () => {
      try {
        await runtime.run({
          action: 'save-auxiliary-draft',
          storeId: row.storeId,
          conversationId: row.uid,
          values: { text: draft },
        })
      } catch (error) {
        if (version === epoch) throw error
      }
      if (version === epoch) task.message.value = '草稿已保存在本机'
    })
  }
  async function send() {
    const row = current.value,
      reply = text.value.trim(),
      version = epoch
    if (!row || !canSend.value) return
    drafts.set(conversationKey(row), reply)
    dirtyDrafts.add(conversationKey(row))
    await runTask(async () => {
      try {
        await runtime.run({
          action: 'save-auxiliary-draft',
          storeId: row.storeId,
          conversationId: row.uid,
          values: { text: reply },
        })
        if (version !== epoch) return
        const result = await runtime.run({
          action: 'send-reply',
          storeId: row.storeId,
          conversationId: row.uid,
          values: { reply },
        })
        if (version !== epoch) return
        if (result.data.confirmed !== true)
          throw new Error('发送未确认，请到平台核对；草稿已保留，不会自动重发')
        drafts.delete(conversationKey(row))
        dirtyDrafts.delete(conversationKey(row))
        if (chosen.value === conversationKey(row) && text.value.trim() === reply) text.value = ''
        task.message.value = result.message
      } catch (error) {
        if (version === epoch) throw error
      }
    })
  }
  function clearReplied() {
    hidden.value = {
      ...hidden.value,
      ...Object.fromEntries(
        replied.value.map((row) => [conversationKey(row), conversationVersion(row)]),
      ),
    }
  }
  function selectTab(value: AssistTab) {
    remember()
    if (tab.value !== value) {
      chosen.value = ''
      text.value = ''
    }
    tab.value = value
    task.error.value = ''
    task.message.value = ''
  }
  async function focusCurrent() {
    const row = current.value
    if (row)
      await runTask(async () => {
        if (!desktop.openAssistConversation) throw new Error('定位平台会话需要桌面辅助中心')
        await desktop.openAssistConversation({
          workspaceId: runtime.snapshot.workspaceId,
          storeId: row.storeId,
          conversationId: row.uid,
        })
      })
  }
  async function resume() {
    const row = current.value
    if (row)
      await runTask(async () => {
        await runtime.run({
          action: 'resume-conversation',
          storeId: row.storeId,
          conversationId: row.uid,
        })
      })
  }
  async function updatePreferences(patch: AssistPreferencesPatch) {
    const version = epoch
    await runTask(async () => {
      if (!desktop.updateAssistPreferences || !preferences.value.isAssistWindow)
        throw new Error('请从桌面主窗口打开辅助中心浮窗后设置')
      const state = await desktop.updateAssistPreferences(patch, preferences.value.workspaceId)
      if (version === epoch && state.workspaceId === runtime.snapshot.workspaceId)
        preferences.value = state
    })
  }
  async function soundTest() {
    await runTask(() => playAssistSound(preferences.value.volume))
  }
  function insertPhrase(phrase: GenericPhrase) {
    if (!current.value || task.pending.value) return
    text.value = text.value ? `${text.value}\n${phrase.reply}` : phrase.reply
    phrasesOpen.value = false
    markDraftEdited()
  }
  function keydown(event: KeyboardEvent) {
    if (
      event.isComposing ||
      event.keyCode === 229 ||
      event.defaultPrevented ||
      settingsOpen.value ||
      correctionOpen.value ||
      closeOpen.value ||
      phrasesOpen.value
    )
      return
    if (event.ctrlKey && event.key === 'Tab') {
      event.preventDefault()
      if (rows.value.length && !task.pending.value) {
        const index = rows.value.findIndex((row) => conversationKey(row) === chosen.value)
        void select(
          rows.value[(index + (event.shiftKey ? rows.value.length - 1 : 1)) % rows.value.length]!,
        )
      }
    }
    if (
      event.key === 'Enter' &&
      !event.shiftKey &&
      !event.ctrlKey &&
      event.target instanceof HTMLTextAreaElement
    ) {
      event.preventDefault()
      void send()
    }
  }
  function openCorrection() {
    correctionMessageTs.value = buyerMessages.value.at(-1)?.ts
    correctionAnswer.value = ''
    correctionConfirmed.value = false
    correctionOpen.value = true
  }
  async function correct() {
    const row = current.value,
      record = qualityRecord.value,
      message = buyerMessages.value.find((item) => item.ts === correctionMessageTs.value),
      version = epoch
    await runTask(async () => {
      if (!row || !record || !message)
        throw new Error('当前会话没有可用的质检记录或原始买家文字，请重新同步会话')
      if (!correctionAnswer.value.trim() || !correctionConfirmed.value)
        throw new Error('请填写标准答案并确认保存为本店知识')
      await runtime.run({
        action: 'learn-conversation-correction',
        storeId: row.storeId,
        conversationId: row.uid,
        values: {
          recordId: record.id,
          version: record.version,
          question: message.content,
          messageTs: message.ts,
          answer: correctionAnswer.value.trim(),
          confirmed: true,
        },
      })
      if (version === epoch) {
        correctionOpen.value = false
        task.message.value = '标准答案已保存为本店知识，未发送消息'
      }
    })
  }
  async function setOrderStatus(status: WorkOrder['status']) {
    const order = workOrder.value,
      version = epoch
    if (!order) return
    await runTask(async () => {
      await runtime.run({ action: 'set-work-order-status', values: { id: order.id, status } })
      if (version === epoch && workOrder.value?.id === order.id)
        workOrder.value = runtime.snapshot.workOrders.find((row) => row.id === order.id)
    })
  }
  async function addOrderNote() {
    const order = workOrder.value,
      note = orderNote.value.trim(),
      version = epoch
    if (!order || !note) return
    await runTask(async () => {
      await runtime.run({ action: 'add-work-order-note', values: { id: order.id, text: note } })
      if (version === epoch && workOrder.value?.id === order.id) {
        if (orderNote.value.trim() === note) orderNote.value = ''
        workOrder.value = runtime.snapshot.workOrders.find((row) => row.id === order.id)
      }
    })
  }
  async function openMain(section: 'workorder' | 'settings') {
    await runTask(async () => {
      if (!desktop.openMainSection) throw new Error('请从桌面主窗口进入配置中心')
      await desktop.openMainSection(section)
    })
  }
  async function syncPlatform(refresh = false) {
    if (platformBusy.value || !runtime.snapshot.workspaceId) return
    const version = epoch,
      workspaceId = runtime.snapshot.workspaceId
    platformBusy.value = true
    platformError.value = ''
    try {
      if (!desktop.assistPlatformSnapshot || !desktop.refreshAssistPlatform)
        throw new Error('平台工单与售后同步需要桌面辅助中心服务')
      const result = refresh
        ? await desktop.refreshAssistPlatform({
            workspaceId,
            ...(storeFilter.value ? { storeId: storeFilter.value } : {}),
          })
        : await desktop.assistPlatformSnapshot()
      if (version === epoch && result.workspaceId === runtime.snapshot.workspaceId)
        platform.value = result
    } catch (error) {
      if (version === epoch)
        platformError.value = error instanceof Error ? error.message : String(error)
    } finally {
      if (version === epoch) platformBusy.value = false
    }
  }
  async function openPlatform(record: PlatformItemsStore, item?: PlatformItem) {
    await runTask(async () => {
      if (!desktop.openAssistPlatformItem) throw new Error('平台页面需要桌面辅助中心服务')
      await desktop.openAssistPlatformItem({
        workspaceId: runtime.snapshot.workspaceId,
        storeId: record.storeId,
        kind: record.kind,
        ...(item ? { id: item.id } : {}),
      })
    })
  }
  async function confirmClose() {
    remember()
    const version = epoch
    await runTask(async () => {
      if (preferences.value.isAssistWindow && desktop.closeAssist) {
        // 浮窗销毁会清空内存草稿，确认关闭前保存本工作区内已编辑的顾客草稿。
        for (const [key, draft] of drafts) {
          if (version !== epoch) return
          const [storeId, uid] = JSON.parse(key) as [string, string]
          if (
            !runtime.snapshot.stores.some((shop) => shop.id === storeId) ||
            !runtime.snapshot.conversations.some(
              (row) => row.storeId === storeId && row.uid === uid,
            )
          )
            continue
          const stored = runtime.snapshot.auxiliary.drafts.find(
            (row) => row.storeId === storeId && row.uid === uid,
          )
          if ((stored?.text ?? '') === draft) continue
          try {
            await runtime.run({
              action: 'save-auxiliary-draft',
              storeId,
              conversationId: uid,
              values: { text: draft },
            })
          } catch (error) {
            if (version === epoch) throw error
            return
          }
        }
        if (version === epoch) await desktop.closeAssist()
      } else await router.push('/')
    })
  }
  async function minimize() {
    await runTask(async () => {
      if (!preferences.value.isAssistWindow) throw new Error('当前是页面预览，最小化仅支持辅助浮窗')
      await desktop.minimize()
    })
  }
  watch(
    () => runtime.snapshot.workspaceId,
    () => {
      epoch++
      chosen.value = ''
      text.value = ''
      drafts.clear()
      dirtyDrafts.clear()
      hidden.value = {}
      workOrder.value = undefined
      platformTrackers.clear()
      platform.value = { workspaceId: '', stores: [] }
      platformBusy.value = false
      platformError.value = ''
      correctionOpen.value = false
      phrasesOpen.value = false
      storeFilter.value = ''
      settingsOpen.value = false
      soundOpen.value = false
      closeOpen.value = false
      correctionAnswer.value = ''
      correctionMessageTs.value = undefined
      correctionConfirmed.value = false
      phraseQuery.value = ''
      orderNote.value = ''
      task.error.value = ''
      task.message.value = ''
      if (desktop.assistState)
        void desktop
          .assistState()
          .then((state) => {
            if (state.workspaceId === runtime.snapshot.workspaceId) preferences.value = state
          })
          .catch(() => {})
      void syncPlatform()
    },
  )
  watch(
    storeFilter,
    () => {
      const old = runtime.snapshot.conversations.find(
        (row) => conversationKey(row) === chosen.value,
      )
      if (old && dirtyDrafts.has(conversationKey(old))) drafts.set(conversationKey(old), text.value)
      chosen.value = ''
      text.value = ''
    },
    { flush: 'sync' },
  )
  watch(current, (next, old) => {
    if (!next && old) {
      chosen.value = ''
      text.value = ''
    }
  })
  watch(
    consultStatus,
    () => {
      remember()
      chosen.value = ''
      text.value = ''
    },
    { flush: 'sync' },
  )
  watch(
    () => workOrder.value?.id,
    () => {
      orderNote.value = ''
    },
    { flush: 'sync' },
  )
  const alertEvents = computed(() => {
    const kinds = preferences.value.alertKinds,
      events: string[] = []
    if (kinds.includes('consult'))
      for (const row of pending.value)
        events.push(`consult:${conversationKey(row)}:${conversationVersion(row)}`)
    if (kinds.includes('handoff'))
      for (const row of handoffs.value)
        events.push(`handoff:${conversationKey(row)}:${conversationVersion(row)}`)
    if (kinds.includes('ticket'))
      for (const order of orders.value)
        events.push(`local-ticket:${order.id}:${order.status}:${order.updatedAt}`)
    return events
  })
  function playAlert() {
    const version = epoch
    void playAssistSound(preferences.value.volume).catch((error) => {
      if (version === epoch && !disposed)
        task.error.value = error instanceof Error ? error.message : '提示音播放失败'
    })
  }
  watch(
    () => JSON.stringify([preferences.value.soundEnabled, preferences.value.alertKinds]),
    () => {
      alertTracker.reset()
      platformTrackers.clear()
      // 偏好变化只重建当前基线；不能把刚启用类别的历史事项当新事件。
      alertTracker.update(runtime.snapshot.workspaceId, alertEvents.value)
    },
    { flush: 'sync' },
  )
  watch(
    alertEvents,
    (events) => {
      const fresh = alertTracker.update(runtime.snapshot.workspaceId, events)
      if (fresh && preferences.value.isAssistWindow && preferences.value.soundEnabled) playAlert()
    },
    { immediate: true },
  )
  watch(platform, (snapshot) => {
    if (snapshot.workspaceId !== runtime.snapshot.workspaceId) return
    let fresh = false
    for (const record of snapshot.stores) {
      if (record.status !== 'success') continue
      const key = `${record.storeId}:${record.kind}`
      let tracker = platformTrackers.get(key)
      if (!tracker) {
        tracker = createAssistAlertTracker()
        platformTrackers.set(key, tracker)
      }
      const added = tracker.update(
        snapshot.workspaceId,
        record.items.map((item) => `${item.id}:${item.status}:${item.updatedAt ?? ''}`),
      )
      if (added && preferences.value.alertKinds.includes(record.kind)) fresh = true
    }
    if (fresh && preferences.value.isAssistWindow && preferences.value.soundEnabled) playAlert()
  })
  onMounted(async () => {
    const version = epoch
    if (desktop.onAssistState)
      offState = desktop.onAssistState((state) => {
        if (state.workspaceId === runtime.snapshot.workspaceId) preferences.value = state
      })
    if (desktop.onAssistCloseRequest)
      offClose = desktop.onAssistCloseRequest(() => {
        closeOpen.value = true
      })
    try {
      const state = await desktop.assistState?.()
      if (state && state.workspaceId === runtime.snapshot.workspaceId) preferences.value = state
    } catch (error) {
      if (version === epoch && !disposed)
        task.error.value = error instanceof Error ? error.message : '辅助中心状态读取失败'
    }
    await syncPlatform()
    if (disposed) return
    // 实际采集由主进程统一调度；渲染页只读取快照，避免最小化或重复窗口产生双重请求。
    timer = setInterval(() => {
      void syncPlatform()
    }, 5000)
  })
  onBeforeUnmount(() => {
    disposed = true
    epoch++
    offState?.()
    offClose?.()
    if (timer) clearInterval(timer)
  })
  return {
    runtime,
    task,
    tab,
    consultStatus,
    ticketMode,
    storeFilter,
    chosen,
    text,
    preferences,
    settingsOpen,
    soundOpen,
    closeOpen,
    phrasesOpen,
    correctionOpen,
    correctionMessageTs,
    correctionAnswer,
    correctionConfirmed,
    phraseQuery,
    phrases,
    buyerMessages,
    qualityRecord,
    workOrder,
    orderNote,
    platformBusy,
    platformError,
    platformStores,
    platformCount,
    ticketCount,
    pending,
    replied,
    handoffs,
    rows,
    current,
    currentStore,
    canSend,
    orders,
    storeName,
    storePlatform,
    receptionState,
    markDraftEdited,
    select,
    saveDraft,
    send,
    clearReplied,
    selectTab,
    focusCurrent,
    resume,
    updatePreferences,
    soundTest,
    insertPhrase,
    keydown,
    openCorrection,
    correct,
    setOrderStatus,
    addOrderNote,
    openMain,
    syncPlatform,
    openPlatform,
    confirmClose,
    minimize,
  }
}

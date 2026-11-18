<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import RuntimePanel from '@/shared/ui/RuntimePanel.vue'
import StoreSelect from '@/shared/ui/StoreSelect.vue'
import { useRuntimeStore } from '@/shared/state/runtime'
import { useTask } from '@/shared/ui/use-task'
import { openKnowledgeManager } from '@/modules/knowledge'
import { RECEPTION_KEYWORDS_SCREEN, type ReceptionKeywordKind } from '@/shared/contracts/backend'
import { useReceptionOperations } from '../services/operations'
import OperationApprovalPanel from './OperationApprovalPanel.vue'
import ReceptionRulesPanel from './ReceptionRulesPanel.vue'
import { useReceptionDraftCache, type ReceptionSettingsDraft } from '../draft-cache'
import {
  normalizeWelcomeSetting,
  welcomeDelayIssue,
  welcomeSettingSchema,
  type NormalizedWelcomeSetting,
} from '@/shared/contracts/welcome'
import type { ReceptionCommand } from '@/shared/contracts/platform-operations'
import type { ReceptionHandoff, ReceptionSetupDraft, ReceptionWelcome } from '../setup'
const props = withDefaults(
  defineProps<{
    viewKey?: string
    storeId?: string
    embedded?: boolean
    /** 复用模式下接待内容随向导统一保存，不得单独写盘。 */
    deferredSave?: boolean
    setupDraft?: ReceptionSetupDraft | null
  }>(),
  { viewKey: 'transfer', storeId: '', embedded: false, deferredSave: false, setupDraft: null },
)
const emit = defineEmits<{
  busy: [value: boolean]
  'update:welcome': [value: ReceptionWelcome]
  'update:handoff': [value: ReceptionHandoff]
}>()
const runtime = useRuntimeStore(),
  task = useTask()
const deferred = computed(() => props.embedded && props.deferredSave && Boolean(props.setupDraft))
const drafts = props.embedded ? useReceptionDraftCache() : undefined
const receipts = useReceptionDraftCache()
let draftLease = {
  workspaceId: runtime.snapshot.workspaceId,
  storeId: props.storeId,
  view: props.viewKey,
}
const selectedStoreId = computed(() => props.storeId || runtime.selectedStoreId)
const titles: Record<string, string> = {
  transfer: '转接人工',
  welcome: '进店欢迎',
  auto: '自动操作',
  image: '图片识别',
}
const title = computed(() => titles[props.viewKey] || '接待配置')
const operations = useReceptionOperations(() => runtime.snapshot.workspaceId)
// 自动保存不冻结欢迎输入，但仍允许父级向导在保存期间锁定离开步骤。
const welcomeSaving = ref(false)
watch(
  [() => task.pending.value, () => operations.busy.value, welcomeSaving],
  ([pending, busy, saving]) => emit('busy', pending || busy || saving),
  { immediate: true },
)
const ruleTrigger = computed(() =>
  props.viewKey === 'welcome'
    ? ('visitor' as const)
    : props.viewKey === 'transfer'
      ? ('transfer-request' as const)
      : ('unpaid-order' as const),
)
const operationError = computed(() =>
  [
    ...new Set(
      [
        operations.error.value,
        operations.snapshot.value?.error,
        operations.snapshot.value?.facts.find((row) => row.storeId === selectedStoreId.value)
          ?.error,
      ].filter(
        (message) => message && message !== '读取真实平台能力失败，请打开平台并重新只读采集',
      ),
    ),
  ].join('；'),
)
const selectedRuns = computed(
  () =>
    operations.snapshot.value?.runs.filter((run) => run.storeId === selectedStoreId.value) ?? [],
)
const activeRuns = computed(() =>
  selectedRuns.value.filter((run) =>
    ['pending', 'uncertain', 'blocked', 'executing'].includes(run.state),
  ),
)
const historyRuns = computed(() =>
  selectedRuns.value.filter(
    (run) => !['pending', 'uncertain', 'blocked', 'executing'].includes(run.state),
  ),
)
const welcome = ref<NormalizedWelcomeSetting>(normalizeWelcomeSetting()),
  vision = ref({ enabled: false, version: 0 })
const inherited = ref(true),
  keywords = ref(''),
  globalKeywords = ref(''),
  manualKeywords = ref(''),
  manualExpected = ref<string[]>([]),
  globalExpected = ref<string[]>([]),
  globalEnabled = ref(true),
  manualEnabled = ref(true),
  fallbackEnabled = ref(false),
  fallbackSeconds = ref(15),
  fallbackText = ref('')
const cached = new Map<string, NormalizedWelcomeSetting>()
const cacheKey = (workspaceId: string, storeId: string) => JSON.stringify([workspaceId, storeId])
watch(
  () => runtime.snapshot.workspaceId,
  () => cached.clear(),
  { flush: 'sync' },
)
watch(
  welcome,
  (value) => {
    if (selectedStoreId.value)
      cached.set(cacheKey(runtime.snapshot.workspaceId, selectedStoreId.value), { ...value })
  },
  { deep: true },
)
let baseline: ReceptionSettingsDraft = {}
let loadRevision = 0
let unmounted = false
type KeywordField = ReceptionKeywordKind
interface KeywordTextQueue {
  generation: number
  running: boolean
  queued: string | null
}
interface KeywordSwitchQueue {
  generation: number
  running: boolean
  queued: boolean | null
}
interface HandoffSave {
  inherited: boolean
  keywords: string[]
}
interface HandoffQueue {
  generation: number
  running: boolean
  queued: HandoffSave | null
}
/** 欢迎自动保存只排队最新一份有效意图；版本在真正发送时读取，避免回执后仍用旧 CAS。 */
type WelcomeIntent = Omit<NormalizedWelcomeSetting, 'version'>
interface WelcomeQueue {
  generation: number
  running: boolean
  queued: WelcomeIntent | null
  inFlight: WelcomeIntent | null
}
const textQueues: Record<KeywordField, KeywordTextQueue> = {
  handoff: { generation: 0, running: false, queued: null },
  manual: { generation: 0, running: false, queued: null },
}
const switchQueues: Record<KeywordField, KeywordSwitchQueue> = {
  handoff: { generation: 0, running: false, queued: null },
  manual: { generation: 0, running: false, queued: null },
}
const textConfirmed: Record<KeywordField, { text: string; expected: string[] }> = {
  handoff: { text: '', expected: [] },
  manual: { text: '', expected: [] },
}
const switchConfirmed: Record<KeywordField, boolean> = { handoff: true, manual: true }
const handoffQueue: HandoffQueue = { generation: 0, running: false, queued: null }
let handoffConfirmed: HandoffSave = { inherited: true, keywords: [] }
const welcomeQueue: WelcomeQueue = {
  generation: 0,
  running: false,
  queued: null,
  inFlight: null,
}
let welcomeConfirmed = normalizeWelcomeSetting()
function resetKeywordAutosave(input: {
  globalKeywords: string[]
  globalExpected?: string[]
  manualKeywords: string[]
  manualExpected?: string[]
  handoffKeywords: string[]
  handoffInherited: boolean
  globalEnabled: boolean
  manualEnabled: boolean
}) {
  for (const kind of ['handoff', 'manual'] as const) {
    const textQueue = textQueues[kind]
    textQueue.generation += 1
    textQueue.running = false
    textQueue.queued = null
    const words = kind === 'handoff' ? input.globalKeywords : input.manualKeywords
    textConfirmed[kind] = {
      text: words.join('\n'),
      // 重挂的未保存草稿保留其载入时 CAS 基线，不能被新快照悄悄抬成“已确认”。
      expected:
        kind === 'manual'
          ? [...(input.manualExpected ?? words)]
          : [...(input.globalExpected ?? words)],
    }
    const switchQueue = switchQueues[kind]
    switchQueue.generation += 1
    switchQueue.running = false
    switchQueue.queued = null
    switchConfirmed[kind] = kind === 'handoff' ? input.globalEnabled : input.manualEnabled
  }
  handoffQueue.generation += 1
  handoffQueue.running = false
  handoffQueue.queued = null
  handoffConfirmed = {
    inherited: input.handoffInherited,
    keywords: [...input.handoffKeywords],
  }
}
const keywordLease = () => ({
  workspaceId: runtime.snapshot.workspaceId,
  storeId: selectedStoreId.value,
  view: props.viewKey,
  revision: loadRevision,
})
function keywordLeaseCurrent(lease: ReturnType<typeof keywordLease>) {
  return (
    !unmounted &&
    runtime.snapshot.workspaceId === lease.workspaceId &&
    selectedStoreId.value === lease.storeId &&
    props.viewKey === lease.view &&
    loadRevision === lease.revision
  )
}
function keywordError(cause: unknown) {
  return (cause instanceof Error ? cause.message : String(cause)).replace(
    /^Error invoking remote method '[^']+': (?:Error: )?/,
    '',
  )
}
function normalizedKeywordText(kind: KeywordField) {
  return lines(kind === 'handoff' ? globalKeywords.value : manualKeywords.value).join('\n')
}
function keywordWords(text: string) {
  return text ? text.split('\n') : []
}
function keywordSwitchValue(kind: KeywordField) {
  return kind === 'handoff' ? globalEnabled.value : manualEnabled.value
}
function setKeywordSwitchValue(kind: KeywordField, value: boolean) {
  if (kind === 'handoff') globalEnabled.value = value
  else manualEnabled.value = value
}
async function pumpKeywordText(kind: KeywordField) {
  const queue = textQueues[kind]
  if (queue.running) return
  queue.running = true
  const generation = queue.generation
  try {
    while (generation === queue.generation && queue.queued !== null && !unmounted) {
      const submittedText = queue.queued
      queue.queued = null
      if (submittedText === textConfirmed[kind].text) continue
      const submitted = keywordWords(submittedText)
      const lease = keywordLease()
      const expected = [...textConfirmed[kind].expected]
      task.error.value = ''
      let result
      try {
        result = await runtime.run({
          action: 'save-config',
          screenId: RECEPTION_KEYWORDS_SCREEN,
          values: {
            kind,
            mode: 'keywords',
            keywords: submitted,
            expectedKeywords: expected,
          },
        })
      } catch (cause) {
        if (generation === queue.generation) {
          queue.queued = null
          if (keywordLeaseCurrent(lease)) task.error.value = keywordError(cause)
        }
        return
      }
      if (result.status !== 'ok') {
        if (generation === queue.generation && keywordLeaseCurrent(lease))
          task.error.value = '无法确认保存结果，当前草稿仍保留；请稍后重试。'
        return
      }
      if (generation !== queue.generation || !keywordLeaseCurrent(lease)) return
      textConfirmed[kind] = { text: submittedText, expected: [...submitted] }
      if (kind === 'handoff') {
        globalExpected.value = [...submitted]
        baseline.globalKeywords = submittedText
      } else {
        manualExpected.value = [...submitted]
        baseline.manualKeywords = submittedText
      }
      ElMessage.success('保存成功')
    }
  } finally {
    if (generation === queue.generation) queue.running = false
  }
}
function requestKeywordTextSave(kind: KeywordField) {
  if (!runtime.available) return
  const queue = textQueues[kind]
  const text = normalizedKeywordText(kind)
  if (!queue.running && text === textConfirmed[kind].text && queue.queued === null) return
  if (queue.queued === text) return
  queue.queued = text
  void pumpKeywordText(kind)
}
async function pumpKeywordSwitch(kind: KeywordField) {
  const queue = switchQueues[kind]
  if (queue.running) return
  queue.running = true
  const generation = queue.generation
  try {
    while (generation === queue.generation && queue.queued !== null && !unmounted) {
      const enabled = queue.queued
      queue.queued = null
      if (enabled === switchConfirmed[kind]) continue
      const lease = keywordLease()
      const expectedEnabled = switchConfirmed[kind]
      task.error.value = ''
      let result
      try {
        result = await runtime.run({
          action: 'save-config',
          screenId: RECEPTION_KEYWORDS_SCREEN,
          values: { kind, mode: 'enabled', enabled, expectedEnabled },
        })
      } catch (cause) {
        if (generation === queue.generation) {
          queue.queued = null
          if (keywordLeaseCurrent(lease)) {
            setKeywordSwitchValue(kind, switchConfirmed[kind])
            task.error.value = keywordError(cause)
          }
        }
        return
      }
      if (result.status !== 'ok') {
        if (generation === queue.generation && keywordLeaseCurrent(lease)) {
          setKeywordSwitchValue(kind, switchConfirmed[kind])
          task.error.value = '无法确认保存结果，关键词开关未更改。'
        }
        return
      }
      if (generation !== queue.generation || !keywordLeaseCurrent(lease)) return
      switchConfirmed[kind] = enabled
      ElMessage.success('保存成功')
    }
  } finally {
    if (generation === queue.generation) queue.running = false
  }
}
function requestKeywordSwitch(kind: KeywordField) {
  const value = keywordSwitchValue(kind)
  if (!runtime.available) {
    setKeywordSwitchValue(kind, switchConfirmed[kind])
    return
  }
  const queue = switchQueues[kind]
  if (!queue.running && value === switchConfirmed[kind] && queue.queued === null) return
  if (queue.queued === value) return
  queue.queued = value
  void pumpKeywordSwitch(kind)
}
function normalizedHandoffSave(): HandoffSave {
  return {
    inherited: inherited.value,
    keywords: inherited.value ? [] : lines(keywords.value),
  }
}
function sameHandoff(left: HandoffSave, right: HandoffSave) {
  return (
    left.inherited === right.inherited &&
    (left.inherited ||
      (left.keywords.length === right.keywords.length &&
        left.keywords.every((word, index) => word === right.keywords[index])))
  )
}
async function pumpStoreHandoff() {
  if (deferred.value) return
  if (handoffQueue.running) return
  handoffQueue.running = true
  const generation = handoffQueue.generation
  try {
    while (generation === handoffQueue.generation && handoffQueue.queued !== null && !unmounted) {
      const submitted = handoffQueue.queued
      handoffQueue.queued = null
      if (sameHandoff(submitted, handoffConfirmed)) continue
      const changedMode = submitted.inherited !== handoffConfirmed.inherited
      const lease = keywordLease()
      task.error.value = ''
      let result
      try {
        result = await runtime.run({
          action: 'save-store-handoff',
          storeId: lease.storeId,
          values: submitted.inherited
            ? { mode: 'inherit' }
            : { mode: 'custom', keywords: submitted.keywords },
        })
      } catch (cause) {
        if (generation === handoffQueue.generation) {
          handoffQueue.queued = null
          if (keywordLeaseCurrent(lease)) {
            if (changedMode && inherited.value === submitted.inherited)
              inherited.value = handoffConfirmed.inherited
            task.error.value = keywordError(cause)
          }
        }
        return
      }
      if (result.status !== 'ok') {
        if (generation === handoffQueue.generation && keywordLeaseCurrent(lease))
          task.error.value = '无法确认本店关键词保存结果，当前草稿仍保留。'
        return
      }
      if (generation !== handoffQueue.generation || !keywordLeaseCurrent(lease)) return
      handoffConfirmed = {
        inherited: submitted.inherited,
        keywords: [...submitted.keywords],
      }
      baseline.inherited = submitted.inherited
      baseline.keywords = submitted.inherited ? '' : submitted.keywords.join('\n')
      if (submitted.inherited && inherited.value && handoffQueue.queued === null) {
        keywords.value = ''
      }
      ElMessage.success('保存成功')
    }
  } finally {
    if (generation === handoffQueue.generation) handoffQueue.running = false
  }
}
function requestStoreHandoffSave() {
  if (deferred.value || !runtime.available) return
  const submitted = normalizedHandoffSave()
  if (
    !handoffQueue.running &&
    sameHandoff(submitted, handoffConfirmed) &&
    handoffQueue.queued === null
  )
    return
  if (handoffQueue.queued && sameHandoff(submitted, handoffQueue.queued)) return
  handoffQueue.queued = submitted
  void pumpStoreHandoff()
}
function welcomeIntent(): WelcomeIntent {
  return {
    text: welcome.value.text,
    enabled: welcome.value.enabled,
    delayMinSeconds: welcome.value.delayMinSeconds,
    delayMaxSeconds: welcome.value.delayMaxSeconds,
  }
}
function sameWelcomeIntent(left: WelcomeIntent, right: WelcomeIntent) {
  return (
    left.text === right.text &&
    left.enabled === right.enabled &&
    left.delayMinSeconds === right.delayMinSeconds &&
    left.delayMaxSeconds === right.delayMaxSeconds
  )
}
function resetWelcomeAutosave(confirmed: NormalizedWelcomeSetting) {
  welcomeConfirmed = { ...confirmed }
  welcomeQueue.generation += 1
  welcomeQueue.running = false
  welcomeQueue.queued = null
  welcomeQueue.inFlight = null
}
async function pumpWelcome() {
  if (deferred.value || welcomeQueue.running) return
  welcomeQueue.running = true
  welcomeSaving.value = true
  const generation = welcomeQueue.generation
  try {
    while (generation === welcomeQueue.generation && welcomeQueue.queued && !unmounted) {
      const submitted = welcomeQueue.queued
      welcomeQueue.queued = null
      if (sameWelcomeIntent(submitted, welcomeConfirmed)) continue
      const issue = welcomeDelayIssue(submitted.delayMinSeconds, submitted.delayMaxSeconds)
      if (issue) {
        if (keywordLeaseCurrent(keywordLease())) task.error.value = issue
        return
      }
      if (welcomeConflict.value) {
        if (keywordLeaseCurrent(keywordLease()))
          task.error.value = '配置已更新，当前草稿仍保留；请重新载入后再保存。'
        return
      }
      const lease = keywordLease()
      const expectedVersion = welcome.value.version
      task.error.value = ''
      task.message.value = ''
      welcomeQueue.inFlight = submitted
      let result
      try {
        result = await runtime.run({
          action: 'save-welcome',
          storeId: lease.storeId,
          values: { ...submitted, version: expectedVersion },
        })
      } catch (cause) {
        if (generation === welcomeQueue.generation && keywordLeaseCurrent(lease))
          task.error.value = keywordError(cause)
        return
      } finally {
        if (welcomeQueue.inFlight === submitted) welcomeQueue.inFlight = null
      }
      if (generation !== welcomeQueue.generation || !keywordLeaseCurrent(lease)) return
      if (!result || result.status !== 'ok') {
        task.error.value = '无法确认保存结果，当前草稿仍保留；请稍后重试。'
        return
      }
      // save-welcome 的 result.data 是后端 CAS 后实际落库的权威记录；
      // 仅接受通过欢迎契约和版本前进校验的回执，不能用提交值代替。
      const receipt = welcomeSettingSchema.safeParse(result?.data)
      if (!receipt.success || normalizeWelcomeSetting(receipt.data).version <= expectedVersion) {
        task.error.value = '无法确认保存结果，当前草稿仍保留；请重新载入后再保存。'
        return
      }
      const stored = normalizeWelcomeSetting(receipt.data)
      welcomeConfirmed = { ...stored }
      receipts.putWelcomeReceipt(lease.workspaceId, lease.storeId, stored)
      baseline.welcome = { ...stored }
      if (sameWelcomeIntent(welcomeIntent(), submitted)) {
        welcome.value = { ...stored }
        cached.set(cacheKey(lease.workspaceId, lease.storeId), { ...stored })
      } else {
        // 保存期间的新编辑保留；CAS 基线推进到后端实际提交的版本。
        welcome.value.version = stored.version
      }
      task.message.value = result.message
      ElMessage.success('保存成功')
    }
  } finally {
    if (generation === welcomeQueue.generation) welcomeQueue.running = false
    welcomeSaving.value = false
  }
}
function requestWelcomeSave() {
  if (deferred.value || !runtime.available) return
  const intent = welcomeIntent()
  if (!welcomeQueue.running && sameWelcomeIntent(intent, welcomeConfirmed)) return
  if (welcomeQueue.running && welcomeQueue.queued && sameWelcomeIntent(intent, welcomeQueue.queued))
    return
  // Element Plus 在测试环境会同时从 wrapper/focus controller 触发 blur；
  // 同一份在途意图不得重复提交，但 A->B->A 的最终 A 仍会在 B 完成后重存。
  if (welcomeQueue.inFlight && sameWelcomeIntent(intent, welcomeQueue.inFlight)) return
  if (welcomeDelayInvalid.value) {
    task.error.value = welcomeDelayInvalid.value
    return
  }
  if (welcomeConflict.value) {
    task.error.value = '配置已更新，当前草稿仍保留；请重新载入后再保存。'
    return
  }
  welcomeQueue.queued = intent
  void pumpWelcome()
}
async function saveWelcomeMedia(command: ReceptionCommand) {
  return operations.executeConfirmed(command)
}
function submitForm() {
  if (props.viewKey === 'welcome') {
    requestWelcomeSave()
    return
  }
  if (props.viewKey === 'transfer') {
    requestStoreHandoffSave()
    return
  }
  void save()
}
function load(restoreDraft = false) {
  loadRevision += 1
  const id = selectedStoreId.value,
    snap = runtime.snapshot
  const snapshotWelcome = normalizeWelcomeSetting(
    snap.welcomeByStore[id] || { text: '', enabled: false, version: 0 },
  )
  const receipt = receipts.getWelcomeReceipt(snap.workspaceId, id)
  let confirmed = snapshotWelcome
  if (receipt) {
    if (snapshotWelcome.version >= receipt.version)
      receipts.deleteWelcomeReceipt(snap.workspaceId, id)
    else confirmed = normalizeWelcomeSetting(receipt)
  }
  resetWelcomeAutosave(confirmed)
  const latestManualKeywords = [...snap.config.safety.manualReplyKeywords]
  const latestGlobalKeywords = [...snap.config.safety.handoffKeywords]
  const latestHandoffKeywords = [...(snap.handoffByStore[id]?.keywords ?? [])]
  const latestInherited = !snap.handoffByStore[id]
  welcome.value = normalizeWelcomeSetting(cached.get(cacheKey(snap.workspaceId, id)) || confirmed)
  vision.value = { ...(snap.visionByStore[id] || { enabled: false, version: 0 }) }
  inherited.value = latestInherited
  keywords.value = latestHandoffKeywords.join('\n')
  globalKeywords.value = latestGlobalKeywords.join('\n')
  manualKeywords.value = latestManualKeywords.join('\n')
  globalExpected.value = latestGlobalKeywords
  manualExpected.value = latestManualKeywords
  globalEnabled.value = snap.config.safety.handoffKeywordsEnabled
  manualEnabled.value = snap.config.safety.manualReplyKeywordsEnabled
  fallbackEnabled.value = snap.config.reply.fallbackAfterMs > 0
  fallbackSeconds.value = Math.max(1, snap.config.reply.fallbackAfterMs / 1000 || 15)
  fallbackText.value = snap.config.reply.fallbackText
  draftLease = { workspaceId: snap.workspaceId, storeId: id, view: props.viewKey }
  baseline = {
    welcome: { ...welcome.value },
    inherited: inherited.value,
    keywords: keywords.value,
    globalKeywords: globalKeywords.value,
    manualKeywords: manualKeywords.value,
  }
  const previous = restoreDraft
    ? drafts?.getSettings(snap.workspaceId, id, props.viewKey)
    : undefined
  if (previous) {
    if (previous.welcome) welcome.value = normalizeWelcomeSetting(previous.welcome)
    if (previous.inherited !== undefined) inherited.value = previous.inherited
    if (previous.keywords !== undefined) keywords.value = previous.keywords
    if (previous.globalKeywords !== undefined) {
      globalKeywords.value = previous.globalKeywords
      globalExpected.value = [...(previous.globalExpectedKeywords ?? latestGlobalKeywords)]
    }
    if (previous.manualKeywords !== undefined) {
      manualKeywords.value = previous.manualKeywords
      manualExpected.value = [...(previous.manualExpectedKeywords ?? latestManualKeywords)]
    }
  }
  // 复用草稿以向导状态为准；平台规则、全局及客服接管关键词仍读真实配置。
  if (deferred.value && props.setupDraft) {
    welcome.value = {
      ...normalizeWelcomeSetting(props.setupDraft.welcome),
      // A cleared input is an invalid draft, not a request to restore a legacy default.
      ...props.setupDraft.welcome,
      version: snap.welcomeByStore[id]?.version || 0,
    }
    inherited.value = props.setupDraft.handoff.inherited
    keywords.value = props.setupDraft.handoff.keywords.join('\n')
  }
  resetKeywordAutosave({
    globalKeywords: latestGlobalKeywords,
    globalExpected: globalExpected.value,
    manualKeywords: latestManualKeywords,
    manualExpected: manualExpected.value,
    handoffKeywords: latestHandoffKeywords,
    handoffInherited: latestInherited,
    globalEnabled: snap.config.safety.handoffKeywordsEnabled,
    manualEnabled: snap.config.safety.manualReplyKeywordsEnabled,
  })
}
onBeforeUnmount(() => {
  unmounted = true
  welcomeQueue.generation += 1
  welcomeQueue.queued = null
  welcomeQueue.inFlight = null
  if (deferred.value) return
  drafts?.putSettings(draftLease.workspaceId, draftLease.storeId, draftLease.view, {
    ...(JSON.stringify(welcome.value) !== JSON.stringify(baseline.welcome)
      ? { welcome: { ...welcome.value } }
      : {}),
    ...(inherited.value !== baseline.inherited ? { inherited: inherited.value } : {}),
    ...(keywords.value !== baseline.keywords ? { keywords: keywords.value } : {}),
    ...(globalKeywords.value !== baseline.globalKeywords
      ? {
          globalKeywords: globalKeywords.value,
          globalExpectedKeywords: [...globalExpected.value],
        }
      : {}),
    ...(manualKeywords.value !== baseline.manualKeywords
      ? {
          manualKeywords: manualKeywords.value,
          manualExpectedKeywords: [...manualExpected.value],
        }
      : {}),
  })
})
watch(
  [() => selectedStoreId.value, () => props.viewKey, () => runtime.snapshot.workspaceId],
  () => load(true),
  { immediate: true },
)
const welcomeConflict = computed(() => {
  if (deferred.value) return false
  const snapshotVersion = runtime.snapshot.welcomeByStore[selectedStoreId.value]?.version || 0
  // The draft's version is its CAS baseline. A delayed snapshot below it is
  // stale; a truly higher snapshot is another edit and must block this draft.
  return snapshotVersion > welcome.value.version
})
// 回车提交也必须先通过范围校验；不能依赖保存按钮的 disabled。
const welcomeDelayInvalid = computed(() =>
  welcomeDelayIssue(welcome.value.delayMinSeconds, welcome.value.delayMaxSeconds),
)
function reloadWelcome() {
  cached.delete(cacheKey(runtime.snapshot.workspaceId, selectedStoreId.value))
  load()
  task.error.value = ''
  task.message.value = ''
}
async function openTraining() {
  await task.run(async () => {
    const storeId = selectedStoreId.value
    if (!storeId) throw Error('请先选择店铺，再打开 AI训练场')
    await openKnowledgeManager(storeId, { tab: 'training' })
  })
}
const visionConflict = computed(
  () =>
    vision.value.version !== (runtime.snapshot.visionByStore[selectedStoreId.value]?.version || 0),
)
const manualConflict = computed(() => {
  const latest = runtime.snapshot.config.safety.manualReplyKeywords
  return (
    manualExpected.value.length !== latest.length ||
    manualExpected.value.some((word, index) => word !== latest[index])
  )
})
const globalConflict = computed(() => {
  const latest = runtime.snapshot.config.safety.handoffKeywords
  return (
    globalExpected.value.length !== latest.length ||
    globalExpected.value.some((word, index) => word !== latest[index])
  )
})
function loadLatestGlobalKeywords() {
  const latest = [...runtime.snapshot.config.safety.handoffKeywords]
  globalKeywords.value = latest.join('\n')
  globalExpected.value = latest
  baseline.globalKeywords = globalKeywords.value
  const queue = textQueues.handoff
  queue.generation += 1
  queue.running = false
  queue.queued = null
  textConfirmed.handoff = { text: globalKeywords.value, expected: [...latest] }
  task.error.value = ''
  task.message.value = ''
}
function loadLatestManualKeywords() {
  const latest = [...runtime.snapshot.config.safety.manualReplyKeywords]
  manualKeywords.value = latest.join('\n')
  manualExpected.value = latest
  baseline.manualKeywords = manualKeywords.value
  const queue = textQueues.manual
  queue.generation += 1
  queue.running = false
  queue.queued = null
  textConfirmed.manual = { text: manualKeywords.value, expected: [...latest] }
  task.error.value = ''
  task.message.value = ''
}
const lines = (text: string) => [
  ...new Set(
    text
      .split(/\r?\n/)
      .map((x) => x.trim())
      .filter(Boolean),
  ),
]
watch([() => props.setupDraft, () => props.deferredSave], () => load(true))
// 统一保存模式下只把本组件负责的接待字段向上同步，避免两个面板互相覆盖。
watch(
  [welcome, inherited, keywords],
  () => {
    if (!deferred.value || !props.setupDraft) return
    if (props.viewKey === 'welcome') {
      const value = {
        text: welcome.value.text,
        enabled: welcome.value.enabled,
        delayMinSeconds: welcome.value.delayMinSeconds,
        delayMaxSeconds: welcome.value.delayMaxSeconds,
      }
      const previous = {
        ...normalizeWelcomeSetting(props.setupDraft.welcome),
        ...props.setupDraft.welcome,
      }
      if (
        value.text !== previous.text ||
        value.enabled !== previous.enabled ||
        value.delayMinSeconds !== previous.delayMinSeconds ||
        value.delayMaxSeconds !== previous.delayMaxSeconds
      )
        emit('update:welcome', value)
      return
    }
    if (props.viewKey !== 'transfer') return
    const value = { inherited: inherited.value, keywords: lines(keywords.value) }
    if (
      value.inherited !== props.setupDraft.handoff.inherited ||
      JSON.stringify(value.keywords) !== JSON.stringify(props.setupDraft.handoff.keywords)
    )
      emit('update:handoff', value)
  },
  { deep: true },
)
async function save() {
  if (deferred.value) return
  const storeId = selectedStoreId.value,
    key = props.viewKey
  const lease = {
    workspaceId: runtime.snapshot.workspaceId,
    storeId,
    view: props.viewKey,
  }
  await task.run(async () => {
    let result
    if (key === 'image')
      result = await runtime.run({
        action: 'save-vision-settings',
        storeId,
        values: { ...vision.value },
      })
    else if (key === 'auto')
      result = await runtime.run({
        action: 'save-automation-fallback',
        values: {
          enabled: fallbackEnabled.value,
          seconds: fallbackSeconds.value,
          text: fallbackText.value,
        },
      })
    else
      result = await runtime.run({
        action: 'save-store-handoff',
        storeId,
        values: inherited.value
          ? { mode: 'inherit' }
          : { mode: 'custom', keywords: lines(keywords.value) },
      })
    if (storeId === selectedStoreId.value && key === props.viewKey) {
      cached.delete(cacheKey(lease.workspaceId, storeId))
      load()
      task.message.value = result.message
    }
  })
}
</script>
<template>
  <RuntimePanel
    :title="viewKey === 'transfer' ? '' : title"
    :aria-label="title"
    :class="{ 'embedded-reception': embedded, 'welcome-panel': viewKey === 'welcome' }"
    :description="
      embedded || viewKey === 'transfer' || viewKey === 'welcome'
        ? ''
        : '配置独立保存；保存不会自动开启店铺 AI 接待。'
    "
    :error="task.error.value"
    :message="task.message.value"
  >
    <template v-if="viewKey === 'welcome'" #actions>
      <span class="welcome-toggle" data-no-drag>
        <el-switch
          v-model="welcome.enabled"
          active-text="启用"
          aria-label="启用本店新会话欢迎"
          :disabled="welcomeConflict"
          @change="requestWelcomeSave"
        />
      </span>
    </template>
    <StoreSelect v-if="!embedded" :disabled="task.pending.value" />
    <p v-if="viewKey !== 'auto' && !selectedStoreId">请先在店铺与商品中添加店铺。</p>
    <div v-if="viewKey === 'welcome' && selectedStoreId" class="welcome-layout">
      <form class="runtime-form welcome-text-form" @submit.prevent="requestWelcomeSave">
        <el-alert
          v-if="welcomeConflict"
          title="配置已更新，当前草稿仍保留；请重新载入最新配置后再保存。"
          type="warning"
          :closable="false"
        >
          <template #default>
            <el-button native-type="button" :disabled="task.pending.value" @click="reloadWelcome"
              >重新载入</el-button
            >
          </template></el-alert
        ><label
          >文字欢迎语<el-input
            v-model="welcome.text"
            type="textarea"
            :rows="2"
            maxlength="200"
            show-word-limit
            aria-label="文字欢迎语"
            @blur="requestWelcomeSave"
        /></label>
      </form>
      <p v-if="deferred" class="reception-deferred" role="status">
        导入内容将在最后统一保存；这里仍可修改，不会单独写入本店配置。
      </p>
      <div class="welcome-lower">
        <div class="welcome-delay welcome-delay-card">
          <span class="welcome-delay-label">欢迎延迟</span>
          <span class="welcome-range">
            <el-input-number
              v-model="welcome.delayMinSeconds"
              aria-label="欢迎延迟下限（秒）"
              :min="1"
              :max="3600"
              :step="1"
              :precision="0"
              @change="requestWelcomeSave"
              @blur="requestWelcomeSave"
            /><span class="welcome-sep">～</span
            ><el-input-number
              v-model="welcome.delayMaxSeconds"
              aria-label="欢迎延迟上限（秒）"
              :min="1"
              :max="3600"
              :step="1"
              :precision="0"
              @change="requestWelcomeSave"
              @blur="requestWelcomeSave"
            /><span class="welcome-unit">秒随机</span>
          </span>
        </div>
        <section class="reception-advanced welcome-media">
          <ReceptionRulesPanel
            :workspace-id="runtime.snapshot.workspaceId"
            :store-id="selectedStoreId"
            trigger="visitor"
            :preserve-draft="embedded"
            media-only
            :media-autosave="Boolean(operations.service.value)"
            :save-media-rule="saveWelcomeMedia"
            :snapshot="operations.snapshot.value"
            :busy="operations.busy.value"
            @command="operations.execute"
            @refresh="
              operations.execute({ type: 'refresh', workspaceId: runtime.snapshot.workspaceId })
            "
          />
        </section>
      </div>
    </div>
    <form
      v-else-if="selectedStoreId || viewKey === 'auto'"
      class="runtime-form"
      @submit.prevent="submitForm"
    >
      <template v-if="viewKey === 'image'"
        ><p>{{ runtime.snapshot.capabilities.vision.reason }}</p>
        <p>
          每轮最多 4 张公网 HTTPS
          图片。模型收到实际图片输入；不支持本地图片上传，也不会把图片链接当作图像内容猜测。
        </p>
        <el-alert
          v-if="visionConflict"
          title="识图配置已更新，请载入最新配置后再保存。"
          type="warning"
          :closable="false"
        /><el-switch
          v-model="vision.enabled"
          active-text="启用本店图片识别"
          :disabled="
            task.pending.value ||
            visionConflict ||
            (!runtime.snapshot.capabilities.vision.supported && !vision.enabled)
          "
        /><el-button :disabled="task.pending.value" @click="openTraining"
          >到知识库训练场测试识图</el-button
        ></template
      >
      <template v-else-if="viewKey === 'auto'"
        ><p>
          此处保留全局 AI 回复超时配置；逐条批准模式不自动发送兜底消息。下方可配置本店平台催付规则。
        </p>
        <el-switch
          v-model="fallbackEnabled"
          active-text="启用回复超时兜底"
          :disabled="task.pending.value" /><label
          >等待秒数<el-input-number
            v-model="fallbackSeconds"
            :min="1"
            :max="120"
            :precision="0" /></label
        ><label
          >兜底话术<el-input
            v-model="fallbackText"
            type="textarea"
            maxlength="500"
            :rows="4" /></label
      ></template>
      <template v-else>
        <el-switch
          v-model="inherited"
          class="store-inherit-switch"
          active-text="继承全局关键词"
          :disabled="task.pending.value"
          @change="requestStoreHandoffSave" /><label v-if="!inherited"
          >本店关键词（每行一个）<el-input
            v-model="keywords"
            type="textarea"
            aria-label="本店关键词"
            :rows="embedded ? 3 : 6"
            @blur="requestStoreHandoffSave" /></label
      ></template>
      <div v-if="!deferred && viewKey !== 'transfer'" class="runtime-actions">
        <el-button
          type="primary"
          native-type="submit"
          :loading="task.pending.value"
          :disabled="!runtime.available || (viewKey === 'image' && visionConflict)"
          >保存配置</el-button
        ><el-button
          :disabled="task.pending.value"
          @click="
            () => {
              cached.delete(cacheKey(runtime.snapshot.workspaceId, selectedStoreId))
              load()
            }
          "
          >载入最新配置</el-button
        >
      </div>
      <p v-else-if="deferred" class="reception-deferred" role="status">
        导入内容将在最后统一保存；这里仍可修改，不会单独写入本店配置。
      </p>
    </form>
    <section v-if="viewKey === 'transfer'" class="reception-keyword-settings">
      <form
        class="runtime-form keyword-setting-card"
        @submit.prevent="requestKeywordTextSave('handoff')"
      >
        <div class="keyword-setting-card__head">
          <h3>
            全局人工关键词
            <span>仅影响继承全局配置的店铺</span>
          </h3>
          <el-switch
            v-model="globalEnabled"
            class="keyword-switch-handoff"
            aria-label="启用全局人工关键词"
            active-text="开"
            inactive-text="关"
            inline-prompt
            @change="requestKeywordSwitch('handoff')"
          />
        </div>
        <el-input
          v-model="globalKeywords"
          type="textarea"
          :rows="3"
          aria-label="全局人工处理关键词"
          @blur="requestKeywordTextSave('handoff')"
        />
        <div v-if="globalConflict" class="keyword-conflict" role="status">
          <span>全局关键词已更新，当前草稿仍保留。</span>
          <el-button native-type="button" @click="loadLatestGlobalKeywords"
            >载入最新全局关键词</el-button
          >
        </div>
      </form>
      <form
        class="runtime-form keyword-setting-card reception-manual"
        @submit.prevent="requestKeywordTextSave('manual')"
      >
        <div class="keyword-setting-card__head">
          <h3>
            客服接管关键词
            <span>全局 · 客服发出后暂停当前会话 AI</span>
          </h3>
          <el-switch
            v-model="manualEnabled"
            class="keyword-switch-manual"
            aria-label="启用客服接管关键词"
            active-text="开"
            inactive-text="关"
            inline-prompt
            @change="requestKeywordSwitch('manual')"
          />
        </div>
        <el-input
          v-model="manualKeywords"
          type="textarea"
          :rows="3"
          aria-label="客服接管关键词"
          @blur="requestKeywordTextSave('manual')"
        />
        <div v-if="manualConflict" class="keyword-conflict" role="status">
          <span>客服接管关键词已更新，当前草稿仍保留。</span>
          <el-button native-type="button" @click="loadLatestManualKeywords"
            >载入最新关键词</el-button
          >
        </div>
      </form>
    </section>
    <p v-if="embedded && operationError" class="reception-visible-error" role="alert">
      {{ operationError }}
    </p>
    <p
      v-if="embedded && viewKey !== 'image' && !operations.snapshot.value"
      class="reception-empty"
      role="status"
    >
      平台接待服务尚未接入，当前不能保存平台规则或执行平台操作。
    </p>
    <section
      v-if="viewKey !== 'image' && viewKey !== 'welcome' && selectedStoreId"
      class="reception-advanced"
    >
      <h3 v-if="embedded" class="reception-section-title">
        平台接待规则与能力 <span>高级设置 · 逐项批准</span>
      </h3>
      <ReceptionRulesPanel
        :workspace-id="runtime.snapshot.workspaceId"
        :store-id="selectedStoreId"
        :trigger="ruleTrigger"
        :preserve-draft="embedded"
        :snapshot="operations.snapshot.value"
        :busy="operations.busy.value"
        @command="operations.execute"
        @refresh="
          operations.execute({ type: 'refresh', workspaceId: runtime.snapshot.workspaceId })
        "
      />
    </section>
    <p v-if="!embedded && operations.error.value" role="alert">{{ operations.error.value }}</p>
    <OperationApprovalPanel
      v-if="viewKey !== 'image' && operations.snapshot.value && (!embedded || activeRuns.length)"
      :workspace-id="runtime.snapshot.workspaceId"
      :store-id="selectedStoreId"
      :runs="embedded ? activeRuns : operations.snapshot.value.runs"
      :busy="operations.busy.value"
      @command="operations.execute"
    />
    <details
      v-if="embedded && viewKey !== 'image' && historyRuns.length"
      class="reception-advanced"
    >
      <summary>
        历史平台操作 <span>{{ historyRuns.length }} 项</span>
      </summary>
      <OperationApprovalPanel
        :workspace-id="runtime.snapshot.workspaceId"
        :store-id="selectedStoreId"
        :runs="historyRuns"
        :busy="operations.busy.value"
        @command="operations.execute"
      />
    </details>
    <p
      v-if="embedded && viewKey !== 'image' && viewKey !== 'welcome' && !selectedRuns.length"
      class="reception-empty"
    >
      暂无平台操作事项
    </p>
  </RuntimePanel>
</template>

<style scoped>
.embedded-reception {
  padding: 16px;
  min-height: 0;
  height: auto;
  overflow: visible;
  border: 1px solid #e5e9f0;
  border-radius: 8px;
}
.embedded-reception :deep(.runtime-page__head) {
  margin-bottom: 12px;
}
/* 标题、文字区和启用开关在同一行基线上垂直居中。 */
.welcome-panel :deep(.runtime-page__head) {
  align-items: center;
  gap: 12px;
}
/* 标题右侧的启用开关作为一个不换行的操作单元；header 内保持 12px 间距。 */
.welcome-toggle {
  display: inline-flex;
  align-items: center;
  gap: 12px;
  flex-shrink: 0;
}
.welcome-layout {
  display: grid;
  gap: 10px;
  min-width: 0;
}
/* 文字欢迎语独占整行；下方延迟与媒体共用一行，媒体占剩余宽度。 */
.welcome-text-form {
  max-width: none;
  margin: 0;
}
.welcome-lower {
  display: grid;
  grid-template-columns: max-content minmax(0, 1fr);
  gap: 10px;
  align-items: stretch;
  min-width: 0;
}
.welcome-delay {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px 8px;
  font-size: 14px;
}
.welcome-delay-card {
  flex-direction: row;
  align-items: center;
  justify-content: center;
  min-width: 0;
  padding: 10px 12px;
  border: 1px solid #e8edf4;
  border-radius: 6px;
  background: #fbfcfe;
}
.welcome-media,
.embedded-reception .welcome-media {
  display: flex;
  min-width: 0;
  height: 100%;
  margin-top: 0;
  padding-top: 0;
  border-top: 0;
}
.welcome-media :deep(.reception-rules) {
  width: 100%;
  min-width: 0;
}
@media (max-width: 1100px) {
  .welcome-lower {
    grid-template-columns: minmax(0, 1fr);
  }
  .welcome-delay-card {
    flex-direction: row;
    align-items: center;
    justify-content: flex-start;
  }
}
.welcome-delay-label {
  white-space: nowrap;
}
/* 起止输入、波浪号与“秒随机”整体换行，窄容器里不拆散范围组。 */
.welcome-range {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  white-space: nowrap;
  flex-wrap: nowrap;
}
.welcome-range :deep(.el-input-number) {
  width: 100px;
  flex: 0 0 100px;
}
.welcome-sep,
.welcome-unit {
  font-size: 13px;
}
.embedded-reception :deep(.runtime-page__head h1) {
  margin: 0;
  font-size: 16px;
  line-height: 1.5;
}
.embedded-reception .runtime-form {
  max-width: none;
  gap: 12px;
  margin: 0;
}
/* 两个关键词区始终各占一半；输入框行数相同，窄容器也不互相挤压。 */
.reception-keyword-settings {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid #edf0f5;
}
.keyword-setting-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
  padding: 10px;
  border: 1px solid #e8edf4;
  border-radius: 6px;
  background: #fbfcfe;
}
.keyword-setting-card__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
  min-height: 38px;
}
.keyword-setting-card__head h3 {
  margin: 0;
  color: #4a5d76;
  font-size: 13px;
  font-weight: 600;
  line-height: 1.5;
}
.keyword-setting-card__head h3 span {
  display: block;
  margin: 2px 0 0;
  color: #94a0b1;
  font-size: 12px;
  font-weight: 400;
  line-height: 1.5;
}
.keyword-setting-card :deep(.el-switch) {
  flex: 0 0 auto;
}
.keyword-setting-card :deep(.el-textarea) {
  flex: 1;
}
.keyword-setting-card :deep(.el-textarea__inner) {
  min-height: 72px;
}
.keyword-conflict {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  color: #a26b00;
  font-size: 12px;
}
.embedded-reception .runtime-form > p {
  margin: 0;
  color: #78869a;
  font-size: 12px;
  line-height: 1.6;
}
.embedded-reception .runtime-actions {
  gap: 8px;
  flex-wrap: wrap;
}
.embedded-reception .reception-advanced {
  margin-top: 12px;
  border-top: 1px solid #edf0f5;
}
.embedded-reception .reception-manual h3 {
  margin: 0;
  color: #4a5d76;
  font-size: 13px;
  line-height: 1.5;
  font-weight: 600;
}
.embedded-reception .reception-manual h3 span {
  margin-left: 8px;
  color: #94a0b1;
  font-size: 12px;
  font-weight: 400;
}
.embedded-reception .reception-manual .manual-conflict {
  display: flex;
  align-items: center;
  gap: 8px;
  color: #a26b00;
  font-size: 12px;
}
.embedded-reception summary {
  box-sizing: border-box;
  min-height: 38px;
  padding: 9px 0;
  color: #4a5d76;
  font-size: 13px;
  cursor: pointer;
}
.embedded-reception summary span {
  margin-left: 8px;
  color: #94a0b1;
  font-size: 12px;
}
.embedded-reception summary:focus-visible {
  outline: 2px solid #3779ed;
  outline-offset: 2px;
}
.embedded-reception .reception-section-title {
  margin: 10px 0 6px;
  color: #4a5d76;
  font-size: 13px;
  font-weight: 600;
  line-height: 1.5;
}
.embedded-reception .reception-section-title span {
  margin-left: 8px;
  color: #94a0b1;
  font-size: 12px;
  font-weight: 400;
}
.embedded-reception :deep(.reception-rules:not(.media-only)) {
  margin-top: 0;
  padding-top: 8px;
  border-top: 0;
}
.embedded-reception :deep(.reception-rules h2),
.embedded-reception :deep(.approval-head h2) {
  font-size: 16px;
}
.embedded-reception .reception-empty {
  margin: 8px 0 0;
  font-size: 12px;
  color: #98a3b2;
}
.embedded-reception .reception-deferred {
  margin: 0;
  padding: 8px 10px;
  border-radius: 4px;
  background: #f2f7ff;
  color: #3678db;
  font-size: 12px;
  line-height: 1.6;
}
.embedded-reception .reception-visible-error {
  margin: 12px 0 0;
  font-size: 13px;
  color: #c45656;
  overflow-wrap: anywhere;
}
</style>

import { computed, reactive, ref, watch } from 'vue'
import { defineStore } from 'pinia'
import { useRuntimeStore } from '@/shared/state/runtime'
import {
  createReceptionSetupSaver,
  readReceptionSetup,
  readReceptionSetupSource,
  type ReceptionHandoff,
  type ReceptionSetupDraft,
  type ReceptionSetupPart,
  type ReceptionSetupTarget,
  type ReceptionWelcome,
} from '@/modules/reception'
import { createBlankSetupDraft, createSetupRules, type SetupDraft } from './setup-rules'
import {
  cloneSetupDraft,
  defaultReuseSelection,
  draftHasContent,
  mergePolicyReuse,
  reuseSectionNames,
  selectedReuseSections,
  type ReuseSection,
  type ReuseSelection,
} from './setup-reuse'

type PartState = 'pending' | 'saved'
interface ReuseLoaded {
  storeId: string
  storeName: string
  platform: string
  configured: boolean
  draft: SetupDraft
}
/** 已应用到当前草稿的复用来历；before 用于“撤销复用”恢复导入前内容。 */
interface ReuseApplied {
  source: { storeId: string; storeName: string; platform: string }
  sections: ReuseSection[]
  selectedSections: ReuseSection[]
  retainedReception: ReceptionSetupPart[]
  writeStarted: boolean
  reception: ReceptionSetupDraft
  baseline: ReceptionSetupTarget
  before: { draft: SetupDraft; reception: ReceptionSetupTarget }
  parts: { policy: PartState; welcome: PartState; handoff: PartState }
}
interface SessionDraft {
  draft: SetupDraft
  step: number
  reuse: ReuseApplied | null
}

function cloneReceptionDraft(draft: ReceptionSetupDraft): ReceptionSetupDraft {
  return {
    welcome: { ...draft.welcome },
    handoff: { inherited: draft.handoff.inherited, keywords: [...draft.handoff.keywords] },
  }
}
function cloneTarget(target: ReceptionSetupTarget): ReceptionSetupTarget {
  return {
    welcome: { ...target.welcome },
    handoff: { inherited: target.handoff.inherited, keywords: [...target.handoff.keywords] },
  }
}
function cloneApplied(applied: ReuseApplied): ReuseApplied {
  return {
    source: { ...applied.source },
    sections: [...applied.sections],
    selectedSections: [...applied.selectedSections],
    retainedReception: [...applied.retainedReception],
    writeStarted: applied.writeStarted,
    reception: cloneReceptionDraft(applied.reception),
    baseline: cloneTarget(applied.baseline),
    before: {
      draft: cloneSetupDraft(applied.before.draft),
      reception: cloneTarget(applied.before.reception),
    },
    parts: { ...applied.parts },
  }
}
function message(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

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
  const reuse = reactive({
    dialog: false,
    sourceId: '',
    selection: defaultReuseSelection() as ReuseSelection,
    loading: false,
    error: '',
    loaded: null as ReuseLoaded | null,
    replaceConfirm: false,
  })
  const reuseApplied = ref<ReuseApplied | null>(null)
  let rules: ReturnType<typeof createSetupRules> | undefined
  const sessionDrafts = new Map<string, SessionDraft>()
  let cacheWorkspace = runtime.snapshot.workspaceId,
    restoreDraft = false
  let version = 0
  // 同一来源也可能被连续选择；店铺ID不能区分 B→C→B 的迟到响应。
  let sourceRequest = 0
  // 内部回填（保存后回读、恢复）不能被当成用户编辑而取消成功标记。
  let internalDraft = false
  const shop = computed(() => runtime.snapshot.stores.find((item) => item.id === storeId.value))
  const reuseSources = computed(() =>
    runtime.snapshot.stores.filter((item) => item.id !== storeId.value),
  )
  const reuseCrossPlatform = computed(() =>
    Boolean(reuse.loaded && shop.value && reuse.loaded.platform !== shop.value.platform),
  )
  const reuseNeedsReplace = computed(() => draftHasContent(draft.value))
  const receptionDeferred = computed(() =>
    Boolean(reuseApplied.value?.sections.includes('reception')),
  )
  /** 只有尚未写入任何部分时才允许撤销复用，避免界面与已保存数据分叉。 */
  const reuseRemovable = computed(() => {
    const applied = reuseApplied.value
    if (!applied || saving.value || applied.writeStarted || applied.parts.policy !== 'pending')
      return false
    return (
      !applied.sections.includes('reception') ||
      (applied.parts.welcome === 'pending' && applied.parts.handoff === 'pending')
    )
  })
  const reusePreview = computed(() => {
    const loaded = reuse.loaded
    if (!loaded || !valid()) return null
    const policy = mergePolicyReuse({
      target: draft.value,
      source: loaded.draft,
      sourceConfigured: loaded.configured,
      selection: reuse.selection,
    })
    const reception = readReceptionSetupSource(
      runtime.snapshot,
      loaded.storeId,
      reuseApplied.value?.sections.includes('reception')
        ? {
            ...cloneTarget(reuseApplied.value.baseline),
            ...cloneReceptionDraft(reuseApplied.value.reception),
            welcome: {
              ...reuseApplied.value.reception.welcome,
              version: reuseApplied.value.baseline.welcome.version,
            },
          }
        : readReceptionSetup(runtime.snapshot, storeId.value),
    )
    return { policy, reception, hints: [...policy.hints, ...reception.hints] }
  })
  const reuseSummary = computed(() =>
    reuseApplied.value
      ? {
          ...reuseApplied.value.source,
          sections: reuseApplied.value.selectedSections.map(
            (section) => reuseSectionNames[section],
          ),
          retainedReception: reuseApplied.value.retainedReception.map((part) =>
            part === 'welcome' ? '文字欢迎' : '本店转人工',
          ),
        }
      : null,
  )
  const reuseParts = computed(() => {
    const applied = reuseApplied.value
    if (!applied) return []
    const rows: { key: 'policy' | ReceptionSetupPart; label: string; state: PartState }[] = [
      { key: 'policy', label: '客服风格、物流与售后政策', state: applied.parts.policy },
    ]
    if (applied.sections.includes('reception')) {
      rows.push({ key: 'welcome', label: '进店文字欢迎', state: applied.parts.welcome })
      rows.push({ key: 'handoff', label: '本店转人工设置', state: applied.parts.handoff })
    }
    return rows
  })
  function valid() {
    return Boolean(
      storeId.value && workspaceId.value === runtime.snapshot.workspaceId && shop.value,
    )
  }
  const loginReady = computed(() => {
    const target = shop.value
    if (!target?.runtime.online || target.runtime.identityError) return false
    return target.platform === 'pdd-web'
      ? target.runtime.authenticated === true
      : target.runtime.authenticated !== false
  })
  function resetReuse() {
    sourceRequest++
    reuse.dialog = false
    reuse.sourceId = ''
    reuse.selection = defaultReuseSelection()
    reuse.loading = false
    reuse.error = ''
    reuse.loaded = null
    reuse.replaceConfirm = false
    reuseApplied.value = null
  }
  function setDraft(next: SetupDraft) {
    internalDraft = true
    try {
      draft.value = next
    } finally {
      internalDraft = false
    }
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
    resetReuse()
  }
  function finish() {
    sessionDrafts.delete(storeId.value)
    resetSession()
  }
  function dismiss() {
    if (valid() && !saved.value && (loaded.value || !runtime.available)) {
      sessionDrafts.set(storeId.value, {
        draft: cloneSetupDraft(draft.value),
        step: Math.min(step.value, 4),
        reuse: reuseApplied.value ? cloneApplied(reuseApplied.value) : null,
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
    draft.value = previous ? cloneSetupDraft(previous.draft) : createBlankSetupDraft()
    reuseApplied.value = previous?.reuse ? cloneApplied(previous.reuse) : null
    restoreDraft = Boolean(previous)
    saved.value = false
    visible.value = true
  }
  function queueAfterLogin(id: string) {
    open(id)
    if (!valid()) return
    // 建立平台窗口不是登录完成。自动引导只等待当前店铺的真实认证结果。
    visible.value = false
    awaitingLogin.value = true
    returnAvailable.value = false
    if (loginReady.value && runtime.selectedStoreId === id) resume()
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
    // 复用草稿是一次性导入内容，“重新载入”只刷新保存基线，不能静默丢回导入内容。
    const keepDraft = restoreDraft || Boolean(reuseApplied.value)
    restoreDraft = false
    loading.value = true
    loaded.value = false
    error.value = ''
    rules = undefined
    try {
      const next = await service.load(id)
      if (!current()) return
      if (!keepDraft) setDraft(next)
      rules = service
      loaded.value = true
    } catch (cause) {
      if (current()) error.value = message(cause)
    } finally {
      if (current()) loading.value = false
    }
  }

  function openReuse() {
    if (!valid() || saving.value || loading.value || !reuseSources.value.length) return
    sourceRequest++
    reuse.dialog = true
    reuse.sourceId = ''
    reuse.selection = defaultReuseSelection()
    reuse.loading = false
    reuse.error = ''
    reuse.loaded = null
    reuse.replaceConfirm = false
  }
  function closeReuse() {
    sourceRequest++
    reuse.dialog = false
    reuse.loading = false
    reuse.error = ''
    reuse.loaded = null
    reuse.sourceId = ''
    reuse.replaceConfirm = false
  }
  /**
   * 读取来源店铺规则。使用独立 createSetupRules 实例，来源读取不会改写
   * 目标店铺的保存基线；租约同时校验工作区、目标店、来源店和对话框状态。
   */
  async function selectReuseSource(sourceId: string) {
    const request = ++sourceRequest
    reuse.sourceId = sourceId
    reuse.loading = false
    reuse.loaded = null
    reuse.error = ''
    reuse.replaceConfirm = false
    if (!sourceId) return
    if (
      !valid() ||
      sourceId === storeId.value ||
      !runtime.snapshot.stores.some((item) => item.id === sourceId)
    ) {
      reuse.error = '请选择当前工作区的其他店铺'
      return
    }
    const lease = version,
      workspace = runtime.snapshot.workspaceId,
      target = storeId.value,
      selected = sourceId
    const current = () =>
      request === sourceRequest &&
      lease === version &&
      workspace === runtime.snapshot.workspaceId &&
      runtime.snapshot.workspaceId === workspace &&
      valid() &&
      storeId.value === target &&
      reuse.dialog &&
      reuse.sourceId === selected
    reuse.loading = true
    reuse.error = ''
    try {
      const service = createSetupRules({
        execute: (command) => runtime.run(command),
        assertCurrent: () => {
          if (!current()) throw Error('来源店铺读取已取消')
        },
      })
      const source = await service.readSource(selected)
      if (!current()) return
      const store = runtime.snapshot.stores.find((item) => item.id === selected)
      if (!store) throw Error('来源店铺已不在当前工作区')
      reuse.loaded = {
        storeId: selected,
        storeName: store.storeName,
        platform: store.platform,
        configured: source.configured,
        draft: source.draft,
      }
    } catch (cause) {
      if (current()) reuse.error = message(cause)
    } finally {
      if (current()) reuse.loading = false
    }
  }
  function applyReuse(): boolean {
    if (!valid() || !reuse.loaded || reuse.loading || saving.value) return false
    const preview = reusePreview.value
    if (!preview) return false
    const sections = selectedReuseSections(reuse.selection)
    if (!sections.length) {
      reuse.error = '请至少选择一类要复用的配置'
      return false
    }
    if (draftHasContent(draft.value) && !reuse.replaceConfirm) {
      reuse.error = '当前店铺已有填写内容，请确认替换所选类别后继续'
      return false
    }
    const target = readReceptionSetup(runtime.snapshot, storeId.value)
    const previous = reuseApplied.value
    const hadReception = Boolean(previous?.sections.includes('reception'))
    const importsReception = sections.includes('reception')
    const retainedReception: ReceptionSetupPart[] = hadReception
      ? (['welcome', 'handoff'] as ReceptionSetupPart[]).filter(
          (part) => !importsReception || preview.reception.missing.includes(part),
        )
      : []
    const reception =
      hadReception && previous
        ? cloneReceptionDraft(previous.reception)
        : cloneReceptionDraft(preview.reception.draft)
    if (importsReception) {
      if (!retainedReception.includes('welcome'))
        reception.welcome = { ...preview.reception.draft.welcome }
      if (!retainedReception.includes('handoff'))
        reception.handoff = {
          inherited: preview.reception.draft.handoff.inherited,
          keywords: [...preview.reception.draft.handoff.keywords],
        }
    }
    const applied: ReuseApplied = {
      source: {
        storeId: reuse.loaded.storeId,
        storeName: reuse.loaded.storeName,
        platform: reuse.loaded.platform,
      },
      sections: hadReception && !importsReception ? [...sections, 'reception'] : sections,
      selectedSections: [...sections],
      retainedReception,
      writeStarted: previous?.writeStarted ?? false,
      reception,
      baseline: hadReception && previous ? cloneTarget(previous.baseline) : cloneTarget(target),
      before: { draft: cloneSetupDraft(draft.value), reception: cloneTarget(target) },
      parts: {
        policy: 'pending',
        welcome:
          retainedReception.includes('welcome') && previous
            ? previous.parts.welcome
            : importsReception
              ? 'pending'
              : 'saved',
        handoff:
          retainedReception.includes('handoff') && previous
            ? previous.parts.handoff
            : importsReception
              ? 'pending'
              : 'saved',
      },
    }
    setDraft(preview.policy.draft)
    reuseApplied.value = applied
    saved.value = false
    reuse.dialog = false
    reuse.loaded = null
    reuse.sourceId = ''
    reuse.replaceConfirm = false
    step.value = 1
    return true
  }
  /** 撤销本次复用，恢复导入前的本店草稿；一次性复制不留下持续关联。 */
  function removeReuse() {
    const applied = reuseApplied.value
    if (!applied || !reuseRemovable.value) return
    setDraft(cloneSetupDraft(applied.before.draft))
    reuseApplied.value = null
    saved.value = false
    if (step.value === 5) step.value = 1
  }
  /**
   * 目标接待配置被其他入口修改后，用户显式确认以最新目标为基线再保存。
   * 不自动更新：冲突提示必须由用户确认，避免静默覆盖他人修改。
   */
  function adoptReceptionBaseline(confirmed?: ReceptionSetupTarget): boolean {
    const applied = reuseApplied.value
    if (!applied || !valid() || saving.value || !applied.sections.includes('reception'))
      return false
    const current = readReceptionSetup(runtime.snapshot, storeId.value)
    if (confirmed && JSON.stringify(current) !== JSON.stringify(confirmed)) {
      error.value = '本店接待配置再次更新，请重新查看并确认'
      return false
    }
    if (applied.parts.welcome === 'pending') applied.baseline.welcome = { ...current.welcome }
    if (applied.parts.handoff === 'pending')
      applied.baseline.handoff = {
        inherited: current.handoff.inherited,
        keywords: [...current.handoff.keywords],
      }
    error.value = ''
    return true
  }
  function updateReceptionPart(part: 'welcome', value: ReceptionWelcome): void
  function updateReceptionPart(part: 'handoff', value: ReceptionHandoff): void
  function updateReceptionPart(
    part: ReceptionSetupPart,
    value: ReceptionWelcome | ReceptionHandoff,
  ) {
    const applied = reuseApplied.value
    if (!applied || !applied.sections.includes('reception')) return
    if (part === 'welcome') {
      const next = value as ReceptionWelcome
      const current = applied.reception.welcome
      if (current.text === next.text && current.enabled === next.enabled) return
      applied.reception.welcome = { text: next.text, enabled: next.enabled }
      if (applied.parts.welcome === 'saved') {
        applied.parts.welcome = 'pending'
        saved.value = false
      }
      return
    }
    const next = value as ReceptionHandoff
    const current = applied.reception.handoff
    if (
      current.inherited === next.inherited &&
      current.keywords.length === next.keywords.length &&
      current.keywords.every((word, index) => word === next.keywords[index])
    )
      return
    applied.reception.handoff = { inherited: next.inherited, keywords: [...next.keywords] }
    if (applied.parts.handoff === 'saved') {
      applied.parts.handoff = 'pending'
      saved.value = false
    }
  }
  function saveFailure(cause: unknown) {
    return message(cause)
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
    const applied = reuseApplied.value
    saving.value = true
    error.value = ''
    try {
      // 非复用路径保持原有独立保存：政策保存成功后回读并完成。
      if (!applied) {
        await rules.save(id, draft.value)
        if (!current()) return false
        setDraft(await rules.load(id))
        if (!current()) return false
        saved.value = true
        sessionDrafts.delete(id)
        return true
      }
      const pendingReception: ReceptionSetupPart[] = (
        ['welcome', 'handoff'] as ReceptionSetupPart[]
      ).filter((part) => applied.parts[part] === 'pending')
      const saver = createReceptionSetupSaver({
        execute: (command) => runtime.run(command),
        snapshot: () => runtime.snapshot,
        assertCurrent: () => {
          if (!current()) throw Error('店铺工作区已改变，请重新打开引导')
        },
      })
      // 保存前预检目标接待配置：目标被其他入口改动时，政策也不写入。
      if (pendingReception.length) {
        try {
          saver.precheck(id, applied.baseline, pendingReception)
        } catch (cause) {
          error.value = saveFailure(cause)
          return false
        }
      }
      const failures: string[] = []
      if (applied.parts.policy === 'pending') {
        try {
          // 写入结果可能因后续回读失败而不确定；不得再把本次复用当成纯草稿撤销。
          applied.writeStarted = true
          await rules.save(id, draft.value)
          if (!current()) return false
          setDraft(await rules.load(id))
          if (!current()) return false
          applied.parts.policy = 'saved'
        } catch (cause) {
          failures.push(saveFailure(cause))
        }
      }
      if (pendingReception.length && current()) {
        try {
          applied.writeStarted = true
          const report = await saver.save(id, applied.reception, applied.baseline, pendingReception)
          if (!current()) return false
          for (const part of report.saved) {
            applied.parts[part] = 'saved'
            const latest = saver.read(id)
            if (part === 'welcome') applied.baseline.welcome = { ...latest.welcome }
            else
              applied.baseline.handoff = {
                inherited: latest.handoff.inherited,
                keywords: [...latest.handoff.keywords],
              }
          }
          for (const item of report.failed) failures.push(item.message)
        } catch (cause) {
          failures.push(saveFailure(cause))
        }
      }
      if (!current()) return false
      const complete =
        applied.parts.policy === 'saved' &&
        (!applied.sections.includes('reception') ||
          (applied.parts.welcome === 'saved' && applied.parts.handoff === 'saved'))
      if (complete) {
        saved.value = true
        sessionDrafts.delete(id)
        return true
      }
      error.value = failures.join('；') || '部分设置尚未保存，请重试未完成项'
      return false
    } catch (cause) {
      if (current()) error.value = saveFailure(cause)
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
    awaitingLogin.value = false
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
      if (loginReady.value) {
        step.value = 0
        resume()
      }
    } catch (cause) {
      if (current()) {
        error.value = message(cause)
        resume()
      }
    } finally {
      if (current()) pending.value = false
    }
  }
  watch(
    draft,
    () => {
      if (internalDraft) return
      const applied = reuseApplied.value
      if (applied && applied.parts.policy === 'saved') {
        applied.parts.policy = 'pending'
        saved.value = false
      }
    },
    { deep: true, flush: 'sync' },
  )
  watch(
    () => [runtime.snapshot.workspaceId, shop.value?.id],
    () => {
      if (cacheWorkspace !== runtime.snapshot.workspaceId) {
        sessionDrafts.clear()
        cacheWorkspace = runtime.snapshot.workspaceId
        resetReuse()
      }
      if (storeId.value && !valid()) finish()
    },
    { flush: 'sync' },
  )
  watch(
    () => runtime.snapshot.stores.map((item) => item.id).join(','),
    () => {
      const loadedSource = reuse.loaded
      if (
        loadedSource &&
        !runtime.snapshot.stores.some((item) => item.id === loadedSource.storeId)
      ) {
        reuse.loaded = null
        reuse.loading = false
        reuse.error = '来源店铺已不在当前工作区，请重新选择'
      }
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
  watch(loginReady, (ready) => {
    if (ready && awaitingLogin.value && valid() && runtime.selectedStoreId === storeId.value) {
      step.value = 0
      resume()
    }
  })
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
    reuse,
    reuseApplied,
    reuseSources,
    reuseCrossPlatform,
    reuseNeedsReplace,
    reusePreview,
    reuseSummary,
    reuseParts,
    reuseRemovable,
    receptionDeferred,
    loadRules,
    saveRules,
    shop,
    open,
    queueAfterLogin,
    resume,
    pauseForConfiguration,
    connect,
    finish,
    dismiss,
    openReuse,
    closeReuse,
    selectReuseSource,
    applyReuse,
    removeReuse,
    adoptReceptionBaseline,
    updateReceptionPart,
  }
})

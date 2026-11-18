import { isRecoverableKnowledgeJob } from '@/shared/knowledge-progress'
import { publishKnowledgeBatch, type BatchReviewResult } from './batch-review'
import { useKnowledgeIngestion } from './ingestion-controller'
import { useKnowledgeCatalog } from './catalog-controller'
import { useKnowledgeMaintenance } from './maintenance-controller'
import { useKnowledgeProductLearning } from './product-learning-controller'
import { useKnowledgeMiss } from './miss-controller'
import { useKnowledgeProductFamily } from './product-family-controller'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRuntimeStore } from '@/shared/state/runtime'
import { getDesktop } from '@/shared/platform/desktop'
import { downloadText } from '@/shared/platform/files'
import { knowledgeDraftSchema, knowledgeScopeSchema } from '@/shared/contracts/knowledge'
import type {
  KnowledgeDraftInput,
  KnowledgeEntry,
  KnowledgeJob,
  KnowledgeProductCard,
  KnowledgeScope,
  KnowledgeSettings,
  KnowledgeSource,
  KnowledgeVersion,
  ProductBinding,
} from '@/shared/contracts/knowledge'
import type {
  KnowledgeDetail,
  KnowledgeSummary,
  KnowledgeTrial,
  KnowledgeWindowContext,
  KnowledgeQuery,
  KnowledgeManagerTab,
} from '@/shared/contracts/knowledge-client'
import type {
  KnowledgePipelineCapabilities,
  KnowledgePipelineInput,
} from '@/shared/contracts/knowledge-pipeline'
import { createKnowledgeClient } from './manager-service'

/** Local manager state is independent from reception selection; async results retain account/store leases. */
export function useKnowledgeManager() {
  const entryHistory = ref<{ version: KnowledgeVersion; reviewed: boolean }[]>([])
  const runtime = useRuntimeStore(),
    desktop = getDesktop()
  const workspace = ref(''),
    storeId = ref(''),
    search = ref(''),
    page = ref(0),
    tab = ref<KnowledgeManagerTab>('products')
  const view = ref<'library' | 'review' | 'misses' | 'settings'>('library'),
    error = ref(''),
    notice = ref(''),
    loading = ref(false),
    busy = ref(false)
  const products = ref<KnowledgeProductCard[]>([]),
    trainingProducts = ref<KnowledgeProductCard[]>([]),
    trainingProductId = ref(''),
    trainingSession = ref(0),
    trainingLoading = ref(false),
    trainingError = ref(''),
    entries = ref<KnowledgeEntry[]>([]),
    total = ref(0),
    summary = ref<KnowledgeSummary>(),
    jobs = ref<KnowledgeJob[]>([]),
    settings = ref<KnowledgeSettings>()
  const capabilities = ref<KnowledgePipelineCapabilities>(),
    selection = ref<string[]>([]),
    allScope = ref(false)
  const detail = ref<KnowledgeDetail>(),
    detailBinding = ref<ProductBinding>(),
    detailTab = ref<'qa' | 'sources' | 'trial' | 'bindings'>('qa')
  const editableBindings = computed(
    () =>
      detail.value?.bindings.filter(
        (b) =>
          b.storeId === storeId.value && b.productId === detailBinding.value?.productId && b.active,
      ) || [],
  )
  function canEditScope(scope: KnowledgeScope) {
    if (!detail.value) return true
    return scope.kind === 'canonical'
      ? scope.canonicalId === detail.value.canonical?.id
      : scope.kind === 'binding' && editableBindings.value.some((b) => b.id === scope.bindingId)
  }
  const editableEntries = computed(
    () => detail.value?.entries.filter((e) => canEditScope(e.draft.scope)) || [],
  )
  function projectedSources(value: KnowledgeDetail) {
    const bindings = value.bindings.filter(
      (b) => b.storeId === storeId.value && b.productId === detailBinding.value?.productId,
    )
    const dependencies = new Set(
      value.entries
        .filter((e) => canEditScope(e.draft.scope))
        .flatMap((e) => [e.draft, ...(e.approved ? [e.approved] : [])])
        .flatMap((v) => v.sourceRefs.map((r) => r.sourceId)),
    )
    return value.sources.filter(
      (s) => bindings.some((b) => b.id === s.bindingId) || dependencies.has(s.id),
    )
  }
  const sourceOriginLabel = (source: KnowledgeSource) =>
    `来源店铺：${stores.value.find((s) => s.id === source.storeId)?.storeName || source.storeId}${source.storeId !== storeId.value ? '（共享知识引用）' : '（本店）'}`
  const draft = ref<KnowledgeDraftInput>(),
    dirty = ref(false),
    saved = ref<KnowledgeVersion>(),
    autosave = ref('')
  const reviewEntries = ref<KnowledgeEntry[]>([]),
    excluded = ref<string[]>([]),
    affected = ref<string[]>([])
  const question = ref(''),
    trial = ref<KnowledgeTrial>(),
    trialSku = ref(''),
    sources = ref<KnowledgeSource[]>([])
  const sourceVersions = ref<KnowledgeSource[]>([])
  const {
    catalog,
    catalogIds,
    catalogAll,
    catalogOpen,
    catalogSearch,
    load: loadCatalog,
    thumbnail: loadCatalogThumbnail,
    collect: collectCatalogSelection,
    reset: resetCatalog,
  } = useKnowledgeCatalog({ client, storeId, search })
  const batchResults = ref<BatchReviewResult[]>([])
  const {
    estimate,
    ocrPreview,
    learnProduct,
    recognizeProduct,
    startLearn,
    learnStore,
    reset: resetLearning,
  } = useKnowledgeProductLearning({
    client,
    storeId,
    notice,
    refresh,
    // 打开详情的编辑器状态仍由本 controller 唯一持有。
    selectBinding: (binding, nextSources) => {
      detailBinding.value = binding
      sources.value = nextSources
    },
  })
  const ingestion = useKnowledgeIngestion({
    client,
    storeId,
    binding: detailBinding,
    refresh,
    notice,
  })
  const importPreview = ingestion.preview
  const stores = computed(() => runtime.snapshot.stores),
    currentStore = computed(() => stores.value.find((s) => s.id === storeId.value))
  const {
    recommendations,
    deleteReview,
    removing,
    addingProduct,
    newTitle,
    newProductId,
    canonicalId,
    canonicals,
    mappingReview,
    metadataTitle,
    metadataCode,
    mappingCanonical,
    loadCanonicals,
    previewDeleteFamily,
    confirmDeleteFamily,
    saveProductMetadata,
    createProduct,
    removeBinding,
    bindShared,
    confirmShared,
  } = useKnowledgeProductFamily({
    client,
    storeId,
    detail,
    detailBinding,
    stores,
    saveDraft,
    closeEditor,
    refresh,
    notice,
  })
  let leaseRevision = 0,
    editGeneration = 0,
    draftSession = 0,
    contextRevision = -1,
    trainingTicket = 0
  let activeRun: symbol | undefined
  const { misses, missStatus, missUpdating, changeMissStatus, updateMissDisposition } =
    useKnowledgeMiss({
      client,
      workspace,
      storeId,
      page,
      total,
      notice,
      error,
      refresh,
      leaseRevision: () => leaseRevision,
      isDisposed: () => disposed,
      runtimeWorkspaceId: () => runtime.snapshot.workspaceId,
    })
  const replacementWaiters = new Set<() => void>()
  const maintenance = useKnowledgeMaintenance({
    client,
    workspace,
    storeId,
    currentStoreName: () => currentStore.value?.storeName,
    captureLease: () => ({
      revision: leaseRevision,
      workspaceId: workspace.value,
      storeId: storeId.value,
    }),
    leaseRevision: () => leaseRevision,
    contextRevision: () => contextRevision,
    runtimeWorkspaceId: () => runtime.snapshot.workspaceId,
    isDisposed: () => disposed,
    assertCaptured: assertCapturedLease,
    closeEditor,
    applyReplacementContext,
    notice,
  })
  const {
    restorePreview,
    clearScope,
    clearPreview,
    clearConfirmation,
    backup,
    backupStore,
    chooseRestore,
    chooseStoreRestore,
    restoreBackup,
    previewClear,
    clearKnowledge,
  } = maintenance
  watch(storeId, () => {
    maintenance.reset()
    clearTimeout(progressTimer)
    jobs.value = []
    misses.value = []
    missStatus.value = 'open'
    missUpdating.value = ''
    total.value = 0
    trainingTicket++
    trainingProducts.value = []
    trainingProductId.value = ''
    trainingLoading.value = false
    trainingError.value = ''
    resetLearning()
    ingestion.reset()
    batchResults.value = []
  })
  function client() {
    const service = createKnowledgeClient(workspace.value),
      revision = leaseRevision,
      w = workspace.value,
      shop = storeId.value
    const guard = async <T>(promise: Promise<T>): Promise<T> => {
      try {
        const result = await promise
        assertCapturedLease(revision, w, shop)
        return result
      } catch (cause) {
        assertCapturedLease(revision, w, shop)
        throw cause
      }
    }
    return {
      ...service,
      query: <T extends KnowledgeQuery>(query: T) => guard(service.query(query)),
      general: (input: Parameters<typeof service.general>[0]) => guard(service.general(input)),
      command: (input: Parameters<typeof service.command>[0]) => guard(service.command(input)),
      saveDraft: (input: KnowledgeDraftInput) => guard(service.saveDraft(input)),
      publish: (input: KnowledgeVersion) => guard(service.publish(input)),
      trial: (input: Parameters<typeof service.trial>[0]) => guard(service.trial(input)),
      asset: (id: string) => guard(service.asset(id)),
      sourceHistory: (id: string) => guard(service.sourceHistory(id)),
      entryHistory: (id: string) => guard(service.entryHistory(id)),
      recommendations: (id: string) => guard(service.recommendations(id)),
      deleteFamily: (input: Parameters<typeof service.deleteFamily>[0]) =>
        guard(service.deleteFamily(input)),
      export: (shop: string, format: 'csv' | 'json', canonicalId?: string) =>
        guard(service.export(shop, format, canonicalId)),
      pipeline: <T extends KnowledgePipelineInput>(input: T) => guard(service.pipeline(input)),
      backup: (canonicalId?: string, shop?: string) => guard(service.backup(canonicalId, shop)),
      restorePreview: (shop?: string) => guard(service.restorePreview(shop)),
      clearPreview: (scope: Parameters<typeof service.clearPreview>[0]) =>
        guard(service.clearPreview(scope)),
      reassociate: (input: Parameters<typeof service.reassociate>[0]) =>
        guard(service.reassociate(input)),
      context: () => guard(Promise.resolve(service.context())),
      hide: () => guard(Promise.resolve(service.hide())),
    }
  }
  let ticket = 0,
    disposed = false,
    timer: ReturnType<typeof setTimeout> | undefined,
    saveTail: Promise<void> = Promise.resolve(),
    offContext: (() => void) | undefined,
    offClose: (() => void) | undefined
  const reason = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause))
  async function run(action: () => Promise<void>) {
    if (busy.value) return
    const token = Symbol()
    activeRun = token
    busy.value = true
    error.value = ''
    try {
      await action()
    } catch (cause) {
      if (activeRun === token) error.value = reason(cause)
    } finally {
      if (activeRun === token) {
        busy.value = false
        activeRun = undefined
      }
    }
  }
  function assertCapturedLease(revision: number, w: string, shop: string) {
    assertLease(w, shop)
    if (revision !== leaseRevision) throw Error('知识库显示范围已改变，已丢弃旧结果')
  }
  function assertLease(w: string, s: string) {
    if (
      disposed ||
      workspace.value !== w ||
      storeId.value !== s ||
      runtime.snapshot.workspaceId !== w
    )
      throw Error('店铺或账号已改变，已丢弃旧结果')
  }
  let progressTimer: ReturnType<typeof setTimeout> | undefined
  const backgroundJobs = computed(() =>
    jobs.value.filter(
      (job) =>
        job.storeId === storeId.value &&
        !['succeeded', 'cancelled'].includes(job.status) &&
        (job.kind !== 'learn' ||
          !Array.isArray(job.payload?.bindingIds) ||
          !job.payload.bindingIds.length),
    ),
  )
  async function jobAction(input: KnowledgePipelineInput) {
    await client().pipeline(input)
    await refresh()
  }
  async function progressJobs(service: ReturnType<typeof client>, shop: string) {
    const first = await service.query({ type: 'jobs', page: { storeId: shop, limit: 100 } })
    let last = first.items,
      offset = last.length
    const items = new Map(first.items.map((job) => [job.id, job]))
    // The repository puts unfinished work first; fetch further pages only while recovery work continues.
    while (offset < first.total && last.length && last.every(isRecoverableKnowledgeJob)) {
      const next = await service.query({
        type: 'jobs',
        page: { storeId: shop, offset, limit: 100 },
      })
      last = next.items
      offset += last.length
      for (const job of last) items.set(job.id, job)
    }
    return { ...first, items: [...items.values()] }
  }
  async function refresh() {
    if (!storeId.value || !workspace.value) return
    const id = ++ticket,
      w = workspace.value,
      s = storeId.value,
      service = client()
    clearTimeout(progressTimer)
    loading.value = !(
      view.value === 'library' &&
      tab.value === 'products' &&
      products.value.length &&
      products.value.every((p) => p.binding.storeId === s)
    )
    try {
      const [nextSummary, nextCapabilities, nextJobs] = await Promise.all([
        service.query({ type: 'summary', storeId: s }),
        service.pipeline({ action: 'capabilities', storeId: s }),
        progressJobs(service, s),
      ])
      assertLease(w, s)
      if (id !== ticket) return
      summary.value = nextSummary
      capabilities.value = nextCapabilities
      const completed = nextJobs.items.find(
        (job) =>
          job.status === 'succeeded' &&
          jobs.value.some((old) => old.id === job.id && old.status !== 'succeeded'),
      )
      if (completed?.kind === 'collect')
        notice.value =
          '采集完成，商品已显示在列表。下一步：点击对应商品的“开始学习”，完成后到“待审核”核对草稿。'
      else if (
        completed?.kind === 'learn' &&
        (!Array.isArray(completed.payload.bindingIds) || !completed.payload.bindingIds.length)
      )
        notice.value = '通用资料学习已结束，请到“待审核”核对草稿。'
      jobs.value = nextJobs.items
      if (view.value === 'misses') {
        const result = await service.query({
          type: 'misses',
          page: {
            storeId: s,
            search: search.value,
            offset: page.value * 20,
            limit: 20,
            status: missStatus.value,
          },
        })
        assertLease(w, s)
        if (id !== ticket) return
        misses.value = result.items
        total.value = result.total
      } else if (view.value === 'settings') {
        const result = await service.query({ type: 'settings' })
        assertLease(w, s)
        if (id !== ticket) return
        settings.value = result
      } else if (view.value === 'review') {
        const result = await pendingPage(service, s, search.value, page.value * 20, 20)
        assertLease(w, s)
        if (id !== ticket) return
        entries.value = result.items
        total.value = result.total
      } else if (tab.value === 'products') {
        const result = await service.query({
          type: 'products',
          page: { storeId: s, search: search.value, offset: page.value * 20, limit: 20 },
        })
        assertLease(w, s)
        if (id !== ticket) return
        products.value = result.items
        total.value = result.total
      } else if (tab.value === 'general') {
        const result = await service.general({
          storeId: s,
          search: search.value,
          offset: page.value * 20,
          limit: 20,
        })
        assertLease(w, s)
        if (id !== ticket) return
        entries.value = result.items
        total.value = result.total
      }
      if (detail.value && detailBinding.value && detailTab.value === 'sources') {
        const latest = await service.query({
          type: 'detail',
          canonicalId: detail.value.canonical!.id,
        })
        assertLease(w, s)
        if (id === ticket) sources.value = projectedSources(latest)
      }
    } catch (cause) {
      if (id === ticket && !disposed) error.value = reason(cause)
    } finally {
      if (id === ticket) {
        loading.value = false
        if (!disposed && jobs.value.some((job) => ['queued', 'running'].includes(job.status)))
          progressTimer = setTimeout(() => {
            void refresh()
          }, 1500)
      }
    }
  }
  async function loadTrainingProducts() {
    if (!storeId.value || !workspace.value) {
      trainingProducts.value = []
      return
    }
    const id = ++trainingTicket,
      w = workspace.value,
      shop = storeId.value,
      service = client()
    trainingLoading.value = true
    trainingError.value = ''
    try {
      const items: KnowledgeProductCard[] = []
      let offset = 0,
        revision: number | undefined
      while (true) {
        const result = await service.query({
          type: 'products',
          page: { storeId: shop, search: '', offset, limit: 100 },
        })
        assertLease(w, shop)
        if (id !== trainingTicket) return
        if (revision !== undefined && revision !== result.revision)
          throw Error('商品列表已变化，请重新读取')
        revision = result.revision
        items.push(...result.items.filter((row) => row.binding.storeId === shop))
        offset += result.items.length
        if (!result.items.length || offset >= result.total) break
      }
      if (id !== trainingTicket) return
      trainingProducts.value = items
      // Keep an invalid preset visible: clearing it would silently change a product test to a generic test.
    } catch (cause) {
      if (id === trainingTicket && workspace.value === w && storeId.value === shop)
        trainingError.value = reason(cause)
    } finally {
      if (id === trainingTicket) trainingLoading.value = false
    }
  }
  function editable(version: KnowledgeVersion): KnowledgeDraftInput {
    return {
      id: version.id,
      expectedRevision: version.revision,
      scope: knowledgeScopeSchema.parse(version.scope),
      question: version.question,
      answer: version.answer,
      keywords: [...version.keywords],
      field: version.field,
      conflictKey: version.conflictKey,
      origin: version.origin,
      modelEvidence: version.modelEvidence,
      sourceRefs: version.sourceRefs.map((r) => ({ sourceId: r.sourceId, revision: r.revision })),
      expiresAt: version.expiresAt,
    }
  }
  function currentEntry(entry: KnowledgeEntry): KnowledgeEntry {
    const candidates = [
      detail.value?.entries.find((value) => value.id === entry.id),
      entries.value.find((value) => value.id === entry.id),
      entry,
    ].filter((value): value is KnowledgeEntry => Boolean(value))
    return candidates.reduce((latest, value) => (value.revision > latest.revision ? value : latest))
  }
  function reconcileVersion(version: KnowledgeVersion) {
    const update = (entry: KnowledgeEntry): KnowledgeEntry =>
      entry.id === version.id
        ? { ...entry, revision: version.revision, status: 'draft', draft: version }
        : entry
    if (detail.value) detail.value.entries = detail.value.entries.map(update)
    entries.value = entries.value.map(update)
  }
  function saveOnce() {
    clearTimeout(timer)
    const revision = leaseRevision,
      w = workspace.value,
      shop = storeId.value,
      session = draftSession
    const operation = saveTail.then(async () => {
      assertCapturedLease(revision, w, shop)
      if (session !== draftSession) throw Error('编辑内容已切换，请重新操作')
      if (!dirty.value || !draft.value) return
      if (!draft.value.question.trim() || !draft.value.answer.trim())
        throw Error('请填写问题和答案后保存；草稿仍保留在编辑器中')
      const input = knowledgeDraftSchema.parse(draft.value),
        generation = editGeneration
      if (!canEditScope(input.scope)) throw Error('此覆盖不属于当前店铺商品，请从所属店铺打开')
      autosave.value = '正在保存草稿…'
      try {
        const version = await client().saveDraft(input)
        assertCapturedLease(revision, w, shop)
        reconcileVersion(version)
        if (session !== draftSession) throw Error('编辑内容已切换，请重新操作')
        saved.value = version
        dirty.value = generation !== editGeneration
        if (draft.value) {
          draft.value.id = version.id
          draft.value.expectedRevision = version.revision
        }
        autosave.value = dirty.value ? '正在保存较新的编辑…' : '草稿已自动保存 · 尚未发布'
      } catch (cause) {
        if (revision === leaseRevision && session === draftSession)
          autosave.value = '保存失败，草稿已保留'
        throw cause
      }
    })
    saveTail = operation.catch(() => {})
    return operation
  }
  async function saveDraft() {
    const revision = leaseRevision,
      w = workspace.value,
      shop = storeId.value,
      session = draftSession
    do {
      await saveOnce()
      assertCapturedLease(revision, w, shop)
      if (session !== draftSession) throw Error('编辑内容已切换，请重新操作')
    } while (dirty.value)
  }
  function changed() {
    editGeneration++
    dirty.value = true
    saved.value = undefined
    autosave.value = '未发布草稿'
    clearTimeout(timer)
    const revision = leaseRevision
    timer = setTimeout(() => {
      void saveDraft().catch((cause) => {
        if (
          !disposed &&
          revision === leaseRevision &&
          workspace.value === runtime.snapshot.workspaceId
        )
          error.value = reason(cause)
      })
    }, 650)
  }
  function discardDraft() {
    draftSession++
    entryHistory.value = []
    clearTimeout(timer)
    draft.value = undefined
    dirty.value = false
    saved.value = undefined
  }
  async function saveSettings() {
    if (!settings.value) return
    await client().command({ type: 'save-settings', settings: settings.value })
    notice.value = '知识库设置已保存'
  }
  async function closeEditor() {
    maintenance.clearRestorePreview()
    do {
      await saveDraft()
    } while (dirty.value)
    draftSession++
    draft.value = undefined
    saved.value = undefined
    detail.value = undefined
    recommendations.value = []
    entryHistory.value = []
    detailBinding.value = undefined
    sources.value = []
    sourceVersions.value = []
    detailTab.value = 'qa'
    trial.value = undefined
    question.value = ''
    trialSku.value = ''
    resetCatalog()
  }
  async function changeStore(next: string) {
    await run(async () => {
      await closeEditor()
      leaseRevision++
      storeId.value = next
      selection.value = []
      allScope.value = false
      page.value = 0
      trial.value = undefined
      notice.value = ''
      error.value = ''
      missStatus.value = 'open'
      missUpdating.value = ''
      misses.value = []
      total.value = 0
      await refresh()
      if (tab.value === 'training') void loadTrainingProducts()
    })
  }
  async function changeTab(next: KnowledgeManagerTab) {
    await run(async () => {
      await closeEditor()
      tab.value = next
      view.value = 'library'
      selection.value = []
      allScope.value = false
      page.value = 0
      await refresh()
    })
    // Training must not hold the global busy lease while it walks product pages,
    // otherwise the shop selector becomes a silent no-op on a large catalog.
    if (tab.value === next && next === 'training') void loadTrainingProducts()
  }
  async function openTraining(row: KnowledgeProductCard) {
    await closeEditor()
    if (row.binding.storeId !== storeId.value)
      throw Error('商品不属于当前知识库店铺，请刷新商品列表后重试')
    tab.value = 'training'
    view.value = 'library'
    selection.value = []
    allScope.value = false
    page.value = 0
    trainingProductId.value = row.binding.productId
    trainingError.value = ''
    await refresh()
    if (tab.value === 'training' && trainingProductId.value === row.binding.productId)
      void loadTrainingProducts()
  }
  async function setView(next: typeof view.value) {
    await closeEditor()
    if (next === 'misses') {
      missStatus.value = 'open'
      missUpdating.value = ''
      notice.value = ''
      error.value = ''
    }
    view.value = next
    selection.value = []
    page.value = 0
    await refresh()
  }
  async function showView(next: typeof view.value) {
    await run(() => setView(next))
  }
  async function openProduct(row: KnowledgeProductCard) {
    await closeEditor()
    const w = workspace.value,
      s = storeId.value
    const result = await client().query({ type: 'detail', canonicalId: row.canonical.id })
    assertLease(w, s)
    detail.value = result
    metadataTitle.value = result.canonical?.title || ''
    metadataCode.value = result.canonical?.code || ''
    detailBinding.value = row.binding
    sources.value = projectedSources(result)
    detailTab.value = 'qa'
    question.value = ''
    trial.value = undefined
    trialSku.value = ''
  }
  function editEntry(entry: KnowledgeEntry) {
    entry = currentEntry(entry)
    if (!canEditScope(entry.draft.scope)) throw Error('此覆盖不属于当前店铺商品，请从所属店铺打开')
    draftSession++
    entryHistory.value = []
    draft.value = editable(entry.draft)
    saved.value = entry.draft
    dirty.value = false
    autosave.value = entry.approved ? '编辑后保存为草稿，旧审核版仍保留' : '草稿 · 尚未发布'
  }
  async function loadEntryHistory() {
    const id = draft.value?.id,
      session = draftSession
    if (!id) return
    const history = await client().entryHistory(id)
    if (session === draftSession && draft.value?.id === id) entryHistory.value = history
  }
  async function createOverride(entry: KnowledgeEntry) {
    await saveDraft()
    const version = currentEntry(entry).draft
    draftSession++
    entryHistory.value = []
    draft.value = {
      scope: detailBinding.value
        ? { kind: 'binding', bindingId: detailBinding.value.id }
        : { kind: 'store', storeId: storeId.value },
      question: version.question,
      answer: version.answer,
      keywords: [...version.keywords],
      field: version.field,
      conflictKey: version.conflictKey,
      origin: 'manual',
      sourceRefs: version.sourceRefs.map((ref) => ({
        sourceId: ref.sourceId,
        revision: ref.revision,
      })),
      expiresAt: version.expiresAt,
    }
    saved.value = undefined
    dirty.value = true
    detailTab.value = 'qa'
    autosave.value = '新的本店覆盖草稿，原共享知识保留'
    changed()
  }
  async function writeOne() {
    await saveDraft()
    if (tab.value === 'products' && !detail.value) {
      addingProduct.value = true
      await loadCanonicals()
      return
    }
    draftSession++
    entryHistory.value = []
    draft.value = {
      scope: detailBinding.value
        ? { kind: 'binding', bindingId: detailBinding.value.id }
        : { kind: 'store', storeId: storeId.value },
      question: '',
      answer: '',
      keywords: [],
      field: 'fact',
      origin: 'manual',
      sourceRefs: [],
    }
    dirty.value = false
    saved.value = undefined
    autosave.value = '填写问题和答案后自动保存草稿'
  }
  function setScope(value: string) {
    if (!draft.value) return
    const scope: KnowledgeScope =
      value === 'canonical' && detail.value?.canonical
        ? { kind: 'canonical', canonicalId: detail.value.canonical.id }
        : value === 'template'
          ? { kind: 'template', storeIds: [storeId.value] }
          : value.startsWith('binding:')
            ? { kind: 'binding', bindingId: value.slice(8) }
            : { kind: 'store', storeId: storeId.value }
    draft.value.scope = scope
    if (['canonical', 'template'].includes(scope.kind)) {
      draft.value.field = 'fact'
      draft.value.expiresAt = null
    }
    changed()
  }
  const scopeValue = computed(() =>
    draft.value?.scope.kind === 'binding'
      ? `binding:${draft.value.scope.bindingId}`
      : draft.value?.scope.kind,
  )
  function templateShop(id: string, enabled: boolean) {
    if (draft.value?.scope.kind !== 'template') return
    draft.value.scope.storeIds = enabled
      ? [...new Set([...draft.value.scope.storeIds, id])]
      : draft.value.scope.storeIds.filter((s) => s !== id)
    changed()
  }
  async function prepareReview(values?: KnowledgeEntry[]) {
    await saveDraft()
    if (dirty.value) throw Error('草稿在保存期间又有修改，请保存后重新审核')
    const list =
      values?.map(currentEntry) ??
      (saved.value
        ? [
            {
              id: saved.value.id,
              revision: saved.value.revision,
              status: 'draft' as const,
              draft: saved.value,
              approved: null,
            },
          ]
        : [])
    if (!list.length) throw Error('没有可审核的草稿')
    reviewEntries.value = list
    excluded.value = []
    const shops = new Set<string>()
    for (const entry of list) {
      const scope = entry.draft.scope
      if (scope.kind === 'template') scope.storeIds.forEach((id) => shops.add(id))
      else if (scope.kind === 'store') shops.add(scope.storeId)
      else if (scope.kind === 'canonical')
        (await client().query({ type: 'detail', canonicalId: scope.canonicalId })).bindings.forEach(
          (b) => shops.add(b.storeId),
        )
      else {
        const binding = detail.value?.bindings.find((b) => b.id === scope.bindingId)
        shops.add(binding?.storeId || storeId.value)
      }
    }
    affected.value = [...shops].map((id) => stores.value.find((s) => s.id === id)?.storeName || id)
  }
  async function confirmPublish() {
    const values = reviewEntries.value.filter((e) => !excluded.value.includes(e.id))
    if (!values.length) throw Error('请至少保留一个条目')
    const service = client()
    const targetResult = await service.pipeline({
      action: 'review-targets',
      storeId: storeId.value,
      entryIds: reviewEntries.value.map((e) => e.id),
    })
    batchResults.value = await publishKnowledgeBatch(
      reviewEntries.value,
      excluded.value,
      service.publish,
      async (entry) => {
        const shopName = (id: string) =>
          runtime.snapshot.stores.find((shop) => shop.id === id)?.storeName || id
        if (targetResult.targets?.[entry.id]) {
          let label = targetResult.targets[entry.id]!
          for (const shop of runtime.snapshot.stores)
            label = label.replaceAll(shop.id, shop.storeName)
          return label
        }
        const scope = entry.draft.scope
        if (scope.kind === 'canonical') {
          const detail = await service.query({ type: 'detail', canonicalId: scope.canonicalId })
          return (
            detail.bindings
              .filter((b) => !b.skuId)
              .map((b) => `${shopName(b.storeId)}/${b.productId}`)
              .join('、') ||
            detail.canonical?.title ||
            scope.canonicalId
          )
        }
        if (scope.kind === 'binding')
          return (
            detail.value?.bindings.find((b) => b.id === scope.bindingId)?.productId ||
            `商品关联 ${scope.bindingId}`
          )
        return scope.kind === 'store'
          ? `店铺 ${shopName(scope.storeId)}`
          : `通用模板 ${scope.storeIds.map(shopName).join('、')}`
      },
    )
    reviewEntries.value = []
    notice.value = `已发布 ${batchResults.value.filter((r) => r.status === 'approved').length} 条，跳过 ${batchResults.value.filter((r) => r.status === 'skipped').length} 条，失败 ${batchResults.value.filter((r) => r.status === 'failed').length} 条；请查看逐商品结果。`
    await refresh()
    if (detail.value && detailBinding.value)
      await openProduct({
        canonical: detail.value.canonical!,
        binding: detailBinding.value,
        sources: 0,
        drafts: 0,
        approved: 0,
        sourceSummary: { count: 0, kinds: [], thumbnailAssetId: null },
      })
  }
  const pendingPage = (
    service: ReturnType<typeof client>,
    shop: string,
    query: string,
    offset: number,
    limit: number,
  ) =>
    service.query({
      type: 'entries',
      page: { storeId: shop, search: query, offset, limit },
      status: 'draft',
    })
  function listingScope() {
    return {
      revision: leaseRevision,
      w: workspace.value,
      shop: storeId.value,
      view: view.value,
      tab: tab.value,
      search: search.value,
      total: total.value,
    }
  }
  function assertListing(scope: ReturnType<typeof listingScope>) {
    assertCapturedLease(scope.revision, scope.w, scope.shop)
    if (scope.view !== view.value || scope.tab !== tab.value || scope.search !== search.value)
      throw Error('筛选范围已变化，请重新选择')
  }
  function listingPage(
    service: ReturnType<typeof client>,
    scope: ReturnType<typeof listingScope>,
    offset: number,
    limit: number,
  ) {
    return scope.view === 'review'
      ? pendingPage(service, scope.shop, scope.search, offset, limit)
      : scope.tab === 'products'
        ? service.query({
            type: 'products',
            page: { storeId: scope.shop, search: scope.search, offset, limit },
          })
        : service.general({ storeId: scope.shop, search: scope.search, offset, limit })
  }
  async function bulkReview() {
    const scope = listingScope(),
      service = client(),
      selected = new Set(selection.value),
      values: KnowledgeEntry[] = []
    let revision: number | undefined
    for (let offset = 0; offset < scope.total; offset += 100) {
      const result = await listingPage(service, scope, offset, 100)
      assertListing(scope)
      if (revision !== undefined && revision !== result.revision)
        throw Error('批量范围已变化，请重新选择')
      revision = result.revision
      for (const item of result.items) {
        if ('binding' in item && selected.has(item.binding.id)) {
          const d = await service.query({
            type: 'detail',
            canonicalId: item.canonical.id,
            storeId: scope.shop,
          })
          assertListing(scope)
          values.push(...d.entries.filter((entry) => entry.status === 'draft'))
        } else if ('draft' in item && selected.has(item.id)) values.push(item)
      }
    }
    assertListing(scope)
    await prepareReview([...new Map(values.map((entry) => [entry.id, entry])).values()])
  }
  async function selectAll() {
    const scope = listingScope(),
      service = client()
    if (scope.total > 1000) throw Error('当前范围超过1000项，请缩小筛选')
    const ids: string[] = []
    let revision: number | undefined
    for (let offset = 0; offset < scope.total; offset += 100) {
      const result = await listingPage(service, scope, offset, 100)
      assertListing(scope)
      if (revision !== undefined && revision !== result.revision)
        throw Error('筛选范围已变化，请重选')
      revision = result.revision
      ids.push(...result.items.map((item) => ('binding' in item ? item.binding.id : item.id)))
    }
    assertListing(scope)
    selection.value = ids
    allScope.value = true
  }
  function select(id: string, checked: boolean) {
    selection.value = checked
      ? [...new Set([...selection.value, id])]
      : selection.value.filter((value) => value !== id)
    allScope.value = false
  }
  async function doTrial() {
    const w = workspace.value,
      s = storeId.value
    if (!question.value.trim()) throw Error('请填写试问问题')
    const result = await client().trial({
      storeId: s,
      productId: detailBinding.value?.productId,
      skuId: trialSku.value,
      query: question.value,
    })
    assertLease(w, s)
    trial.value = result
  }
  async function exportEntries(
    format: 'csv' | 'json' = 'json',
    scope: 'shop' | 'detail' = 'detail',
  ) {
    const w = workspace.value,
      shop = storeId.value,
      name = currentStore.value?.storeName || shop
    if (!shop) throw Error('请先选择店铺')
    const result = await client().export(
      shop,
      format,
      scope === 'shop' ? undefined : detail.value?.canonical?.id,
    )
    assertLease(w, shop)
    const safeName = Array.from(name, (character) => {
      const code = character.codePointAt(0)!
      return /[<>:"/\\|?*]/.test(character) || code <= 0x1f || code === 0x7f ? '_' : character
    }).join('')
    downloadText(
      `知识库-${safeName}.${format}`,
      result.text,
      format === 'json' ? 'application/json' : 'text/csv;charset=utf-8',
    )
    notice.value = `店铺「${name}」已导出${result.count}条。${result.message}`
  }
  async function collectCatalog() {
    // 目录校验与提交由 catalog controller 负责；这里只做采集后的跨视图切换。
    if (!(await collectCatalogSelection())) return
    notice.value = '正在采集商品资料，完成后可在商品条目开始学习。'
    tab.value = 'products'
    view.value = 'library'
    search.value = ''
    page.value = 0
    await refresh()
  }
  const chooseSources = () => ingestion.choose()
  const archiveChats = async () => {
    ingestion.archiveOpen.value = true
  }
  const confirmArchive = () => ingestion.choose(true)
  const applyImport = ingestion.apply
  const contextStore = (context: KnowledgeWindowContext) =>
    context.storeId || stores.value[0]?.id || ''
  const contextAlreadyApplied = (context: KnowledgeWindowContext) =>
    context.workspaceId === workspace.value &&
    context.revision <= contextRevision &&
    contextStore(context) === storeId.value
  async function applyContext(context: KnowledgeWindowContext) {
    if (context.workspaceId !== runtime.snapshot.workspaceId) return
    if (contextAlreadyApplied(context)) return
    maintenance.clearRestorePreview()
    await saveDraft()
    if (context.workspaceId !== runtime.snapshot.workspaceId) return
    if (contextAlreadyApplied(context)) return
    await closeEditor()
    if (context.workspaceId !== runtime.snapshot.workspaceId) return
    if (contextAlreadyApplied(context)) return
    leaseRevision++
    contextRevision = context.revision
    trainingSession.value++
    workspace.value = context.workspaceId
    storeId.value = contextStore(context)
    // The store watcher clears the previous shop's training preset; apply the
    // owner's new preset only after that synchronous invalidation has flushed.
    await nextTick()
    if (
      disposed ||
      contextRevision !== context.revision ||
      context.workspaceId !== runtime.snapshot.workspaceId
    )
      return
    draft.value = undefined
    detail.value = undefined
    selection.value = []
    allScope.value = false
    view.value = 'library'
    tab.value = context.tab || 'products'
    trainingProductId.value = tab.value === 'training' ? context.productId || '' : ''
    trainingError.value = ''
    page.value = 0
    if (context.workspaceId === runtime.snapshot.workspaceId && currentStore.value) error.value = ''
    await refresh()
    if (tab.value === 'training') void loadTrainingProducts()
  }
  async function applyReplacementContext(context: KnowledgeWindowContext) {
    if (disposed) throw Error('知识库窗口已关闭')
    // A refresh may resolve after its result was superseded by another refresh.
    // Wait for the actual owner snapshot, after workspace invalidation watchers,
    // rather than treating completion of an individual request as a handoff.
    await new Promise<void>((resolve, reject) => {
      let settled = false
      let stop = () => {}
      const cancel = () => finish(Error('知识库窗口已关闭，已取消工作区交接'))
      const finish = (cause?: unknown) => {
        if (settled) return
        settled = true
        stop()
        clearTimeout(timer)
        replacementWaiters.delete(cancel)
        if (cause) reject(cause)
        else resolve()
      }
      replacementWaiters.add(cancel)
      stop = watch(
        () => runtime.snapshot.workspaceId,
        (workspaceId) => {
          if (workspaceId === context.workspaceId) finish()
        },
        { flush: 'post' },
      )
      const timer = setTimeout(
        () => finish(Error('工作区交接尚未完成，请从目标店铺重新打开知识库')),
        10000,
      )
      if (runtime.snapshot.workspaceId === context.workspaceId) finish()
      void runtime.refresh().catch(finish)
    })
    await nextTick()
    if (disposed) throw Error('知识库窗口已关闭')
    await applyContext(context)
    if (disposed) throw Error('知识库窗口已关闭')
    if (
      runtime.snapshot.workspaceId !== context.workspaceId ||
      workspace.value !== context.workspaceId ||
      (context.storeId && storeId.value !== context.storeId)
    )
      throw Error('账号工作区已再次改变，请从目标店铺重新打开知识库')
  }
  async function hide() {
    await run(async () => {
      do {
        await saveDraft()
      } while (dirty.value)
      trainingSession.value++
      await client().hide()
    })
  }
  onMounted(async () => {
    await runtime.refresh()
    workspace.value = runtime.snapshot.workspaceId
    const service = client()
    const mountedRevision = leaseRevision
    offContext = service.onContext?.((context) => {
      void applyContext(context).catch((cause) => {
        if (
          context.workspaceId === workspace.value &&
          workspace.value === runtime.snapshot.workspaceId
        )
          error.value = reason(cause)
      })
    })
    offClose = service.onCloseRequest?.(() => {
      void hide()
    })
    try {
      const context = await service.context()
      if (context) await applyContext(context)
      else {
        storeId.value = stores.value[0]?.id || ''
        await refresh()
      }
    } catch (cause) {
      if (mountedRevision === leaseRevision) error.value = reason(cause)
    }
  })
  watch(
    () => runtime.snapshot.workspaceId,
    (next) => {
      if (workspace.value && next !== workspace.value) {
        leaseRevision++
        draftSession++
        editGeneration++
        ticket++
        activeRun = undefined
        busy.value = false
        loading.value = false
        clearTimeout(timer)
        saveTail = Promise.resolve()
        contextRevision = -1
        draft.value = undefined
        dirty.value = false
        saved.value = undefined
        autosave.value = ''
        detail.value = undefined
        detailBinding.value = undefined
        detailTab.value = 'qa'
        sources.value = []
        sourceVersions.value = []
        trial.value = undefined
        question.value = ''
        trialSku.value = ''
        products.value = []
        trainingTicket++
        trainingProducts.value = []
        trainingProductId.value = ''
        trainingLoading.value = false
        trainingError.value = ''
        entries.value = []
        jobs.value = []
        misses.value = []
        missStatus.value = 'open'
        missUpdating.value = ''
        settings.value = undefined
        summary.value = undefined
        capabilities.value = undefined
        resetLearning()
        total.value = 0
        selection.value = []
        allScope.value = false
        reviewEntries.value = []
        excluded.value = []
        affected.value = []
        addingProduct.value = false
        removing.value = false
        newTitle.value = ''
        newProductId.value = ''
        canonicalId.value = ''
        canonicals.value = []
        metadataTitle.value = ''
        metadataCode.value = ''
        mappingCanonical.value = ''
        mappingReview.value = undefined
        maintenance.reset()
        deleteReview.value = undefined
        recommendations.value = []
        entryHistory.value = []
        resetCatalog()
        ingestion.reset()
        batchResults.value = []
        workspace.value = next
        storeId.value = ''
        view.value = 'library'
        tab.value = 'products'
        search.value = ''
        page.value = 0
        notice.value = ''
        error.value = '账号工作区已改变，请从目标店铺重新打开知识库'
      }
    },
  )
  watch(
    () => runtime.snapshot,
    () => {
      if (workspace.value === runtime.snapshot.workspaceId && storeId.value) void refresh()
    },
  )
  watch(search, () => {
    selection.value = []
    allScope.value = false
    if (page.value !== 0) page.value = 0
    else void refresh()
  })
  watch(page, () => {
    selection.value = []
    allScope.value = false
    void refresh()
  })
  onBeforeUnmount(() => {
    disposed = true
    for (const cancel of replacementWaiters) cancel()
    ticket++
    clearTimeout(timer)
    clearTimeout(progressTimer)
    offContext?.()
    offClose?.()
  })
  return {
    desktop,
    storeId,
    search,
    page,
    tab,
    view,
    error,
    notice,
    loading,
    busy,
    products,
    trainingProducts,
    trainingProductId,
    trainingSession,
    trainingLoading,
    trainingError,
    entries,
    total,
    summary,
    jobs,
    backgroundJobs,
    jobAction,
    misses,
    missStatus,
    missUpdating,
    changeMissStatus,
    updateMissDisposition,
    settings,
    capabilities,
    selection,
    allScope,
    detail,
    editableEntries,
    editableBindings,
    sourceOriginLabel,
    detailBinding,
    detailTab,
    draft,
    autosave,
    reviewEntries,
    excluded,
    affected,
    question,
    trial,
    trialSku,
    sources,
    removing,
    sourceVersions,
    addingProduct,
    newTitle,
    newProductId,
    canonicalId,
    canonicals,
    mappingReview,
    confirmShared,
    metadataTitle,
    metadataCode,
    saveProductMetadata,
    loadCanonicals,
    mappingCanonical,
    catalog,
    catalogIds,
    catalogAll,
    catalogOpen,
    catalogSearch,
    estimate,
    stores,
    currentStore,
    client,
    run,
    refresh,
    saveDraft,
    discardDraft,
    saveSettings,
    closeEditor,
    changeStore,
    changeTab,
    showView,
    openProduct,
    openTraining,
    loadTrainingProducts,
    editEntry,
    createOverride,
    writeOne,
    createProduct,
    setScope,
    scopeValue,
    templateShop,
    prepareReview,
    confirmPublish,
    bulkReview,
    selectAll,
    select,
    removeBinding,
    bindShared,
    doTrial,
    backup,
    backupStore,
    recommendations,
    entryHistory,
    loadEntryHistory,
    deleteReview,
    previewDeleteFamily,
    confirmDeleteFamily,
    restorePreview,
    clearScope,
    clearPreview,
    clearConfirmation,
    previewClear,
    clearKnowledge,
    chooseRestore,
    chooseStoreRestore,
    restoreBackup,
    exportEntries,
    loadCatalog,
    loadCatalogThumbnail,
    collectCatalog,
    learnProduct,
    recognizeProduct,
    ocrPreview,
    startLearn,
    chooseSources,
    archiveChats,
    confirmArchive,
    archiveOpen: ingestion.archiveOpen,
    archiveFrom: ingestion.archiveFrom,
    archiveTo: ingestion.archiveTo,
    learnStore,
    applyImport,
    importPreview,
    batchResults,
    hide,
    changed,
  }
}

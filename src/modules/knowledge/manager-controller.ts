import { publishKnowledgeBatch, type BatchReviewResult } from './batch-review'
import { useKnowledgeIngestion } from './ingestion-controller'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRuntimeStore } from '@/shared/state/runtime'
import { getDesktop } from '@/shared/platform/desktop'
import { downloadText } from '@/shared/platform/files'
import { knowledgeDraftSchema, knowledgeScopeSchema } from '@/shared/contracts/knowledge'
import type {
  CanonicalProduct,
  KnowledgeDraftInput,
  KnowledgeEntry,
  KnowledgeJob,
  KnowledgeMiss,
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
} from '@/shared/contracts/knowledge-client'
import type {
  KnowledgePipelineCapabilities,
  KnowledgeCatalogPage,
  KnowledgeEstimate,
  KnowledgePipelineInput,
} from '@/shared/contracts/knowledge-pipeline'
import { createKnowledgeClient } from './manager-service'

/** Local manager state is independent from reception selection; async results retain account/store leases. */
export function useKnowledgeManager() {
  const ocrPreview = ref<import('@/shared/contracts/knowledge-pipeline').KnowledgeOcrPreview>()
  const clearScope = ref<'store' | 'account'>('store')
  const clearPreview = ref<import('@/shared/contracts/knowledge-client').KnowledgeClearPreview>()
  const clearConfirmation = ref('')
  const restorePreview =
    ref<import('@/shared/contracts/knowledge-client').KnowledgeRestorePreview>()
  const recommendations = ref<{ canonical: CanonicalProduct; reasons: string[]; score: number }[]>(
    [],
  )
  const entryHistory = ref<{ version: KnowledgeVersion; reviewed: boolean }[]>([])
  const deleteReview = ref<KnowledgeDetail>()
  const runtime = useRuntimeStore(),
    desktop = getDesktop()
  const workspace = ref(''),
    storeId = ref(''),
    search = ref(''),
    page = ref(0),
    tab = ref<'products' | 'general'>('products')
  const view = ref<'library' | 'review' | 'jobs' | 'misses' | 'settings'>('library'),
    error = ref(''),
    notice = ref(''),
    loading = ref(false),
    busy = ref(false)
  const products = ref<KnowledgeProductCard[]>([]),
    entries = ref<KnowledgeEntry[]>([]),
    total = ref(0),
    summary = ref<KnowledgeSummary>(),
    jobs = ref<KnowledgeJob[]>([]),
    misses = ref<KnowledgeMiss[]>([]),
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
  const removing = ref(false),
    sourceVersions = ref<KnowledgeSource[]>([])
  const addingProduct = ref(false),
    newTitle = ref(''),
    newProductId = ref(''),
    canonicalId = ref(''),
    canonicals = ref<CanonicalProduct[]>([])
  const mappingReview = ref<{
    root: ProductBinding
    bindings: ProductBinding[]
    target: CanonicalProduct
    shops: string[]
  }>()
  const metadataTitle = ref(''),
    metadataCode = ref('')
  const mappingCanonical = ref('')
  const catalog = ref<KnowledgeCatalogPage>(),
    catalogIds = ref<string[]>([]),
    catalogAll = ref(false),
    catalogOpen = ref(false),
    catalogSearch = ref(''),
    estimate = ref<KnowledgeEstimate>()
  const batchResults = ref<BatchReviewResult[]>([])
  const learningSelection = ref<{ bindingIds: string[]; sourceIds: string[] }>()
  const ingestion = useKnowledgeIngestion({
    client,
    storeId,
    binding: detailBinding,
    refresh,
    notice,
  })
  const importPreview = ingestion.preview
  watch(storeId, () => {
    ocrPreview.value = undefined
    clearPreview.value = undefined
    clearConfirmation.value = ''
    clearScope.value = 'store'
    ingestion.reset()
    estimate.value = undefined
    learningSelection.value = undefined
    batchResults.value = []
  })
  const stores = computed(() => runtime.snapshot.stores),
    currentStore = computed(() => stores.value.find((s) => s.id === storeId.value))
  let leaseRevision = 0,
    editGeneration = 0,
    draftSession = 0
  let activeRun: symbol | undefined
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
      pipeline: <T extends KnowledgePipelineInput>(input: T) => guard(service.pipeline(input)),
      backup: (canonicalId?: string) => guard(service.backup(canonicalId)),
      restorePreview: () => guard(service.restorePreview()),
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
  async function refresh() {
    if (!storeId.value || !workspace.value) return
    const id = ++ticket,
      w = workspace.value,
      s = storeId.value,
      service = client()
    loading.value = true
    try {
      const [nextSummary, nextCapabilities] = await Promise.all([
        service.query({ type: 'summary', storeId: s }),
        service.pipeline({ action: 'capabilities', storeId: s }),
      ])
      assertLease(w, s)
      if (id !== ticket) return
      summary.value = nextSummary
      capabilities.value = nextCapabilities
      if (view.value === 'jobs') {
        const result = await service.query({ type: 'jobs', page: { storeId: s, limit: 100 } })
        assertLease(w, s)
        if (id !== ticket) return
        jobs.value = result.items
      } else if (view.value === 'misses') {
        const result = await service.query({ type: 'misses', page: { storeId: s, limit: 100 } })
        assertLease(w, s)
        if (id !== ticket) return
        misses.value = result.items
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
      } else {
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
      if (id === ticket) loading.value = false
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
    catalog.value = undefined
    catalogIds.value = []
    catalogAll.value = false
    catalogOpen.value = false
    catalogSearch.value = ''
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
      await refresh()
    })
  }
  async function changeTab(next: 'products' | 'general') {
    await run(async () => {
      await closeEditor()
      tab.value = next
      view.value = 'library'
      selection.value = []
      allScope.value = false
      page.value = 0
      await refresh()
    })
  }
  async function setView(next: typeof view.value) {
    await closeEditor()
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
  async function loadCanonicals() {
    const values: CanonicalProduct[] = []
    for (let offset = 0; ; offset += 100) {
      const result = await client().query({ type: 'canonicals', page: { offset, limit: 100 } })
      values.push(...result.items)
      if (offset + result.items.length >= result.total) break
      if (!result.items.length) throw Error('共享商品分页不完整')
    }
    canonicals.value = values
    if (detailBinding.value)
      recommendations.value = await client().recommendations(detailBinding.value.id)
  }
  async function previewDeleteFamily() {
    await saveDraft()
    if (!detailBinding.value) return
    deleteReview.value = await client().query({
      type: 'detail',
      canonicalId: detailBinding.value.canonicalId,
    })
    removing.value = false
  }
  async function confirmDeleteFamily() {
    const value = deleteReview.value
    if (!value?.canonical) return
    await client().deleteFamily({
      canonicalId: value.canonical.id,
      expectedRevision: value.canonical.revision,
      bindings: value.bindings.map((b) => ({ id: b.id, expectedRevision: b.revision })),
    })
    deleteReview.value = undefined
    await closeEditor()
    await refresh()
    notice.value = '已从全部店铺移除此同款；审核与来源历史保留，可从备份恢复。'
  }
  async function saveProductMetadata() {
    await saveDraft()
    const canonical = detail.value?.canonical
    if (!canonical) throw Error('共享商品不存在')
    await client().command({
      type: 'save-canonical',
      canonical: {
        id: canonical.id,
        expectedRevision: canonical.revision,
        title: metadataTitle.value,
        code: metadataCode.value,
      },
    })
    notice.value = '共享商品名称与编码已保存，平台商品身份保持不变'
    if (detail.value)
      detail.value = await client().query({ type: 'detail', canonicalId: canonical.id })
    await refresh()
  }
  async function createProduct() {
    if (!newTitle.value.trim() || !newProductId.value.trim())
      throw Error('请填写商品名称和平台商品编号')
    const service = client()
    const canonical = canonicalId.value
      ? canonicals.value.find((c) => c.id === canonicalId.value)
      : ((await service.command({
          type: 'save-canonical',
          canonical: { title: newTitle.value, code: '' },
        })) as CanonicalProduct)
    if (!canonical) throw Error('共享商品不存在')
    await service.command({
      type: 'bind-product',
      binding: {
        canonicalId: canonical.id,
        storeId: storeId.value,
        productId: newProductId.value,
        title: newTitle.value,
        skuId: '',
      },
    })
    addingProduct.value = false
    newTitle.value = ''
    newProductId.value = ''
    canonicalId.value = ''
    await refresh()
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
  async function removeBinding(binding: ProductBinding) {
    await client().command({
      type: 'unlink',
      bindingId: binding.id,
      expectedRevision: binding.revision,
    })
    notice.value = '已解除当前店铺商品及其SKU关联，共享内容仍保留'
    await closeEditor()
    await refresh()
  }
  async function bindShared() {
    await saveDraft()
    const root = detailBinding.value,
      target = canonicals.value.find((c) => c.id === mappingCanonical.value)
    if (!root || root.skuId || !target) throw Error('请选择根商品与目标共享商品')
    const family =
      detail.value?.bindings.filter(
        (b) => b.storeId === root.storeId && b.productId === root.productId,
      ) || []
    const targetDetail = await client().query({ type: 'detail', canonicalId: target.id })
    const shops = [...new Set([root.storeId, ...targetDetail.bindings.map((b) => b.storeId)])].map(
      (id) => stores.value.find((s) => s.id === id)?.storeName || id,
    )
    mappingReview.value = { root, bindings: family, target, shops }
  }
  async function confirmShared() {
    const review = mappingReview.value
    if (!review) throw Error('请先预览整体同款关联')
    await client().reassociate({
      rootBindingId: review.root.id,
      canonicalId: review.target.id,
      expectedCanonicalRevision: review.target.revision,
      bindings: review.bindings.map((b) => ({ id: b.id, expectedRevision: b.revision })),
    })
    mappingReview.value = undefined
    notice.value = '根商品及全部SKU已整体关联；本店覆盖、来源与动态值保留，旧待发送引用已失效'
    await closeEditor()
    await refresh()
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
  async function backup(canonicalId?: string) {
    const result = await client().backup(canonicalId)
    notice.value = `${result.scope ? `同款全部店铺/SKU备份（${result.scope.storeIds.length}店，${result.scope.bindingIds.length}个绑定；含完整原件）` : '全库一致快照备份'}完成：${result.directory}`
  }
  async function chooseRestore() {
    await closeEditor()
    restorePreview.value = (await client().restorePreview()) ?? undefined
  }
  async function restoreBackup() {
    const preview = restorePreview.value
    if (!preview) return
    const service = createKnowledgeClient(workspace.value)
    restorePreview.value = undefined
    // Restore intentionally replaces the lease. The owner returns the verified NEW context.
    const result = await service.restore(preview.token)
    await runtime.refresh()
    await applyContext(result.context)
    notice.value = result.message
  }
  async function previewClear() {
    await closeEditor()
    clearConfirmation.value = ''
    clearPreview.value = await client().clearPreview(
      clearScope.value === 'store'
        ? { kind: 'store', storeId: storeId.value }
        : { kind: 'account' },
    )
  }
  async function clearKnowledge() {
    const preview = clearPreview.value
    if (!preview || clearConfirmation.value !== preview.confirmation)
      throw Error('请输入完整确认文字')
    const service = createKnowledgeClient(workspace.value)
    const confirmation = clearConfirmation.value
    notice.value = ''
    clearPreview.value = undefined
    clearConfirmation.value = ''
    const result = await service.clear(preview.token, confirmation)
    await runtime.refresh()
    await applyContext(result.context)
    notice.value = result.message
  }
  async function exportEntries(format: 'csv' | 'json' = 'json') {
    const w = workspace.value,
      shop = storeId.value
    const result = await createKnowledgeClient(w).export(shop, format, detail.value?.canonical?.id)
    assertLease(w, shop)
    downloadText(
      `知识库-${shop}.${format}`,
      result.text,
      format === 'json' ? 'application/json' : 'text/csv;charset=utf-8',
    )
    notice.value = `已导出${result.count}条。${result.message}`
  }
  async function loadCatalog(cursor = '', initialSearch = search.value) {
    const filter = cursor ? catalogSearch.value : initialSearch
    const result = await client().pipeline({
      action: 'catalog',
      storeId: storeId.value,
      search: filter,
      cursor,
    })
    if (
      cursor &&
      catalog.value &&
      (result.identityVersion !== catalog.value.identityVersion ||
        result.scopeToken !== catalog.value.scopeToken)
    )
      throw Error('目录身份或筛选范围已变化，请重新读取')
    catalog.value = result
    if (!cursor) {
      catalogSearch.value = filter
      catalogIds.value = []
      catalogAll.value = false
    }
    catalogOpen.value = true
  }
  async function collectCatalog() {
    if (!catalog.value) return
    if (
      catalogAll.value &&
      (!catalog.value.complete || catalog.value.total === null || catalog.value.total > 1000)
    )
      throw Error('目录范围未完整或数量超限，请明确选择已验证商品')
    if (!catalogIds.value.length && !catalogAll.value) throw Error('请选择商品或明确当前筛选全选')
    const result = await client().pipeline({
      action: 'start',
      storeId: storeId.value,
      kind: 'collect',
      bindingIds: [],
      sourceIds: [],
      catalog: {
        identityVersion: catalog.value.identityVersion,
        scopeToken: catalog.value.scopeToken,
        productIds: catalogIds.value,
        allMatching: catalogAll.value,
        total: catalog.value.total,
      },
    })
    notice.value = `已建立采集任务 ${result.jobId}`
    catalogOpen.value = false
    await setView('jobs')
  }
  async function loadCatalogThumbnail(productId: string): Promise<string> {
    const selected = catalog.value,
      service = client()
    if (!selected) throw Error('商品目录已关闭')
    const result = await service.pipeline({
      action: 'catalog-thumbnail',
      storeId: storeId.value,
      scopeToken: selected.scopeToken,
      identityVersion: selected.identityVersion,
      productId,
    })
    if (catalog.value?.scopeToken !== selected.scopeToken) throw Error('商品目录已改变')
    const image = await service.asset(result.assetId)
    if (catalog.value?.scopeToken !== selected.scopeToken) throw Error('商品目录已改变')
    return image
  }
  async function learnProduct(binding: ProductBinding) {
    const d = await client().query({
      type: 'detail',
      canonicalId: binding.canonicalId,
      storeId: binding.storeId,
    })
    learningSelection.value = {
      bindingIds: [binding.id],
      sourceIds: d.sources
        .filter(
          (s) =>
            !s.removed &&
            (s.bindingId === binding.id ||
              d.bindings.some((b) => b.id === s.bindingId && b.productId === binding.productId)),
        )
        .map((s) => s.id),
    }
    estimate.value = await client().pipeline({
      action: 'estimate',
      storeId: binding.storeId,
      ...learningSelection.value,
    })
    detailBinding.value = binding
    sources.value = d.sources
  }
  async function recognizeProduct(binding: ProductBinding) {
    const d = await client().query({
      type: 'detail',
      canonicalId: binding.canonicalId,
      storeId: binding.storeId,
    })
    const sourceIds = d.sources
      .filter(
        (s) =>
          !s.removed &&
          (s.bindingId === binding.id ||
            d.bindings.some((b) => b.id === s.bindingId && b.productId === binding.productId)),
      )
      .map((s) => s.id)
    ocrPreview.value = await client().pipeline({
      action: 'recognize-images',
      storeId: binding.storeId,
      bindingIds: [binding.id],
      sourceIds,
    })
  }
  async function startLearn() {
    if (!estimate.value || !learningSelection.value) return
    const result = await client().pipeline({
      action: 'start',
      storeId: storeId.value,
      kind: 'learn',
      ...learningSelection.value,
      estimateId: estimate.value.estimateId,
    })
    estimate.value = undefined
    notice.value = `已建立学习任务 ${result.jobId}`
    await setView('jobs')
  }
  const chooseSources = () => ingestion.choose()
  const archiveChats = async () => {
    ingestion.archiveOpen.value = true
  }
  const confirmArchive = () => ingestion.choose(true)
  const applyImport = ingestion.apply
  async function learnStore() {
    const result = await client().pipeline({ action: 'store-materials', storeId: storeId.value })
    learningSelection.value = { bindingIds: [], sourceIds: result.sourceIds }
    estimate.value = await client().pipeline({
      action: 'estimate',
      storeId: storeId.value,
      ...learningSelection.value,
    })
  }
  async function applyContext(context: KnowledgeWindowContext) {
    if (context.workspaceId !== runtime.snapshot.workspaceId) return
    if (context.revision <= contextRevision && context.workspaceId === workspace.value) return
    await saveDraft()
    if (context.revision <= contextRevision && context.workspaceId === workspace.value) return
    await closeEditor()
    leaseRevision++
    contextRevision = context.revision
    workspace.value = context.workspaceId
    storeId.value = context.storeId || stores.value[0]?.id || ''
    draft.value = undefined
    detail.value = undefined
    selection.value = []
    allScope.value = false
    view.value = 'library'
    tab.value = 'products'
    page.value = 0
    if (context.workspaceId === runtime.snapshot.workspaceId && currentStore.value) error.value = ''
    await refresh()
  }
  let contextRevision = -1
  async function hide() {
    await run(async () => {
      do {
        await saveDraft()
      } while (dirty.value)
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
        entries.value = []
        jobs.value = []
        misses.value = []
        settings.value = undefined
        summary.value = undefined
        capabilities.value = undefined
        ocrPreview.value = undefined
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
        restorePreview.value = undefined
        clearPreview.value = undefined
        clearConfirmation.value = ''
        clearScope.value = 'store'
        deleteReview.value = undefined
        recommendations.value = []
        entryHistory.value = []
        catalog.value = undefined
        catalogIds.value = []
        catalogAll.value = false
        catalogOpen.value = false
        catalogSearch.value = ''
        estimate.value = undefined
        learningSelection.value = undefined
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
  watch([search, page], () => {
    selection.value = []
    allScope.value = false
    void refresh()
  })
  onBeforeUnmount(() => {
    disposed = true
    ticket++
    clearTimeout(timer)
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
    entries,
    total,
    summary,
    jobs,
    misses,
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

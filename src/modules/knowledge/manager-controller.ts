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
} from '@/shared/contracts/knowledge-client'
import type {
  KnowledgePipelineCapabilities,
  KnowledgeCatalogPage,
  KnowledgeEstimate,
} from '@/shared/contracts/knowledge-pipeline'
import { createKnowledgeClient } from './manager-service'

/** Local manager state is independent from reception selection; async results retain account/store leases. */
export function useKnowledgeManager() {
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
    estimate = ref<KnowledgeEstimate>()
  const stores = computed(() => runtime.snapshot.stores),
    currentStore = computed(() => stores.value.find((s) => s.id === storeId.value))
  const client = () => createKnowledgeClient(workspace.value)
  let ticket = 0,
    disposed = false,
    timer: ReturnType<typeof setTimeout> | undefined,
    saveTail: Promise<void> = Promise.resolve(),
    offContext: (() => void) | undefined,
    offClose: (() => void) | undefined
  const reason = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause))
  async function run(action: () => Promise<void>) {
    if (busy.value) return
    busy.value = true
    error.value = ''
    try {
      await action()
    } catch (cause) {
      error.value = reason(cause)
    } finally {
      busy.value = false
    }
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
        const result = await service.query({
          type: 'entries',
          page: { storeId: s, offset: page.value * 20, limit: 20 },
          status: 'draft',
        })
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
      sourceRefs: version.sourceRefs.map((r) => ({ sourceId: r.sourceId, revision: r.revision })),
      expiresAt: version.expiresAt,
    }
  }
  function saveDraft() {
    clearTimeout(timer)
    const operation = saveTail.then(async () => {
      if (!dirty.value || !draft.value) return
      if (!draft.value.question.trim() || !draft.value.answer.trim())
        throw Error('请填写问题和答案后保存；草稿仍保留在编辑器中')
      const w = workspace.value,
        s = storeId.value,
        input = knowledgeDraftSchema.parse(draft.value),
        serialized = JSON.stringify(knowledgeDraftSchema.parse(draft.value))
      autosave.value = '正在保存草稿…'
      try {
        const version = await client().saveDraft(input)
        assertLease(w, s)
        saved.value = version
        dirty.value = draft.value
          ? serialized !== JSON.stringify(knowledgeDraftSchema.parse(draft.value))
          : false
        if (draft.value) {
          draft.value.id = version.id
          draft.value.expectedRevision = version.revision
        }
        autosave.value = '草稿已自动保存 · 尚未发布'
      } catch (cause) {
        autosave.value = '保存失败，草稿已保留'
        throw cause
      }
    })
    saveTail = operation.catch(() => {})
    return operation
  }
  function changed() {
    dirty.value = true
    saved.value = undefined
    autosave.value = '未发布草稿'
    clearTimeout(timer)
    timer = setTimeout(() => {
      void saveDraft().catch((cause) => {
        error.value = reason(cause)
      })
    }, 650)
  }
  function discardDraft() {
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
    await saveDraft()
    draft.value = undefined
    saved.value = undefined
    detail.value = undefined
    detailBinding.value = undefined
    sources.value = []
    sourceVersions.value = []
    detailTab.value = 'qa'
    trial.value = undefined
    question.value = ''
    trialSku.value = ''
  }
  async function changeStore(next: string) {
    await run(async () => {
      await closeEditor()
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
    sources.value = result.sources.filter((source) => source.storeId === s)
    detailTab.value = 'qa'
    question.value = ''
    trial.value = undefined
    trialSku.value = ''
  }
  function editEntry(entry: KnowledgeEntry) {
    draft.value = editable(entry.draft)
    saved.value = entry.draft
    dirty.value = false
    autosave.value = entry.approved ? '编辑后保存为草稿，旧审核版仍保留' : '草稿 · 尚未发布'
  }
  async function createOverride(entry: KnowledgeEntry) {
    await saveDraft()
    const version = entry.draft
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
      values ??
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
    for (const entry of values) await client().publish(entry.draft)
    reviewEntries.value = []
    notice.value = `已审核发布 ${values.length} 条，生效店铺：${affected.value.join('、')}`
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
  async function bulkReview() {
    const values: KnowledgeEntry[] = [],
      service = client(),
      w = workspace.value,
      shop = storeId.value
    if (view.value === 'review')
      values.push(...entries.value.filter((e) => selection.value.includes(e.id)))
    else {
      let revision: number | undefined
      for (let offset = 0; offset < total.value; offset += 100) {
        const result =
          tab.value === 'products'
            ? await service.query({
                type: 'products',
                page: { storeId: shop, search: search.value, offset, limit: 100 },
              })
            : await service.general({ storeId: shop, search: search.value, offset, limit: 100 })
        assertLease(w, shop)
        if (revision !== undefined && revision !== result.revision)
          throw Error('批量范围已变化，请重新选择')
        revision = result.revision
        for (const item of result.items) {
          if ('binding' in item && selection.value.includes(item.binding.id)) {
            const d = await service.query({
              type: 'detail',
              canonicalId: item.canonical.id,
              storeId: shop,
            })
            assertLease(w, shop)
            values.push(...d.entries.filter((e) => e.status === 'draft'))
          } else if ('draft' in item && selection.value.includes(item.id)) values.push(item)
        }
      }
    }
    await prepareReview([...new Map(values.map((e) => [e.id, e])).values()])
  }
  async function selectAll() {
    if (total.value > 1000) throw Error('当前范围超过1000项，请缩小筛选')
    const ids: string[] = []
    let revision: number | undefined
    for (let offset = 0; offset < total.value; offset += 100) {
      const result =
        tab.value === 'products' && view.value !== 'review'
          ? await client().query({
              type: 'products',
              page: { storeId: storeId.value, search: search.value, offset, limit: 100 },
            })
          : await client().general({
              storeId: storeId.value,
              search: search.value,
              offset,
              limit: 100,
            })
      if (revision !== undefined && revision !== result.revision)
        throw Error('筛选范围已变化，请重选')
      revision = result.revision
      ids.push(...result.items.map((item) => ('binding' in item ? item.binding.id : item.id)))
    }
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
  async function backup() {
    const result = await client().backup()
    notice.value = `一致快照备份完成：${result.directory}`
  }
  async function exportEntries() {
    const service = client(),
      w = workspace.value,
      shop = storeId.value,
      items: KnowledgeEntry[] = []
    let revision: number | undefined
    for (let offset = 0; ; offset += 100) {
      const result = await service.query({
        type: 'entries',
        page: { storeId: shop, offset, limit: 100 },
      })
      assertLease(w, shop)
      if (revision !== undefined && revision !== result.revision)
        throw Error('导出期间知识已变化，请重试')
      revision = result.revision
      items.push(...result.items)
      if (items.length >= result.total) break
      if (!result.items.length) throw Error('知识分页不完整')
    }
    downloadText(`知识库-${shop}.json`, JSON.stringify(items, null, 2), 'application/json')
    notice.value = `已导出本店${items.length}条知识及审核状态`
  }
  async function loadCatalog(cursor = '') {
    const result = await client().pipeline({
      action: 'catalog',
      storeId: storeId.value,
      search: search.value,
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
      catalogIds.value = []
      catalogAll.value = false
    }
    catalogOpen.value = true
  }
  async function collectCatalog() {
    if (!catalog.value) return
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
  async function learnProduct(binding: ProductBinding) {
    const d = await client().query({
      type: 'detail',
      canonicalId: binding.canonicalId,
      storeId: binding.storeId,
    })
    estimate.value = await client().pipeline({
      action: 'estimate',
      storeId: binding.storeId,
      bindingIds: [binding.id],
      sourceIds: d.sources.filter((s) => s.bindingId === binding.id).map((s) => s.id),
    })
    detailBinding.value = binding
    sources.value = d.sources
  }
  async function startLearn() {
    if (!estimate.value || !detailBinding.value) return
    const result = await client().pipeline({
      action: 'start',
      storeId: storeId.value,
      kind: 'learn',
      bindingIds: [detailBinding.value.id],
      sourceIds: sources.value.map((s) => s.id),
      estimateId: estimate.value.estimateId,
    })
    estimate.value = undefined
    notice.value = `已建立学习任务 ${result.jobId}`
    await setView('jobs')
  }
  async function chooseSources() {
    const result = await client().pipeline({
      action: 'choose-sources',
      storeId: storeId.value,
      bindingId: detailBinding.value?.id,
    })
    notice.value = `已登记 ${result.sourceIds.length} 份原始资料，尚未学习或发布`
    await refresh()
  }
  async function applyContext(context: KnowledgeWindowContext) {
    if (context.workspaceId !== runtime.snapshot.workspaceId) return
    if (context.revision <= contextRevision && context.workspaceId === workspace.value) return
    await saveDraft()
    if (context.revision <= contextRevision && context.workspaceId === workspace.value) return
    await closeEditor()
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
    await refresh()
  }
  let contextRevision = -1
  async function hide() {
    await run(async () => {
      await saveDraft()
      await client().hide()
    })
  }
  onMounted(async () => {
    await runtime.refresh()
    workspace.value = runtime.snapshot.workspaceId
    const service = client()
    offContext = service.onContext?.((context) => {
      void applyContext(context).catch((cause) => {
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
      error.value = reason(cause)
    }
  })
  watch(
    () => runtime.snapshot.workspaceId,
    (next) => {
      if (workspace.value && next !== workspace.value) {
        ticket++
        clearTimeout(timer)
        draft.value = undefined
        dirty.value = false
        detail.value = undefined
        detailBinding.value = undefined
        sources.value = []
        sourceVersions.value = []
        trial.value = undefined
        question.value = ''
        mappingReview.value = undefined
        products.value = []
        entries.value = []
        selection.value = []
        reviewEntries.value = []
        workspace.value = next
        storeId.value = ''
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
    exportEntries,
    loadCatalog,
    collectCatalog,
    learnProduct,
    startLearn,
    chooseSources,
    hide,
    changed,
  }
}

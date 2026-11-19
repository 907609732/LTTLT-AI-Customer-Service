import { computed, ref, watch, type Ref } from 'vue'
import type { KnowledgeJob } from '@/shared/contracts/knowledge'
import type {
  KnowledgeCatalogPage,
  KnowledgeEstimate,
  KnowledgeImportPreview,
} from '@/shared/contracts/knowledge-pipeline'
import { createKnowledgeClient } from './manager-service'

type Client = Pick<ReturnType<typeof createKnowledgeClient>, 'pipeline' | 'query'>
/** Own only this onboarding's jobs. Never resume or replay unrelated historical requests. */
export function useKnowledgeOnboarding(options: {
  storeId: Ref<string>
  workspaceId: Ref<string>
  client?: (workspace: string) => Client
}) {
  const busy = ref(false),
    error = ref(''),
    notice = ref('')
  const catalog = ref<KnowledgeCatalogPage>(),
    selected = ref<string[]>([])
  const preview = ref<KnowledgeImportPreview>(),
    estimate = ref<KnowledgeEstimate>()
  const job = ref<KnowledgeJob>(),
    jobId = ref(''),
    imported = ref(false)
  const sourceIds = ref<string[]>([]),
    bindingIds = ref<string[]>([])
  const submissionUnknown = ref(false)
  let generation = 0
  const client = () => (options.client ?? createKnowledgeClient)(options.workspaceId.value)
  const activeJob = computed(
    () => Boolean(jobId.value) && (!job.value || ['queued', 'running'].includes(job.value.status)),
  )
  const percent = computed(() => {
    const progress = job.value?.progress
    return progress?.total
      ? Math.min(100, Math.floor((progress.completed / progress.total) * 100))
      : null
  })
  function reset() {
    generation++
    busy.value = false
    error.value = notice.value = jobId.value = ''
    catalog.value = undefined
    preview.value = undefined
    estimate.value = undefined
    job.value = undefined
    imported.value = false
    submissionUnknown.value = false
    selected.value = []
    sourceIds.value = []
    bindingIds.value = []
  }
  watch(() => [options.storeId.value, options.workspaceId.value], reset, { flush: 'sync' })
  async function run(
    action: (service: Client, store: string, current: () => void) => Promise<void>,
  ) {
    if (busy.value) return
    const ticket = generation,
      store = options.storeId.value,
      workspace = options.workspaceId.value
    const current = () => {
      if (
        ticket !== generation ||
        store !== options.storeId.value ||
        workspace !== options.workspaceId.value
      )
        throw Error('店铺或账号已切换')
    }
    busy.value = true
    error.value = ''
    try {
      if (!store || !workspace) throw Error('请重新打开当前店铺引导')
      await action(client(), store, current)
    } catch (cause) {
      if (ticket === generation)
        error.value = (cause instanceof Error ? cause.message : String(cause)).replace(
          /^Error invoking remote method '[^']+': (?:Error: )?/,
          '',
        )
    } finally {
      if (ticket === generation) busy.value = false
    }
  }
  async function loadCatalog() {
    await run(async (service, store, current) => {
      if (jobId.value) throw Error('本次已有导入任务，请查看其结果')
      const page = await service.pipeline({ action: 'catalog', storeId: store })
      current()
      // Keep the server's scope token. allMatching is not used: the exact previewed IDs are submitted.
      const items = [...page.items]
      let cursor = page.nextCursor
      for (let pages = 1; cursor; pages++) {
        if (pages >= 1000 || items.length >= 10000) throw Error('商品范围过大，请在知识库分批导入')
        const next = await service.pipeline({ action: 'catalog', storeId: store, cursor })
        current()
        if (next.scopeToken !== page.scopeToken || next.identityVersion !== page.identityVersion)
          throw Error('商品范围已变化，请重新读取')
        items.push(...next.items)
        cursor = next.nextCursor
      }
      catalog.value = { ...page, items, nextCursor: null }
      selected.value = items.map((item) => item.productId)
      notice.value = items.length
        ? `读取到 ${items.length} 件在售商品`
        : '没有可导入的在售商品，可稍后再做'
    })
  }
  async function chooseFiles() {
    await run(async (service, store, current) => {
      if (jobId.value) throw Error('本次已有导入任务，请查看其结果')
      const chosen = await service.pipeline({ action: 'choose-sources', storeId: store })
      current()
      if (!chosen.sourceIds.length) {
        notice.value = '未选择文件'
        return
      }
      const result = await service.pipeline({
        action: 'preview-import',
        storeId: store,
        sourceIds: chosen.sourceIds,
      })
      current()
      sourceIds.value = chosen.sourceIds
      preview.value = result
    })
  }
  async function startImport(kind: 'collect' | 'import') {
    if (activeJob.value || jobId.value || submissionUnknown.value) return
    await run(async (service, store, current) => {
      const page = catalog.value,
        file = preview.value
      const productIds = [...selected.value]
      if (kind === 'collect' && productIds.length > 1000)
        throw Error('单次最多导入1000件商品，请缩小本次选择，剩余商品可在知识库继续导入')
      if (
        kind === 'collect' &&
        (!page ||
          !productIds.length ||
          productIds.some((id) => !page.items.some((item) => item.productId === id)))
      )
        throw Error('请选择本次预览中的商品')
      if (kind === 'import' && !file) throw Error('请先预览文件')
      submissionUnknown.value = true
      const result = await service.pipeline({
        action: 'start',
        kind,
        storeId: store,
        ...(kind === 'collect' && page
          ? {
              catalog: {
                identityVersion: page.identityVersion,
                scopeToken: page.scopeToken,
                productIds,
                allMatching: false,
                total: productIds.length,
              },
            }
          : { sourceIds: [...sourceIds.value], estimateId: file!.previewId }),
      })
      current()
      if (typeof result.jobId !== 'string' || !result.jobId)
        throw Error('未收到任务编号，请在知识库核对提交结果')
      submissionUnknown.value = false
      jobId.value = result.jobId
      job.value = undefined
      preview.value = undefined
      estimate.value = undefined
    })
  }
  async function refreshJob() {
    if (!jobId.value) return
    await run(async (service, store, current) => {
      const id = jobId.value
      let found: KnowledgeJob | undefined
      for (let offset = 0; offset < 10000; offset += 100) {
        const page = await service.query({
          type: 'jobs',
          page: { storeId: store, offset, limit: 100 },
        })
        current()
        found = page.items.find((item) => item.id === id && item.storeId === store)
        if (found || offset + page.items.length >= page.total) break
      }
      if (!found) throw Error('未找到本次任务，请在知识库核对；不要重复提交')
      job.value = found
      if (found.kind !== 'learn' && found.status === 'succeeded') {
        imported.value = true
        const count =
          found.kind === 'import' && typeof found.checkpoint.completed === 'number'
            ? found.checkpoint.completed
            : found.progress.completed
        notice.value = count ? `导入完成：${count} 项` : '导入结束，没有新增资料'
      }
      if (found.kind === 'learn' && found.status === 'succeeded')
        notice.value = '学习完成，请到知识库审核草稿'
      if (found.status === 'paused') notice.value = '任务已暂停，可从知识库继续或取消本次任务'
      if (['failed', 'needs-confirmation', 'cancelled'].includes(found.status))
        notice.value =
          found.status === 'needs-confirmation'
            ? `部分完成或待确认：${found.error}`
            : found.status === 'cancelled'
              ? '任务已取消'
              : `任务失败：${found.error}`
    })
  }
  async function estimateLearning() {
    await run(async (service, store, current) => {
      const completed = job.value
      if (!completed || completed.kind === 'learn' || completed.status !== 'succeeded')
        throw Error('请先完成本次导入')
      const fileSources = new Set<string>(
        completed.kind === 'import' && Array.isArray(completed.checkpoint.sourceIds)
          ? completed.checkpoint.sourceIds.filter((id): id is string => typeof id === 'string')
          : [],
      )
      const leases = completed.checkpoint.bindingLeases
      const ids = Array.isArray(leases)
        ? leases.flatMap((value) =>
            value && typeof value === 'object' && 'id' in value && typeof value.id === 'string'
              ? [value.id]
              : [],
          )
        : []
      const collectedSources = new Set<string>(),
        matchedBindings = new Set<string>()
      if (completed.kind === 'import') {
        const materials = await service.pipeline({ action: 'store-materials', storeId: store })
        current()
        materials.sourceIds
          .filter((id) => fileSources.has(id))
          .forEach((id) => collectedSources.add(id))
      }
      for (let offset = 0; offset < 10000; offset += 100) {
        const page = await service.query({
          type: 'products',
          page: { storeId: store, offset, limit: 100 },
        })
        current()
        for (const row of page.items.filter(
          (item) =>
            item.binding.storeId === store &&
            (completed.kind === 'import' || ids.includes(item.binding.id)),
        )) {
          const detail = await service.query({
            type: 'detail',
            canonicalId: row.canonical.id,
            storeId: store,
          })
          current()
          const sources = detail.sources.filter(
            (source) =>
              !source.removed &&
              source.storeId === store &&
              (!source.bindingId || source.bindingId === row.binding.id) &&
              (completed.kind === 'import'
                ? fileSources.has(source.id)
                : source.updatedAt >= completed.createdAt),
          )
          if (sources.length) matchedBindings.add(row.binding.id)
          sources.forEach((source) => collectedSources.add(source.id))
        }
        if (offset + page.items.length >= page.total) break
        if (offset === 9900) throw Error('资料范围过大，请在知识库分批学习')
      }
      bindingIds.value = [...matchedBindings]
      sourceIds.value = [...collectedSources]
      if (bindingIds.value.length > 1000) throw Error('本次商品过多，请在知识库分批学习')
      if (!sourceIds.value.length) throw Error('本次没有新增可学习资料，可稍后在知识库选择')
      const result = await service.pipeline({
        action: 'estimate',
        storeId: store,
        bindingIds: [...bindingIds.value],
        sourceIds: [...sourceIds.value],
      })
      current()
      estimate.value = result
    })
  }
  async function startLearning() {
    if (!estimate.value || activeJob.value || submissionUnknown.value) return
    await run(async (service, store, current) => {
      submissionUnknown.value = true
      const result = await service.pipeline({
        action: 'start',
        kind: 'learn',
        storeId: store,
        bindingIds: [...bindingIds.value],
        sourceIds: [...sourceIds.value],
        estimateId: estimate.value!.estimateId,
      })
      current()
      if (typeof result.jobId !== 'string' || !result.jobId)
        throw Error('未收到任务编号，请在知识库核对提交结果')
      submissionUnknown.value = false
      jobId.value = result.jobId
      job.value = undefined
      estimate.value = undefined
    })
  }
  async function cancel() {
    await run(async (service, store, current) => {
      if (!jobId.value) return
      await service.pipeline({ action: 'cancel', storeId: store, jobId: jobId.value })
      current()
    })
    await refreshJob()
  }
  return {
    busy,
    error,
    notice,
    catalog,
    selected,
    preview,
    estimate,
    job,
    jobId,
    imported,
    activeJob,
    percent,
    submissionUnknown,
    loadCatalog,
    chooseFiles,
    startImport,
    refreshJob,
    estimateLearning,
    startLearning,
    cancel,
    reset,
  }
}

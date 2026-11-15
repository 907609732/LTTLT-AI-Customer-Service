import { ref, type Ref } from 'vue'
import type { KnowledgeImportPreview } from '@/shared/contracts/knowledge-pipeline'
import type { ProductBinding } from '@/shared/contracts/knowledge'
import type { createKnowledgeClient } from './manager-service'
export function useKnowledgeIngestion(options: {
  client: () => Pick<ReturnType<typeof createKnowledgeClient>, 'pipeline'>
  storeId: Ref<string>
  binding: Ref<ProductBinding | undefined>
  refresh(): Promise<void>
  notice: Ref<string>
}) {
  const preview = ref<KnowledgeImportPreview>(),
    sourceIds = ref<string[]>([]),
    archiveOpen = ref(false),
    archiveFrom = ref(new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10)),
    archiveTo = ref(new Date().toISOString().slice(0, 10))
  async function choose(archive = false) {
    const client = options.client(),
      storeId = options.storeId.value
    const selected = archive
      ? await client.pipeline({
          action: 'archive-chat',
          storeId,
          from: new Date(archiveFrom.value + 'T00:00:00').getTime(),
          to: new Date(archiveTo.value + 'T23:59:59').getTime(),
        })
      : await client.pipeline({
          action: 'choose-sources',
          storeId,
          bindingId: options.binding.value?.id,
        })
    if (!selected.sourceIds.length) {
      options.notice.value =
        'range' in selected && typeof selected.range === 'string'
          ? selected.range
          : '未选择可导入资料'
      archiveOpen.value = false
      return
    }
    sourceIds.value = selected.sourceIds
    preview.value = await client.pipeline({
      action: 'preview-import',
      storeId,
      sourceIds: selected.sourceIds,
      bindingIds: archive ? [] : options.binding.value ? [options.binding.value.id] : [],
    })
    if ('range' in selected && typeof selected.range === 'string')
      preview.value.warnings.push(selected.range)
    archiveOpen.value = false
  }
  async function apply() {
    if (!preview.value) return
    const result = await options.client().pipeline({
      action: 'start',
      storeId: options.storeId.value,
      kind: 'import',
      sourceIds: sourceIds.value,
      estimateId: preview.value.previewId,
    })
    options.notice.value = `已提交导入任务 ${result.jobId}；仅原料或未审核问答，尚未模型学习/发布`
    preview.value = undefined
    await options.refresh()
  }
  function reset() {
    archiveOpen.value = false
    preview.value = undefined
    sourceIds.value = []
  }
  return { preview, choose, apply, reset, archiveOpen, archiveFrom, archiveTo }
}

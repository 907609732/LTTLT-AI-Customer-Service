import { ref, type Ref } from 'vue'
import type { ProductBinding, KnowledgeSource } from '@/shared/contracts/knowledge'
import type { KnowledgeEstimate, KnowledgeOcrPreview } from '@/shared/contracts/knowledge-pipeline'
import type { createKnowledgeClient } from './manager-service'

/**
 * 商品学习/识图只负责选择范围、估算与启动任务；打开商品详情仍由 manager
 * 的单一编辑器生命周期处理，这里仅通过 selectBinding 交回明确的领域结果。
 */
export function useKnowledgeProductLearning(options: {
  client: () => Pick<ReturnType<typeof createKnowledgeClient>, 'query' | 'pipeline'>
  storeId: Ref<string>
  notice: Ref<string>
  refresh: () => Promise<void>
  selectBinding: (binding: ProductBinding, sources: KnowledgeSource[]) => void
}) {
  const estimate = ref<KnowledgeEstimate>()
  const learningSelection = ref<{ bindingIds: string[]; sourceIds: string[] }>()
  const ocrPreview = ref<KnowledgeOcrPreview>()

  async function learnProduct(binding: ProductBinding) {
    const detail = await options.client().query({
      type: 'detail',
      canonicalId: binding.canonicalId,
      storeId: binding.storeId,
    })
    learningSelection.value = {
      bindingIds: [binding.id],
      sourceIds: detail.sources
        .filter(
          (source) =>
            !source.removed &&
            (source.bindingId === binding.id ||
              detail.bindings.some(
                (row) => row.id === source.bindingId && row.productId === binding.productId,
              )),
        )
        .map((source) => source.id),
    }
    estimate.value = await options.client().pipeline({
      action: 'estimate',
      storeId: binding.storeId,
      ...learningSelection.value,
    })
    options.selectBinding(binding, detail.sources)
  }

  async function recognizeProduct(binding: ProductBinding) {
    const detail = await options.client().query({
      type: 'detail',
      canonicalId: binding.canonicalId,
      storeId: binding.storeId,
    })
    const sourceIds = detail.sources
      .filter(
        (source) =>
          !source.removed &&
          (source.bindingId === binding.id ||
            detail.bindings.some(
              (row) => row.id === source.bindingId && row.productId === binding.productId,
            )),
      )
      .map((source) => source.id)
    ocrPreview.value = await options.client().pipeline({
      action: 'recognize-images',
      storeId: binding.storeId,
      bindingIds: [binding.id],
      sourceIds,
    })
  }

  async function startLearn() {
    if (!estimate.value || !learningSelection.value) return
    await options.client().pipeline({
      action: 'start',
      storeId: options.storeId.value,
      kind: 'learn',
      ...learningSelection.value,
      estimateId: estimate.value.estimateId,
    })
    estimate.value = undefined
    options.notice.value = learningSelection.value.bindingIds.length
      ? '已开始学习，请在对应商品条目查看资料处理进度；完成后请审核草稿。'
      : '已开始学习本店通用资料'
    await options.refresh()
  }

  async function learnStore() {
    const result = await options.client().pipeline({
      action: 'store-materials',
      storeId: options.storeId.value,
    })
    if (!result.sourceIds.length) {
      options.notice.value = '本店暂无可学习的通用资料，请先通过“导入”添加资料文件。'
      return
    }
    learningSelection.value = { bindingIds: [], sourceIds: result.sourceIds }
    estimate.value = await options.client().pipeline({
      action: 'estimate',
      storeId: options.storeId.value,
      ...learningSelection.value,
    })
  }

  /** 店铺切换或工作区切换时清掉估算、选择与识图预览。 */
  function reset() {
    estimate.value = undefined
    learningSelection.value = undefined
    ocrPreview.value = undefined
  }

  return {
    estimate,
    learningSelection,
    ocrPreview,
    learnProduct,
    recognizeProduct,
    startLearn,
    learnStore,
    reset,
  }
}

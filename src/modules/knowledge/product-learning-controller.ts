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

  let generation = 0
  async function learnProducts(bindings: ProductBinding[], assertScope: () => void = () => {}) {
    const owner = ++generation
    const shop = options.storeId.value
    estimate.value = undefined
    learningSelection.value = undefined
    if (!bindings.length) throw Error('请先选择商品')
    if (bindings.some((binding) => binding.storeId !== shop))
      throw Error('商品范围已变化，请重新选择')
    const service = options.client()
    const sourceIds = new Set<string>()
    let firstSources: KnowledgeSource[] = []
    const assertCurrent = () => {
      assertScope()
      if (owner !== generation || shop !== options.storeId.value)
        throw Error('学习范围已变化，请重新选择')
    }
    for (const binding of bindings) {
      const detail = await service.query({
        type: 'detail',
        canonicalId: binding.canonicalId,
        storeId: shop,
      })
      assertCurrent()
      if (binding === bindings[0]) firstSources = detail.sources
      for (const source of detail.sources) {
        if (
          !source.removed &&
          (source.bindingId === binding.id ||
            detail.bindings.some(
              (row) =>
                row.id === source.bindingId &&
                row.storeId === shop &&
                row.productId === binding.productId,
            ))
        )
          sourceIds.add(source.id)
      }
    }
    const selected = {
      bindingIds: [...new Set(bindings.map((binding) => binding.id))],
      sourceIds: [...sourceIds],
    }
    const result = await service.pipeline({ action: 'estimate', storeId: shop, ...selected })
    assertCurrent()
    learningSelection.value = selected
    estimate.value = result
    if (bindings.length === 1) options.selectBinding(bindings[0]!, firstSources)
  }

  async function learnProduct(binding: ProductBinding) {
    await learnProducts([binding])
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
    generation++
    estimate.value = undefined
    learningSelection.value = undefined
    ocrPreview.value = undefined
  }

  return {
    estimate,
    learningSelection,
    ocrPreview,
    learnProduct,
    learnProducts,
    recognizeProduct,
    startLearn,
    learnStore,
    reset,
  }
}

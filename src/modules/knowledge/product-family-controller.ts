import { ref, type Ref } from 'vue'
import type { CanonicalProduct, ProductBinding } from '@/shared/contracts/knowledge'
import type { KnowledgeDetail } from '@/shared/contracts/knowledge-client'
import type { createKnowledgeClient } from './manager-service'

/**
 * 商品家族维护只持有同款创建/元数据、解绑、整体重关联和删除预览状态。
 * 草稿、审核、工作区租约和编辑器生命周期仍由 manager 唯一持有；所有请求
 * 继续经过 manager 注入的受租约保护 client()。
 */
export function useKnowledgeProductFamily(options: {
  client: () => Pick<
    ReturnType<typeof createKnowledgeClient>,
    'query' | 'command' | 'deleteFamily' | 'reassociate' | 'recommendations'
  >
  storeId: Ref<string>
  detail: Ref<KnowledgeDetail | undefined>
  detailBinding: Ref<ProductBinding | undefined>
  stores: Ref<{ id: string; storeName: string }[]>
  saveDraft(): Promise<void>
  closeEditor(): Promise<void>
  refresh(): Promise<void>
  notice: Ref<string>
}) {
  const recommendations = ref<{ canonical: CanonicalProduct; reasons: string[]; score: number }[]>(
    [],
  )
  const deleteReview = ref<KnowledgeDetail>()
  const removing = ref(false)
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

  async function loadCanonicals() {
    const values: CanonicalProduct[] = []
    for (let offset = 0; ; offset += 100) {
      const result = await options
        .client()
        .query({ type: 'canonicals', page: { offset, limit: 100 } })
      values.push(...result.items)
      if (offset + result.items.length >= result.total) break
      if (!result.items.length) throw Error('共享商品分页不完整')
    }
    canonicals.value = values
    if (options.detailBinding.value)
      recommendations.value = await options.client().recommendations(options.detailBinding.value.id)
  }
  async function previewDeleteFamily() {
    await options.saveDraft()
    if (!options.detailBinding.value) return
    deleteReview.value = await options.client().query({
      type: 'detail',
      canonicalId: options.detailBinding.value.canonicalId,
    })
    removing.value = false
  }
  async function confirmDeleteFamily() {
    const value = deleteReview.value
    if (!value?.canonical) return
    await options.client().deleteFamily({
      canonicalId: value.canonical.id,
      expectedRevision: value.canonical.revision,
      bindings: value.bindings.map((b) => ({ id: b.id, expectedRevision: b.revision })),
    })
    deleteReview.value = undefined
    await options.closeEditor()
    await options.refresh()
    options.notice.value = '已从全部店铺移除此同款；审核与来源历史保留，可从备份恢复。'
  }
  async function saveProductMetadata() {
    await options.saveDraft()
    const canonical = options.detail.value?.canonical
    if (!canonical) throw Error('共享商品不存在')
    await options.client().command({
      type: 'save-canonical',
      canonical: {
        id: canonical.id,
        expectedRevision: canonical.revision,
        title: metadataTitle.value,
        code: metadataCode.value,
      },
    })
    options.notice.value = '共享商品名称与编码已保存，平台商品身份保持不变'
    if (options.detail.value)
      options.detail.value = await options.client().query({
        type: 'detail',
        canonicalId: canonical.id,
      })
    await options.refresh()
  }
  async function createProduct() {
    if (!newTitle.value.trim() || !newProductId.value.trim())
      throw Error('请填写商品名称和平台商品编号')
    const service = options.client()
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
        storeId: options.storeId.value,
        productId: newProductId.value,
        title: newTitle.value,
        skuId: '',
      },
    })
    addingProduct.value = false
    newTitle.value = ''
    newProductId.value = ''
    canonicalId.value = ''
    await options.refresh()
  }
  async function removeBinding(binding: ProductBinding) {
    await options.client().command({
      type: 'unlink',
      bindingId: binding.id,
      expectedRevision: binding.revision,
    })
    options.notice.value = '已解除当前店铺商品及其SKU关联，共享内容仍保留'
    await options.closeEditor()
    await options.refresh()
  }
  async function bindShared() {
    await options.saveDraft()
    const root = options.detailBinding.value,
      target = canonicals.value.find((c) => c.id === mappingCanonical.value)
    if (!root || root.skuId || !target) throw Error('请选择根商品与目标共享商品')
    const family =
      options.detail.value?.bindings.filter(
        (b) => b.storeId === root.storeId && b.productId === root.productId,
      ) || []
    const targetDetail = await options.client().query({ type: 'detail', canonicalId: target.id })
    const shops = [...new Set([root.storeId, ...targetDetail.bindings.map((b) => b.storeId)])].map(
      (id) => options.stores.value.find((s) => s.id === id)?.storeName || id,
    )
    mappingReview.value = { root, bindings: family, target, shops }
  }
  async function confirmShared() {
    const review = mappingReview.value
    if (!review) throw Error('请先预览整体同款关联')
    await options.client().reassociate({
      rootBindingId: review.root.id,
      canonicalId: review.target.id,
      expectedCanonicalRevision: review.target.revision,
      bindings: review.bindings.map((b) => ({ id: b.id, expectedRevision: b.revision })),
    })
    mappingReview.value = undefined
    options.notice.value =
      '根商品及全部SKU已整体关联；本店覆盖、来源与动态值保留，旧待发送引用已失效'
    await options.closeEditor()
    await options.refresh()
  }

  return {
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
  }
}

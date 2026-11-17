import { ref, type Ref } from 'vue'
import type { KnowledgeCatalogPage } from '@/shared/contracts/knowledge-pipeline'
import type { createKnowledgeClient } from './manager-service'

/**
 * 目录采集只持有目录弹窗状态，跨视图切换和刷新仍由 manager 协调。
 * 翻页必须保持同一 identityVersion/scopeToken；未知总数时不得自动全选，
 * 缩略图两次异步读取后重新核对 scopeToken。
 */
export function useKnowledgeCatalog(options: {
  client: () => Pick<ReturnType<typeof createKnowledgeClient>, 'pipeline' | 'asset'>
  storeId: Ref<string>
  search: Ref<string>
}) {
  const catalog = ref<KnowledgeCatalogPage>(),
    catalogIds = ref<string[]>([]),
    catalogAll = ref(false),
    catalogOpen = ref(false),
    catalogSearch = ref('')

  async function load(cursor = '', initialSearch = options.search.value) {
    const filter = cursor ? catalogSearch.value : initialSearch
    const result = await options.client().pipeline({
      action: 'catalog',
      storeId: options.storeId.value,
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

  /** 返回 false 表示没有已读取目录，保持原来的静默返回；抛错沿用原校验文案。 */
  async function collect(): Promise<boolean> {
    const value = catalog.value
    if (!value) return false
    if (catalogAll.value && (!value.complete || value.total === null || value.total > 1000))
      throw Error('目录范围未完整或数量超限，请明确选择已验证商品')
    if (!catalogIds.value.length && !catalogAll.value) throw Error('请选择商品或明确当前筛选全选')
    await options.client().pipeline({
      action: 'start',
      storeId: options.storeId.value,
      kind: 'collect',
      bindingIds: [],
      sourceIds: [],
      catalog: {
        identityVersion: value.identityVersion,
        scopeToken: value.scopeToken,
        productIds: catalogIds.value,
        allMatching: catalogAll.value,
        total: value.total,
      },
    })
    catalogOpen.value = false
    return true
  }

  async function thumbnail(productId: string): Promise<string> {
    const selected = catalog.value,
      service = options.client()
    if (!selected) throw Error('商品目录已关闭')
    const result = await service.pipeline({
      action: 'catalog-thumbnail',
      storeId: options.storeId.value,
      scopeToken: selected.scopeToken,
      identityVersion: selected.identityVersion,
      productId,
    })
    if (catalog.value?.scopeToken !== selected.scopeToken) throw Error('商品目录已改变')
    const image = await service.asset(result.assetId)
    if (catalog.value?.scopeToken !== selected.scopeToken) throw Error('商品目录已改变')
    return image
  }

  /** 只由账号/工作区切换清理；切换店铺保留原目录行为。 */
  function reset() {
    catalog.value = undefined
    catalogIds.value = []
    catalogAll.value = false
    catalogOpen.value = false
    catalogSearch.value = ''
  }

  return {
    catalog,
    catalogIds,
    catalogAll,
    catalogOpen,
    catalogSearch,
    load,
    collect,
    thumbnail,
    reset,
  }
}

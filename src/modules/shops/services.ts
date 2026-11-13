import { useRuntimeStore } from '@/shared/state/runtime'
import {
  productsPageSchema,
  productSchema,
  importPreviewSchema,
  type ProductDraft,
} from '@/shared/contracts/backend'

/** 领域服务负责响应校验和分页转换，组件不直接拼接原始 IPC。 */
export function useProductService() {
  const runtime = useRuntimeStore()
  return {
    async list(storeId: string, page: number) {
      return productsPageSchema.parse(
        (
          await runtime.run({
            action: 'list-products',
            storeId,
            values: { offset: (page - 1) * 20, limit: 20 },
          })
        ).data,
      )
    },
    async save(storeId: string, draft: ProductDraft) {
      return productSchema.parse(
        (await runtime.run({ action: 'save-product', storeId, values: { ...draft } })).data,
      )
    },
    async preview(storeId: string, csv: string) {
      return importPreviewSchema.parse(
        (await runtime.run({ action: 'preview-product-import', storeId, values: { csv } })).data,
      )
    },
  }
}

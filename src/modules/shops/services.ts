import { useRuntimeStore } from '@/shared/state/runtime'
import { productSchema, importPreviewSchema, type ProductDraft } from '@/shared/contracts/backend'
import {
  productCatalogPageSchema,
  setProductCodesResultSchema,
  type SetProductCodesInput,
} from '@/shared/contracts/product-catalog'

/** 领域服务负责响应校验和分页转换，组件不直接拼接原始 IPC。 */
export function useProductService() {
  const runtime = useRuntimeStore()
  return {
    async list(
      storeId: string,
      page: number,
      options: { pageSize?: number; query?: string; merchantCode?: string } = {},
    ) {
      const limit = options.pageSize ?? 20
      return productCatalogPageSchema.parse(
        (
          await runtime.run({
            action: 'list-products',
            storeId,
            values: {
              offset: (page - 1) * limit,
              limit,
              query: options.query ?? '',
              merchantCode: options.merchantCode ?? '',
            },
          })
        ).data,
      )
    },
    async setCodes(storeId: string, input: SetProductCodesInput) {
      return setProductCodesResultSchema.parse(
        (await runtime.run({ action: 'set-product-codes', storeId, values: { ...input } })).data,
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

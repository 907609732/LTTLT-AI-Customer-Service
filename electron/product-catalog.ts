import { z } from 'zod'
import { productsPageSchema, type Product } from '../src/shared/contracts/backend'
import {
  productCatalogPageSchema,
  productCatalogQuerySchema,
  setProductCodesSchema,
} from '../src/shared/contracts/product-catalog'
import {
  platformProductDetailSchema,
  type PlatformProductDetail,
} from '../src/shared/contracts/platform-product'

interface Options {
  directory: string
  execute(command: {
    action: 'list-products'
    storeId: string
    values: { offset: number; limit: number }
  }): Promise<unknown>
  assertActive(): void
  assertStore(storeId: string): void
  getPlatformProduct?(storeId: string, productId: string): PlatformProductDetail | null
}
const nativePageSchema = z.object({ status: z.literal('ok'), data: productsPageSchema })
/** Platform codes are read-only source facts; legacy local-code files remain untouched. */
export function createProductCatalog(options: Options) {
  const check = (storeId: string) => {
    z.string().min(1).max(64).parse(storeId)
    options.assertActive()
    options.assertStore(storeId)
  }
  async function allProducts(storeId: string) {
    check(storeId)
    const rows: Product[] = [],
      ids = new Set<string>()
    let total: number | undefined, revision: number | undefined
    for (let offset = 0; offset <= 10000; offset += 100) {
      check(storeId)
      const page = nativePageSchema.parse(
        await options.execute({ action: 'list-products', storeId, values: { offset, limit: 100 } }),
      ).data
      check(storeId)
      if (
        !Number.isInteger(page.total) ||
        page.total < 0 ||
        page.total > 10000 ||
        !Number.isInteger(page.revision) ||
        page.revision < 0 ||
        page.items.length > 100
      )
        throw Error('商品列表超出容量或分页数据无效')
      if (total !== undefined && (page.total !== total || page.revision !== revision))
        throw Error('商品在采集期间已变化，请刷新重试')
      total = page.total
      revision = page.revision
      if (!page.items.length && rows.length < total) throw Error('商品分页为空，未采用不完整结果')
      for (const row of page.items) {
        if (row.storeId !== storeId || ids.has(row.id))
          throw Error('商品分页重复或店铺不符，未采用不完整结果')
        ids.add(row.id)
        rows.push(row)
      }
      if (rows.length > total) throw Error('商品数量与平台分页总数不一致')
      if (rows.length === total) return { revision, rows }
    }
    throw Error('商品列表超出单次读取容量')
  }
  return {
    async list(storeId: string, values: unknown) {
      const query = productCatalogQuerySchema.parse(values)
      const products = await allProducts(storeId)
      check(storeId)
      const needle = query.query.toLocaleLowerCase(),
        codeNeedle = query.merchantCode.toLocaleLowerCase()
      const rows = products.rows
        .map((row) => {
          const raw = options.getPlatformProduct?.(storeId, row.productId) ?? null
          const platformDetail = raw ? platformProductDetailSchema.parse(raw) : null
          if (platformDetail && platformDetail.productId !== row.productId)
            throw Error('平台商品来源编号不一致')
          return { ...row, merchantCode: platformDetail?.merchantCode ?? '', platformDetail }
        })
        .filter(
          (row) =>
            (!needle ||
              row.title.toLocaleLowerCase().includes(needle) ||
              row.productId.toLocaleLowerCase().includes(needle)) &&
            (!codeNeedle ||
              [
                row.merchantCode,
                ...(row.platformDetail?.skus.map((sku) => sku.merchantCode) ?? []),
              ].some((code) => code.toLocaleLowerCase().includes(codeNeedle))),
        )
      check(storeId)
      return productCatalogPageSchema.parse({
        revision: products.revision,
        codesRevision: 0,
        total: rows.length,
        items: rows.slice(query.offset, query.offset + query.limit),
      })
    },
    async setCodes(storeId: string, input: unknown): Promise<{ revision: number }> {
      check(storeId)
      setProductCodesSchema.parse(input)
      throw Error('平台商家编码为只读来源，请在平台后台维护后重新采集')
    },
  }
}

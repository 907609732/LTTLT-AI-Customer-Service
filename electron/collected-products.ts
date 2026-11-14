import { z } from 'zod'
import { productsPageSchema, productSchema } from '../src/shared/contracts/backend'
import type { PlatformProductDetail } from '../src/shared/contracts/platform-product'
import {
  platformLearningIdentitySchema,
  platformLearningProductSchema,
  type PlatformLearningIdentity,
  type PlatformLearningProduct,
} from '../src/shared/contracts/platform-learning'

export interface CollectedProductsInput {
  identity: PlatformLearningIdentity
  products: PlatformLearningProduct[]
  signal: AbortSignal
}
interface Options {
  execute(command: {
    action: 'list-products' | 'save-product'
    storeId: string
    values: Record<string, unknown>
  }): Promise<unknown>
  assertActive(): void
  assertStore(storeId: string): void
  assertIdentity(identity: PlatformLearningIdentity): Promise<void>
  savePlatformProduct?(storeId: string, detail: PlatformProductDetail): void
}
const draftSchema = z
  .object({
    productId: z.string().trim().min(1).max(100),
    title: z.string().trim().min(1).max(200),
    description: z.string().max(6000),
    specifications: z.string().max(3000),
    price: z.literal(''),
    enabled: z.literal(false),
  })
  .strict()
/** New source rows are inactive. Existing local knowledge is never overwritten by collection. */
export function createCollectedProductWriter(options: Options) {
  return {
    async write(input: CollectedProductsInput): Promise<void> {
      const identity = platformLearningIdentitySchema.parse(input.identity)
      // Validate the whole page before the first write; never silently shorten source material.
      const sources = z.array(platformLearningProductSchema).max(10000).parse(input.products)
      for (const row of sources) {
        if (row.platformDetail && row.platformDetail.productId !== row.id)
          throw Error('平台详情与商品编号不一致')
      }
      const drafts = sources.map((row) =>
        draftSchema.parse({
          productId: row.id,
          title: row.title,
          description: row.description,
          specifications: row.specifications,
          price: '',
          enabled: false,
        }),
      )
      const check = () => {
        input.signal.throwIfAborted()
        options.assertActive()
        options.assertStore(identity.storeId)
      }
      const verify = async () => {
        check()
        await options.assertIdentity(identity)
        check()
      }
      await verify()
      const ids = new Set<string>(),
        productIds = new Set<string>()
      let revision: number | undefined, total: number | undefined
      for (let offset = 0; offset <= 10000; offset += 100) {
        check()
        const result = z.object({ status: z.literal('ok'), data: productsPageSchema }).parse(
          await options.execute({
            action: 'list-products',
            storeId: identity.storeId,
            values: { offset, limit: 100 },
          }),
        ).data
        check()
        if (
          !Number.isSafeInteger(result.total) ||
          result.total < 0 ||
          result.total > 10000 ||
          !Number.isSafeInteger(result.revision) ||
          result.revision < 0 ||
          result.items.length > 100
        )
          throw Error('商品列表范围无效')
        if (total !== undefined && (total !== result.total || revision !== result.revision))
          throw Error('商品列表读取期间已变化，请重试')
        total = result.total
        revision = result.revision
        for (const row of result.items) {
          if (row.storeId !== identity.storeId) throw Error('商品列表店铺身份不一致')
          if (ids.has(row.id) || productIds.has(row.productId))
            throw Error('商品列表返回重复页或重复编号')
          ids.add(row.id)
          productIds.add(row.productId)
        }
        if (ids.size === total) break
        if (!result.items.length || ids.size > total || offset >= 10000)
          throw Error('商品列表未读取完整')
      }
      await verify()
      for (const draft of drafts) {
        const detail = sources.find((row) => row.id === draft.productId)?.platformDetail
        if (detail && options.savePlatformProduct) {
          await verify()
          options.savePlatformProduct(identity.storeId, detail)
          await verify()
        }
        if (productIds.has(draft.productId)) continue
        await verify()
        const result = z.object({ status: z.literal('ok'), data: productSchema }).parse(
          await options.execute({
            action: 'save-product',
            storeId: identity.storeId,
            values: { ...draft },
          }),
        ).data
        if (
          result.storeId !== identity.storeId ||
          result.productId !== draft.productId ||
          result.enabled !== false
        )
          throw Error('采集商品保存结果未核对')
        productIds.add(draft.productId)
        await verify()
      }
    },
  }
}

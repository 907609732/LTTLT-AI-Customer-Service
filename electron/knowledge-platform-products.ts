import {
  platformProductDetailSchema,
  type PlatformProductDetail,
} from '../src/shared/contracts/platform-product'
import type { KnowledgeRepository } from './knowledge'
/** Compatibility port for already verified platform collection; raw material is never approved here. */
export function createKnowledgePlatformProducts(options: {
  repository: KnowledgeRepository
  assertActive(): void
  assertStore(storeId: string): void
}) {
  const check = (storeId: string) => {
    options.assertActive()
    options.assertStore(storeId)
  }
  return {
    get(storeId: string, productId: string): PlatformProductDetail | null {
      check(storeId)
      const binding = options.repository
        .listBindings()
        .find((b) => b.storeId === storeId && b.productId === productId && !b.skuId)
      if (!binding) return null
      for (const source of options.repository
        .listSources({ storeId, bindingId: binding.id })
        .reverse()) {
        if (source.kind !== 'platform') continue
        try {
          const parsed = platformProductDetailSchema.safeParse(JSON.parse(source.text))
          if (parsed.success && parsed.data.productId === productId) return parsed.data
        } catch {
          /* Other platform sources may be text rather than a complete detail snapshot. */
        }
      }
      return null
    },
    upsert(storeId: string, input: unknown) {
      check(storeId)
      const detail = platformProductDetailSchema.parse(input),
        repo = options.repository
      repo.transaction(() => {
        check(storeId)
        const binding = repo
          .listBindings()
          .find((b) => b.storeId === storeId && b.productId === detail.productId && !b.skuId)
        if (!binding) throw Error('请先建立此店铺商品绑定再保存平台来源')
        const source = repo.listSources({ storeId, bindingId: binding.id }).find(
          (s) =>
            s.kind === 'platform' &&
            (() => {
              try {
                return platformProductDetailSchema.safeParse(JSON.parse(s.text)).success
              } catch {
                return false
              }
            })(),
        )
        if (source) {
          const previous = platformProductDetailSchema.parse(JSON.parse(source.text))
          if (previous.capturedAt > detail.capturedAt)
            throw Error('商品来源已更新，拒绝较早采集结果')
        }
        repo.saveSource({
          id: source?.id,
          expectedRevision: source?.revision,
          kind: 'platform',
          storeId,
          bindingId: binding.id,
          label: detail.title,
          text: JSON.stringify(detail),
          locator: { url: detail.sourceUrl },
          assetIds: source?.assetIds ?? [],
        })
        for (const sku of detail.skus)
          if (
            sku.skuId &&
            !repo
              .listBindings()
              .some(
                (b) =>
                  b.storeId === storeId &&
                  b.productId === detail.productId &&
                  b.skuId === sku.skuId,
              )
          )
            repo.bindProduct({
              canonicalId: binding.canonicalId,
              storeId,
              productId: detail.productId,
              skuId: sku.skuId,
              title: detail.title,
            })
      })
    },
  }
}

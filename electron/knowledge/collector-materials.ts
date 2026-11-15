import type { KnowledgeRepository } from './index'
import {
  platformProductDetailSchema,
  type PlatformProductDetail,
} from '../../src/shared/contracts/platform-product'
import type { KnowledgeSource, ProductBinding } from '../../src/shared/contracts/knowledge'
import { createKnowledgePlatformProducts } from '../knowledge-platform-products'
const stableImageUrl = (value: string) => {
  const url = new URL(value)
  for (const key of [...url.searchParams.keys()])
    if (
      /^(?:signature|sig|token|expires|x-signature|x-expires|x-oss-signature|x-oss-expires|x-oss-security-token|requestId)$/i.test(
        key,
      )
    )
      url.searchParams.delete(key)
  return url.href
}
export const collectorMaterialLabels = {
  static: '平台静态资料',
  images: '平台图片资料',
  dynamic: '平台动态快照',
  capture: '平台采集范围',
  catalog: '平台目录快照',
} as const
export interface CollectedImage {
  url: string
  assetId?: string
  error?: string
}
/** Raw lineage, stable learning material and time-bound SKU snapshots are separate source identities. */
export function createCollectorMaterials(repository: KnowledgeRepository) {
  const raw = createKnowledgePlatformProducts({ repository, assertActive() {}, assertStore() {} })
  function save(
    binding: ProductBinding,
    label: string,
    text: string,
    locator: KnowledgeSource['locator'],
    assetIds: string[] = [],
  ) {
    const old = repository
      .listSources({ storeId: binding.storeId, bindingId: binding.id })
      .find(
        (source) =>
          source.kind === 'platform' &&
          source.label === label &&
          repository.getMetadata(`cleared-source:${source.id}`) !== '1',
      )
    return repository.saveSource({
      id: old?.id,
      expectedRevision: old?.revision,
      storeId: binding.storeId,
      bindingId: binding.id,
      kind: 'platform',
      label,
      text,
      locator,
      assetIds,
    })
  }
  function root(storeId: string, productId: string, title: string) {
    return (
      repository
        .listBindings()
        .find(
          (binding) =>
            binding.storeId === storeId && binding.productId === productId && !binding.skuId,
        ) ??
      repository.bindProduct({
        storeId,
        productId,
        title,
        canonicalId: repository.saveCanonical({ title }).id,
      })
    )
  }
  return {
    write(
      storeId: string,
      input: PlatformProductDetail,
      images: CollectedImage[] = [],
      coverage?: { scope: string; pageCursor: string | null },
    ) {
      const detail = platformProductDetailSchema.parse(input)
      return repository.transaction(() => {
        const binding = root(storeId, detail.productId, detail.title)
        raw.upsert(storeId, detail)
        // Request query/capture metadata and price/stock must never revise static facts.
        const url = new URL(detail.sourceUrl)
        const locator = {
          url: `${url.origin}${url.pathname}?goods_id=${encodeURIComponent(detail.productId)}`,
        }
        const staticSource = save(
          binding,
          collectorMaterialLabels.static,
          JSON.stringify({
            productId: detail.productId,
            title: detail.title,
            merchantCode: detail.merchantCode,
            description: detail.description,
            attributes: detail.attributes,
            images: detail.images.map(stableImageUrl),
            skus: detail.skus
              .map(({ skuId, specs, merchantCode, barcode }) => ({
                skuId,
                specs,
                merchantCode,
                barcode,
              }))
              .sort((a, b) => a.skuId.localeCompare(b.skuId)),
          }),
          locator,
        )
        for (const sku of detail.skus) {
          if (!sku.skuId) continue
          const skuBinding = repository
            .listBindings()
            .find(
              (row) =>
                row.storeId === storeId &&
                row.productId === detail.productId &&
                row.skuId === sku.skuId,
            )!
          save(
            skuBinding,
            collectorMaterialLabels.dynamic,
            JSON.stringify({
              productId: detail.productId,
              skuId: sku.skuId,
              price: sku.price,
              stock: sku.stock,
              capturedAt: detail.capturedAt,
            }),
            locator,
          )
        }
        if (detail.detailStatus === 'complete') {
          for (const previousSku of repository
            .listBindings()
            .filter(
              (row) =>
                row.storeId === storeId &&
                row.productId === detail.productId &&
                row.skuId &&
                !detail.skus.some((sku) => sku.skuId === row.skuId),
            ))
            save(
              previousSku,
              collectorMaterialLabels.dynamic,
              JSON.stringify({
                productId: detail.productId,
                skuId: previousSku.skuId,
                availability: 'not-listed',
                capturedAt: detail.capturedAt,
              }),
              locator,
            )
        }
        const existing = repository
          .listSources({ bindingId: binding.id })
          .find(
            (source) =>
              source.label === collectorMaterialLabels.images &&
              repository.getMetadata(`cleared-source:${source.id}`) !== '1',
          )
        // A failed refresh is recorded separately and cannot erase previously captured bytes.
        const previous = existing
          ? (JSON.parse(existing.text) as { images: CollectedImage[] })
          : { images: [] }
        const resolved = detail.images.map((url) => {
          const image = images.find((image) => image.url === url)
          const prior = previous.images.find(
            (image) => stableImageUrl(image.url) === stableImageUrl(url),
          )
          return {
            url: stableImageUrl(url),
            ...(image?.assetId
              ? { assetId: image.assetId }
              : prior?.assetId
                ? { assetId: prior.assetId }
                : {}),
          }
        })
        const imageSource = save(
          binding,
          collectorMaterialLabels.images,
          JSON.stringify({ productId: detail.productId, images: resolved }),
          locator,
          [...new Set(resolved.flatMap((image) => (image.assetId ? [image.assetId] : [])))],
        )
        save(
          binding,
          collectorMaterialLabels.capture,
          JSON.stringify({
            capturedAt: detail.capturedAt,
            detailStatus: detail.detailStatus,
            detailNote: detail.detailNote,
            ...coverage,
            images: detail.images.map(
              (url) =>
                images.find((image) => image.url === url) ?? { url, error: '尚未取得图片字节' },
            ),
          }),
          locator,
        )
        return { binding, staticSource, imageSource }
      })
    },
    writeList(
      storeId: string,
      item: {
        id: string
        title: string
        description: string
        specifications: string
        merchantCode?: string
        thumbnailUrl?: string
        sourceUrl: string
      },
      capturedAt: number,
      coverage?: { scope: string; pageCursor: string | null },
      images: CollectedImage[] = [],
    ) {
      return repository.transaction(() => {
        const binding = root(storeId, item.id, item.title)
        const thumbnailUrl = item.thumbnailUrl ? stableImageUrl(item.thumbnailUrl) : undefined
        const previous = repository
          .listSources({ bindingId: binding.id })
          .find(
            (source) =>
              source.label === collectorMaterialLabels.catalog &&
              !source.removed &&
              repository.getMetadata(`cleared-source:${source.id}`) !== '1',
          )
        let assetIds = images.flatMap((image) => (image.assetId ? [image.assetId] : []))
        if (!assetIds.length && thumbnailUrl && previous) {
          // A failed refresh must not erase verified bytes for the same picture.
          try {
            const last = JSON.parse(previous.text) as { thumbnailUrl?: string }
            if (last.thumbnailUrl === thumbnailUrl) assetIds = previous.assetIds
          } catch {
            // Legacy free-form catalog notes cannot authorize retaining an image.
          }
        }
        save(
          binding,
          collectorMaterialLabels.catalog,
          JSON.stringify({
            ...item,
            ...(thumbnailUrl ? { thumbnailUrl } : {}),
            capturedAt,
            detailStatus: 'partial',
            detailNote: '详情未读取；列表动态字段不作为共享静态知识',
            ...coverage,
          }),
          { url: item.sourceUrl },
          assetIds,
        )
        return binding
      })
    },
  }
}

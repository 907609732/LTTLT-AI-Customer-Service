import type { KnowledgeRepository } from './repository'
import type { KnowledgeOcrPreview } from '../../src/shared/contracts/knowledge-pipeline'
import { imageParts } from './sources'
import {
  windowsOcrEngine,
  recognizeWindowsImage,
  parseWindowsOcrResult,
  type ImageOcrResult,
} from './windows-ocr'
import { collectorMaterialLabels } from './collector-materials'

export function createKnowledgeImageOcr(options: {
  repository: KnowledgeRepository
  assertActive(): void
  assertStore?(storeId: string): void
  recognize?: (bytes: Uint8Array, signal: AbortSignal) => Promise<ImageOcrResult>
}) {
  const repo = options.repository,
    controllers = new Map<AbortController, string>()
  let closed = false
  const key = (id: string) => `image-ocr:${windowsOcrEngine}:${id}`
  function read(id: string) {
    const cached = repo.getMetadata(key(id))
    return cached ? parseWindowsOcrResult(cached) : undefined
  }
  return {
    read,
    async recognize(
      storeId: string,
      bindingIds: string[],
      sourceIds: string[],
    ): Promise<KnowledgeOcrPreview> {
      if (closed) throw Error('图片识别服务已关闭')
      options.assertActive()
      options.assertStore?.(storeId)
      const bindings = [...new Set(bindingIds)].map((id) => {
        const b = repo.getBinding(id)
        if (!b?.active || b.storeId !== storeId) throw Error('识别商品不属于本店')
        return b
      })
      const sources = [...new Set(sourceIds)]
        .map((id) => {
          const s = repo.getSource(id)
          const b = s?.bindingId ? repo.getBinding(s.bindingId) : null
          if (
            !s ||
            s.removed ||
            s.storeId !== storeId ||
            !b?.active ||
            !bindings.some((x) => x.id === b.id || (!x.skuId && x.productId === b.productId))
          )
            throw Error('识别图片来源不在所选商品范围')
          return s
        })
        .filter((s) => repo.getMetadata(`cleared-source:${s.id}`) !== '1')
      const controller = new AbortController()
      controllers.set(controller, storeId)
      const check = () => {
        controller.signal.throwIfAborted()
        if (closed) throw Error('图片识别服务已关闭')
        options.assertActive()
        options.assertStore?.(storeId)
        if (
          bindings.some((b) => {
            const v = repo.getBinding(b.id)
            return !v?.active || v.revision !== b.revision
          }) ||
          sources.some((s) => {
            const v = repo.getSource(s.id)
            return !v || v.removed || v.revision !== s.revision
          })
        )
          throw Error('商品或图片来源已变化，识别结果未写入')
      }
      const items: KnowledgeOcrPreview['items'] = [],
        images = new Set<string>()
      try {
        for (const source of sources) {
          if (source.kind === 'platform' && source.label !== collectorMaterialLabels.images)
            continue
          const assetIds = source.locator.imageAssetId
            ? [source.locator.imageAssetId]
            : source.assetIds
          for (const id of [...new Set(assetIds)]) {
            if (
              !repo
                .row<import('../../src/shared/contracts/knowledge').KnowledgeAsset>('assets', id)
                ?.mimeType.startsWith('image/')
            )
              continue
            images.add(id)
            if (images.size > 200) throw Error('单次识别最多200张图片，请按商品分批')
            const tiles = await imageParts(repo.readAsset(id), source.locator)
            check()
            for (const tile of tiles) {
              if (items.length >= 1000) throw Error('单次识别分块过多，请按商品分批')
              const asset = repo.addAsset(tile.image!.bytes, {
                name: 'OCR图片分块',
                mimeType: 'image/png',
              })
              let result = read(asset.id)
              if (!result) {
                result = await (options.recognize ?? recognizeWindowsImage)(
                  tile.image!.bytes,
                  controller.signal,
                )
                check()
                const verified = parseWindowsOcrResult(JSON.stringify(result))
                repo.setMetadata(key(asset.id), JSON.stringify(verified))
                result = verified
              }
              check()
              items.push({
                sourceId: source.id,
                imageAssetId: id,
                tileAssetId: asset.id,
                image: source.locator.image ?? assetIds.indexOf(id) + 1,
                tile: tile.locator.tile ?? 1,
                text: result.text,
              })
            }
          }
        }
        check()
        return {
          engine: windowsOcrEngine,
          images: images.size,
          characters: items.reduce((n, i) => n + i.text.length, 0),
          items,
        }
      } finally {
        controllers.delete(controller)
      }
    },
    removeStore(storeId: string) {
      for (const [c, s] of controllers) if (s === storeId) c.abort()
    },
    dispose() {
      closed = true
      for (const c of controllers.keys()) c.abort()
      controllers.clear()
    },
  }
}

import { createHash, randomUUID } from 'node:crypto'
import { existsSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import {
  KNOWLEDGE_PRODUCT_IMAGE_MAX_BYTES,
  KNOWLEDGE_PRODUCT_IMAGE_MAX_DIMENSION,
  KNOWLEDGE_PRODUCT_IMAGE_MAX_PIXELS,
  KNOWLEDGE_PRODUCT_IMAGE_MAX_TOTAL_BYTES,
  KNOWLEDGE_PRODUCT_IMAGE_STAGE_LIMIT,
  KNOWLEDGE_PRODUCT_IMAGE_STAGE_TTL_MS,
  KNOWLEDGE_PRODUCT_PROFILE_GALLERY_LIMIT,
  KNOWLEDGE_PRODUCT_PROFILE_MAX_IMAGES,
  KNOWLEDGE_PRODUCT_PROFILE_SOURCE_LABEL,
  isKnowledgeProductProfileSource,
  knowledgeProductImageDiscardSchema,
  knowledgeProductImageStageSchema,
  knowledgeProductProfileSaveSchema,
  knowledgeProductProfileStoredSchema,
  type KnowledgeProductProfile,
  type KnowledgeProductProfileImage,
  type KnowledgeProductProfileSave,
  type KnowledgeStagedProductImage,
} from '../../src/shared/contracts/knowledge-product-profile'
import type {
  KnowledgeAsset,
  KnowledgeSource,
  ProductBinding,
} from '../../src/shared/contracts/knowledge'
import type { KnowledgeRepository } from './repository'
import { collectorMaterialLabels } from './collector-materials'
import { knowledgeRequire } from './node-loader'
const canvas = knowledgeRequire('@napi-rs/canvas') as {
  loadImage(input: Buffer): Promise<{ width: number; height: number }>
}

interface PickedImage {
  name: string
  bytes: Uint8Array
}
interface StageRecord {
  workspaceId: string
  storeId: string
  bindingId: string
  bindingRevision: number
  manualSourceId: string | null
  manualSourceRevision: number | null
  name: string
  mimeType: string
  bytes: Uint8Array
  expiresAt: number
}
const imageMime = (bytes: Uint8Array): string => {
  if (
    bytes.length >= 8 &&
    Buffer.from(bytes.subarray(0, 8)).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )
    return 'image/png'
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
    return 'image/jpeg'
  if (bytes.length >= 6 && /^GIF8[79]a$/.test(Buffer.from(bytes.subarray(0, 6)).toString()))
    return 'image/gif'
  if (
    bytes.length >= 12 &&
    Buffer.from(bytes.subarray(0, 4)).toString() === 'RIFF' &&
    Buffer.from(bytes.subarray(8, 12)).toString() === 'WEBP'
  )
    return 'image/webp'
  return ''
}
export function productImagePreview(bytes: Uint8Array, mimeType?: string) {
  const mime = mimeType || imageMime(bytes)
  if (!mime) throw Error('仅支持PNG、JPEG、GIF或WebP图片')
  return `data:${mime};base64,${Buffer.from(bytes).toString('base64')}`
}
function sanitizeName(value: string) {
  const name = z.string().trim().min(1).max(1000).parse(value).split(/[\\/]/).pop() || ''
  return z.string().trim().min(1).max(200).parse(name)
}
async function validatePicked(file: PickedImage) {
  const name = sanitizeName(file.name)
  if (!file.bytes.byteLength || file.bytes.byteLength > KNOWLEDGE_PRODUCT_IMAGE_MAX_BYTES)
    throw Error('单张图片需在10MB以内')
  const mimeType = imageMime(file.bytes)
  if (!mimeType) throw Error('图片格式伪装或不受支持；仅接受PNG、JPEG、GIF或WebP')
  try {
    const image = await canvas.loadImage(Buffer.from(file.bytes))
    if (
      !image.width ||
      !image.height ||
      image.width > KNOWLEDGE_PRODUCT_IMAGE_MAX_DIMENSION ||
      image.height > KNOWLEDGE_PRODUCT_IMAGE_MAX_DIMENSION ||
      image.width * image.height > KNOWLEDGE_PRODUCT_IMAGE_MAX_PIXELS
    )
      throw Error('图片像素尺寸超出限制')
  } catch (cause) {
    if (cause instanceof Error && cause.message === '图片像素尺寸超出限制') throw cause
    throw Error('图片内容无法解码或格式伪装')
  }
  return { name, mimeType, bytes: file.bytes }
}
function parseStored(source: KnowledgeSource) {
  try {
    return knowledgeProductProfileStoredSchema.parse(JSON.parse(source.text))
  } catch {
    throw Error('商品手工资料格式损坏，请从备份恢复后再编辑')
  }
}
function describeImage(repository: KnowledgeRepository, id: string): KnowledgeProductProfileImage {
  const asset = repository.row<KnowledgeAsset>('assets', id)
  if (!asset || !asset.mimeType.startsWith('image/')) throw Error('商品图片附件不存在或不是图片')
  return { assetId: asset.id, name: asset.name, mimeType: asset.mimeType, size: asset.size }
}

/**
 * Product profile reads only one root binding. Saves use the existing source/asset/version
 * tables (therefore backups and source history need no migration) but keep a dedicated
 * structured label so learning and reception never consume it as platform evidence.
 */
export function createKnowledgeProductProfileService(options: {
  repository: KnowledgeRepository
  workspaceId: string
  assertActive(): void
  assertStore(storeId: string): void
  chooseProductImages?(): Promise<PickedImage[]>
  now?(): number
}) {
  const repo = options.repository
  const now = options.now ?? Date.now
  const stages = new Map<string, StageRecord>()

  function assertBinding(storeId: string, bindingId: string) {
    options.assertActive()
    options.assertStore(storeId)
    const binding = repo.getBinding(bindingId)
    if (!binding?.active || binding.storeId !== storeId || binding.skuId)
      throw Error('当前店铺根商品不存在或已解除关联，请刷新后重试')
    if (!repo.getCanonical(binding.canonicalId)) throw Error('共享商品不存在')
    return binding
  }
  function sourceVisible(source: KnowledgeSource) {
    return !source.removed && repo.getMetadata(`cleared-source:${source.id}`) !== '1'
  }
  function manual(binding: ProductBinding) {
    const source = repo
      .listSources({ storeId: binding.storeId, bindingId: binding.id })
      .find((row) => sourceVisible(row) && isKnowledgeProductProfileSource(row))
    return source ? { source, stored: parseStored(source) } : null
  }
  function assertManualExpectation(
    current: ReturnType<typeof manual>,
    id: string | null,
    revision: number | null,
  ) {
    if (!current) {
      if (id !== null || revision !== null)
        throw Error('商品手工资料尚未建立或已变化，请刷新后重试')
      return
    }
    if (current.source.id !== id || current.source.revision !== revision)
      throw Error('商品手工资料已变化，请刷新后重试')
  }
  function assertBindingRevision(binding: ProductBinding, expected: number) {
    if (binding.revision !== expected) throw Error('商品资料已变更，请刷新后重试')
  }
  function cleanupStages() {
    const at = now()
    for (const [token, stage] of stages)
      if (stage.expiresAt <= at || stage.workspaceId !== options.workspaceId) stages.delete(token)
  }
  function read(storeId: string, bindingId: string): KnowledgeProductProfile {
    options.assertActive()
    const binding = assertBinding(storeId, bindingId)
    const sources = repo
      .listSources({ storeId, bindingId })
      .filter((source) => sourceVisible(source))
    const current = manual(binding)
    let platformDescription = ''
    let platformTitle = ''
    const staticSource = sources.find((source) => source.label === collectorMaterialLabels.static)
    if (staticSource) {
      try {
        const parsed = z
          .object({
            title: z.string().max(500).optional(),
            description: z.string().max(20000).optional(),
          })
          .passthrough()
          .parse(JSON.parse(staticSource.text))
        platformTitle = parsed.title ?? ''
        platformDescription = parsed.description ?? ''
      } catch {
        platformTitle = ''
        platformDescription = ''
      }
    }
    const catalog = sources.find((source) => source.label === collectorMaterialLabels.catalog)
    if (!platformDescription && catalog) {
      try {
        const parsed = z
          .object({
            title: z.string().max(500).optional(),
            description: z.string().max(20000).optional(),
          })
          .passthrough()
          .parse(JSON.parse(catalog.text))
        platformTitle ||= parsed.title ?? ''
        platformDescription = parsed.description ?? ''
      } catch {
        // A malformed legacy catalog row remains visible as a source, but cannot prefill facts.
      }
    }
    // Keep the same manual/platform/other order as the list. Other imported images must not
    // disappear just because they are not collector-labelled.
    const assetIds: string[] = []
    if (current) assetIds.push(...current.stored.imageAssetIds)
    const platformImages = sources.find((source) => source.label === collectorMaterialLabels.images)
    if (platformImages) assetIds.push(...platformImages.assetIds)
    if (catalog) assetIds.push(...catalog.assetIds)
    for (const source of sources) {
      assetIds.push(...source.assetIds)
      if (source.locator.assetId) assetIds.push(source.locator.assetId)
      if (source.locator.imageAssetId) assetIds.push(source.locator.imageAssetId)
    }
    const images = [...new Set(assetIds)]
      .filter((id) => repo.row<KnowledgeAsset>('assets', id)?.mimeType.startsWith('image/'))
      .slice(0, KNOWLEDGE_PRODUCT_PROFILE_GALLERY_LIMIT)
      .map((id) => describeImage(repo, id))
    const canonical = repo.getCanonical(binding.canonicalId)!
    return {
      canonical,
      binding,
      title: current?.stored.title || binding.title || platformTitle || canonical.title,
      productId: binding.productId,
      storeId: binding.storeId,
      copy: current ? current.stored.copy : platformDescription,
      copySource: current ? 'manual' : platformDescription ? 'platform' : 'empty',
      manualPrice: current?.stored.price ?? '',
      notes: current?.stored.notes ?? '',
      manualSourceId: current?.source.id ?? null,
      manualSourceRevision: current?.source.revision ?? null,
      images,
      knowledge: repo.productKnowledgeCounts(binding),
      platformPrice: repo.productPlatformPrice(binding),
      sources: {
        count: sources.length,
        kinds: [...new Set(sources.map((source) => source.kind))],
      },
    }
  }

  async function stage(raw: unknown): Promise<KnowledgeStagedProductImage[]> {
    const input = knowledgeProductImageStageSchema.parse(raw)
    let binding = assertBinding(input.storeId, input.bindingId)
    assertBindingRevision(binding, input.expectedBindingRevision)
    let current = manual(binding)
    assertManualExpectation(
      current,
      input.expectedManualSourceId,
      input.expectedManualSourceRevision,
    )
    if (!options.chooseProductImages) throw Error('商品图片选择尚未接入')
    const picked = await options.chooseProductImages()
    // The native picker may stay open while the shop or binding changes. Re-check all leases
    // before any bytes enter the in-memory staging map.
    binding = assertBinding(input.storeId, input.bindingId)
    assertBindingRevision(binding, input.expectedBindingRevision)
    current = manual(binding)
    assertManualExpectation(
      current,
      input.expectedManualSourceId,
      input.expectedManualSourceRevision,
    )
    if (!picked.length) return []
    if (picked.length > KNOWLEDGE_PRODUCT_PROFILE_MAX_IMAGES)
      throw Error(`一次最多选择${KNOWLEDGE_PRODUCT_PROFILE_MAX_IMAGES}张图片`)
    const images = await Promise.all(picked.map(validatePicked))
    cleanupStages()
    if (stages.size + images.length > KNOWLEDGE_PRODUCT_IMAGE_STAGE_LIMIT)
      throw Error('暂存图片数量过多，请先保存或取消当前编辑')
    const total = [...stages.values()].reduce((sum, stage) => sum + stage.bytes.byteLength, 0)
    if (
      total + images.reduce((sum, image) => sum + image.bytes.byteLength, 0) >
      KNOWLEDGE_PRODUCT_IMAGE_MAX_TOTAL_BYTES
    )
      throw Error('暂存图片总容量超出50MB，请先保存或取消当前编辑')
    const expiresAt = now() + KNOWLEDGE_PRODUCT_IMAGE_STAGE_TTL_MS
    return images.map((image) => {
      const token = randomUUID()
      stages.set(token, {
        workspaceId: options.workspaceId,
        storeId: input.storeId,
        bindingId: input.bindingId,
        bindingRevision: input.expectedBindingRevision,
        manualSourceId: input.expectedManualSourceId,
        manualSourceRevision: input.expectedManualSourceRevision,
        ...image,
        expiresAt,
      })
      return {
        token,
        name: image.name,
        mimeType: image.mimeType,
        size: image.bytes.byteLength,
        preview: productImagePreview(image.bytes, image.mimeType),
      }
    })
  }
  function discard(tokens: string[]) {
    const parsed = knowledgeProductImageDiscardSchema.parse({ tokens })
    cleanupStages()
    let discarded = 0
    for (const token of new Set(parsed.tokens)) {
      const stage = stages.get(token)
      if (!stage || stage.workspaceId !== options.workspaceId) continue
      stages.delete(token)
      discarded++
    }
    return { discarded }
  }
  function assertUsableStages(value: KnowledgeProductProfileSave, binding: ProductBinding) {
    if (new Set(value.imageTokens).size !== value.imageTokens.length)
      throw Error('商品图片暂存令牌重复')
    cleanupStages()
    return value.imageTokens.map((token) => {
      const stage = stages.get(token)
      if (!stage) throw Error('商品图片暂存已过期或已失效，请重新选择')
      if (
        stage.workspaceId !== options.workspaceId ||
        stage.storeId !== value.storeId ||
        stage.bindingId !== binding.id ||
        stage.bindingRevision !== value.expectedBindingRevision ||
        stage.manualSourceId !== value.expectedManualSourceId ||
        stage.manualSourceRevision !== value.expectedManualSourceRevision
      )
        throw Error('商品或资料范围已变化，暂存图片已失效，请重新选择')
      return { token, stage }
    })
  }

  async function save(raw: unknown): Promise<KnowledgeProductProfile> {
    const value = knowledgeProductProfileSaveSchema.parse(raw)
    let binding = assertBinding(value.storeId, value.bindingId)
    assertBindingRevision(binding, value.expectedBindingRevision)
    let current = manual(binding)
    assertManualExpectation(
      current,
      value.expectedManualSourceId,
      value.expectedManualSourceRevision,
    )
    const staged = assertUsableStages(value, binding)
    const existing = current?.stored.imageAssetIds ?? []
    if (existing.length + staged.length > KNOWLEDGE_PRODUCT_PROFILE_MAX_IMAGES)
      throw Error(`图集最多${KNOWLEDGE_PRODUCT_PROFILE_MAX_IMAGES}张图片`)
    const createdFiles: string[] = []
    let result: KnowledgeProductProfile
    try {
      result = repo.transaction(() => {
        // Re-read inside the write transaction so concurrent edits cannot slip between checks.
        binding = assertBinding(value.storeId, value.bindingId)
        assertBindingRevision(binding, value.expectedBindingRevision)
        current = manual(binding)
        assertManualExpectation(
          current,
          value.expectedManualSourceId,
          value.expectedManualSourceRevision,
        )
        const assetIds = [...existing]
        for (const { stage } of staged) {
          const digest = createHash('sha256').update(stage.bytes).digest('hex')
          const file = join(repo.directory, 'assets', digest)
          const existed = Boolean(repo.row<KnowledgeAsset>('assets', digest)) || existsSync(file)
          if (!existed) createdFiles.push(file)
          const asset = repo.addAsset(
            stage.bytes,
            {
              name: stage.name,
              mimeType: stage.mimeType,
            },
            value.storeId,
          )
          if (!assetIds.includes(asset.id)) assetIds.push(asset.id)
        }
        if (assetIds.length > KNOWLEDGE_PRODUCT_PROFILE_MAX_IMAGES)
          throw Error(`图集最多${KNOWLEDGE_PRODUCT_PROFILE_MAX_IMAGES}张图片`)
        const stored = knowledgeProductProfileStoredSchema.parse({
          version: 1,
          title: value.title,
          price: value.manualPrice.trim(),
          notes: value.notes,
          copy: value.copy,
          imageAssetIds: assetIds,
        })
        repo.saveSource({
          ...(current ? { id: current.source.id, expectedRevision: current.source.revision } : {}),
          kind: 'manual',
          storeId: value.storeId,
          bindingId: value.bindingId,
          label: KNOWLEDGE_PRODUCT_PROFILE_SOURCE_LABEL,
          text: JSON.stringify(stored),
          locator: {},
          assetIds,
        })
        // The binding and canonical identity/title stay untouched: pending learning plans and
        // citations remain valid while the store-local display title lives in this source.
        return read(value.storeId, value.bindingId)
      })
    } catch (cause) {
      // addAsset writes its content-addressed file immediately, not at SQL COMMIT. A later
      // failure must reclaim only files this attempt created, never pre-existing/shared blobs.
      for (const file of new Set(createdFiles)) {
        try {
          unlinkSync(file)
        } catch {
          // Best effort; the unregistered blob is content-addressed and can be reclaimed later.
        }
      }
      throw cause
    }
    // A single-use staging token is consumed only after the database transaction committed.
    for (const { token } of staged) stages.delete(token)
    return result
  }
  function removeStore(storeId: string) {
    for (const [token, stage] of stages) if (stage.storeId === storeId) stages.delete(token)
  }
  function clear() {
    stages.clear()
  }
  return {
    read,
    stage,
    discard,
    save,
    removeStore,
    clear,
  }
}

import { z } from 'zod'
import type { CanonicalProduct, KnowledgeSource, ProductBinding } from './knowledge'

/** A dedicated, structured manual source. Existing generic sources keep their old interpretation. */
export const KNOWLEDGE_PRODUCT_PROFILE_SOURCE_LABEL = '商品手工资料'
export const KNOWLEDGE_PRODUCT_PROFILE_MAX_IMAGES = 8
export const KNOWLEDGE_PRODUCT_IMAGE_MAX_BYTES = 10 * 1024 * 1024
export const KNOWLEDGE_PRODUCT_IMAGE_MAX_TOTAL_BYTES = 50 * 1024 * 1024
export const KNOWLEDGE_PRODUCT_IMAGE_STAGE_TTL_MS = 2 * 60 * 1000
export const KNOWLEDGE_PRODUCT_IMAGE_STAGE_LIMIT = 16
const assetId = z.string().trim().min(1).max(200)
const imageToken = z.string().uuid()

export const knowledgeProductProfileStoredSchema = z
  .object({
    version: z.literal(1),
    price: z.string().max(60),
    notes: z.string().max(4000),
    copy: z.string().max(20000),
    imageAssetIds: z.array(assetId).max(KNOWLEDGE_PRODUCT_PROFILE_MAX_IMAGES),
  })
  .strict()
export type KnowledgeProductProfileStored = z.infer<typeof knowledgeProductProfileStoredSchema>

export const knowledgeProductProfileSaveSchema = z
  .object({
    storeId: z.string().trim().min(1).max(200),
    bindingId: z.string().trim().min(1).max(200),
    expectedBindingRevision: z.number().int().positive(),
    expectedManualSourceId: z.string().trim().min(1).max(200).nullable(),
    expectedManualSourceRevision: z.number().int().positive().nullable(),
    title: z.string().trim().min(1, '请填写商品标题').max(500),
    manualPrice: z.string().max(60),
    notes: z.string().max(4000),
    copy: z.string().max(20000),
    imageTokens: z.array(imageToken).max(KNOWLEDGE_PRODUCT_PROFILE_MAX_IMAGES).default([]),
  })
  .strict()
export type KnowledgeProductProfileSaveInput = z.input<typeof knowledgeProductProfileSaveSchema>
export type KnowledgeProductProfileSave = z.output<typeof knowledgeProductProfileSaveSchema>

export const knowledgeProductImageStageSchema = z
  .object({
    storeId: z.string().trim().min(1).max(200),
    bindingId: z.string().trim().min(1).max(200),
    expectedBindingRevision: z.number().int().positive(),
    expectedManualSourceId: z.string().trim().min(1).max(200).nullable(),
    expectedManualSourceRevision: z.number().int().positive().nullable(),
  })
  .strict()
export type KnowledgeProductImageStageInput = z.input<typeof knowledgeProductImageStageSchema>

export const knowledgeProductImageDiscardSchema = z
  .object({ tokens: z.array(imageToken).min(1).max(KNOWLEDGE_PRODUCT_IMAGE_STAGE_LIMIT) })
  .strict()

export interface KnowledgeProductProfileImage {
  assetId: string
  name: string
  mimeType: string
  size: number
}
export interface KnowledgeStagedProductImage {
  /** Opaque, single-use token; the renderer never receives a filesystem path or raw bytes. */
  token: string
  name: string
  mimeType: string
  size: number
  preview: string
}
export interface KnowledgeProductProfile {
  canonical: CanonicalProduct
  binding: ProductBinding
  title: string
  productId: string
  storeId: string
  copy: string
  copySource: 'manual' | 'platform' | 'empty'
  manualPrice: string
  notes: string
  manualSourceId: string | null
  manualSourceRevision: number | null
  images: KnowledgeProductProfileImage[]
  knowledge: { approved: number; drafts: number }
  platformPrice: {
    prices: string[]
    capturedAt: number | null
    expiresAt: number | null
    expired: boolean
  }
  sources: { count: number; kinds: KnowledgeSource['kind'][] }
}
export interface KnowledgeProductProfileForm {
  title: string
  manualPrice: string
  notes: string
  copy: string
}

/** Shared read/write boundary for list projections, learning filters and the dedicated editor. */
export function isKnowledgeProductProfileSource(
  source: Pick<KnowledgeSource, 'kind' | 'label'>,
): boolean {
  return source.kind === 'manual' && source.label === KNOWLEDGE_PRODUCT_PROFILE_SOURCE_LABEL
}

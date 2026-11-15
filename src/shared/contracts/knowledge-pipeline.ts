import { z } from 'zod'
const identity = z.string().trim().min(1).max(200)
const ids = z.array(identity).max(1000)
// A parsed document has per-page/line/cell sources; keep the full supported parser range.
const sourceIds = z.array(identity).max(50000)
export const knowledgePipelineInputSchema = z.discriminatedUnion('action', [
  z
    .object({
      action: z.literal('recognize-images'),
      storeId: identity,
      bindingIds: ids,
      sourceIds,
    })
    .strict(),
  z
    .object({
      action: z.literal('catalog-thumbnail'),
      storeId: identity,
      scopeToken: identity,
      identityVersion: identity,
      productId: identity,
    })
    .strict(),
  z
    .object({
      action: z.literal('preview-import'),
      storeId: identity,
      sourceIds,
      bindingIds: ids.default([]),
    })
    .strict(),
  z
    .object({
      action: z.literal('archive-chat'),
      storeId: identity,
      from: z.number().int().nonnegative(),
      to: z.number().int().nonnegative(),
    })
    .strict(),
  z.object({ action: z.literal('store-materials'), storeId: identity }).strict(),
  z.object({ action: z.literal('review-targets'), storeId: identity, entryIds: ids }).strict(),
  z
    .object({
      action: z.literal('resolve-uncertain'),
      storeId: identity,
      jobId: identity,
      decision: z.enum(['retry', 'skip']),
    })
    .strict(),
  z.object({ action: z.literal('capabilities'), storeId: identity }).strict(),
  z
    .object({
      action: z.literal('catalog'),
      storeId: identity,
      search: z.string().max(1000).default(''),
      cursor: z.string().max(4000).default(''),
    })
    .strict(),
  z
    .object({
      action: z.literal('choose-sources'),
      storeId: identity,
      bindingId: identity.optional(),
    })
    .strict(),
  z
    .object({ action: z.literal('estimate'), storeId: identity, bindingIds: ids, sourceIds })
    .strict(),
  z
    .object({
      action: z.literal('start'),
      storeId: identity,
      kind: z.enum(['collect', 'learn', 'import', 'daily-check']),
      bindingIds: ids.default([]),
      sourceIds: sourceIds.default([]),
      catalog: z
        .object({
          identityVersion: identity,
          scopeToken: identity,
          productIds: ids,
          allMatching: z.boolean().default(false),
          total: z.number().int().nonnegative().nullable(),
        })
        .strict()
        .optional(),
      estimateId: identity.optional(),
    })
    .strict(),
  z.object({ action: z.literal('pause'), storeId: identity, jobId: identity }).strict(),
  z.object({ action: z.literal('resume'), storeId: identity, jobId: identity }).strict(),
  z.object({ action: z.literal('cancel'), storeId: identity, jobId: identity }).strict(),
  z.object({ action: z.literal('retry-received'), storeId: identity, jobId: identity }).strict(),
])
export type KnowledgePipelineInput = z.input<typeof knowledgePipelineInputSchema>
export interface KnowledgePipelineCapabilities {
  catalog: boolean
  collect: boolean
  import: boolean
  learn: boolean
  dailyCheck: boolean
  reason: string
}
export interface KnowledgeCatalogPage {
  identityVersion: string
  scopeToken: string
  items: {
    productId: string
    title: string
    merchantCode?: string
    hasThumbnail?: boolean
    thumbnailAssetId?: string
  }[]
  nextCursor: string | null
  total: number | null
  complete: boolean
  range: string
}
export interface KnowledgeEstimate {
  estimateId: string
  sources: number
  images: number
  characters: number
  estimatedTokens: number
  message: string
}
export interface KnowledgePipelineResults {
  'recognize-images': KnowledgeOcrPreview
  'catalog-thumbnail': { assetId: string }
  'review-targets': { targets: Record<string, string> }
  'store-materials': { sourceIds: string[] }
  'preview-import': KnowledgeImportPreview
  'archive-chat': { sourceIds: string[]; range: string }
  'resolve-uncertain': { jobId: string }
  capabilities: KnowledgePipelineCapabilities
  catalog: KnowledgeCatalogPage
  'choose-sources': { sourceIds: string[] }
  estimate: KnowledgeEstimate
  start: { jobId: string }
  pause: { jobId: string }
  resume: { jobId: string }
  cancel: { jobId: string }
  'retry-received': { jobId: string }
}
export interface KnowledgeOcrPreview {
  engine: string
  images: number
  characters: number
  items: {
    sourceId: string
    imageAssetId: string
    tileAssetId: string
    image: number
    tile: number
    text: string
  }[]
}
export interface KnowledgeImportPreview {
  previewId: string
  files: number
  parts: number
  duplicates: number
  encodings: string[]
  warnings: string[]
  rows: {
    label: string
    target: string
    locator: import('./knowledge').KnowledgeSourceLocator
    text: string
    duplicate: boolean
    kind: string
  }[]
}

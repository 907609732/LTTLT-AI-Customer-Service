import { z } from 'zod'
const identity = z.string().trim().min(1).max(200)
const ids = z.array(identity).max(1000)
export const knowledgePipelineInputSchema = z.discriminatedUnion('action', [
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
    .object({ action: z.literal('estimate'), storeId: identity, bindingIds: ids, sourceIds: ids })
    .strict(),
  z
    .object({
      action: z.literal('start'),
      storeId: identity,
      kind: z.enum(['collect', 'learn', 'import', 'daily-check']),
      bindingIds: ids.default([]),
      sourceIds: ids.default([]),
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
  items: { productId: string; title: string; thumbnailAssetId?: string }[]
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
  capabilities: KnowledgePipelineCapabilities
  catalog: KnowledgeCatalogPage
  'choose-sources': { sourceIds: string[] }
  estimate: KnowledgeEstimate
  start: { jobId: string }
  pause: { jobId: string }
  resume: { jobId: string }
  cancel: { jobId: string }
}

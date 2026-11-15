import { z } from 'zod'
import { knowledgePipelineInputSchema } from './knowledge-pipeline'
import {
  knowledgeCommandSchema,
  knowledgeQuerySchema,
  knowledgeResolveSchema,
  knowledgePageSchema,
  type CanonicalProduct,
  type KnowledgeEntry,
  type KnowledgeJob,
  type KnowledgeMiss,
  type KnowledgePage,
  type KnowledgeProductCard,
  type KnowledgeResolution,
  type KnowledgeSettings,
  type KnowledgeSource,
  type ProductBinding,
  type KnowledgeCommand,
  type KnowledgeQuery,
} from './knowledge'

export interface KnowledgeSummary {
  revision: number
  products: number
  entries: number
  generalEntries: number
  pending: number
  jobs: number
  misses: number
  readOnly: boolean
  migration: { status: string; error: string }
}
export interface KnowledgeDetail {
  canonical: CanonicalProduct | null
  bindings: ProductBinding[]
  entries: KnowledgeEntry[]
  sources: KnowledgeSource[]
}
export interface KnowledgeQueryResults {
  summary: KnowledgeSummary
  canonicals: KnowledgePage<CanonicalProduct>
  products: KnowledgePage<KnowledgeProductCard>
  detail: KnowledgeDetail
  entries: KnowledgePage<KnowledgeEntry>
  resolve: KnowledgeResolution
  jobs: KnowledgePage<KnowledgeJob>
  misses: KnowledgePage<KnowledgeMiss>
  settings: KnowledgeSettings
}
export const knowledgeReassociateSchema = z
  .object({
    rootBindingId: z.string().min(1).max(200),
    canonicalId: z.string().min(1).max(200),
    expectedCanonicalRevision: z.number().int().positive(),
    bindings: z
      .array(
        z
          .object({ id: z.string().min(1).max(200), expectedRevision: z.number().int().positive() })
          .strict(),
      )
      .min(1)
      .max(1000),
  })
  .strict()
export type KnowledgeReassociateInput = z.input<typeof knowledgeReassociateSchema>
export const knowledgeRequestSchema = z.discriminatedUnion('operation', [
  z
    .object({
      workspaceId: z.string().min(1),
      operation: z.literal('reassociate-product'),
      input: knowledgeReassociateSchema,
    })
    .strict(),
  z
    .object({
      workspaceId: z.string().min(1),
      operation: z.literal('general-entries'),
      page: knowledgePageSchema,
    })
    .strict(),
  z
    .object({
      workspaceId: z.string().min(1),
      operation: z.literal('pipeline'),
      input: knowledgePipelineInputSchema,
    })
    .strict(),
  z
    .object({
      workspaceId: z.string().min(1),
      operation: z.literal('source-history'),
      sourceId: z.string().min(1).max(200),
    })
    .strict(),
  z
    .object({
      workspaceId: z.string().min(1),
      operation: z.literal('query'),
      query: knowledgeQuerySchema,
    })
    .strict(),
  z
    .object({
      workspaceId: z.string().min(1),
      operation: z.literal('command'),
      command: knowledgeCommandSchema,
    })
    .strict(),
  z
    .object({
      workspaceId: z.string().min(1),
      operation: z.literal('trial'),
      input: knowledgeResolveSchema,
    })
    .strict(),
  z
    .object({
      workspaceId: z.string().min(1),
      operation: z.literal('asset'),
      assetId: z.string().min(1).max(200),
    })
    .strict(),
  z.object({ workspaceId: z.string().min(1), operation: z.literal('backup') }).strict(),
])
export const knowledgeOpenSchema = z
  .object({ workspaceId: z.string().min(1), storeId: z.string().max(200).default('') })
  .strict()
export interface KnowledgeWindowContext {
  workspaceId: string
  storeId: string
  revision: number
}
export interface KnowledgeTrial {
  answer: string
  resolution: KnowledgeResolution
}
export interface KnowledgeBridge {
  request(input: z.input<typeof knowledgeRequestSchema>): Promise<unknown>
  open(input: z.input<typeof knowledgeOpenSchema>): Promise<void>
  hide(workspaceId: string): Promise<void>
  onCloseRequest(listener: () => void): () => void
  context(): Promise<KnowledgeWindowContext>
  onContext(listener: (context: KnowledgeWindowContext) => void): () => void
}
export type { KnowledgeCommand, KnowledgeQuery }

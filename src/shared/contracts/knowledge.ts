import { z } from 'zod'
import { knowledgeVisualEvidenceSchema, type KnowledgeVisualEvidence } from './knowledge-evidence'

const id = z.string().trim().min(1).max(200)
const revision = z.number().int().positive()
export const knowledgeScopeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('canonical'), canonicalId: id }).strict(),
  z.object({ kind: z.literal('binding'), bindingId: id }).strict(),
  z.object({ kind: z.literal('template'), storeIds: z.array(id).max(1000) }).strict(),
  z.object({ kind: z.literal('store'), storeId: id }).strict(),
])
export type KnowledgeScope = z.infer<typeof knowledgeScopeSchema>
export const sourceRefSchema = z.object({ sourceId: id, revision }).strict()
export type KnowledgeSourceRef = z.infer<typeof sourceRefSchema>
export const knowledgeFieldSchema = z.enum(['fact', 'price', 'stock', 'activity'])
export type KnowledgeField = z.infer<typeof knowledgeFieldSchema>
/** Miss disposition is a processing state only; it never creates or publishes an answer. */
export const knowledgeMissStatusSchema = z.enum(['open', 'resolved', 'ignored'])
export type KnowledgeMissStatus = z.infer<typeof knowledgeMissStatusSchema>
export const knowledgeDraftSchema = z
  .object({
    id: id.optional(),
    expectedRevision: revision.optional(),
    scope: knowledgeScopeSchema,
    question: z.string().trim().min(1).max(4000),
    answer: z.string().trim().min(1).max(30000),
    keywords: z.array(z.string().trim().min(1).max(200)).max(100).default([]),
    field: knowledgeFieldSchema.default('fact'),
    conflictKey: z.string().trim().max(300).optional(),
    origin: z.enum(['manual', 'model', 'import', 'migration']).default('manual'),
    sourceRefs: z.array(sourceRefSchema).max(1000).default([]),
    modelEvidence: knowledgeVisualEvidenceSchema.optional(),
    expiresAt: z.number().int().nonnegative().nullable().optional(),
  })
  .strict()
export type KnowledgeDraftInput = z.input<typeof knowledgeDraftSchema>
export interface KnowledgeVersion {
  id: string
  revision: number
  scope: KnowledgeScope
  question: string
  answer: string
  keywords: string[]
  field: KnowledgeField
  conflictKey: string
  origin: 'manual' | 'model' | 'import' | 'migration'
  sourceRefs: KnowledgeSourceRef[]
  modelEvidence?: KnowledgeVisualEvidence
  expiresAt: number | null
  updatedAt: number
}
export interface KnowledgeEntry {
  id: string
  revision: number
  status: 'draft' | 'approved' | 'withdrawn' | 'stale'
  draft: KnowledgeVersion
  approved: KnowledgeVersion | null
}
export interface CanonicalProduct {
  id: string
  title: string
  code: string
  revision: number
  updatedAt: number
}
export const canonicalProductInputSchema = z
  .object({
    id: id.optional(),
    expectedRevision: revision.optional(),
    title: z.string().trim().min(1).max(1000),
    code: z.string().max(200).default(''),
  })
  .strict()
export type CanonicalProductInput = z.input<typeof canonicalProductInputSchema>
export const productBindingInputSchema = z
  .object({
    id: id.optional(),
    expectedRevision: revision.optional(),
    canonicalId: id,
    storeId: id,
    productId: id,
    skuId: z.string().max(200).default(''),
    title: z.string().max(1000).default(''),
  })
  .strict()
export type ProductBindingInput = z.input<typeof productBindingInputSchema>
export interface ProductBinding {
  id: string
  canonicalId: string
  storeId: string
  productId: string
  skuId: string
  title: string
  revision: number
  active: boolean
  updatedAt: number
}
export const sourceLocatorSchema = z
  .object({
    imageAssetId: id.optional(),
    image: z.number().int().positive().optional(),
    column: z.number().int().positive().optional(),
    tile: z.number().int().positive().optional(),
    page: z.number().int().positive().optional(),
    sheet: z.string().max(200).optional(),
    row: z.number().int().positive().optional(),
    line: z.number().int().positive().optional(),
    messageId: z.string().max(200).optional(),
    assetId: id.optional(),
    url: z.string().url().max(4000).optional(),
  })
  .strict()
export type KnowledgeSourceLocator = z.infer<typeof sourceLocatorSchema>
export const knowledgeSourceInputSchema = z
  .object({
    id: id.optional(),
    expectedRevision: revision.optional(),
    kind: z.enum(['platform', 'document', 'image', 'chat', 'manual', 'legacy-audit']),
    storeId: id,
    bindingId: id.optional(),
    label: z.string().max(1000),
    removed: z.boolean().optional(),
    text: z.string().max(5_000_000),
    locator: sourceLocatorSchema.default({}),
    assetIds: z.array(id).default([]),
  })
  .strict()
export type KnowledgeSourceInput = z.input<typeof knowledgeSourceInputSchema>
export interface KnowledgeSource
  extends Omit<z.output<typeof knowledgeSourceInputSchema>, 'id' | 'expectedRevision'> {
  id: string
  revision: number
  hash: string
  updatedAt: number
}
export interface KnowledgeAsset {
  id: string
  sha256: string
  mimeType: string
  name: string
  size: number
}
export interface KnowledgePublishInput {
  entryId: string
  expectedDraftRevision: number
  expectedSourceRevisions: Record<string, number>
}
export const knowledgePublishSchema = z
  .object({
    entryId: id,
    expectedDraftRevision: revision,
    expectedSourceRevisions: z.record(id, revision),
  })
  .strict()
export const knowledgeResolveSchema = z
  .object({
    storeId: id,
    productId: z.string().max(200).default(''),
    skuId: z.string().max(200).default(''),
    query: z.string().max(10000),
    limit: z.number().int().min(1).max(50).default(10),
    maxCharacters: z.number().int().min(100).max(60000).default(12000),
  })
  .strict()
export type KnowledgeResolveInput = z.input<typeof knowledgeResolveSchema>
export interface KnowledgeCitation {
  entryId: string
  entryRevision: number
  question: string
  answer: string
  field: KnowledgeField
  scope: KnowledgeScope
  bindingId: string | null
  bindingRevision: number | null
  sourceRefs: KnowledgeSourceRef[]
  expiresAt: number | null
  context: { storeId: string; productId: string; skuId: string }
  scopeVersion: string
}
export interface KnowledgeResolution {
  citations: KnowledgeCitation[]
  characters: number
  omitted: number
  productStatus: 'matched' | 'unknown' | 'ambiguous' | 'unspecified'
  expiredFields: KnowledgeField[]
}
export const knowledgePageSchema = z
  .object({
    storeId: id.optional(),
    search: z.string().max(1000).optional(),
    offset: z.number().int().min(0).default(0),
    limit: z.number().int().min(1).max(100).default(50),
  })
  .strict()
export type KnowledgePageInput = z.input<typeof knowledgePageSchema>
/** Optional status keeps old callers (and runtime history lookup) seeing every miss. */
export const knowledgeMissPageSchema = knowledgePageSchema.extend({
  status: knowledgeMissStatusSchema.optional(),
})
export type KnowledgeMissPageInput = z.input<typeof knowledgeMissPageSchema>
export interface KnowledgePage<T> {
  total: number
  items: T[]
  revision: number
}
export interface KnowledgeProductCard {
  productSummary?: {
    skuCount: number
    specifications: string[]
    capturedAt: number | null
    expiresAt: number | null
    expired: boolean
    code: string
  }
  canonical: CanonicalProduct
  binding: ProductBinding
  sources: number
  approved: number
  drafts: number
  sourceSummary: {
    count: number
    kinds: KnowledgeSource['kind'][]
    thumbnailAssetId: string | null
  }
}
export const knowledgeSettingsSchema = z
  .object({
    dynamicTtlMinutes: z.number().int().min(1).max(10080).default(60),
    dailyCheckTime: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
      .default('09:00'),
    timezone: z.literal('Asia/Shanghai').default('Asia/Shanghai'),
    dailyCheckEnabled: z.boolean().default(false),
    lastDailyCheckAt: z.number().int().min(0).default(0),
  })
  .strict()
export type KnowledgeSettings = z.infer<typeof knowledgeSettingsSchema>
export type KnowledgeJobStatus =
  | 'queued'
  | 'running'
  | 'paused'
  | 'needs-confirmation'
  | 'succeeded'
  | 'failed'
  | 'cancelled'
export interface KnowledgeJob {
  id: string
  kind: 'collect' | 'learn' | 'daily-check' | 'import'
  storeId: string
  revision: number
  status: KnowledgeJobStatus
  payload: Record<string, unknown>
  checkpoint: Record<string, unknown>
  progress: { completed: number; total: number | null }
  error: string
  createdAt: number
  updatedAt: number
}
export interface KnowledgeMiss {
  id: string
  storeId: string
  productId: string
  skuId: string
  question: string
  reason?: 'unknown-product' | 'expired-field' | 'no-eligible-knowledge'
  source?: 'reception'
  context?: { from: string; content: string }[]
  count: number
  conversationIds: string[]
  status: KnowledgeMissStatus
  firstSeenAt: number
  lastSeenAt: number
}
export interface KnowledgeBackupManifest {
  version: 1
  createdAt: number
  revision: number
  scope?: ({ kind: 'family'; canonicalId: string } | { kind: 'store'; storeId: string }) & {
    storeIds: string[]
    bindingIds: string[]
    dependencyBindingIds: string[]
    originalFiles: string[]
  }
  files: { path: string; sha256: string; size: number }[]
}
export interface KnowledgeMigrationState {
  status: 'not-needed' | 'complete' | 'failed'
  error: string
  backupDirectory: string | null
  inputHashes: Record<string, string>
  idMap: Record<string, string>
}
/** No paths or reviewer identities are accepted from renderer/model data. */
export const knowledgeCommandSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('save-canonical'), canonical: canonicalProductInputSchema }).strict(),
  z.object({ type: z.literal('bind-product'), binding: productBindingInputSchema }).strict(),
  z.object({ type: z.literal('save-draft'), draft: knowledgeDraftSchema }).strict(),
  z.object({ type: z.literal('publish'), review: knowledgePublishSchema }).strict(),
  z.object({ type: z.literal('withdraw'), entryId: id, expectedRevision: revision }).strict(),
  z.object({ type: z.literal('unlink'), bindingId: id, expectedRevision: revision }).strict(),
  z
    .object({ type: z.literal('save-settings'), settings: knowledgeSettingsSchema.partial() })
    .strict(),
  z.object({ type: z.literal('cancel-job'), jobId: id, expectedRevision: revision }).strict(),
  z
    .object({
      type: z.literal('update-miss'),
      missId: id,
      status: knowledgeMissStatusSchema,
    })
    .strict(),
])
export type KnowledgeCommand = z.input<typeof knowledgeCommandSchema>
export const knowledgeQuerySchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('canonicals'), page: knowledgePageSchema }).strict(),
  z.object({ type: z.literal('summary'), storeId: id.optional() }).strict(),
  z
    .object({ type: z.literal('products'), page: knowledgePageSchema.extend({ storeId: id }) })
    .strict(),
  z.object({ type: z.literal('detail'), canonicalId: id, storeId: id.optional() }).strict(),
  z
    .object({
      type: z.literal('entries'),
      page: knowledgePageSchema,
      status: z.enum(['draft', 'approved', 'withdrawn', 'stale']).optional(),
    })
    .strict(),
  z.object({ type: z.literal('resolve'), input: knowledgeResolveSchema }).strict(),
  z.object({ type: z.literal('jobs'), page: knowledgePageSchema }).strict(),
  z.object({ type: z.literal('misses'), page: knowledgeMissPageSchema }).strict(),
  z.object({ type: z.literal('settings') }).strict(),
])
export type KnowledgeQuery = z.input<typeof knowledgeQuerySchema>

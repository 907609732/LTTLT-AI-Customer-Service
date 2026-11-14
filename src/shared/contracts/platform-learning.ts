import { z } from 'zod'

const id = z.string().trim().min(1).max(200)
const timestamp = z.number().finite().nonnegative()
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (value) =>
      !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value,
  )
export const platformLearningIdentitySchema = z
  .object({
    storeId: z.string().trim().min(1).max(64),
    platform: id,
    accountId: id,
    platformStoreId: id,
  })
  .strict()
export type PlatformLearningIdentity = z.infer<typeof platformLearningIdentitySchema>
export const platformLearningRangeSchema = z
  .object({
    from: date.optional(),
    to: date.optional(),
    maxPages: z.number().int().min(1).max(1000),
    maxRecords: z.number().int().min(1).max(10000),
    productStatus: z.enum(['all', 'on-sale', 'off-sale']),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      Boolean(value.from) !== Boolean(value.to) ||
      (value.from && value.to && value.from > value.to)
    )
      context.addIssue({ code: 'custom', message: '起止日期必须成对填写且顺序正确' })
  })
export type PlatformLearningRange = z.infer<typeof platformLearningRangeSchema>
export const platformLearningSourceSchema = z.enum(['products', 'chats'])
export type PlatformLearningSource = z.infer<typeof platformLearningSourceSchema>
export const platformLearningProductSchema = z
  .object({
    id: z.string().trim().min(1).max(100),
    title: z.string().trim().min(1).max(500),
    description: z.string().max(20000),
    specifications: z.string().max(20000),
    sourceUrl: z.string().url().max(2000).optional(),
    updatedAt: timestamp.optional(),
  })
  .strict()
export type PlatformLearningProduct = z.infer<typeof platformLearningProductSchema>
export const platformLearningChatSchema = z
  .object({
    id,
    uid: id,
    messages: z
      .array(
        z
          .object({
            id,
            from: z.enum(['buyer', 'seller']),
            text: z.string().max(20000),
            at: timestamp,
            type: z.enum(['text', 'image', 'video', 'other']),
          })
          .strict(),
      )
      .max(10000),
  })
  .strict()
export type PlatformLearningChat = z.infer<typeof platformLearningChatSchema>
export interface PlatformLearningPage<T> {
  identity: PlatformLearningIdentity
  items: T[]
  nextCursor: string | null
  exhausted: boolean
  total?: number
  /** Provider-confirmed accessible range. Exhausting it never implies all platform history. */
  scope: string
  capturedAt: number
  /** False when the provider can read only a bounded subset of the requested business range. */
  rangeComplete?: boolean
}
export interface PlatformLearningCollectInput {
  identity: PlatformLearningIdentity
  range: PlatformLearningRange
  cursor: string | null
  signal: AbortSignal
}
export const platformLearningPageSchema = z
  .object({
    identity: platformLearningIdentitySchema,
    items: z.array(z.unknown()).max(10000),
    nextCursor: z.string().min(1).max(4000).nullable(),
    exhausted: z.boolean(),
    total: z.number().int().nonnegative().optional(),
    scope: z.string().trim().min(1).max(2000),
    capturedAt: timestamp,
    rangeComplete: z.boolean().optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.exhausted !== (value.nextCursor === null))
      context.addIssue({ code: 'custom', message: '分页范围与下一页游标不一致' })
  })
export const platformLearningQaSchema = z
  .object({
    question: z.string().trim().min(1).max(1000),
    answer: z.string().trim().min(1).max(4000),
  })
  .strict()
const evidenceSchema = z
  .object({
    recordId: id,
    uid: id.optional(),
    messageIds: z.array(id).max(2),
    capturedAt: timestamp,
    sourceUrl: z.string().url().max(2000).optional(),
    sourceUpdatedAt: timestamp.optional(),
    scope: z.string().max(2000).optional(),
  })
  .strict()
export const platformLearningCandidateSchema = z
  .object({
    id: z.string().uuid(),
    taskId: z.string().uuid(),
    fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    source: platformLearningSourceSchema,
    identity: platformLearningIdentitySchema,
    question: platformLearningQaSchema.shape.question,
    answer: platformLearningQaSchema.shape.answer,
    original: platformLearningQaSchema,
    productIds: z.array(z.string().min(1).max(100)).max(100),
    evidence: evidenceSchema,
    status: z.enum(['pending', 'saving', 'saved', 'rejected']),
    reviewed: platformLearningQaSchema.optional(),
    packId: z.string().uuid().optional(),
    error: z.string().max(2000),
    audit: z
      .array(
        z
          .object({
            at: timestamp,
            event: z.enum(['collected', 'saving', 'saved', 'failed', 'rejected', 'recovered']),
            reason: z.string().max(2000).optional(),
            packId: z.string().uuid().optional(),
            reviewed: platformLearningQaSchema.optional(),
          })
          .strict(),
      )
      .max(100),
  })
  .strict()
export type PlatformLearningCandidate = z.infer<typeof platformLearningCandidateSchema>
export const platformLearningTaskSchema = z
  .object({
    id: z.string().uuid(),
    identity: platformLearningIdentitySchema,
    source: platformLearningSourceSchema,
    range: platformLearningRangeSchema,
    status: z.enum(['running', 'paused', 'completed', 'failed', 'cancelled']),
    cursor: z.string().max(4000).nullable(),
    pages: z.number().int().nonnegative(),
    records: z.number().int().nonnegative(),
    candidates: z.number().int().nonnegative(),
    duplicates: z.number().int().nonnegative(),
    skipped: z.number().int().nonnegative(),
    total: z.number().int().nonnegative().optional(),
    coverage: z.enum(['partial', 'range-complete']),
    sourceLimited: z.boolean().optional(),
    scope: z.string().max(2000),
    reason: z.string().max(2000),
    error: z.string().max(2000),
    createdAt: timestamp,
    updatedAt: timestamp,
  })
  .strict()
export type PlatformLearningTask = z.infer<typeof platformLearningTaskSchema>
export const platformLearningStateSchema = z
  .object({
    version: z.literal(1),
    tasks: z.array(platformLearningTaskSchema).max(100),
    candidates: z.array(platformLearningCandidateSchema).max(10000),
  })
  .strict()
export type PlatformLearningState = z.infer<typeof platformLearningStateSchema>
export const platformLearningSnapshotSchema = platformLearningStateSchema.extend({
  workspaceId: z.string().uuid(),
})
export type PlatformLearningSnapshot = z.infer<typeof platformLearningSnapshotSchema>
export const platformLearningSnapshotRequestSchema = z
  .object({
    workspaceId: z.string().uuid(),
    storeId: z.string().trim().min(1).max(64).optional(),
  })
  .strict()
export const platformLearningStartSchema = z
  .object({
    workspaceId: z.string().uuid(),
    storeId: z.string().trim().min(1).max(64),
    source: platformLearningSourceSchema,
    range: platformLearningRangeSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (value.source === 'chats' && (!value.range.from || !value.range.to))
      context.addIssue({ code: 'custom', message: '平台聊天必须明确选择起止日期' })
  })
export const platformLearningTaskRequestSchema = z
  .object({
    workspaceId: z.string().uuid(),
    taskId: z.string().uuid(),
  })
  .strict()
export const platformLearningReviewSchema = z
  .object({
    workspaceId: z.string().uuid(),
    candidateId: z.string().uuid(),
    question: platformLearningQaSchema.shape.question,
    answer: platformLearningQaSchema.shape.answer,
    confirmed: z.boolean(),
  })
  .strict()
export type PlatformLearningSnapshotRequest = z.infer<typeof platformLearningSnapshotRequestSchema>
export type PlatformLearningStart = z.infer<typeof platformLearningStartSchema>
export type PlatformLearningTaskRequest = z.infer<typeof platformLearningTaskRequestSchema>
export type PlatformLearningReview = z.infer<typeof platformLearningReviewSchema>
export const platformLearningOpenSourceSchema = z
  .object({
    workspaceId: z.string().uuid(),
    storeId: z.string().trim().min(1).max(64),
    source: platformLearningSourceSchema,
  })
  .strict()
export type PlatformLearningOpenSource = z.infer<typeof platformLearningOpenSourceSchema>
/** Narrow IPC/client surface. Collection sources and filesystem paths cannot be supplied by the renderer. */
export interface PlatformLearningTransport {
  openSource?(input: PlatformLearningOpenSource): Promise<void>
  snapshot(input: PlatformLearningSnapshotRequest): Promise<PlatformLearningSnapshot>
  start(input: PlatformLearningStart): Promise<PlatformLearningSnapshot>
  pause(input: PlatformLearningTaskRequest): Promise<PlatformLearningSnapshot>
  resume(input: PlatformLearningTaskRequest): Promise<PlatformLearningSnapshot>
  cancel(input: PlatformLearningTaskRequest): Promise<PlatformLearningSnapshot>
  review(input: PlatformLearningReview): Promise<PlatformLearningSnapshot>
  subscribe?(listener: () => void): () => void
}

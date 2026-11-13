import { z } from 'zod'

export const compressionInfoSchema = z.object({
  triggered: z.boolean(),
  beforeTokens: z.number(),
  afterTokens: z.number(),
  triggerTokens: z.number(),
  targetTokens: z.number(),
  tokenizer: z.string(),
  keptMessages: z.number(),
  summary: z.string(),
  clipped: z.boolean(),
})
export type CompressionInfo = z.infer<typeof compressionInfoSchema>
export const messageAiSchema = z.object({
  stage: z.enum([
    'unknown',
    'waiting',
    'blocked',
    'preparing',
    'requesting',
    'generated',
    'confirming',
    'sending',
    'sent',
    'skipped',
    'failed',
    'canceled',
  ]),
  submitted: z.boolean().nullable(),
  code: z.string(),
  reason: z.string(),
  updatedAt: z.number(),
  traceId: z.string().optional(),
})
export type MessageAiState = z.infer<typeof messageAiSchema>

export const reviewStatusSchema = z.enum([
  'pending',
  'sending',
  'sent',
  'rejected',
  'expired',
  'failed',
])
export const logEntrySchema = z.object({
  ai: messageAiSchema.optional(),
  id: z.string(),
  at: z.number(),
  storeId: z.string(),
  storeName: z.string(),
  uid: z.string(),
  buyerName: z.string(),
  kind: z.string(),
  text: z.string(),
})
export const modelTraceSchema = z.object({
  startedAt: z.number().optional(),
  completedAt: z.number().optional(),
  submittedAt: z.number().optional(),
  durationMs: z.number().nonnegative().optional(),
  purpose: z.enum(['reply', 'compression']).default('reply'),
  compression: compressionInfoSchema.optional(),
  id: z.string(),
  at: z.number(),
  storeId: z.string(),
  storeName: z.string(),
  uid: z.string(),
  buyerName: z.string(),
  model: z.string(),
  messages: z.string(),
  thread: z.string(),
  reply: z.string(),
  error: z.string(),
})
export const replyReviewSchema = z.object({
  id: z.string(),
  at: z.number(),
  storeId: z.string(),
  storeName: z.string(),
  uid: z.string(),
  buyerName: z.string(),
  text: z.string(),
  traceId: z.string(),
  status: reviewStatusSchema,
  reason: z.string(),
})
/** 调试只保留本次进程的有界内存；关闭窗口不会批准或丢弃候选。 */
export const reviewSnapshotSchema = z.object({
  logs: z.array(logEntrySchema),
  traces: z.array(modelTraceSchema),
  replies: z.array(replyReviewSchema),
})
export const reviewDecisionSchema = z
  .object({ id: z.string().uuid(), approve: z.boolean() })
  .strict()
export type LogEntry = z.infer<typeof logEntrySchema>
export type ModelTrace = z.infer<typeof modelTraceSchema>
export type ReplyReview = z.infer<typeof replyReviewSchema>
export const emptyReview = () => ({ logs: [], traces: [], replies: [] })

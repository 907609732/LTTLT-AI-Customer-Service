import { z } from 'zod'

export const reportingKinds = [
  'buyer-message',
  'seller-message',
  'ai-generated',
  'ai-sent',
  'ai-failed',
  'work-order-created',
] as const
export const reportingCountsSchema = z.object({
  'buyer-message': z.number().int().nonnegative(),
  'seller-message': z.number().int().nonnegative(),
  'ai-generated': z.number().int().nonnegative(),
  'ai-sent': z.number().int().nonnegative(),
  'ai-failed': z.number().int().nonnegative(),
  'work-order-created': z.number().int().nonnegative(),
})
export type ReportingKind = (typeof reportingKinds)[number]
export const reportingReportSchema = z.object({
  start: z.number(),
  end: z.number(),
  observedSince: z.number(),
  persistence: z.enum(['ready', 'error']),
  truncated: z.boolean(),
  source: z.literal('local-observed-events'),
  complete: z.literal(false),
  real: reportingCountsSchema,
  simulated: reportingCountsSchema,
})
export type ReportingReport = z.infer<typeof reportingReportSchema>
export const reportingSnapshotSchema = z.object({
  today: reportingReportSchema,
  yesterday: reportingReportSchema,
  week: reportingReportSchema,
  month: reportingReportSchema,
  aftersales: z
    .array(
      z.object({
        storeId: z.string(),
        platform: z.string(),
        status: z.string(),
        complete: z.boolean(),
        total: z.number().int().nonnegative().nullable(),
        observed: z.number().int().nonnegative(),
        lastSyncedAt: z.number().nullable(),
        scope: z.literal('current-merchant-pending'),
        queryWindow: z.enum(['last-3-months', 'unknown']).optional(),
      }),
    )
    .default([]),
})
export type ReportingSnapshot = z.infer<typeof reportingSnapshotSchema>
export const emptyReportingCounts = () => ({
  'buyer-message': 0,
  'seller-message': 0,
  'ai-generated': 0,
  'ai-sent': 0,
  'ai-failed': 0,
  'work-order-created': 0,
})

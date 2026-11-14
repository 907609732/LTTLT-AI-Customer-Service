import { z } from 'zod'

export const syncSectionSchema = z.enum(['products', 'welcome', 'vision', 'handoff'])
export type SyncSection = z.infer<typeof syncSectionSchema>
export const syncEnvelopeSchema = z
  .object({ workspaceId: z.string().uuid(), input: z.unknown().optional() })
  .strict()
export const syncRequestSchema = z
  .object({
    sourceStoreId: z.string().min(1).max(64),
    targetStoreIds: z.array(z.string().min(1).max(64)).min(1).max(20),
    sections: z.array(syncSectionSchema).min(1).max(4),
    productIds: z.array(z.string().min(1).max(100)).max(1000).default([]),
    conflict: z.enum(['skip', 'replace']),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.targetStoreIds.includes(value.sourceStoreId) ||
      new Set(value.targetStoreIds).size !== value.targetStoreIds.length
    )
      context.addIssue({ code: 'custom', message: '源店与目标店必须不同，目标不可重复' })
    if (new Set(value.sections).size !== value.sections.length)
      context.addIssue({ code: 'custom', message: '同步范围不可重复' })
    if (
      value.sections.includes('products') &&
      (!value.productIds.length || new Set(value.productIds).size !== value.productIds.length)
    )
      context.addIssue({ code: 'custom', message: '请明确选择不重复的商品编号' })
  })
export type SyncRequest = z.infer<typeof syncRequestSchema>
export const syncApplySchema = z
  .object({ planId: z.string().uuid(), confirmed: z.literal(true) })
  .strict()
export const syncRollbackSchema = z
  .object({ backupId: z.string().uuid(), confirmed: z.literal(true) })
  .strict()
export const syncPreviewSchema = z.object({
  planId: z.string().uuid(),
  expiresAt: z.number(),
  rows: z.array(
    z.object({
      storeId: z.string(),
      section: syncSectionSchema,
      key: z.string(),
      action: z.enum(['add', 'replace', 'skip', 'unchanged']),
    }),
  ),
  warnings: z.array(z.string()),
})
export type SyncPreview = z.infer<typeof syncPreviewSchema>
export const syncResultSchema = z.object({
  backupId: z.string().uuid(),
  status: z.enum(['completed', 'failed', 'rolled-back', 'rollback-blocked']),
  applied: z.number(),
  restored: z.number(),
  error: z.string().optional(),
})
export type SyncResult = z.infer<typeof syncResultSchema>
export const syncBackupListSchema = z.array(
  z.object({
    backupId: z.string().uuid(),
    createdAt: z.number(),
    sourceStoreId: z.string(),
    targetStoreIds: z.array(z.string()),
    status: syncResultSchema.shape.status,
    applied: z.number(),
    restored: z.number(),
    error: z.string().optional(),
  }),
)
export type SyncBackup = z.infer<typeof syncBackupListSchema>[number]
export interface StoreSyncClient {
  preview(input: SyncRequest): Promise<SyncPreview>
  apply(input: z.infer<typeof syncApplySchema>): Promise<SyncResult>
  rollback(input: z.infer<typeof syncRollbackSchema>): Promise<SyncResult>
  backups(): Promise<SyncBackup[]>
}

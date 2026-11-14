import { z } from 'zod'

export const platformItemKindSchema = z.enum(['ticket', 'aftersale'])
export type PlatformItemKind = z.infer<typeof platformItemKindSchema>
export const platformItemSchema = z.object({
  id: z.string().min(1).max(200),
  storeId: z.string().min(1).max(64),
  platform: z.string().max(40),
  kind: platformItemKindSchema,
  title: z.string().max(300),
  status: z.string().max(100),
  buyer: z.string().max(100).optional(),
  orderNo: z.string().max(100).optional(),
  amount: z.string().max(100).optional(),
  deadline: z.string().max(100).optional(),
  detailKey: z.string().max(300),
  updatedAt: z.string().max(100).optional(),
})
export type PlatformItem = z.infer<typeof platformItemSchema>
export const platformItemsSnapshotSchema = z.object({
  workspaceId: z.string(),
  stores: z.array(
    z.object({
      storeId: z.string(),
      storeName: z.string(),
      platform: z.string(),
      kind: platformItemKindSchema,
      status: z.enum(['unavailable', 'login_required', 'syncing', 'success', 'error', 'stale']),
      message: z.string(),
      lastSyncedAt: z.number().optional(),
      total: z.number().int().nonnegative().nullable(),
      complete: z.boolean(),
      items: z.array(platformItemSchema),
    }),
  ),
})
export type PlatformItemsSnapshot = z.infer<typeof platformItemsSnapshotSchema>
export type PlatformItemsStore = PlatformItemsSnapshot['stores'][number]
export const refreshAssistPlatformSchema = z
  .object({
    workspaceId: z.string().uuid(),
    storeId: z.string().min(1).max(64).optional(),
    kind: platformItemKindSchema.optional(),
  })
  .strict()
export type RefreshAssistPlatformInput = z.infer<typeof refreshAssistPlatformSchema>
export const openAssistPlatformItemSchema = z
  .object({
    workspaceId: z.string().uuid(),
    storeId: z.string().min(1).max(64),
    kind: platformItemKindSchema,
    id: z.string().min(1).max(200).optional(),
  })
  .strict()
export type OpenAssistPlatformItemInput = z.infer<typeof openAssistPlatformItemSchema>

import { z } from 'zod'
export const storeZoomSchema = z
  .object({
    workspaceId: z.string().uuid(),
    storeId: z.string().min(1).max(64),
    percent: z.number().int().min(75).max(200),
  })
  .strict()
export type StoreZoomRequest = z.infer<typeof storeZoomSchema>

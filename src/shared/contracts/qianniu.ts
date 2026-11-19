import { z } from 'zod'

export const QIANNIU_PLATFORM_ID = 'qianniu'
export const qianniuAccountSchema = z.object({
  serviceId: z.string().trim().min(1).max(100),
  name: z.string().max(100),
  mallId: z.string().max(100),
  nativeReady: z.boolean(),
  online: z.boolean(),
})
export type QianniuAccount = z.infer<typeof qianniuAccountSchema>
export const qianniuAccountsSchema = z.array(qianniuAccountSchema).max(100)

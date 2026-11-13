import { z } from 'zod'

export const modelSourceSchema = z
  .object({
    mode: z.enum(['local', 'managed']),
    apiOrigin: z.string().max(2048),
    portalOrigin: z.string().max(2048),
  })
  .strict()
export type ModelSource = z.infer<typeof modelSourceSchema>
export const defaultModelSource: ModelSource = {
  mode: 'local',
  apiOrigin: 'https://api-kefu.lttlt.top',
  portalOrigin: 'https://account-kefu.lttlt.top',
}
export const managedSessionSchema = z.object({
  status: z.enum(['signed_out', 'authorizing', 'signed_in', 'offline', 'expired', 'disabled']),
  account: z
    .object({
      userId: z.union([z.number().int().positive(), z.string().min(1).max(512)]),
      displayName: z.string().max(512),
      capabilities: z
        .object({ vision: z.boolean(), model: z.string().max(128), maxImages: z.number() })
        .optional(),
      trial: z.object({
        limit: z.number().int().nonnegative(),
        used: z.number().int().nonnegative(),
        reserved: z.number().int().nonnegative(),
        remaining: z.number().int().nonnegative(),
        expiresAt: z.number().int().nonnegative(),
      }),
    })
    .nullable(),
  expiresAt: z.number().nullable(),
  login: z.object({ userCode: z.string().max(64), expiresAt: z.number() }).nullable(),
  message: z.string().nullable(),
})
export type ManagedSessionState = z.infer<typeof managedSessionSchema>
export const emptyManagedSession = (): ManagedSessionState => ({
  status: 'signed_out',
  account: null,
  expiresAt: null,
  login: null,
  message: null,
})
export const managedStateSchema = z.object({
  active: modelSourceSchema,
  configured: modelSourceSchema,
  restartRequired: z.boolean(),
  session: managedSessionSchema,
})
export type ManagedState = z.infer<typeof managedStateSchema>
export const emptyManagedState = (): ManagedState => ({
  active: { ...defaultModelSource },
  configured: { ...defaultModelSource },
  restartRequired: false,
  session: emptyManagedSession(),
})

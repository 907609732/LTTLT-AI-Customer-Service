import { z } from 'zod'

export const managedServiceErrorCodeSchema = z.enum([
  'service_not_deployed',
  'session_expired',
  'account_disabled',
  'access_denied',
  'payment_not_configured',
  'plans_not_configured',
  'invalid_plan',
  'billing_conflict',
  'checkout_unavailable',
  'billing_unavailable',
  'offline',
  'invalid_response',
  'team_forbidden',
  'team_not_found',
  'team_revision_conflict',
  'team_invalid_request',
  'team_temporarily_unavailable',
  'workspace_changed',
  'canceled',
  'invalid_request',
  'request_failed',
])
export type ManagedServiceErrorCode = z.infer<typeof managedServiceErrorCodeSchema>
export const managedServiceFailureSchema = z
  .object({
    code: managedServiceErrorCodeSchema,
    status: z.number().int().min(100).max(599).nullable(),
    message: z.string().min(1).max(512),
    retryable: z.boolean(),
  })
  .strict()
export type ManagedServiceFailure = z.infer<typeof managedServiceFailureSchema>
export const managedServiceResponseSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), data: z.unknown() }).strict(),
  z.object({ ok: z.literal(false), error: managedServiceFailureSchema }).strict(),
])
export type ManagedServiceResponse = z.infer<typeof managedServiceResponseSchema>

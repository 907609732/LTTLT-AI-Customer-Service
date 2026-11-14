import { managedBusinessPayloadSchema } from '../src/shared/contracts/managed-business'

export const managedServiceRequestSchema = managedBusinessPayloadSchema

/** Only a main-process validated team/billing path can reuse the encrypted device session. */
export function validateManagedServiceRequest(
  endpoint: string,
  input: {
    method?: string
    body?: unknown
  } = {},
) {
  return managedServiceRequestSchema.parse({ endpoint, ...input })
}

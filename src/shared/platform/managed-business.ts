import { managedServiceResponseSchema } from '../contracts/managed-service-error'

/** Electron serializes thrown Error properties poorly. Parse the closed envelope before throwing in Vue. */
export function unwrapManagedBusinessResponse(input: unknown): unknown {
  const parsed = managedServiceResponseSchema.safeParse(input)
  if (!parsed.success)
    throw Object.assign(new Error('托管服务响应格式不正确，请更新或刷新客户端'), {
      code: 'invalid_response',
    })
  if (!parsed.data.ok) throw Object.assign(new Error(parsed.data.error.message), parsed.data.error)
  return parsed.data.data
}

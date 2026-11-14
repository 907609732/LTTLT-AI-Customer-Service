import { describe, it, expect } from 'vitest'
import { toManagedServiceFailure } from '../electron/managed-service-error'
import { managedServiceResponseSchema } from '../src/shared/contracts/managed-service-error'

describe('managed business failures', () => {
  it.each([
    [{ status: 404 }, 'service_not_deployed', false],
    [{ status: 401, code: 'unauthorized' }, 'session_expired', false],
    [{ status: 503, code: 'payment_not_configured' }, 'payment_not_configured', false],
    [{ status: 409, code: 'billing_conflict' }, 'billing_conflict', false],
    [{ code: 'offline' }, 'offline', true],
    [{ code: 'team_revision_conflict' }, 'team_revision_conflict', false],
  ])('keeps the safe failure identity for %j', (cause, code, retryable) => {
    const result = toManagedServiceFailure(cause)
    expect(result.code).toBe(code)
    expect(result.retryable).toBe(retryable)
    expect(result.status).toBe('status' in cause ? cause.status : null)
    expect(managedServiceResponseSchema.parse({ ok: false, error: result }).ok).toBe(false)
  })
  it('does not expose raw IPC messages, response bodies, headers or credentials', () => {
    const result = toManagedServiceFailure(
      Object.assign(new Error('Error invoking remote method: secret-key raw upstream'), {
        code: 'not-whitelisted-private',
        body: 'private-body',
        headers: { Authorization: 'Bearer private' },
      }),
    )
    expect(result.code).toBe('request_failed')
    expect(JSON.stringify(result)).not.toMatch(/secret-key|private-body|Bearer|invoking remote/)
  })
})

import { describe, expect, it } from 'vitest'
import { unwrapManagedBusinessResponse } from '../src/shared/platform/managed-business'

describe('托管业务错误经过桌面桥后仍可识别', () => {
  it('保留返回数据和受限错误码，拒绝未经契约验证的响应', () => {
    expect(unwrapManagedBusinessResponse({ ok: true, data: { teams: [] } })).toEqual({ teams: [] })
    const failure = {
      ok: false,
      error: {
        code: 'payment_not_configured',
        status: 503,
        message: '商户支付尚未配置',
        retryable: false,
      },
    }
    try {
      unwrapManagedBusinessResponse(failure)
      throw Error('expected rejection')
    } catch (cause) {
      expect(cause).toMatchObject({
        code: 'payment_not_configured',
        status: 503,
        message: '商户支付尚未配置',
      })
    }
    expect(() =>
      unwrapManagedBusinessResponse({ ok: false, error: { code: 'unknown', raw: 'secret' } }),
    ).toThrow('响应')
  })
})

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { emptySnapshot } from '../src/shared/contracts/backend'
import type { LocalRuntime } from '../electron/local-runtime'
import { registerBusinessIpc } from '../electron/business-ipc'

const fake = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, input: unknown) => unknown>(),
  authorize: vi.fn(),
  open: vi.fn(),
}))
vi.mock('electron', () => ({
  ipcMain: {
    handle: (name: string, callback: (event: unknown, input: unknown) => unknown) =>
      fake.handlers.set(name, callback),
    removeHandler: (name: string) => fake.handlers.delete(name),
  },
  BrowserWindow: { getAllWindows: () => [] },
  shell: { openExternal: fake.open },
}))
vi.mock('../electron/local-runtime', () => ({ requireAppFrame: fake.authorize }))
vi.mock('../electron/windows', () => ({
  isAppWebContents: () => true,
  isTrustedRenderer: () => true,
}))
beforeEach(() => {
  fake.handlers.clear()
  vi.clearAllMocks()
})

function fixture() {
  const snapshot = emptySnapshot()
  snapshot.workspaceId = randomUUID()
  snapshot.managed.active.mode = 'managed'
  snapshot.managed.session.status = 'signed_in'
  const serviceRequest = vi.fn(async () => ({ plans: [] }))
  const runtime = {
    snapshot: () => snapshot,
    serviceRequest,
    subscribe: () => () => {},
  } as unknown as LocalRuntime
  const dispose = registerBusinessIpc(runtime)
  const invoke = (name: string, input: unknown) => fake.handlers.get(`managed:${name}`)!({}, input)
  return { snapshot, serviceRequest, invoke, dispose }
}

describe('统一托管业务IPC', () => {
  it('校验frame、工作区与精确路由，不接受URL、账号及认证头', async () => {
    const f = fixture()
    await expect(
      f.invoke('business-request', {
        workspaceId: f.snapshot.workspaceId,
        request: { endpoint: '/teams', method: 'GET' },
      }),
    ).resolves.toEqual({ ok: true, data: { plans: [] } })
    expect(fake.authorize).toHaveBeenCalled()
    for (const input of [
      { workspaceId: randomUUID(), request: { endpoint: '/teams' } },
      { workspaceId: f.snapshot.workspaceId, request: { endpoint: '/admin' } },
      {
        workspaceId: f.snapshot.workspaceId,
        request: { endpoint: '/teams', headers: { Authorization: 'anything' } },
      },
    ])
      await expect(f.invoke('business-request', input)).rejects.toThrow()
    expect(f.serviceRequest).toHaveBeenCalledTimes(1)
    f.dispose()
    expect(fake.handlers.has('managed:business-request')).toBe(false)
  })
  it('保留受限支付错误码，不将服务响应或密钥穿过Electron异常序列化', async () => {
    const f = fixture()
    f.serviceRequest.mockRejectedValueOnce(
      Object.assign(new Error('private raw body sk_secret'), {
        status: 404,
        code: 'request_failed',
      }),
    )
    const result = await f.invoke('business-request', {
      workspaceId: f.snapshot.workspaceId,
      request: { endpoint: '/billing' },
    })
    expect(result).toMatchObject({
      ok: false,
      error: { code: 'service_not_deployed', status: 404, retryable: false },
    })
    expect(JSON.stringify(result)).not.toMatch(/private raw|sk_secret/)
  })
  it('401使会话过期后仍返回session_expired闭集错误', async () => {
    const f = fixture()
    f.serviceRequest.mockImplementationOnce(async () => {
      f.snapshot.managed.session.status = 'expired'
      throw Object.assign(new Error('request failed'), { status: 401, code: 'session_expired' })
    })
    await expect(
      f.invoke('business-request', {
        workspaceId: f.snapshot.workspaceId,
        request: { endpoint: '/billing' },
      }),
    ).resolves.toMatchObject({ ok: false, error: { code: 'session_expired', status: 401 } })
  })
  it('切换工作区后丢弃晚到响应，付款入口只接受准确服务商来源', async () => {
    const f = fixture()
    f.serviceRequest.mockImplementationOnce(async () => {
      f.snapshot.workspaceId = randomUUID()
      return { plans: [] }
    })
    await expect(
      f.invoke('business-request', {
        workspaceId: f.snapshot.workspaceId,
        request: { endpoint: '/billing' },
      }),
    ).rejects.toThrow('工作区')
    for (const url of [
      'https://checkout.stripe.com.evil.test/x',
      'https://user@checkout.stripe.com/x',
      'http://checkout.stripe.com/x',
      'https://checkout.stripe.com:444/x',
    ])
      await expect(
        f.invoke('open-checkout', { workspaceId: f.snapshot.workspaceId, url }),
      ).rejects.toThrow()
    expect(fake.open).not.toHaveBeenCalled()
    await f.invoke('open-checkout', {
      workspaceId: f.snapshot.workspaceId,
      url: 'https://checkout.stripe.com/c/pay/fixture',
    })
    expect(fake.open).toHaveBeenCalledTimes(1)
  })
})

import { afterEach, describe, expect, it, vi } from 'vitest'
import { createRequire } from 'node:module'
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  createManagedController,
  validateModelSource,
  type ManagedSessionFactory,
} from '../electron/managed-controller'
import { defaultModelSource } from '../src/shared/contracts/managed'

const factory = createRequire(import.meta.url)(
  path.resolve('vendor/lingtu-runtime/electron/managed-session.cjs'),
) as ManagedSessionFactory
const disposals: (() => void)[] = []
afterEach(() => {
  for (const dispose of disposals.splice(0)) dispose()
  vi.useRealTimers()
})

function fixture(mode: 'local' | 'managed' = 'managed') {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yunduo-managed-'))
  disposals.push(() => {
    const resolved = path.resolve(rootDir)
    if (
      path.dirname(resolved) !== path.resolve(os.tmpdir()) ||
      !path.basename(resolved).startsWith('yunduo-managed-')
    )
      throw new Error('Refusing cleanup outside the managed test directory')
    fs.rmSync(resolved, { recursive: true, force: true })
  })
  const source = {
    mode,
    apiOrigin: 'https://api.managed.test',
    portalOrigin: 'https://account.managed.test',
  }
  fs.writeFileSync(path.join(rootDir, 'model-source.json'), JSON.stringify(source))
  const key = randomBytes(32)
  const safeStorage = {
    isEncryptionAvailable: () => true,
    encryptString(value: string) {
      const iv = randomBytes(12)
      const cipher = createCipheriv('aes-256-gcm', key, iv)
      const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
      return Buffer.concat([iv, cipher.getAuthTag(), ciphertext])
    },
    decryptString(value: Buffer) {
      const cipher = createDecipheriv('aes-256-gcm', key, value.subarray(0, 12))
      cipher.setAuthTag(value.subarray(12, 28))
      return Buffer.concat([cipher.update(value.subarray(28)), cipher.final()]).toString('utf8')
    },
  }
  let userId = 1
  let chatError = ''
  const expiry = Math.floor(Date.now() / 1000) + 3600
  const calls: { url: string; body: Record<string, unknown> | null; bearer: string | null }[] = []
  const submitted = vi.fn()
  const browser = vi.fn(async () => {})
  const stopAi = vi.fn()
  const fetchImpl: typeof fetch = async (url, init) => {
    const endpoint = new URL(String(url)).pathname
    const body =
      typeof init?.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : null
    calls.push({ url: String(url), body, bearer: new Headers(init?.headers).get('Authorization') })
    let result: unknown
    let status = 200
    if (endpoint.endsWith('/auth/device/authorize'))
      result = {
        device_code: 'fixture-device',
        user_code: 'ABCD-EFGH',
        expires_in: 600,
        interval: 1,
        verification_uri: source.portalOrigin + '/lingtu/device',
        verification_uri_complete: source.portalOrigin + '/lingtu/device?user_code=ABCD-EFGH',
      }
    else if (endpoint.endsWith('/auth/device/token') || endpoint.endsWith('/auth/refresh'))
      result = {
        access_token: 'fixture-access-secret',
        refresh_token: 'fixture-refresh-secret',
        user_id: userId,
        session_id: 'fixture-session-' + userId,
        token_type: 'Bearer',
        expires_at: expiry,
        access_expires_at: Math.floor(Date.now() / 1000) + 900,
      }
    else if (endpoint.endsWith('/me'))
      result = {
        user_id: userId,
        display_name: '测试账号' + userId,
        status: 'enabled',
        trial: { limit: 20, used: 1, reserved: 0, remaining: 19, expires_at: expiry },
        capabilities: { vision: false, model: 'managed-1', max_images: 4 },
      }
    else if (endpoint.endsWith('/chat/completions')) {
      result = chatError
        ? { error: chatError }
        : { choices: [{ message: { content: '{"reply":"托管夹具回答"}' } }] }
      if (chatError) status = 409
    } else if (endpoint.endsWith('/auth/logout')) result = { revoked: true }
    else throw new Error('Unexpected fixture request')
    return new Response(JSON.stringify(result), {
      status,
      headers: { 'content-type': 'application/json' },
    })
  }
  const make = () => {
    const controller = createManagedController({
      rootDir,
      factory,
      safeStorage,
      stopAi,
      changed: () => {},
      submitted,
      openExternal: browser,
      transport: { fetchImpl, openExternal: browser },
    })
    disposals.unshift(() => controller.dispose())
    return controller
  }
  return {
    rootDir,
    source,
    make,
    calls,
    submitted,
    browser,
    stopAi,
    setUser: (id: number) => {
      userId = id
    },
    setError: (error: string) => {
      chatError = error
    },
  }
}

describe('托管账号和模式隔离', () => {
  it('默认保持本机模式，不恢复远程会话；仅为数字回环地址放行 HTTP', async () => {
    expect(defaultModelSource.mode).toBe('local')
    for (const apiOrigin of [
      'http://api.example.com',
      'http://127.0.0.1.evil.test:3000',
      'http://localhost:3000',
      'http://127.0.0.1',
      'https://user:password@api.example.com',
      'https://api.example.com/path',
      'https://api.example.com/?token=x',
    ])
      expect(() => validateModelSource({ ...defaultModelSource, apiOrigin })).toThrow()
    expect(
      validateModelSource({ ...defaultModelSource, apiOrigin: 'http://127.0.0.1:3000' }).apiOrigin,
    ).toBe('http://127.0.0.1:3000')
    const localSession = factory.createManagedSession({
      origin: 'http://127.0.0.1:3000',
      portalOrigin: 'http://127.0.0.1:3000',
      credentialFile: path.join(os.tmpdir(), 'unused-local-session.enc'),
    })
    expect(localSession.snapshot()).toMatchObject({ status: 'signed_out' })
    localSession.dispose()
    const f = fixture('local')
    const controller = f.make()
    await controller.init()
    expect(f.calls).toHaveLength(0)
    expect(controller.dataDir).toBe(f.rootDir)
    expect(controller.partitionNamespace).toBe('yunduo-local')
    await controller.execute('save-model-source', { ...f.source, mode: 'managed' })
    expect(controller.snapshot().restartRequired).toBe(true)
    expect(f.calls).toHaveLength(0)
    expect(() => controller.ready()).toThrow('重启')
  })

  it('真实设备授权协议、加密持久化与恢复不泄漏 token，首次登录要求切换账号工作区', async () => {
    vi.useFakeTimers()
    const f = fixture()
    const controller = f.make()
    await controller.execute('managed-login', {})
    expect(controller.snapshot().session.status).toBe('authorizing')
    expect(f.browser).toHaveBeenCalledWith(
      'https://account.managed.test/lingtu/device?user_code=ABCD-EFGH',
    )
    await vi.advanceTimersByTimeAsync(1100)
    expect(controller.snapshot().session.account?.userId).toBe(1)
    expect(controller.snapshot().restartRequired).toBe(true)
    expect(() => controller.ready()).toThrow('重启')
    expect(JSON.stringify(controller.snapshot())).not.toContain('secret')
    const authDirectory = path.join(
      f.rootDir,
      'managed-auth',
      fs.readdirSync(path.join(f.rootDir, 'managed-auth'))[0]!,
    )
    expect(
      fs
        .readFileSync(path.join(authDirectory, 'session.enc'))
        .includes(Buffer.from('fixture-refresh-secret')),
    ).toBe(false)
    controller.dispose()
    const restored = f.make()
    await restored.init()
    expect(restored.snapshot().restartRequired).toBe(false)
    expect(restored.snapshot().session.status).toBe('signed_in')
    expect(() => restored.ready()).not.toThrow()
    expect(restored.dataDir).not.toBe(controller.dataDir)
    expect(restored.partitionNamespace).not.toBe('yunduo-local')
  })

  it('聊天只走受限客户端协议；提交证据对应真实聊天 fetch，不对未知结果自动重试', async () => {
    vi.useFakeTimers()
    const f = fixture()
    const login = f.make()
    await login.execute('managed-login', {})
    await vi.advanceTimersByTimeAsync(1100)
    login.dispose()
    const controller = f.make()
    await controller.init()
    const payload = {
      client_request_id: 'fixture-request-1',
      messages: [{ role: 'user', content: '物流不动了' }],
    }
    await controller.chat(payload, { traceId: 'fixture-trace' })
    const chatCalls = f.calls.filter((call) => call.url.endsWith('/chat/completions'))
    expect(chatCalls).toHaveLength(1)
    expect(chatCalls[0]?.body).toEqual(payload)
    expect(chatCalls[0]?.bearer).toBe('Bearer fixture-access-secret')
    expect(JSON.stringify(chatCalls[0]?.body)).not.toContain('fixture-trace')
    expect(f.submitted).toHaveBeenCalledTimes(1)
    expect(f.submitted).toHaveBeenCalledWith('fixture-trace')
    f.setError('request_uncertain')
    await expect(
      controller.chat({ ...payload, client_request_id: 'fixture-request-2' }, {}),
    ).rejects.toMatchObject({ code: 'request_uncertain' })
    expect(f.calls.filter((call) => call.url.endsWith('/chat/completions'))).toHaveLength(2)
  })

  it('切换账号后阻止旧账号工作区调用，新账号不会读取旧工作区和平台分区', async () => {
    vi.useFakeTimers()
    const f = fixture()
    const login = f.make()
    await login.execute('managed-login', {})
    await vi.advanceTimersByTimeAsync(1100)
    login.dispose()
    const first = f.make()
    await first.init()
    fs.mkdirSync(first.dataDir, { recursive: true })
    fs.writeFileSync(path.join(first.dataDir, 'account-one-only.txt'), 'private fixture')
    f.setUser(2)
    await first.execute('managed-login', {})
    await vi.advanceTimersByTimeAsync(1100)
    expect(first.snapshot().session.account?.userId).toBe(2)
    expect(() => first.ready()).toThrow('重启')
    first.dispose()
    const second = f.make()
    await second.init()
    expect(second.dataDir).not.toBe(first.dataDir)
    expect(second.partitionNamespace).not.toBe(first.partitionNamespace)
    expect(fs.existsSync(path.join(second.dataDir, 'account-one-only.txt'))).toBe(false)
    expect(() => second.ready()).not.toThrow()
    await second.execute('managed-logout', {})
    expect(second.snapshot().session.status).toBe('signed_out')
    expect(() => second.ready()).toThrow('登录')
  })
})

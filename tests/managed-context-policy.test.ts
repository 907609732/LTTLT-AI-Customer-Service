import { afterEach, describe, expect, it, vi } from 'vitest'
import { createRequire } from 'node:module'
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createManagedController, type ManagedSessionFactory } from '../electron/managed-controller'
import { managedContextPolicySchema } from '../electron/managed-context-policy'

const factory = createRequire(import.meta.url)(
  path.resolve('vendor/lingtu-runtime/electron/managed-session.cjs'),
) as ManagedSessionFactory
const disposals: (() => void)[] = []
afterEach(() => {
  for (const dispose of disposals.splice(0)) dispose()
  vi.useRealTimers()
})

const policy = {
  default_model: 'managed-1',
  models: [{ id: 'managed-1', name: '托管模型一' }],
  max_tokens: 512,
  policy_version: 3,
  runtime_context: {
    enabled: true,
    retrieval_budget: 3000,
    retrieval_order: ['binding', 'store', 'canonical', 'template'],
  },
  learning: {
    enabled: true,
    vision_enabled: true,
    allowed_sources: ['pdd_detail_text', 'pdd_detail_image'],
    max_calls_per_product: 20,
    max_output_tokens: 4096,
    requires_review: true,
    video_mode: 'disabled',
    asr_mode: 'disabled',
  },
}

function fixture() {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yunduo-managed-policy-'))
  disposals.push(() => {
    const resolved = path.resolve(rootDir)
    if (
      path.dirname(resolved) !== path.resolve(os.tmpdir()) ||
      !path.basename(resolved).startsWith('yunduo-managed-policy-')
    )
      throw new Error('Refusing cleanup outside the managed policy test directory')
    fs.rmSync(resolved, { recursive: true, force: true })
  })
  const source = {
    mode: 'managed' as const,
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
  let vision = true
  let configBody: unknown = structuredClone(policy)
  let configStatus = 200
  let configGate: Promise<void> | undefined
  let configEntered: (() => void) | undefined
  const expiry = Math.floor(Date.now() / 1000) + 3600
  const calls: {
    url: string
    method: string
    body: Record<string, unknown> | null
    bearer: string | null
  }[] = []
  const fetchImpl: typeof fetch = async (url, init) => {
    const endpoint = new URL(String(url)).pathname
    const body =
      typeof init?.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : null
    calls.push({
      url: String(url),
      method: init?.method ?? 'GET',
      body,
      bearer: new Headers(init?.headers).get('Authorization'),
    })
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
        trial: { limit: 20, used: 2, reserved: 0, remaining: 18, expires_at: expiry },
        capabilities: { vision, model: 'managed-1', max_images: 4 },
      }
    else if (endpoint.endsWith('/config')) {
      configEntered?.()
      configEntered = undefined
      if (configGate) await configGate
      result = configBody
      status = configStatus
    } else if (endpoint.endsWith('/auth/logout')) result = { revoked: true }
    else if (endpoint === '/api/client/billing') result = { plans: [] }
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
      stopAi: () => {},
      changed: () => {},
      openExternal: async () => {},
      transport: { fetchImpl },
    })
    disposals.unshift(() => controller.dispose())
    return controller
  }
  async function signedIn() {
    const login = make()
    await login.execute('managed-login', {})
    await vi.advanceTimersByTimeAsync(1100)
    login.dispose()
    const controller = make()
    await controller.init()
    return controller
  }
  return {
    rootDir,
    source,
    make,
    signedIn,
    calls,
    setConfig(value: unknown, status = 200) {
      configBody = value
      configStatus = status
    },
    holdConfig() {
      let release = () => {}
      configGate = new Promise<void>((resolve) => {
        release = resolve
      })
      const entered = new Promise<void>((resolve) => {
        configEntered = resolve
      })
      return { entered, release }
    },
    setUser: (id: number) => {
      userId = id
    },
    setVision(value: boolean) {
      vision = value
    },
  }
}

describe('托管上下文策略安全投影', () => {
  it('只读取固定配置端点，凭据不进入策略 DTO 或快照', async () => {
    vi.useFakeTimers()
    const f = fixture()
    const controller = await f.signedIn()
    await expect(controller.contextPolicy()).resolves.toEqual(policy)
    const configCalls = f.calls.filter(
      (call) => new URL(call.url).pathname === '/api/client/config',
    )
    expect(configCalls).toHaveLength(1)
    expect(configCalls[0]).toMatchObject({
      url: 'https://api.managed.test/api/client/config',
      method: 'GET',
      body: null,
      bearer: 'Bearer fixture-access-secret',
    })
    expect(JSON.stringify(await controller.contextPolicy())).not.toMatch(
      /fixture-access-secret|fixture-refresh-secret|system_prompt|provider/,
    )
    expect(JSON.stringify(controller.snapshot())).not.toMatch(
      /fixture-access-secret|fixture-refresh-secret/,
    )
    const serviceRequest = Reflect.get(controller, 'serviceRequest') as (
      endpoint: string,
    ) => Promise<unknown>
    await expect(serviceRequest('/config')).rejects.toThrow()
    expect(
      f.calls.filter((call) => new URL(call.url).pathname === '/api/client/config'),
    ).toHaveLength(1)
  })

  it('严格拒绝隐藏提示词、未知字段和畸形策略', () => {
    expect(managedContextPolicySchema.safeParse(policy).success).toBe(true)
    const invalid = [
      {
        ...policy,
        runtime_context: { ...policy.runtime_context, system_prompt: 'hidden prompt' },
      },
      { ...policy, provider: 'internal-route' },
      { ...policy, policy_version: -1 },
      { ...policy, max_tokens: -512 },
      {
        ...policy,
        runtime_context: {
          ...policy.runtime_context,
          retrieval_order: ['binding', 'store', 'store', 'template'],
        },
      },
      {
        ...policy,
        learning: { ...policy.learning, requires_review: false },
      },
      {
        ...policy,
        learning: { ...policy.learning, allowed_sources: ['pdd_detail_video'] },
      },
      {
        ...policy,
        learning: { ...policy.learning, max_output_tokens: 8192 },
      },
      { ...policy, runtime_context: policy.runtime_context, policy_version: undefined },
    ]
    for (const value of invalid)
      expect(managedContextPolicySchema.safeParse(value).success).toBe(false)
  })

  it('接受服务端允许的模型显示名长度和超过200个连接', () => {
    const name = `${'m'.repeat(128)} · ${'n'.repeat(128)}`
    const models = Array.from({ length: 201 }, (_, index) => ({ id: `model-${index}`, name }))
    expect(name.length).toBe(259)
    expect(managedContextPolicySchema.safeParse({ ...policy, models }).success).toBe(true)
  })

  it('旧服务端缺字段或配置失败使新学习不可用，恢复后仍可读取', async () => {
    vi.useFakeTimers()
    const f = fixture()
    const controller = await f.signedIn()
    f.setConfig({ default_model: 'managed-1', models: policy.models, max_tokens: 512 })
    await expect(controller.contextPolicy()).resolves.toBeNull()
    f.setConfig(
      {
        ...policy,
        runtime_context: { ...policy.runtime_context, system_prompt: 'hidden' },
      },
      200,
    )
    await expect(controller.contextPolicy()).resolves.toBeNull()
    f.setConfig({ error: 'configuration_unavailable' }, 503)
    await expect(controller.contextPolicy()).resolves.toBeNull()
    expect(controller.snapshot().session.status).toBe('signed_in')
    f.setConfig(policy)
    await expect(controller.contextPolicy()).resolves.toEqual(policy)
  })

  it('缓存不超过60秒且绑定当前来源与已登录账号，注销后清除', async () => {
    vi.useFakeTimers()
    const f = fixture()
    const controller = await f.signedIn()
    const count = () =>
      f.calls.filter((call) => new URL(call.url).pathname === '/api/client/config').length
    await controller.contextPolicy()
    await controller.contextPolicy()
    expect(count()).toBe(1)
    vi.setSystemTime(Date.now() + 61_000)
    await controller.contextPolicy()
    expect(count()).toBe(2)
    await controller.execute('managed-logout', {})
    await expect(controller.contextPolicy()).resolves.toBeNull()
    expect(count()).toBe(2)
  })

  it('切换账号后不沿用旧缓存；重启后按新账号重新读取', async () => {
    vi.useFakeTimers()
    const f = fixture()
    const controller = await f.signedIn()
    const count = () =>
      f.calls.filter((call) => new URL(call.url).pathname === '/api/client/config').length
    await expect(controller.contextPolicy()).resolves.toEqual(policy)
    expect(count()).toBe(1)
    f.setUser(2)
    await controller.execute('managed-login', {})
    await vi.advanceTimersByTimeAsync(1100)
    await expect(controller.contextPolicy()).resolves.toBeNull()
    expect(count()).toBe(1)
    controller.dispose()
    const restarted = f.make()
    await restarted.init()
    await expect(restarted.contextPolicy()).resolves.toEqual(policy)
    expect(count()).toBe(2)
  })

  it('保存模型来源使旧策略缓存失效，恢复原来源后重新读取', async () => {
    vi.useFakeTimers()
    const f = fixture()
    const controller = await f.signedIn()
    const count = () =>
      f.calls.filter((call) => new URL(call.url).pathname === '/api/client/config').length
    await expect(controller.contextPolicy()).resolves.toEqual(policy)
    expect(count()).toBe(1)
    await controller.execute('save-model-source', {
      ...f.source,
      apiOrigin: 'https://api2.managed.test',
    })
    await expect(controller.contextPolicy()).resolves.toBeNull()
    expect(count()).toBe(1)
    await controller.execute('save-model-source', f.source)
    await expect(controller.contextPolicy()).resolves.toEqual(policy)
    expect(count()).toBe(2)
  })

  it('等待配置响应期间注销或切换账号，晚到结果不得写入缓存', async () => {
    vi.useFakeTimers()
    const f = fixture()
    const controller = await f.signedIn()
    const gate = f.holdConfig()
    const pending = controller.contextPolicy()
    await gate.entered
    await controller.execute('managed-logout', {})
    gate.release()
    await expect(pending).resolves.toBeNull()
    await expect(controller.contextPolicy()).resolves.toBeNull()
  })

  it('学习预检返回当前真实 revision，旧服务端和禁用来源在请求前失败', async () => {
    vi.useFakeTimers()
    const f = fixture()
    const controller = await f.signedIn()
    const configCalls = () =>
      f.calls.filter((call) => new URL(call.url).pathname === '/api/client/config').length
    await expect(
      controller.learningPolicy({
        learningSource: 'pdd_detail_text',
        withImages: false,
      }),
    ).resolves.toEqual({ policyVersion: 3, maxTokens: 4096, maxCallsPerProduct: 20 })
    expect(configCalls()).toBe(1)
    await controller.learningPolicy({ learningSource: 'pdd_detail_text', withImages: false })
    expect(configCalls()).toBe(2)

    vi.setSystemTime(Date.now() + 61_000)
    f.setConfig({ ...policy, learning: { ...policy.learning, enabled: false } })
    await expect(
      controller.learningPolicy({
        learningSource: 'pdd_detail_text',
        withImages: false,
      }),
    ).rejects.toThrow(/未开通商品详情学习/)

    vi.setSystemTime(Date.now() + 61_000)
    f.setConfig({
      ...policy,
      learning: { ...policy.learning, allowed_sources: ['pdd_detail_image'] },
    })
    await expect(
      controller.learningPolicy({
        learningSource: 'pdd_detail_text',
        withImages: false,
      }),
    ).rejects.toThrow(/未允许该商品详情来源/)

    vi.setSystemTime(Date.now() + 61_000)
    f.setConfig({
      ...policy,
      learning: { ...policy.learning, vision_enabled: false },
    })
    await expect(
      controller.learningPolicy({
        learningSource: 'pdd_detail_image',
        withImages: true,
      }),
    ).rejects.toThrow(/未允许图片学习/)

    vi.setSystemTime(Date.now() + 61_000)
    f.setConfig({ default_model: 'managed-1', models: policy.models, max_tokens: 512 })
    await expect(
      controller.learningPolicy({
        learningSource: 'pdd_detail_text',
        withImages: false,
      }),
    ).rejects.toThrow(/旧版服务端/)
  })

  it('学习预检校验账号视觉能力并忽略账号切换期间的迟到策略', async () => {
    vi.useFakeTimers()
    const f = fixture()
    f.setVision(false)
    const controller = await f.signedIn()
    await expect(
      controller.learningPolicy({
        learningSource: 'pdd_detail_image',
        withImages: true,
      }),
    ).rejects.toThrow(/未提供图片学习能力/)

    f.setVision(true)
    vi.setSystemTime(Date.now() + 61_000)
    const gate = f.holdConfig()
    const pending = controller.learningPolicy({
      learningSource: 'pdd_detail_text',
      withImages: false,
    })
    await gate.entered
    await controller.execute('managed-logout', {})
    gate.release()
    await expect(pending).rejects.toThrow(/知识任务已取消|账号|登录/)
  })
}, 15_000)

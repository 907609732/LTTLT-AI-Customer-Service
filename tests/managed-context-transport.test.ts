import { afterEach, describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  createManagedController,
  type ManagedSession,
  type ManagedSessionFactory,
} from '../electron/managed-controller'

const require = createRequire(import.meta.url)
const disposals: (() => void)[] = []
afterEach(() => {
  for (const dispose of disposals.splice(0)) dispose()
})

const identity = (apiOrigin: string) => createHash('sha256').update(apiOrigin).digest('hex')

function controllerFixture() {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yunduo-managed-transport-'))
  disposals.push(() => fs.rmSync(rootDir, { recursive: true, force: true }))
  const source = {
    mode: 'managed' as const,
    apiOrigin: 'https://api.managed.test',
    portalOrigin: 'https://account.managed.test',
  }
  fs.writeFileSync(path.join(rootDir, 'model-source.json'), JSON.stringify(source))
  const authDir = path.join(rootDir, 'managed-auth', identity(source.apiOrigin))
  fs.mkdirSync(authDir, { recursive: true })
  fs.writeFileSync(path.join(authDir, 'last-account.json'), JSON.stringify({ userId: 1 }))
  const chat = vi.fn(async (_payload: unknown, _options?: unknown) => ({ choices: [] }))
  const state = {
    status: 'signed_in' as const,
    account: {
      userId: 1,
      displayName: '测试账号',
      capabilities: { vision: true, model: 'managed-1', maxImages: 4 },
      trial: {
        limit: 20,
        used: 2,
        reserved: 0,
        remaining: 18,
        expiresAt: Math.floor(Date.now() / 1000) + 3600,
      },
    },
    expiresAt: Math.floor(Date.now() / 1000) + 3600,
    login: null,
    message: null,
  }
  class ManagedSessionError extends Error {
    code: string
    constructor(code: string) {
      super(code)
      this.code = code
    }
  }
  const session: ManagedSession = {
    init: async () => state,
    snapshot: () => structuredClone(state),
    config: async () => ({}),
    beginLogin: async () => state,
    cancelLogin: async () => state,
    logout: async () => state,
    refresh: async () => state,
    chat,
    dispose: () => {},
  }
  const factory: ManagedSessionFactory = {
    createManagedSession(options) {
      const onChange = options.onChange as ((value: unknown) => void) | undefined
      onChange?.(structuredClone(state))
      return session
    },
    ManagedSessionError,
  }
  const controller = createManagedController({
    rootDir,
    factory,
    safeStorage: {
      isEncryptionAvailable: () => true,
      encryptString: (value) => Buffer.from(value),
      decryptString: (value) => value.toString(),
    },
    stopAi: () => {},
    changed: () => {},
    openExternal: async () => {},
  })
  disposals.unshift(() => controller.dispose())
  return { controller, chat }
}

describe('托管聊天策略透传', () => {
  it('控制器只转交允许的用途、版本和来源，任意输出声明被剔除', async () => {
    const { controller, chat } = controllerFixture()
    await controller.init()
    const messages = [{ role: 'user', content: '详情页学习' }]
    await controller.chat(
      {
        client_request_id: 'explicit-learning',
        messages,
        purpose: 'learning',
        policy_version: 3,
        learning_source: 'pdd_detail_image',
        max_tokens: 8192,
      } as never,
      {},
    )
    expect(chat).toHaveBeenLastCalledWith(
      {
        client_request_id: 'explicit-learning',
        messages,
        purpose: 'learning',
        policy_version: 3,
        learning_source: 'pdd_detail_image',
      },
      {},
    )
    expect(JSON.stringify(chat.mock.calls.at(-1)?.[0])).not.toMatch(/max_tokens|8192/)
    await expect(
      controller.chat(
        {
          client_request_id: 'invalid',
          messages,
          purpose: 'admin',
        } as never,
        {},
      ),
    ).rejects.toThrow()
    await expect(
      controller.chat(
        {
          client_request_id: 'invalid',
          messages,
          purpose: 'learning',
          policy_version: -1,
        } as never,
        {},
      ),
    ).rejects.toThrow()
    expect(chat).toHaveBeenCalledTimes(1)
  })

  it('旧聊天正文保持原样并省略新增字段', async () => {
    const { controller, chat } = controllerFixture()
    await controller.init()
    const payload = {
      client_request_id: 'legacy-request',
      messages: [{ role: 'user', content: '物流不动了' }],
    }
    await controller.chat(payload, {})
    expect(chat).toHaveBeenLastCalledWith(payload, {})
    expect(Object.keys(chat.mock.calls[0]?.[0] as object)).toEqual([
      'client_request_id',
      'messages',
    ])
  })
})

describe('托管后端显式策略透传', () => {
  it('仅从明确标记的 complete 输入携带学习用途，旧调用与其他字段保持不变', async () => {
    const { createBackend } = require(
      path.resolve('vendor/lingtu-runtime/electron/backend.cjs'),
    ) as {
      createBackend: (options: Record<string, unknown>) => {
        engine: { aiClient: { complete: (input: unknown) => Promise<string> } }
        dispose: () => void
      }
    }
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yunduo-managed-backend-'))
    disposals.push(() => fs.rmSync(dataDir, { recursive: true, force: true }))
    const payloads: Record<string, unknown>[] = []
    const backend = createBackend({
      dataDir,
      modelMode: 'managed',
      managedChat: async (payload: Record<string, unknown>) => {
        payloads.push(payload)
        return { choices: [{ message: { content: '{"reply":"ok"}' } }] }
      },
      managerFactory: () => ({
        stateOf: () => ({ open: true, online: true }),
        closeAll() {},
      }),
      adapterFactory: () => ({
        syncAiEnabled: async () => {},
        focusConversation: async () => ({ ok: true }),
        sendText: async () => ({ ok: true }),
      }),
    })
    disposals.unshift(() => backend.dispose())
    const messages = [{ role: 'user', content: '商品详情' }]
    await backend.engine.aiClient.complete({
      messages,
      purpose: 'learning',
      policyVersion: 3,
      learningSource: 'pdd_detail_image',
      maxTokens: 8192,
      client_request_id: 'forged-request',
    })
    expect(payloads[0]).toEqual({
      client_request_id: expect.any(String),
      messages,
      purpose: 'learning',
      policy_version: 3,
      learning_source: 'pdd_detail_image',
    })
    expect(payloads[0]?.client_request_id).not.toBe('forged-request')
    expect(JSON.stringify(payloads[0])).not.toMatch(/max_tokens|8192|maxTokens/)

    await backend.engine.aiClient.complete({ messages })
    expect(payloads[1]).toEqual({ client_request_id: expect.any(String), messages })
    expect(Object.keys(payloads[1]!)).toEqual(['client_request_id', 'messages'])

    for (const metadata of [
      { purpose: 'admin', policyVersion: 3, learningSource: 'pdd_detail_text' },
      { purpose: 'reply', policyVersion: 0, learningSource: 'pdd_detail_text' },
      { purpose: 'learning', policyVersion: -1, learningSource: 'pdd_detail_text' },
      { purpose: 'learning', policyVersion: 3, learningSource: 'pdd_detail_video' },
      { purpose: 'learning', policyVersion: 3 },
    ]) {
      await expect(backend.engine.aiClient.complete({ messages, ...metadata })).rejects.toThrow()
      expect(payloads).toHaveLength(2)
    }
  })
})

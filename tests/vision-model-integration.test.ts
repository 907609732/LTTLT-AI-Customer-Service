// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import type { AddressInfo } from 'node:net'
import { createVisionModelAssembly } from '../electron/vision-model-assembly'
import {
  toVisionExpected,
  visionModelSettingsViewSchema,
  visionModelVerifyResultSchema,
} from '../src/shared/contracts/vision'
import type { KnowledgeModelPort } from '../electron/knowledge-runtime'

const cleanup: (() => void)[] = []
afterEach(() => {
  for (const dispose of cleanup.splice(0).reverse()) dispose()
})

function safeStorage() {
  return {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => Buffer.from(value, 'utf8'),
    decryptString: (value: Buffer) => value.toString('utf8'),
  }
}

async function server(handler: http.RequestListener) {
  const instance = http.createServer(handler)
  await new Promise<void>((resolve) => instance.listen(0, '127.0.0.1', resolve))
  cleanup.push(() => instance.close())
  const port = (instance.address() as AddressInfo).port
  return `http://127.0.0.1:${port}`
}

async function readBody(request: http.IncomingMessage) {
  const chunks: Buffer[] = []
  for await (const chunk of request) chunks.push(Buffer.from(chunk))
  return Buffer.concat(chunks).toString('utf8')
}

function basePort(url: string): KnowledgeModelPort {
  return {
    complete: async () => {
      const response = await fetch(`${url}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ messages: [{ role: 'user', content: 'text' }] }),
      })
      const body = (await response.json()) as {
        choices: { message: { content: string } }[]
      }
      return body.choices[0]!.message.content
    },
    vision: () => ({ supported: true, maxImages: 4, reason: 'text vision' }),
    identity: () => 'text-base-identity',
    minimumIntervalMs: () => 1234,
  }
}

describe('local vision public assembly', () => {
  it('exposes get/save/probe/verify/clear and splits text/image across two real loopback endpoints', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vision-assembly-'))
    cleanup.push(() => fs.rmSync(dir, { recursive: true, force: true }))
    let visionAuth = ''
    let imageBody = ''
    let modelCalls = 0
    const vision = await server(async (request, response) => {
      visionAuth = String(request.headers.authorization || '')
      if (request.url === '/models') {
        response.setHeader('content-type', 'application/json')
        response.end(JSON.stringify({ data: [{ id: 'vision-model' }] }))
        return
      }
      imageBody = await readBody(request)
      modelCalls += 1
      response.setHeader('content-type', 'application/json')
      response.end(JSON.stringify({ choices: [{ message: { content: 'red, blue' } }] }))
    })
    let textCalls = 0
    const text = await server(async (_request, response) => {
      textCalls += 1
      response.setHeader('content-type', 'application/json')
      response.end(JSON.stringify({ choices: [{ message: { content: 'text endpoint answer' } }] }))
    })
    const assembly = createVisionModelAssembly({
      dataDir: dir,
      safeStorage: safeStorage(),
      assertActive: () => {},
      modelSource: () => 'local',
    })
    const wrapped = assembly.wrap(basePort(text))
    const initial = visionModelSettingsViewSchema.parse(
      await assembly.execute('get-vision-model-settings', {}),
    )
    expect(initial.snapshot.mode).toBe('inherit')
    const inheritedExpected = toVisionExpected(initial)
    const saved = visionModelSettingsViewSchema.parse(
      await assembly.execute('save-vision-model-settings', {
        mode: 'custom',
        baseUrl: vision,
        model: 'vision-model',
        apiKey: 'vision-key',
        expected: inheritedExpected,
      }),
    )
    expect(saved.snapshot).toMatchObject({
      mode: 'custom',
      apiKeyConfigured: true,
      status: 'unverified',
    })
    expect(JSON.stringify(saved)).not.toContain('vision-key')
    const probe = (await assembly.execute('probe-vision-model', toVisionExpected(saved))) as {
      ok: boolean
    }
    expect(probe.ok).toBe(true)
    const verified = visionModelVerifyResultSchema.parse(
      await assembly.execute('verify-vision-model', toVisionExpected(saved)),
    )
    expect(verified.ok).toBe(true)
    expect(verified.status).toBe('verified')
    expect(visionAuth).toContain('vision-key')
    expect(imageBody).toContain('image_url')

    const textCallsBefore = textCalls
    expect(await wrapped.complete({ messages: [{ role: 'user', content: '文字问题' }] })).toBe(
      'text endpoint answer',
    )
    expect(textCalls).toBe(textCallsBefore + 1)
    expect(
      await wrapped.complete({
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: '图片问题' },
              { type: 'image_url', image_url: { url: 'https://example.com/a.png' } },
            ],
          },
        ],
      }),
    ).toBe('red, blue')
    expect(modelCalls).toBeGreaterThan(0)

    const managedAssembly = createVisionModelAssembly({
      dataDir: dir,
      safeStorage: safeStorage(),
      assertActive: () => {},
      modelSource: () => 'managed',
    })
    const managedWrapped = managedAssembly.wrap(basePort(text))
    expect(managedWrapped.identity?.()).toBe('text-base-identity')
    const imageCallsBeforeManaged = modelCalls
    expect(
      await managedWrapped.complete({
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: '托管图片' },
              { type: 'image_url', image_url: { url: 'https://example.com/a.png' } },
            ],
          },
        ],
      }),
    ).toBe('text endpoint answer')
    expect(modelCalls).toBe(imageCallsBeforeManaged)

    const beforeStale = visionAuth
    await expect(
      assembly.execute('probe-vision-model', { ...toVisionExpected(saved), revision: 0 }),
    ).rejects.toThrow(/已更新/)
    expect(visionAuth).toBe(beforeStale)

    const afterVerify = visionModelSettingsViewSchema.parse(
      await assembly.execute('get-vision-model-settings', {}),
    )
    const cleared = visionModelSettingsViewSchema.parse(
      await assembly.execute('clear-vision-key', toVisionExpected(afterVerify)),
    )
    expect(cleared.snapshot.apiKeyConfigured).toBe(false)
  })

  it('contains corrupt local vision files and leaves text plus managed mode on the base port', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vision-corrupt-'))
    cleanup.push(() => fs.rmSync(dir, { recursive: true, force: true }))
    fs.writeFileSync(path.join(dir, 'vision-model.json'), '{broken')
    const assembly = createVisionModelAssembly({
      dataDir: dir,
      safeStorage: safeStorage(),
      assertActive: () => {},
      modelSource: () => 'local',
    })
    expect(assembly.error).toMatch(/损坏|无效|原文件/)
    expect(assembly.snapshot().status).toBe('stale')
    const base: KnowledgeModelPort = {
      complete: async () => 'base text',
      vision: () => ({ supported: true, maxImages: 4, reason: 'base' }),
      identity: () => 'base',
      minimumIntervalMs: () => 0,
    }
    const wrapped = assembly.wrap(base)
    expect(await wrapped.complete({ messages: [{ role: 'user', content: '普通文字' }] })).toBe(
      'base text',
    )
    await expect(
      wrapped.complete({
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: '图片' },
              { type: 'image_url', image_url: { url: 'https://example.com/a.png' } },
            ],
          },
        ],
      }),
    ).rejects.toThrow(/图片模型配置不可用/)

    const managedBase: KnowledgeModelPort = {
      ...base,
      identity: () => 'managed-base',
    }
    const managed = createVisionModelAssembly({
      dataDir: dir,
      safeStorage: safeStorage(),
      assertActive: () => {},
      modelSource: () => 'managed',
    }).wrap(managedBase)
    expect(managed.identity?.()).toBe('managed-base')
    expect(await managed.complete({ messages: [{ role: 'user', content: '托管文字' }] })).toBe(
      'base text',
    )
  })
})

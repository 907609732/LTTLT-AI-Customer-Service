// @vitest-environment node
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { KnowledgeModelPort } from '../electron/knowledge-runtime'
import type { ModelMessages } from '../electron/context-compression'
import { VisionModelSettingsStore, type VisionSafeStorage } from '../electron/vision-model-settings'
import { VisionModelRuntime, type VisionTraceEvent } from '../electron/vision-model-runtime'
import { createKnowledgeRepository } from '../electron/knowledge'
import { createKnowledgeLearner } from '../electron/knowledge/learning'
import { VISION_VERIFICATION_SUITE_VERSION } from '../electron/vision-model-verification'
import type { VisionModelSettingsView } from '../src/shared/contracts/vision'

const cleanup: (() => void)[] = []
afterEach(() => {
  for (const remove of cleanup.splice(0).reverse()) remove()
})

function directory(): string {
  const value = mkdtempSync(join(tmpdir(), 'vision-route-'))
  cleanup.push(() => rmSync(value, { recursive: true, force: true }))
  return value
}

const safeStorage: VisionSafeStorage = {
  isEncryptionAvailable: () => true,
  encryptString: (value) => Buffer.from(`sealed:${value}`, 'utf8'),
  decryptString: (value) => {
    const text = value.toString('utf8')
    if (!text.startsWith('sealed:')) throw new Error('invalid ciphertext')
    return text.slice('sealed:'.length)
  },
}

function expected(view: VisionModelSettingsView) {
  return {
    mode: view.snapshot.mode,
    baseUrl: view.snapshot.baseUrl,
    model: view.snapshot.model,
    apiKeyConfigured: view.snapshot.apiKeyConfigured,
    revision: view.revision,
  }
}

interface CapturedCall {
  url: string
  method: string
  authorization: string
  body: unknown
  signal: AbortSignal | null
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('not an object')
  return value as Record<string, unknown>
}

function array(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new Error('not an array')
  return value
}

function responseJson(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function harness(options: { managed?: boolean; assertActive?: () => void } = {}) {
  const root = directory()
  const store = new VisionModelSettingsStore({ dataDir: root, safeStorage })
  const baseComplete = vi.fn<KnowledgeModelPort['complete']>(async () => 'base-text-response')
  const baseVision = vi.fn(() => ({
    supported: true,
    maxImages: 4,
    reason: '沿用文字模型的旧图片能力',
  }))
  const base: KnowledgeModelPort = {
    complete: baseComplete,
    vision: baseVision,
    identity: () => 'text-model-identity',
    minimumIntervalMs: () => 1234,
  }
  const calls: CapturedCall[] = []
  let responder: (call: CapturedCall) => Response | Promise<Response> = () =>
    responseJson({ choices: [{ message: { content: '红色、蓝色' } }] })
  const request: typeof fetch = async (input, init) => {
    const headers = new Headers(init?.headers)
    const call: CapturedCall = {
      url: String(input),
      method: init?.method ?? 'GET',
      authorization: headers.get('authorization') ?? '',
      body: typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined,
      signal: init?.signal ?? null,
    }
    calls.push(call)
    return responder(call)
  }
  const traces: VisionTraceEvent[] = []
  const runtime = new VisionModelRuntime({
    store,
    base,
    modelSource: () => (options.managed ? 'managed' : 'local'),
    assertActive: options.assertActive,
    request,
    onTrace: (event) => traces.push(event),
  })
  function saveCustom(apiKey = 'vision-secret-value'): VisionModelSettingsView {
    return store.save({
      mode: 'custom',
      baseUrl: 'http://127.0.0.1:41801/v1',
      model: 'deepseek-flash',
      apiKey,
      expected: expected(store.view()),
    })
  }
  return {
    root,
    store,
    runtime,
    calls,
    traces,
    baseComplete,
    baseVision,
    saveCustom,
    setResponder(next: typeof responder) {
      responder = next
    },
  }
}

function imageMessages(): ModelMessages {
  return [
    { role: 'system', content: '只输出审核 JSON' },
    {
      role: 'user',
      content: [
        { type: 'text', text: '不可信图片资料' },
        {
          type: 'image_url',
          image_url: { url: `data:image/png;base64,${'A'.repeat(600)}` },
        },
      ],
    },
  ]
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let index = 0; index < 100; index++) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  throw new Error('condition not reached')
}

interface LoopbackRequest {
  path: string
  method: string
  authorization: string
  body: unknown
}

async function closeServer(server: Server): Promise<void> {
  server.closeAllConnections()
  await new Promise<void>((resolve) => server.close(() => resolve()))
}

async function startLoopbackServer(): Promise<{
  baseUrl: string
  requests: LoopbackRequest[]
  server: Server
}> {
  const requests: LoopbackRequest[] = []
  const server = createServer((request, response) => {
    const chunks: Buffer[] = []
    request.on('data', (chunk: Buffer) => chunks.push(chunk))
    request.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8')
      const parsed = body ? (JSON.parse(body) as unknown) : null
      const captured: LoopbackRequest = {
        path: request.url ?? '',
        method: request.method ?? '',
        authorization: request.headers.authorization ?? '',
        body: parsed,
      }
      requests.push(captured)
      if (captured.path.endsWith('/models')) {
        response.writeHead(200, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ data: [{ id: 'deepseek-flash' }] }))
        return
      }
      if (captured.path.endsWith('/chat/completions')) {
        const payload = record(parsed)
        const messages = array(payload.messages)
        const content = messages.flatMap((message) => {
          const value = record(message).content
          return typeof value === 'string' ? [{ type: 'text', text: value }] : array(value)
        })
        const prompt =
          content
            .filter((part) => record(part).type === 'text')
            .map((part) => String(record(part).text ?? ''))
            .find((text) => text.includes('从上到下')) ?? ''
        const image = content.find((part) => record(part).type === 'image_url')
        const imageUrl =
          image && typeof record(record(image).image_url).url === 'string'
            ? String(record(record(image).image_url).url)
            : ''
        const hasImage = imageUrl.startsWith('data:image/png;base64,') && imageUrl.length > 500
        response.writeHead(200, { 'content-type': 'application/json' })
        if (!hasImage) {
          response.end(
            JSON.stringify({ choices: [{ message: { content: '这里没有可核对的图片' } }] }),
          )
        } else if (String(prompt).includes('从上到下')) {
          // mock 依据固定 fixture 的上下红蓝顺序回答，不在 prompt 中读取答案。
          response.end(JSON.stringify({ choices: [{ message: { content: '红色、蓝色' } }] }))
        } else {
          response.end(JSON.stringify({ choices: [{ message: { content: '{"candidates":[]}' } }] }))
        }
        return
      }
      response.writeHead(404)
      response.end()
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address() as AddressInfo
  return { baseUrl: `http://127.0.0.1:${address.port}`, requests, server }
}

async function startHangingModelsServer(): Promise<{
  baseUrl: string
  server: Server
  requestSeen: Promise<void>
}> {
  let seen: (() => void) | undefined
  const requestSeen = new Promise<void>((resolve) => {
    seen = resolve
  })
  const server = createServer((request, response) => {
    request.resume()
    response.writeHead(200, { 'content-type': 'application/json' })
    response.write('{"data":[')
    response.flushHeaders()
    seen?.()
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address() as AddressInfo
  return { baseUrl: `http://127.0.0.1:${address.port}`, server, requestSeen }
}

describe('独立图片模型连接与路由', () => {
  it('固定合成图验证发送真实 OpenAI 兼容图片 body，只接受可核对答案', async () => {
    const fixture = harness()
    fixture.saveCustom()
    const verified = await fixture.runtime.verify()
    expect(verified).toMatchObject({ ok: true, status: 'verified' })
    const call = fixture.calls[0]!
    expect(call.url).toBe('http://127.0.0.1:41801/v1/chat/completions')
    expect(call.method).toBe('POST')
    expect(call.authorization).toBe('Bearer vision-secret-value')
    const body = record(call.body)
    expect(body.model).toBe('deepseek-flash')
    const messages = array(body.messages)
    const content = array(record(messages[0]).content)
    expect(content.some((part) => record(part).type === 'text')).toBe(true)
    const image = content.find((part) => record(part).type === 'image_url')
    expect(image).toBeTruthy()
    const url = record(record(image!).image_url).url
    expect(typeof url).toBe('string')
    expect(String(url)).toMatch(/^data:image\/png;base64,/)
    expect(String(url).length).toBeGreaterThan(500)
  })

  it('验证提示不泄露颜色答案，只返回单一颜色或普通文字都不算验证', async () => {
    const fixture = harness()
    fixture.saveCustom()
    const verified = await fixture.runtime.verify()
    expect(verified.ok).toBe(true)
    const body = record(fixture.calls[0]!.body)
    const content = array(record(array(body.messages)[0]).content)
    const prompt = String(record(content.find((part) => record(part).type === 'text')).text)
    expect(prompt).toContain('从上到下')
    expect(prompt).not.toMatch(/红色|蓝色|red|blue/i)

    const ignored = harness()
    ignored.saveCustom()
    ignored.setResponder(() => responseJson({ choices: [{ message: { content: '红色' } }] }))
    const failed = await ignored.runtime.verify()
    expect(failed).toMatchObject({ ok: false, status: 'failed' })
    expect(() => ignored.store.resolveCustomRoute(true)).toThrow(/验证/)
  })

  it('普通连接成功不授予图片验证，图片学习仍被明确拒绝', async () => {
    const fixture = harness()
    fixture.saveCustom()
    fixture.setResponder(() => responseJson({ data: [{ id: 'deepseek-flash' }] }))
    const probed = await fixture.runtime.probe()
    expect(probed.ok).toBe(true)
    expect(fixture.calls).toHaveLength(1)
    expect(fixture.calls[0]!.url).toBe('http://127.0.0.1:41801/v1/models')
    expect(fixture.store.snapshot().status).toBe('unverified')
    await expect(
      fixture.runtime.knowledgePort().complete({ messages: imageMessages() }),
    ).rejects.toThrow(/验证/)
    expect(fixture.calls).toHaveLength(1)
    expect(fixture.baseComplete).not.toHaveBeenCalled()
  })

  it('忽略图片只返回任意文字时图片验证失败，不能把文字成功冒充识图', async () => {
    const fixture = harness()
    fixture.saveCustom()
    fixture.setResponder(() =>
      responseJson({
        choices: [{ message: { content: '我已阅读你的请求，但这里不便展示图片。' } }],
      }),
    )
    const verified = await fixture.runtime.verify()
    expect(verified).toMatchObject({ ok: false, status: 'failed' })
    expect(fixture.store.snapshot().status).toBe('failed')
    await expect(
      fixture.runtime.knowledgePort().complete({ messages: imageMessages() }),
    ).rejects.toThrow(/验证/)
    expect(fixture.baseComplete).not.toHaveBeenCalled()
  })

  it('已验证自定义图片请求走独立视觉端点，文字请求仍原样走文字端口', async () => {
    const fixture = harness()
    fixture.saveCustom()
    await fixture.runtime.verify()
    fixture.calls.length = 0
    fixture.setResponder(() =>
      responseJson({ choices: [{ message: { content: '{"candidates":[]}' } }] }),
    )
    const port = fixture.runtime.knowledgePort()
    await expect(port.complete({ messages: imageMessages() })).resolves.toBe('{"candidates":[]}')
    expect(fixture.baseComplete).not.toHaveBeenCalled()
    expect(fixture.calls).toHaveLength(1)
    expect(fixture.calls[0]!.authorization).toBe('Bearer vision-secret-value')
    expect(JSON.stringify(fixture.calls[0]!.body)).toContain('"image_url"')

    fixture.calls.length = 0
    const textMessages: ModelMessages = [{ role: 'user', content: '纯文字学习资料' }]
    await expect(port.complete({ messages: textMessages })).resolves.toBe('base-text-response')
    expect(fixture.baseComplete).toHaveBeenCalledTimes(1)
    expect(fixture.baseComplete).toHaveBeenCalledWith({ messages: textMessages })
    expect(fixture.calls).toHaveLength(0)
    expect(JSON.stringify(fixture.baseComplete.mock.calls)).not.toContain('vision-secret-value')
  })

  it('托管模式即使本机存在已验证视觉配置也只传原托管端口', async () => {
    const fixture = harness({ managed: true })
    fixture.saveCustom()
    await fixture.runtime.verify()
    fixture.calls.length = 0
    await expect(
      fixture.runtime.knowledgePort().complete({ messages: imageMessages() }),
    ).resolves.toBe('base-text-response')
    expect(fixture.baseComplete).toHaveBeenCalledTimes(1)
    expect(fixture.calls).toHaveLength(0)
    expect(fixture.runtime.vision()).toEqual({
      supported: true,
      maxImages: 4,
      reason: '沿用文字模型的旧图片能力',
    })
  })

  it('缺文件继承沿用原图片能力但明确标为未独立验证，文字和图片仍走原端口', async () => {
    const fixture = harness()
    expect(fixture.store.snapshot().status).toBe('inherit')
    expect(fixture.runtime.vision().reason).toContain('未独立验证')
    await expect(
      fixture.runtime.knowledgePort().complete({ messages: imageMessages() }),
    ).resolves.toBe('base-text-response')
    expect(fixture.baseComplete).toHaveBeenCalledTimes(1)
    expect(fixture.calls).toHaveLength(0)
  })

  it('自定义视觉失败明确报错，不静默回退文字模型', async () => {
    const fixture = harness()
    fixture.saveCustom()
    await fixture.runtime.verify()
    fixture.setResponder(() => {
      throw new Error('visual endpoint offline')
    })
    const error = await fixture.runtime
      .knowledgePort()
      .complete({ messages: imageMessages() })
      .catch((reason: unknown) => reason)
    expect(error).toBeInstanceOf(Error)
    expect(String(error)).toMatch(/视觉模型/)
    expect(String(error)).not.toContain('vision-secret-value')
    expect(fixture.baseComplete).not.toHaveBeenCalled()
  })

  it('迟到图片验证结果在配置保存后不能写入新配置', async () => {
    const fixture = harness()
    const initial = fixture.saveCustom()
    let release: ((value: Response) => void) | undefined
    fixture.setResponder(
      () =>
        new Promise<Response>((resolve) => {
          release = resolve
        }),
    )
    const verification = fixture.runtime.verify()
    await waitFor(() => fixture.calls.length === 1)
    fixture.store.save({
      mode: 'custom',
      baseUrl: 'http://127.0.0.1:41801/v2',
      model: 'deepseek-flash',
      expected: expected(initial),
    })
    release?.(responseJson({ choices: [{ message: { content: '红色、蓝色' } }] }))
    await expect(verification).rejects.toThrow(/配置已变化|重新/)
    expect(fixture.store.snapshot().status).not.toBe('verified')
  })

  it('迟到图片响应不能越过代次检查进入学习 received 检查点', async () => {
    const fixture = harness()
    fixture.saveCustom()
    await fixture.runtime.verify()
    const before = fixture.store.view()
    fixture.calls.length = 0
    let release: ((value: Response) => void) | undefined
    fixture.setResponder(
      () =>
        new Promise<Response>((resolve) => {
          release = resolve
        }),
    )
    const port = fixture.runtime.knowledgePort()
    const completion = port.complete({ messages: imageMessages() })
    await waitFor(() => fixture.calls.length === 1)
    fixture.store.save({
      mode: 'custom',
      baseUrl: 'http://127.0.0.1:41801/v2',
      model: 'deepseek-flash',
      expected: expected(before),
    })
    release?.(responseJson({ choices: [{ message: { content: '{"candidates":[]}' } }] }))
    await expect(completion).rejects.toThrow(/配置已变化|重新/)
    expect(fixture.baseComplete).not.toHaveBeenCalled()
  })

  it('workspace 失效后迟到图片响应被丢弃，不进入学习 received 检查点', async () => {
    let active = true
    const fixture = harness({
      assertActive: () => {
        if (!active) throw new Error('workspace 已改变')
      },
    })
    fixture.saveCustom()
    await fixture.runtime.verify()
    fixture.calls.length = 0
    let release: ((value: Response) => void) | undefined
    fixture.setResponder(
      () =>
        new Promise<Response>((resolve) => {
          release = resolve
        }),
    )
    const completion = fixture.runtime.knowledgePort().complete({ messages: imageMessages() })
    await waitFor(() => fixture.calls.length === 1)
    active = false
    release?.(responseJson({ choices: [{ message: { content: '{"candidates":[]}' } }] }))
    await expect(completion).rejects.toThrow(/workspace/)
  })

  it('原端口响应返回前检查 isCurrent，过期结果不会进入学习 received', async () => {
    const fixture = harness()
    let current = true
    fixture.baseComplete.mockImplementation(async () => {
      current = false
      return 'stale-text-response'
    })
    await expect(
      fixture.runtime.knowledgePort().complete({
        messages: [{ role: 'user', content: '文字资料' }],
        isCurrent: () => current,
      }),
    ).rejects.toThrow(/取消/)
  })

  it('图片请求响应 AbortSignal 取消并拒绝返回旧响应', async () => {
    const fixture = harness()
    fixture.saveCustom()
    await fixture.runtime.verify()
    fixture.calls.length = 0
    fixture.setResponder(
      (call) =>
        new Promise<Response>((_resolve, reject) => {
          const abort = () => reject(new Error('aborted by signal'))
          if (call.signal?.aborted) abort()
          else call.signal?.addEventListener('abort', abort, { once: true })
        }),
    )
    const controller = new AbortController()
    const completion = fixture.runtime.knowledgePort().complete({
      messages: imageMessages(),
      signal: controller.signal,
    })
    await waitFor(() => fixture.calls.length === 1)
    controller.abort()
    await expect(completion).rejects.toThrow(/取消/)
  })

  it('图片请求超时不会返回迟到正文', async () => {
    const fixture = harness()
    fixture.saveCustom()
    await fixture.runtime.verify()
    fixture.calls.length = 0
    fixture.setResponder(
      (call) =>
        new Promise<Response>((_resolve, reject) => {
          call.signal?.addEventListener('abort', () => reject(new Error('aborted by timeout')), {
            once: true,
          })
        }),
    )
    await expect(
      fixture.runtime.knowledgePort().complete({
        messages: imageMessages(),
        timeoutMs: 25,
      }),
    ).rejects.toThrow(/超时/)
  })

  it('真实 127.0.0.1 HTTP 服务验证固定图并接收含图学习请求，文字仍走原端口', async () => {
    const loopback = await startLoopbackServer()
    const root = directory()
    try {
      const store = new VisionModelSettingsStore({ dataDir: root, safeStorage })
      const baseComplete = vi.fn<KnowledgeModelPort['complete']>(async () => 'base-text-response')
      const base: KnowledgeModelPort = {
        complete: baseComplete,
        vision: () => ({ supported: true, maxImages: 4, reason: '旧文字模型图片能力' }),
        identity: () => 'text-model',
        minimumIntervalMs: () => 0,
      }
      const traces: VisionTraceEvent[] = []
      const runtime = new VisionModelRuntime({
        store,
        base,
        onTrace: (event) => traces.push(event),
      })
      store.save({
        mode: 'custom',
        baseUrl: `${loopback.baseUrl}/v1`,
        model: 'deepseek-flash',
        apiKey: 'real-loop-key',
        expected: expected(store.view()),
      })
      await expect(runtime.verify()).resolves.toMatchObject({ ok: true, status: 'verified' })
      expect(loopback.requests).toHaveLength(1)
      const verification = loopback.requests[0]!
      expect(verification.path).toBe('/v1/chat/completions')
      expect(verification.authorization).toBe('Bearer real-loop-key')
      const verifyBody = record(verification.body)
      const verifyContent = array(record(array(verifyBody.messages)[0]).content)
      const verifyPrompt = String(
        record(verifyContent.find((part) => record(part).type === 'text')).text,
      )
      expect(verifyPrompt).toContain('从上到下')
      expect(verifyPrompt).not.toMatch(/红色|蓝色|red|blue/i)
      expect(JSON.stringify(verifyBody)).toContain('"image_url"')

      loopback.requests.length = 0
      traces.length = 0
      const port = runtime.knowledgePort()
      await expect(port.complete({ messages: imageMessages() })).resolves.toBe('{"candidates":[]}')
      expect(loopback.requests).toHaveLength(1)
      const learning = loopback.requests[0]!
      expect(learning.path).toBe('/v1/chat/completions')
      expect(learning.authorization).toBe('Bearer real-loop-key')
      expect(JSON.stringify(learning.body)).toContain('"image_url"')
      expect(JSON.stringify(learning.body)).toContain('data:image/png;base64,')

      await expect(
        port.complete({ messages: [{ role: 'user', content: '纯文字学习资料' }] }),
      ).resolves.toBe('base-text-response')
      expect(baseComplete).toHaveBeenCalledTimes(1)
      expect(loopback.requests).toHaveLength(1)
      const visible = JSON.stringify({ snapshot: store.snapshot(), traces })
      expect(visible).not.toContain('real-loop-key')
      expect(visible).not.toContain('ciphertext')
      expect(visible).not.toContain('revision')
    } finally {
      await closeServer(loopback.server)
    }
  })

  it('真实双端口跨 origin 换 Key：未重输 Key 不发往 B，新 Key 只进入 B', async () => {
    const serverA = await startLoopbackServer()
    const serverB = await startLoopbackServer()
    const root = directory()
    try {
      const store = new VisionModelSettingsStore({ dataDir: root, safeStorage })
      const base: KnowledgeModelPort = {
        complete: async () => 'base-text-response',
        vision: () => ({ supported: true, maxImages: 4, reason: '旧文字模型图片能力' }),
      }
      const runtime = new VisionModelRuntime({ store, base })
      store.save({
        mode: 'custom',
        baseUrl: `${serverA.baseUrl}/v1`,
        model: 'deepseek-flash',
        apiKey: 'key-a-only',
        expected: expected(store.view()),
      })
      await runtime.verify()
      expect(serverA.requests).toHaveLength(1)
      const loaded = store.view()
      expect(() =>
        store.save({
          mode: 'custom',
          baseUrl: `${serverB.baseUrl}/v1`,
          model: 'deepseek-flash',
          expected: expected(loaded),
        }),
      ).toThrow(/重新输入/)
      expect(serverB.requests).toHaveLength(0)
      expect(store.snapshot().baseUrl).toBe(`${serverA.baseUrl}/v1`)
      expect(store.resolveCustomRoute(false).apiKey).toBe('key-a-only')

      store.save({
        mode: 'custom',
        baseUrl: `${serverB.baseUrl}/v1`,
        model: 'deepseek-flash',
        apiKey: 'key-b-only',
        expected: expected(store.view()),
      })
      await runtime.verify()
      expect(serverB.requests).toHaveLength(1)
      expect(serverB.requests[0]!.authorization).toBe('Bearer key-b-only')
      expect(serverA.requests.map((request) => request.authorization)).not.toContain(
        'Bearer key-b-only',
      )
    } finally {
      await Promise.all([closeServer(serverA.server), closeServer(serverB.server)])
    }
  })

  it('真实双端口 A→inherit 空→B/空 Key 拒绝，显式 Key 才可 B', async () => {
    const serverA = await startLoopbackServer()
    const serverB = await startLoopbackServer()
    const root = directory()
    try {
      const store = new VisionModelSettingsStore({ dataDir: root, safeStorage })
      const runtime = new VisionModelRuntime({
        store,
        base: {
          complete: async () => 'base-text-response',
          vision: () => ({ supported: true, maxImages: 4, reason: '旧文字模型图片能力' }),
        },
      })
      store.save({
        mode: 'custom',
        baseUrl: `${serverA.baseUrl}/v1`,
        model: 'deepseek-flash',
        apiKey: 'inherit-key-a',
        expected: expected(store.view()),
      })
      await runtime.verify()
      expect(serverA.requests).toHaveLength(1)
      const inherited = store.save({
        mode: 'inherit',
        baseUrl: '',
        model: '',
        expected: expected(store.view()),
      })
      expect(inherited.snapshot).toMatchObject({ mode: 'inherit', apiKeyConfigured: true })
      expect(() =>
        store.save({
          mode: 'custom',
          baseUrl: `${serverB.baseUrl}/v1`,
          model: 'deepseek-flash',
          expected: expected(inherited),
        }),
      ).toThrow(/重新输入|归属/)
      expect(serverB.requests).toHaveLength(0)
      expect(serverA.requests.map((request) => request.authorization)).not.toContain(
        'Bearer inherit-key-b',
      )

      store.save({
        mode: 'custom',
        baseUrl: `${serverB.baseUrl}/v1`,
        model: 'deepseek-flash',
        apiKey: 'inherit-key-b',
        expected: expected(inherited),
      })
      await runtime.verify()
      expect(serverB.requests).toHaveLength(1)
      expect(serverB.requests[0]!.authorization).toBe('Bearer inherit-key-b')
      expect(serverA.requests.map((request) => request.authorization)).not.toContain(
        'Bearer inherit-key-b',
      )
    } finally {
      await Promise.all([closeServer(serverA.server), closeServer(serverB.server)])
    }
  })

  it('真实双端口旧文件 baseUrl=B/KeyA无origin：probe/verify/图片均 0 上游，重输后才可用', async () => {
    const serverA = await startLoopbackServer()
    const serverB = await startLoopbackServer()
    const root = directory()
    try {
      const store = new VisionModelSettingsStore({ dataDir: root, safeStorage })
      const base: KnowledgeModelPort = {
        complete: async () => 'base-text-response',
        vision: () => ({ supported: true, maxImages: 4, reason: '旧文字模型图片能力' }),
      }
      const runtime = new VisionModelRuntime({ store, base })
      store.save({
        mode: 'custom',
        baseUrl: `${serverA.baseUrl}/v1`,
        model: 'deepseek-flash',
        apiKey: 'migration-key-a',
        expected: expected(store.view()),
      })
      const file = join(root, 'vision-model.json')
      const keyA = (JSON.parse(readFileSync(file, 'utf8')) as { key: { ciphertext: string } }).key
        .ciphertext
      store.save({
        mode: 'custom',
        baseUrl: `${serverB.baseUrl}/v1`,
        model: 'deepseek-flash',
        apiKey: 'migration-key-b-old',
        expected: expected(store.view()),
      })
      await runtime.verify()
      expect(serverB.requests).toHaveLength(1)
      const raw = JSON.parse(readFileSync(file, 'utf8')) as {
        key: { ciphertext: string; origin?: string }
        verify?: { suite?: number }
      }
      expect(raw.verify?.suite).toBe(VISION_VERIFICATION_SUITE_VERSION)
      raw.key.ciphertext = keyA
      delete raw.key.origin
      writeFileSync(file, JSON.stringify(raw))

      const migrated = new VisionModelSettingsStore({ dataDir: root, safeStorage })
      expect(migrated.snapshot()).toMatchObject({
        mode: 'custom',
        baseUrl: `${serverB.baseUrl}/v1`,
        apiKeyConfigured: true,
        status: 'stale',
      })
      expect(migrated.snapshot().reason).toContain('来源未知')
      const migratedRuntime = new VisionModelRuntime({ store: migrated, base })
      const beforeB = serverB.requests.length
      const beforeA = serverA.requests.length
      await expect(migratedRuntime.probe()).resolves.toMatchObject({ ok: false })
      await expect(migratedRuntime.verify()).rejects.toThrow(/来源未知/)
      await expect(
        migratedRuntime.knowledgePort().complete({ messages: imageMessages() }),
      ).rejects.toThrow(/来源未知|验证/)
      expect(serverB.requests).toHaveLength(beforeB)
      expect(serverA.requests).toHaveLength(beforeA)

      migrated.save({
        mode: 'custom',
        baseUrl: `${serverB.baseUrl}/v1`,
        model: 'deepseek-flash',
        apiKey: 'migration-key-b-new',
        expected: expected(migrated.view()),
      })
      await expect(migratedRuntime.verify()).resolves.toMatchObject({
        ok: true,
        status: 'verified',
      })
      expect(serverB.requests).toHaveLength(beforeB + 1)
      expect(serverB.requests.at(-1)!.authorization).toBe('Bearer migration-key-b-new')
      expect(serverA.requests.map((request) => request.authorization)).not.toContain(
        'Bearer migration-key-b-new',
      )
    } finally {
      await Promise.all([closeServer(serverA.server), closeServer(serverB.server)])
    }
  })

  it('同源 A→B→A 回到旧端点也不自动复活验证，图片请求零上游', async () => {
    const loopback = await startLoopbackServer()
    const root = directory()
    try {
      const store = new VisionModelSettingsStore({ dataDir: root, safeStorage })
      const base: KnowledgeModelPort = {
        complete: async () => 'base-text-response',
        vision: () => ({ supported: true, maxImages: 4, reason: '旧文字模型图片能力' }),
      }
      const runtime = new VisionModelRuntime({ store, base })
      store.save({
        mode: 'custom',
        baseUrl: `${loopback.baseUrl}/v1`,
        model: 'deepseek-flash',
        apiKey: 'loop-key',
        expected: expected(store.view()),
      })
      await runtime.verify()
      let view = store.save({
        mode: 'custom',
        baseUrl: `${loopback.baseUrl}/v2`,
        model: 'deepseek-flash',
        expected: expected(store.view()),
      })
      expect(view.snapshot.status).toBe('unverified')
      view = store.save({
        mode: 'custom',
        baseUrl: `${loopback.baseUrl}/v1`,
        model: 'deepseek-flash',
        expected: expected(store.view()),
      })
      expect(view.snapshot.status).toBe('unverified')
      loopback.requests.length = 0
      await expect(runtime.knowledgePort().complete({ messages: imageMessages() })).rejects.toThrow(
        /验证/,
      )
      expect(loopback.requests).toHaveLength(0)
    } finally {
      await closeServer(loopback.server)
    }
  })

  it('旧 suite1 记录同 owner/digest 仍 stale，重新验证写 suite2 前 0 上游', async () => {
    const root = directory()
    const firstStore = new VisionModelSettingsStore({ dataDir: root, safeStorage })
    const firstRuntime = new VisionModelRuntime({
      store: firstStore,
      base: {
        complete: async () => 'base',
        vision: () => ({ supported: true, maxImages: 4, reason: 'base' }),
      },
      request: async () => responseJson({ choices: [{ message: { content: '红色、蓝色' } }] }),
    })
    firstStore.save({
      mode: 'custom',
      baseUrl: 'http://127.0.0.1:41801/v1',
      model: 'deepseek-flash',
      apiKey: 'suite-key',
      expected: expected(firstStore.view()),
    })
    await firstRuntime.verify()
    const file = join(root, 'vision-model.json')
    const raw = JSON.parse(readFileSync(file, 'utf8')) as {
      verify?: { suite?: number }
    }
    expect(raw.verify?.suite).toBe(VISION_VERIFICATION_SUITE_VERSION)
    if (raw.verify) raw.verify.suite = 1
    writeFileSync(file, JSON.stringify(raw))

    const reloaded = new VisionModelSettingsStore({ dataDir: root, safeStorage })
    expect(reloaded.snapshot()).toMatchObject({
      mode: 'custom',
      apiKeyConfigured: true,
      status: 'stale',
    })
    expect(reloaded.snapshot().reason).toContain('验证方式')
    const calls: string[] = []
    const baseComplete = vi.fn<KnowledgeModelPort['complete']>(async () => 'base')
    const runtime = new VisionModelRuntime({
      store: reloaded,
      base: {
        complete: baseComplete,
        vision: () => ({ supported: true, maxImages: 4, reason: 'base' }),
      },
      request: async (input, init) => {
        calls.push(String(input))
        const body = String(init?.body ?? '')
        return responseJson({
          choices: [
            {
              message: {
                content: body.includes('从上到下') ? '红色、蓝色' : '{"candidates":[]}',
              },
            },
          ],
        })
      },
    })
    await expect(runtime.knowledgePort().complete({ messages: imageMessages() })).rejects.toThrow(
      /验证方式|重新验证/,
    )
    expect(calls).toHaveLength(0)
    expect(baseComplete).not.toHaveBeenCalled()
    await expect(runtime.verify()).resolves.toMatchObject({ ok: true, status: 'verified' })
    expect(
      (JSON.parse(readFileSync(file, 'utf8')) as { verify?: { suite?: number } }).verify?.suite,
    ).toBe(VISION_VERIFICATION_SUITE_VERSION)
    expect(runtime.vision().supported).toBe(true)
    calls.length = 0
    await expect(runtime.knowledgePort().complete({ messages: imageMessages() })).resolves.toBe(
      '{"candidates":[]}',
    )
    expect(calls).toHaveLength(1)
  })

  it('probe 在响应头已到、body 挂起时取消仍能在有限时间结束', async () => {
    const hanging = await startHangingModelsServer()
    const root = directory()
    try {
      const store = new VisionModelSettingsStore({ dataDir: root, safeStorage })
      store.save({
        mode: 'custom',
        baseUrl: hanging.baseUrl,
        model: 'deepseek-flash',
        apiKey: 'hang-key',
        expected: expected(store.view()),
      })
      const runtime = new VisionModelRuntime({
        store,
        base: {
          complete: async () => 'base',
          vision: () => ({ supported: true, maxImages: 4, reason: 'base' }),
        },
      })
      const controller = new AbortController()
      const probing = runtime.probe({ signal: controller.signal })
      await Promise.race([
        hanging.requestSeen,
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('server request not observed')), 1000),
        ),
      ])
      await new Promise((resolve) => setTimeout(resolve, 30))
      controller.abort()
      const outcome = await Promise.race([
        probing.then(
          () => ({ kind: 'resolved' as const }),
          () => ({ kind: 'rejected' as const }),
        ),
        new Promise<{ kind: 'timeout' }>((resolve) =>
          setTimeout(() => resolve({ kind: 'timeout' }), 1000),
        ),
      ])
      expect(outcome.kind).toBe('rejected')
    } finally {
      await closeServer(hanging.server)
    }
  })

  it('identity 包含内部配置代次且不含 Key，用量 trace 只记录安全字段', async () => {
    const fixture = harness()
    const initialIdentity = fixture.runtime.knowledgePort().identity?.()
    fixture.saveCustom()
    const savedIdentity = fixture.runtime.knowledgePort().identity?.()
    expect(savedIdentity).not.toBe(initialIdentity)
    expect(savedIdentity).not.toContain('vision-secret-value')
    await fixture.runtime.verify()
    const verifiedIdentity = fixture.runtime.knowledgePort().identity?.()
    expect(verifiedIdentity).not.toBe(savedIdentity)
    expect(fixture.runtime.knowledgePort().minimumIntervalMs?.()).toBe(1234)

    fixture.calls.length = 0
    fixture.traces.length = 0
    fixture.setResponder(() =>
      responseJson({
        choices: [{ message: { content: '{"candidates":[]}' } }],
        usage: { prompt_tokens: 17, completion_tokens: 3, total_tokens: 20 },
      }),
    )
    await fixture.runtime.knowledgePort().complete({
      messages: imageMessages(),
      traceId: 'trace-learning-1',
    })
    expect(fixture.traces).toEqual([
      {
        traceId: 'trace-learning-1',
        model: 'deepseek-flash',
        usage: { promptTokens: 17, completionTokens: 3, totalTokens: 20 },
      },
    ])
    expect(JSON.stringify(fixture.traces)).not.toContain('vision-secret-value')
  })

  it('真实学习器含图请求通过包装端口进入视觉 HTTP body', async () => {
    const fixture = harness()
    fixture.saveCustom()
    await fixture.runtime.verify()
    const repo = createKnowledgeRepository({ directory: fixture.root, workspaceId: 'vision-route' })
    cleanup.push(() => repo.dispose())
    const canonical = repo.saveCanonical({ title: '视觉学习测试' })
    const binding = repo.bindProduct({
      canonicalId: canonical.id,
      storeId: 'store-1',
      productId: 'product-1',
    })
    const asset = repo.addAsset(
      Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
        'base64',
      ),
      { name: 'probe.png', mimeType: 'image/png' },
    )
    const source = repo.saveSource({
      storeId: 'store-1',
      bindingId: binding.id,
      kind: 'image',
      label: '固定测试图',
      text: '',
      locator: { imageAssetId: asset.id, tile: 1 },
      assetIds: [asset.id],
    })
    fixture.calls.length = 0
    fixture.setResponder(() =>
      responseJson({ choices: [{ message: { content: '{"candidates":[]}' } }] }),
    )
    const learner = createKnowledgeLearner({
      repository: repo,
      assertActive() {},
      changed() {},
      model: fixture.runtime.knowledgePort(),
    })
    cleanup.push(() => learner.dispose())
    const estimate = await learner.estimate('store-1', [binding.id], [source.id])
    const job = await learner.start('store-1', [binding.id], [source.id], estimate.estimateId)
    let settled = repo.getJob(job.jobId)!
    for (let index = 0; index < 100 && ['queued', 'running'].includes(settled.status); index++) {
      await new Promise((resolve) => setTimeout(resolve, 10))
      settled = repo.getJob(job.jobId)!
    }
    expect(settled.status).toBe('succeeded')
    expect(fixture.calls).toHaveLength(1)
    expect(JSON.stringify(fixture.calls[0]!.body)).toContain('data:image/png;base64,')
  })
})

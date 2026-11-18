// @vitest-environment node
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { KnowledgeModelPort } from '../electron/knowledge-runtime'
import type { ModelMessages } from '../electron/context-compression'
import { VisionModelSettingsStore, type VisionSafeStorage } from '../electron/vision-model-settings'
import { VisionModelRuntime, type VisionTraceEvent } from '../electron/vision-model-runtime'
import { createKnowledgeRepository } from '../electron/knowledge'
import { createKnowledgeLearner } from '../electron/knowledge/learning'
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
    responseJson({ choices: [{ message: { content: '红色' } }] })
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
          image_url: { url: 'data:image/png;base64,AAAA' },
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
    await expect(
      fixture.runtime.knowledgePort().complete({ messages: imageMessages() }),
    ).rejects.toThrow(/视觉模型/)
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
      baseUrl: 'http://127.0.0.1:41802/v1',
      model: 'deepseek-flash',
      expected: expected(initial),
    })
    release?.(responseJson({ choices: [{ message: { content: '红色' } }] }))
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
      baseUrl: 'http://127.0.0.1:41803/v1',
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

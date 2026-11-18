import { deflateSync } from 'node:zlib'
import type { KnowledgeModelPort } from './knowledge-runtime'
import type { ModelMessages } from './context-compression'
import { listCustomModels } from './list-custom-models'
import type { VisionCustomRoute, VisionVerificationTicket } from './vision-model-settings'
import type { VisionModelSettingsStore } from './vision-model-settings'
import type {
  VisionModelProbeResult,
  VisionModelVerifyResult,
} from '../src/shared/contracts/vision'

type CompleteInput = Parameters<KnowledgeModelPort['complete']>[0]
type VisionResult = ReturnType<KnowledgeModelPort['vision']>

export interface VisionTraceUsage {
  promptTokens?: number
  completionTokens?: number
  totalTokens?: number
}

/** 可供现有日志/诊断端口消费的安全投影；不包含请求头、Key、图片或响应原文。 */
export interface VisionTraceEvent {
  traceId?: string
  model: string
  usage?: VisionTraceUsage
}

interface ChatCompletionResponse {
  text: string
  usage?: VisionTraceUsage
}

interface CombinedSignal {
  signal: AbortSignal
  cleanup(): void
  timedOut(): boolean
  externalAborted(): boolean
}

class VisionRequestError extends Error {
  constructor(
    message: string,
    readonly kind: 'aborted' | 'timeout' | 'network' | 'http' | 'invalid',
  ) {
    super(message)
  }
}

const SUITE_VERSION = 1
const DEFAULT_TIMEOUT_MS = 60_000
const MAX_TIMEOUT_MS = 120_000

function combineSignals(signal: AbortSignal | undefined, timeoutMs: number): CombinedSignal {
  const controller = new AbortController()
  let timedOut = false
  const externalAborted = () => signal?.aborted === true
  const abort = () => controller.abort()
  if (externalAborted()) controller.abort()
  else signal?.addEventListener('abort', abort, { once: true })
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, timeoutMs)
  return {
    signal: controller.signal,
    cleanup() {
      clearTimeout(timer)
      signal?.removeEventListener('abort', abort)
    },
    timedOut: () => timedOut,
    externalAborted,
  }
}

function mergedSignal(signals: (AbortSignal | null | undefined)[]): {
  signal: AbortSignal
  cleanup(): void
} {
  const controller = new AbortController()
  const active = signals.filter((signal): signal is AbortSignal => Boolean(signal))
  const abort = () => controller.abort()
  for (const signal of active) {
    if (signal.aborted) controller.abort()
    else signal.addEventListener('abort', abort, { once: true })
  }
  return {
    signal: controller.signal,
    cleanup() {
      for (const signal of active) signal.removeEventListener('abort', abort)
    },
  }
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new VisionRequestError('视觉模型响应格式无效', 'invalid')
  return value as Record<string, unknown>
}

function rows(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new VisionRequestError('视觉模型响应格式无效', 'invalid')
  return value
}

function numeric(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function usageOf(value: unknown): VisionTraceUsage | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const usage = value as Record<string, unknown>
  const promptTokens = numeric(usage.prompt_tokens)
  const completionTokens = numeric(usage.completion_tokens)
  const totalTokens = numeric(usage.total_tokens)
  if (promptTokens === undefined && completionTokens === undefined && totalTokens === undefined)
    return undefined
  return {
    ...(promptTokens === undefined ? {} : { promptTokens }),
    ...(completionTokens === undefined ? {} : { completionTokens }),
    ...(totalTokens === undefined ? {} : { totalTokens }),
  }
}

function contentText(value: unknown): string {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) {
    const parts: string[] = []
    for (const part of value) {
      if (part && typeof part === 'object' && !Array.isArray(part)) {
        const text = (part as Record<string, unknown>).text
        if (typeof text === 'string') parts.push(text)
      }
    }
    if (parts.length) return parts.join('')
  }
  throw new VisionRequestError('视觉模型没有返回可核对文本', 'invalid')
}

function hasImage(messages: ModelMessages): boolean {
  return messages.some(
    (message) =>
      typeof message.content !== 'string' &&
      message.content.some((part) => part.type === 'image_url'),
  )
}

function failureMessage(error: unknown): string {
  return error instanceof Error ? error.message : '图片模型操作失败'
}

/**
 * 固定 64×64 合成 PNG，仅用于用户显式点击的图片能力探针。
 * 图像内容全部为红色系，可核对答案，不包含客户图片或外部资源。
 */
function verifyPng(): Buffer {
  const width = 64
  const height = 64
  const stride = width * 4 + 1
  const pixels = Buffer.alloc(stride * height)
  for (let y = 0; y < height; y++) {
    pixels[y * stride] = 0
    for (let x = 0; x < width; x++) {
      const offset = y * stride + 1 + x * 4
      // 轻微变化的红色像素避免压缩成极小常量，同时保持答案唯一为“红色”。
      pixels[offset] = 235 + ((x * 7 + y * 11) % 21)
      pixels[offset + 1] = (x * 3 + y * 5) % 18
      pixels[offset + 2] = (x * 5 + y * 2) % 15
      pixels[offset + 3] = 255
    }
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header[8] = 8
  header[9] = 6
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  return Buffer.concat([
    signature,
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(pixels, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ])
}

function pngChunk(type: string, data: Buffer): Buffer {
  const name = Buffer.from(type, 'ascii')
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length, 0)
  const checksum = Buffer.alloc(4)
  checksum.writeUInt32BE(crc32(Buffer.concat([name, data])), 0)
  return Buffer.concat([length, name, data, checksum])
}

let crcTable: Uint32Array | undefined
function crc32(value: Buffer): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256)
    for (let index = 0; index < 256; index++) {
      let current = index
      for (let bit = 0; bit < 8; bit++)
        current = current & 1 ? 0xedb88320 ^ (current >>> 1) : current >>> 1
      crcTable[index] = current >>> 0
    }
  }
  let crc = 0xffffffff
  for (const byte of value) crc = crcTable[(crc ^ byte) & 0xff]! ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function answerMatches(value: string): boolean {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/^["'“”‘’]+|["'“”‘’]+$/g, '')
    .replace(/[。.!！\s]+$/g, '')
  return normalized === '红色' || normalized === 'red'
}

/**
 * 知识模型端口包装器。本类只用于现有 knowledge model 注入点：
 * - 图片请求仅在 local + custom + 当前验证有效时去独立端点；
 * - 文本、inherit 和 managed 始终委托原端口；
 * - 不按模型名称推断、不静默回退，且返回前复核代次、workspace 与 isCurrent。
 */
export class VisionModelRuntime {
  private readonly store: VisionModelSettingsStore
  private readonly base: KnowledgeModelPort
  private readonly modelSource: () => 'local' | 'managed'
  private readonly assertActive: () => void
  private readonly request: typeof fetch
  private readonly timeoutMs: number
  private readonly onTrace?: (event: VisionTraceEvent) => void

  constructor(options: {
    store: VisionModelSettingsStore
    base: KnowledgeModelPort
    modelSource?: () => 'local' | 'managed'
    assertActive?: () => void
    request?: typeof fetch
    timeoutMs?: number
    onTrace?: (event: VisionTraceEvent) => void
  }) {
    this.store = options.store
    this.base = options.base
    this.modelSource = options.modelSource ?? (() => 'local')
    this.assertActive = options.assertActive ?? (() => {})
    this.request = options.request ?? fetch
    this.timeoutMs = Math.max(1, Math.min(MAX_TIMEOUT_MS, options.timeoutMs ?? DEFAULT_TIMEOUT_MS))
    this.onTrace = options.onTrace
  }

  knowledgePort(): KnowledgeModelPort {
    return {
      complete: (input) => this.complete(input),
      vision: () => this.vision(),
      identity: () => this.identity(),
      minimumIntervalMs: () => this.base.minimumIntervalMs?.() ?? 0,
    }
  }

  private assertReturnAllowed(
    generation: number,
    isCurrent?: () => boolean,
    signal?: AbortSignal,
  ): void {
    if (signal?.aborted || isCurrent?.() === false) throw new Error('知识任务已取消')
    this.assertActive()
    if (this.store.generation() !== generation)
      throw new Error('图片模型配置已变化，请重新估算学习计划后重试')
  }

  private trace(event: VisionTraceEvent): void {
    try {
      this.onTrace?.(event)
    } catch {
      // 诊断端口不能改变实际模型结果或把已付费响应变成可重试失败。
    }
  }

  private async chatCompletion(
    route: VisionCustomRoute,
    input: CompleteInput,
    maxTokens: number,
    timeoutMs: number,
    traceId?: string,
  ): Promise<ChatCompletionResponse> {
    if (input.signal?.aborted) throw new Error('视觉模型请求已取消')
    const combined = combineSignals(input.signal, timeoutMs)
    try {
      const endpoint = new URL(`${route.baseUrl}/chat/completions`)
      let response: Response
      try {
        response = await this.request(endpoint, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${route.apiKey}`,
            Accept: 'application/json',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: route.model,
            messages: input.messages,
            max_tokens: maxTokens,
            stream: false,
          }),
          redirect: 'error',
          signal: combined.signal,
        })
      } catch {
        if (combined.externalAborted()) throw new Error('视觉模型请求已取消')
        if (combined.timedOut()) throw new Error('视觉模型请求超时')
        throw new Error('视觉模型请求失败，请检查端点、网络或服务状态')
      }
      if (!response.ok) throw new Error(`视觉模型请求失败（HTTP ${response.status}）`)
      let body: unknown
      try {
        body = await response.json()
      } catch {
        if (combined.externalAborted()) throw new Error('视觉模型请求已取消')
        if (combined.timedOut()) throw new Error('视觉模型请求超时')
        throw new Error('视觉模型响应不是有效 JSON')
      }
      const payload = record(body)
      const choice = rows(payload.choices)[0]
      const message = record(record(choice).message)
      const text = contentText(message.content)
      const usage = usageOf(payload.usage)
      this.trace({
        ...(traceId ? { traceId } : {}),
        model: route.model,
        ...(usage ? { usage } : {}),
      })
      return { text, ...(usage ? { usage } : {}) }
    } finally {
      combined.cleanup()
    }
  }

  async complete(input: CompleteInput): Promise<string> {
    this.assertActive()
    if (input.signal?.aborted) throw new Error('知识任务已取消')
    if (input.isCurrent?.() === false) throw new Error('知识任务已取消')
    const generation = this.store.generation()
    const independent =
      this.modelSource() === 'local' &&
      this.store.snapshot().mode === 'custom' &&
      hasImage(input.messages)
    if (!independent) {
      const result = await this.base.complete(input)
      this.assertReturnAllowed(generation, input.isCurrent, input.signal)
      return result
    }
    const route = this.store.resolveCustomRoute(true)
    const timeout = Math.max(1, Math.min(MAX_TIMEOUT_MS, input.timeoutMs ?? this.timeoutMs))
    const response = await this.chatCompletion(
      route,
      input,
      Math.max(1, Math.min(32_000, input.maxTokens ?? 4096)),
      timeout,
      input.traceId,
    )
    this.assertReturnAllowed(generation, input.isCurrent, input.signal)
    return response.text
  }

  vision(): VisionResult {
    this.assertActive()
    if (this.modelSource() === 'managed') return this.base.vision()
    const snapshot = this.store.snapshot()
    if (snapshot.mode === 'inherit') {
      const inherited = this.base.vision()
      return {
        ...inherited,
        reason: `${inherited.reason || '沿用文字模型'}（未独立验证）`,
      }
    }
    if (snapshot.status === 'verified')
      return {
        supported: true,
        maxImages: 4,
        reason: '使用已通过固定合成图验证的独立图片模型。',
      }
    return { supported: false, maxImages: 4, reason: snapshot.reason }
  }

  identity(): string {
    this.assertActive()
    const baseIdentity = this.base.identity?.() ?? 'configured'
    // 代次只进入主进程学习计划 identity，不进入渲染快照；配置改变会让旧估算失效。
    return `${baseIdentity}|vision:${this.store.snapshot().mode}:${this.store.generation()}`
  }

  async probe(
    options: { signal?: AbortSignal; isCurrent?: () => boolean } = {},
  ): Promise<VisionModelProbeResult> {
    this.assertActive()
    let route: VisionCustomRoute
    try {
      route = this.store.resolveCustomRoute(false)
    } catch (error) {
      return { ok: false, message: failureMessage(error) }
    }
    const generation = this.store.generation()
    if (options.signal?.aborted) throw new Error('图片模型连接测试已取消')
    if (options.isCurrent?.() === false) throw new Error('图片模型连接测试已取消')
    const outer = options.signal
    const requestWithOuter: typeof fetch = async (input, init) => {
      const merged = mergedSignal([init?.signal, outer])
      try {
        return await this.request(input, { ...init, signal: merged.signal })
      } finally {
        merged.cleanup()
      }
    }
    try {
      const models = await listCustomModels(
        { baseUrl: route.baseUrl, apiKey: route.apiKey },
        requestWithOuter,
      )
      if (outer?.aborted) throw new Error('图片模型连接测试已取消')
      if (options.isCurrent?.() === false) throw new Error('图片模型连接测试已取消')
      this.assertActive()
      if (this.store.generation() !== generation)
        throw new Error('图片模型配置已变化，请重新测试连接')
      return {
        ok: true,
        message: models.length
          ? `连接成功，模型目录返回 ${models.length} 项；普通连接不代表图片能力已验证。`
          : '连接成功；普通连接不代表图片能力已验证。',
      }
    } catch (error) {
      if (outer?.aborted || options.isCurrent?.() === false)
        throw new Error('图片模型连接测试已取消')
      if (
        error instanceof Error &&
        (error.message.includes('已变化') || error.message.includes('连接测试已取消'))
      )
        throw error
      return { ok: false, message: failureMessage(error) }
    }
  }

  async verify(
    options: { signal?: AbortSignal; isCurrent?: () => boolean } = {},
  ): Promise<VisionModelVerifyResult> {
    this.assertActive()
    const route = this.store.resolveCustomRoute(false)
    const ticket: VisionVerificationTicket = this.store.captureVerificationTicket()
    const generation = this.store.generation()
    if (options.signal?.aborted) throw new Error('图片验证已取消')
    if (options.isCurrent?.() === false) throw new Error('图片验证已取消')
    const prompt =
      '这是一张内置的合成验证图，整张图以红色为主。请只回答“红色”两个字，不要解释、不要补充其他内容。'
    const messages: ModelMessages = [
      {
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          {
            type: 'image_url',
            image_url: { url: `data:image/png;base64,${verifyPng().toString('base64')}` },
          },
        ],
      },
    ]
    const timeout = this.timeoutMs
    let response: ChatCompletionResponse
    try {
      response = await this.chatCompletion(
        route,
        {
          messages,
          maxTokens: 8,
          timeoutMs: timeout,
          signal: options.signal,
        },
        Math.max(8, Math.min(32, 8)),
        timeout,
      )
    } catch (error) {
      if (options.signal?.aborted) throw new Error('图片验证已取消')
      if (options.isCurrent?.() === false) throw new Error('图片验证已取消')
      this.assertActive()
      if (this.store.generation() !== generation)
        throw new Error('图片模型配置已变化，请重新执行固定合成图验证')
      const recorded = this.store.recordVerification(ticket, {
        ok: false,
        reason: '固定合成图验证请求失败，请检查端点、网络、模型和 Key 后重试。',
      })
      return {
        ok: false,
        status: recorded.snapshot.status,
        revision: recorded.revision,
        message: failureMessage(error),
      }
    }
    if (options.signal?.aborted) throw new Error('图片验证已取消')
    if (options.isCurrent?.() === false) throw new Error('图片验证已取消')
    this.assertActive()
    if (this.store.generation() !== generation)
      throw new Error('图片模型配置已变化，请重新执行固定合成图验证')
    if (!answerMatches(response.text)) {
      const recorded = this.store.recordVerification(ticket, {
        ok: false,
        reason: '固定合成图验证失败：模型没有返回可核对的答案（只接受“红色”）。',
      })
      return {
        ok: false,
        status: recorded.snapshot.status,
        revision: recorded.revision,
        message: '固定合成图验证失败：模型未返回可核对的答案。',
      }
    }
    const recorded = this.store.recordVerification(ticket, { ok: true })
    return {
      ok: true,
      status: recorded.snapshot.status,
      revision: recorded.revision,
      message: `图片识别验证通过（验证套件 v${SUITE_VERSION}）。`,
    }
  }
}

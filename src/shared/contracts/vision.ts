import { z } from 'zod'

/**
 * 本机图片模型是独立的写入域：这里只定义渲染层与主进程之间的安全契约。
 * Key、系统密文、配置摘要和内部代次都不进入快照或渲染层命令回执。
 */
export const visionModeSchema = z.enum(['inherit', 'custom'])
export type VisionMode = z.infer<typeof visionModeSchema>

export const visionVerificationStatusSchema = z.enum([
  'inherit',
  'unverified',
  'verified',
  'failed',
  'stale',
])
export type VisionVerificationStatus = z.infer<typeof visionVerificationStatusSchema>

export const visionModelCommands = [
  'get-vision-model-settings',
  'save-vision-model-settings',
  'probe-vision-model',
  'verify-vision-model',
  'clear-vision-key',
] as const
export type VisionModelCommand = (typeof visionModelCommands)[number]

export interface VisionModelSnapshot {
  mode: VisionMode
  baseUrl: string
  model: string
  apiKeyConfigured: boolean
  status: VisionVerificationStatus
  reason: string
}
export const visionModelSnapshotSchema: z.ZodType<VisionModelSnapshot> = z
  .object({
    mode: visionModeSchema,
    baseUrl: z.string().max(4096),
    model: z.string().max(256),
    apiKeyConfigured: z.boolean(),
    status: visionVerificationStatusSchema,
    reason: z.string().max(2000),
  })
  .strict()
export const visionModelSettingsViewSchema = z
  .object({
    snapshot: visionModelSnapshotSchema,
    revision: z.number().int().nonnegative(),
  })
  .strict()
export const visionModelExpectedSchema: z.ZodType<VisionModelExpected> = z
  .object({
    mode: visionModeSchema,
    baseUrl: z.string().max(4096),
    model: z.string().max(256),
    apiKeyConfigured: z.boolean(),
    revision: z.number().int().nonnegative(),
  })
  .strict()
export const visionModelSaveInputSchema = z
  .object({
    mode: visionModeSchema,
    baseUrl: z.string().max(4096),
    model: z.string().max(256),
    apiKey: z.string().max(20_000).optional(),
    expected: visionModelExpectedSchema,
  })
  .strict()
export const visionModelProbeResultSchema: z.ZodType<VisionModelProbeResult> = z
  .object({ ok: z.boolean(), message: z.string().max(2000) })
  .strict()
export const visionModelVerifyResultSchema: z.ZodType<VisionModelVerifyResult> = z
  .object({
    ok: z.boolean(),
    message: z.string().max(2000),
    status: visionVerificationStatusSchema,
    revision: z.number().int().nonnegative(),
  })
  .strict()

/**
 * 设置页的并发凭据：安全 revision 由主进程每次变更递增。它不含 Key 或摘要，
 * 仅用于同一业务目录内的迟到保存/清除 CAS；capabilities.visionModel 仍只投影
 * VisionModelSnapshot 的六个字段。
 */
export interface VisionModelSettingsView {
  snapshot: VisionModelSnapshot
  revision: number
}

export interface VisionModelExpected {
  mode: VisionMode
  baseUrl: string
  model: string
  apiKeyConfigured: boolean
  revision: number
}

export interface VisionModelSaveInput {
  mode: VisionMode
  baseUrl: string
  model: string
  apiKey?: string
  expected: VisionModelExpected
}

export interface VisionModelProbeResult {
  ok: boolean
  message: string
}

export interface VisionModelVerifyResult {
  ok: boolean
  message: string
  status: VisionVerificationStatus
  revision: number
}

export interface VisionServiceCallOptions {
  signal?: AbortSignal
}

/**
 * 组件只依赖该模块服务。主进程实现必须再绑定当前 workspace 租约；
 * 浏览器/测试替身不得直接联网或读写配置文件。
 */
export interface VisionModelService {
  load(options?: VisionServiceCallOptions): Promise<VisionModelSettingsView>
  save(input: VisionModelSaveInput): Promise<VisionModelSettingsView>
  probe(
    options?: VisionServiceCallOptions & { expected?: VisionModelExpected },
  ): Promise<VisionModelProbeResult>
  verify(
    options?: VisionServiceCallOptions & { expected?: VisionModelExpected },
  ): Promise<VisionModelVerifyResult>
  clearKey(
    expected: VisionModelExpected,
    options?: VisionServiceCallOptions,
  ): Promise<VisionModelSettingsView>
}

export const defaultVisionModelSnapshot = (): VisionModelSnapshot => ({
  mode: 'inherit',
  baseUrl: '',
  model: '',
  apiKeyConfigured: false,
  status: 'inherit',
  reason: '沿用文字模型；旧图片能力保持可用但未独立验证。',
})

export function toVisionExpected(view: VisionModelSettingsView): VisionModelExpected {
  return {
    mode: view.snapshot.mode,
    baseUrl: view.snapshot.baseUrl,
    model: view.snapshot.model,
    apiKeyConfigured: view.snapshot.apiKeyConfigured,
    revision: view.revision,
  }
}

/**
 * 复用现有本机模型端口口径：只允许无内嵌凭证的 http(s) 地址；
 * 明文 http 仅允许回环地址，避免 Key 经局域网或公网传输。
 */
export function normalizeVisionBaseUrl(raw: string): string {
  const value = raw.trim()
  if (!value) throw new Error('请填写图片模型 API 地址')
  let endpoint: URL
  try {
    endpoint = new URL(value)
  } catch {
    throw new Error('API 地址格式无效，请填写完整的 http(s) 地址')
  }
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(endpoint.hostname.toLowerCase())
  if (
    !['http:', 'https:'].includes(endpoint.protocol) ||
    endpoint.username ||
    endpoint.password ||
    (endpoint.protocol === 'http:' && !loopback)
  )
    throw new Error('API 地址必须使用 https；本机回环地址可使用 http')
  endpoint.search = ''
  endpoint.hash = ''
  return endpoint.toString().replace(/\/+$/, '')
}

export function visionBaseUrlOrigin(raw: string): string {
  return new URL(normalizeVisionBaseUrl(raw)).origin
}

export function validateVisionModelText(input: {
  mode: VisionMode
  baseUrl: string
  savedBaseUrl?: string
  model: string
  apiKey: string
  apiKeyConfigured: boolean
}): string {
  if (input.mode === 'inherit') return ''
  let baseUrl: string
  try {
    baseUrl = normalizeVisionBaseUrl(input.baseUrl)
  } catch (error) {
    return error instanceof Error ? error.message : 'API 地址格式无效'
  }
  const model = input.model.trim()
  if (!model) return '请填写图片模型名称'
  if (model.length > 200) return '图片模型名称不能超过 200 个字符'
  const apiKey = input.apiKey.trim()
  if (!apiKey && !input.apiKeyConfigured) return '请填写图片模型 API Key'
  if (apiKey.length > 20_000) return '图片模型 API Key 过长'
  if (!apiKey && input.apiKeyConfigured && input.savedBaseUrl) {
    try {
      if (visionBaseUrlOrigin(baseUrl) !== visionBaseUrlOrigin(input.savedBaseUrl))
        return '更换图片模型服务地址后必须重新输入 API Key'
    } catch {
      return '已保存的图片模型服务地址无效，请重新输入 Endpoint 和 Key'
    }
  }
  return ''
}

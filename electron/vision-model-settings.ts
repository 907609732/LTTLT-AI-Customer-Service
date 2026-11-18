import fs from 'node:fs'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { z } from 'zod'
import {
  defaultVisionModelSnapshot,
  normalizeVisionBaseUrl,
  visionBaseUrlOrigin,
  visionModeSchema,
  type VisionMode,
  type VisionModelExpected,
  type VisionModelSettingsView,
  type VisionModelSnapshot,
} from '../src/shared/contracts/vision'

/**
 * 与 Electron safeStorage 相同的最小端口。production 组合根必须传真实主进程
 * safeStorage；这里刻意不提供 base64 或明文后备实现。
 */
export interface VisionSafeStorage {
  isEncryptionAvailable(): boolean
  encryptString(value: string): Buffer
  decryptString(value: Buffer): string
}

export interface VisionVerificationTicket {
  revision: number
  generation: number
  digest: string
  owner: string
}

export interface VisionCustomRoute {
  baseUrl: string
  model: string
  apiKey: string
  revision: number
  generation: number
  digest: string
  owner: string
}

export type VisionVerificationOutcome =
  | { ok: true }
  | {
      ok: false
      reason: string
    }

interface StoredKey {
  ciphertext: string
  version: number
}

interface StoredVerification {
  status: 'verified' | 'failed'
  digest: string
  owner: string
  at: number
  suite: number
  reason?: string
}

interface SettingsFile {
  version: 1
  owner: string
  revision: number
  generation: number
  mode: VisionMode
  baseUrl: string
  model: string
  key?: StoredKey
  verify?: StoredVerification
}

const expectedSchema = z
  .object({
    mode: visionModeSchema,
    baseUrl: z.string().max(4096),
    model: z.string().max(256),
    apiKeyConfigured: z.boolean(),
    revision: z.number().int().nonnegative(),
  })
  .strict()

const saveSchema = z
  .object({
    mode: visionModeSchema,
    baseUrl: z.string().max(4096),
    model: z.string().max(256),
    apiKey: z.string().max(20_000).optional(),
    expected: expectedSchema,
  })
  .strict()

const clearSchema = expectedSchema

const fileKeySchema = z
  .object({
    ciphertext: z.string().min(1).max(1_000_000),
    version: z.number().int().positive(),
  })
  .strict()

const verificationSchema = z
  .object({
    status: z.enum(['verified', 'failed']),
    digest: z.string().min(1).max(256),
    owner: z.string().min(1).max(256),
    at: z.number().int().nonnegative(),
    suite: z.number().int().positive(),
    reason: z.string().max(1000).optional(),
  })
  .strict()

const fileSchema = z
  .object({
    version: z.literal(1),
    owner: z.string().min(1).max(256),
    revision: z.number().int().nonnegative(),
    generation: z.number().int().nonnegative(),
    mode: visionModeSchema,
    baseUrl: z.string().max(4096),
    model: z.string().max(256),
    key: fileKeySchema.optional(),
    verify: verificationSchema.optional(),
  })
  .strict()

const FAILED_VERIFY_REASON = '固定合成图验证失败，请检查端点、模型和 Key 后重试。'
const VERIFIED_REASON = '独立图片模型已完成固定合成图验证。'
const UNVERIFIED_REASON = '已保存独立配置，尚未执行固定合成图验证。普通连接测试不能代替图片验证。'
const STALE_CONFIG_REASON = '图片模型端点、模型或 Key 已改变，请重新执行固定合成图验证。'
const STALE_OWNER_REASON = '视觉配置来自另一业务目录，图片验证已失效，请重新验证。'
const KEY_CLEARED_REASON = '独立图片模型 Key 已清除，图片学习不可用。'

/**
 * 视觉配置和文字模型配置完全分开保存。文件只存在本机业务目录；
 * 写入采用 0600 临时文件 + rename，失败时旧文件保持不变。
 */
export class VisionModelSettingsStore {
  readonly file: string
  private readonly owner: string
  private readonly safeStorage: VisionSafeStorage
  private readonly assertActive: () => void
  private readonly now: () => number
  private state: SettingsFile

  constructor(options: {
    dataDir: string
    safeStorage: VisionSafeStorage
    assertActive?: () => void
    now?: () => number
  }) {
    const directory = path.resolve(options.dataDir)
    fs.mkdirSync(directory, { recursive: true })
    const canonical = fs.realpathSync.native(directory)
    const normalized = process.platform === 'win32' ? canonical.toLowerCase() : canonical
    this.owner = createHash('sha256').update(normalized).digest('hex')
    this.file = path.join(canonical, 'vision-model.json')
    this.safeStorage = options.safeStorage
    this.assertActive = options.assertActive ?? (() => {})
    this.now = options.now ?? Date.now
    this.state = this.load()
  }

  private load(): SettingsFile {
    if (!fs.existsSync(this.file))
      return {
        version: 1,
        owner: this.owner,
        revision: 0,
        generation: 0,
        mode: 'inherit',
        baseUrl: '',
        model: '',
      }
    let raw: unknown
    try {
      raw = JSON.parse(fs.readFileSync(this.file, 'utf8'))
    } catch {
      throw new Error('图片模型配置损坏，原文件未改动，请恢复备份后重试')
    }
    const parsed = fileSchema.safeParse(raw)
    if (!parsed.success) throw new Error('图片模型配置无效，原文件未改动，请恢复备份后重试')
    return parsed.data
  }

  private write(value: SettingsFile): void {
    fs.mkdirSync(path.dirname(this.file), { recursive: true })
    const temporary = `${this.file}.${randomUUID()}.tmp`
    let failure: unknown
    try {
      const descriptor = fs.openSync(temporary, 'wx', 0o600)
      try {
        fs.writeFileSync(descriptor, JSON.stringify(value))
        // 数据落盘后再 rename，避免掉电留下“已改名但内容未持久”的新配置。
        fs.fsyncSync(descriptor)
      } finally {
        fs.closeSync(descriptor)
      }
      fs.renameSync(temporary, this.file)
      try {
        const directory = fs.openSync(path.dirname(this.file), 'r')
        try {
          fs.fsyncSync(directory)
        } finally {
          fs.closeSync(directory)
        }
      } catch {
        // Windows 对目录 fsync 支持不一致；文件本身已经 fsync，不能因此宣称写入失败。
      }
    } catch (error) {
      failure = error
    } finally {
      if (fs.existsSync(temporary)) {
        try {
          fs.unlinkSync(temporary)
        } catch {
          // 清理失败不能覆盖真正的写入/rename 错误；旧文件仍保持不动。
        }
      }
    }
    if (failure) throw failure
  }

  private commit(next: SettingsFile, failure: string): void {
    this.assertActive()
    try {
      this.write(next)
    } catch {
      throw new Error(failure)
    }
    this.state = next
  }

  private digest(value: SettingsFile): string {
    // 摘要绑定可见配置和 Key 代次，但不保存 Key 指纹；仅主进程用于验证失效判断。
    return createHash('sha256')
      .update(
        JSON.stringify({
          version: 1,
          owner: this.owner,
          mode: value.mode,
          baseUrl: value.baseUrl,
          model: value.model,
          keyVersion: value.key?.version ?? 0,
        }),
      )
      .digest('hex')
  }

  private comparable(value: VisionModelExpected): string {
    return JSON.stringify({
      mode: value.mode,
      baseUrl: value.baseUrl.trim(),
      model: value.model.trim(),
      apiKeyConfigured: value.apiKeyConfigured,
      revision: value.revision,
    })
  }

  private currentExpected(): VisionModelExpected {
    return {
      mode: this.state.mode,
      baseUrl: this.state.baseUrl,
      model: this.state.model,
      apiKeyConfigured: Boolean(this.state.key),
      revision: this.state.revision,
    }
  }

  private assertExpected(expected: VisionModelExpected): void {
    if (this.comparable(expected) !== this.comparable(this.currentExpected()))
      throw new Error('图片模型配置已更新，请载入已保存配置后再修改')
  }

  private verificationState(): {
    status: VisionModelSnapshot['status']
    reason: string
  } {
    if (this.state.mode === 'inherit')
      return {
        status: 'inherit',
        reason: '沿用文字模型；旧图片能力保持可用但未独立验证。',
      }
    if (!this.state.baseUrl || !this.state.model || !this.state.key)
      return { status: 'unverified', reason: '请完整填写图片模型地址、名称和 API Key。' }
    const verify = this.state.verify
    if (!verify) return { status: 'unverified', reason: UNVERIFIED_REASON }
    if (verify.owner !== this.owner) return { status: 'stale', reason: STALE_OWNER_REASON }
    if (verify.digest !== this.digest(this.state))
      return { status: 'stale', reason: STALE_CONFIG_REASON }
    if (verify.status === 'failed')
      return { status: 'failed', reason: verify.reason || FAILED_VERIFY_REASON }
    return { status: 'verified', reason: VERIFIED_REASON }
  }

  snapshot(): VisionModelSnapshot {
    const verification = this.verificationState()
    return {
      mode: this.state.mode,
      baseUrl: this.state.baseUrl,
      model: this.state.model,
      apiKeyConfigured: Boolean(this.state.key),
      status: verification.status,
      reason: verification.reason,
    }
  }

  /** 设置页 CAS 使用安全 revision；capabilities 投影不得直接带出该字段。 */
  view(): VisionModelSettingsView {
    return { snapshot: this.snapshot(), revision: this.state.revision }
  }

  revision(): number {
    return this.state.revision
  }

  /** 主进程学习计划 identity 使用；快照和 IPC 契约不包含此值。 */
  generation(): number {
    return this.state.generation
  }

  save(raw: unknown): VisionModelSettingsView {
    this.assertActive()
    let input: z.infer<typeof saveSchema>
    try {
      input = saveSchema.parse(raw)
    } catch {
      throw new Error('图片模型参数无效，请检查模式、地址、模型名称和 Key')
    }
    this.assertExpected(input.expected)
    const nextBaseUrl = this.normalizedBaseUrl(input)
    const nextModel = input.model.trim()
    if (input.mode === 'custom') {
      if (!nextModel) throw new Error('请填写图片模型名称')
      if (nextModel.length > 200) throw new Error('图片模型名称不能超过 200 个字符')
    }
    const providedKey = input.apiKey?.trim() ?? ''
    if (providedKey && !this.safeStorage.isEncryptionAvailable())
      throw new Error('系统加密不可用，图片模型 Key 未保存')
    if (input.mode === 'custom' && !providedKey && !this.state.key)
      throw new Error('请填写图片模型 API Key')
    if (providedKey.length > 20_000) throw new Error('图片模型 API Key 过长')
    if (this.state.key && this.state.baseUrl && nextBaseUrl && !providedKey) {
      // Key 绑定 origin；换协议/主机/端口必须显式重输，不能把 A 的旧 Key 静默发给 B。
      if (visionBaseUrlOrigin(this.state.baseUrl) !== visionBaseUrlOrigin(nextBaseUrl))
        throw new Error('更换图片模型服务地址后必须重新输入 API Key；原配置未改动')
    }

    let key = this.state.key
    if (providedKey) {
      try {
        key = {
          ciphertext: this.safeStorage.encryptString(providedKey).toString('base64'),
          version: (this.state.key?.version ?? 0) + 1,
        }
      } catch {
        throw new Error('图片模型 Key 加密失败，未保存任何配置')
      }
    }
    const keyChanged = key?.version !== this.state.key?.version
    const modeChanged = input.mode !== this.state.mode
    const configChanged =
      modeChanged ||
      keyChanged ||
      nextBaseUrl !== this.state.baseUrl ||
      nextModel !== this.state.model
    if (!configChanged) return this.view()

    const next: SettingsFile = {
      ...this.state,
      revision: this.state.revision + 1,
      generation: this.state.generation + 1,
      mode: input.mode,
      baseUrl: nextBaseUrl,
      model: nextModel,
      ...(key ? { key } : { key: undefined }),
      // 任何有效配置变化都撤销旧验证；A→B→A 即使摘要相同也必须重新显式验证。
      verify: undefined,
    }
    this.commit(next, '图片模型保存失败，请检查数据目录权限；原文件未改动')
    return this.view()
  }

  private normalizedBaseUrl(input: z.infer<typeof saveSchema>): string {
    if (input.mode === 'inherit') {
      const value = input.baseUrl.trim()
      return value ? normalizeVisionBaseUrl(value) : ''
    }
    return normalizeVisionBaseUrl(input.baseUrl)
  }

  clearKey(raw: unknown): VisionModelSettingsView {
    this.assertActive()
    let expected: VisionModelExpected
    try {
      expected = clearSchema.parse(raw)
    } catch {
      throw new Error('清除图片模型 Key 的参数无效')
    }
    this.assertExpected(expected)
    if (!this.state.key) return this.view()
    const next: SettingsFile = {
      ...this.state,
      revision: this.state.revision + 1,
      generation: this.state.generation + 1,
      key: undefined,
      verify: undefined,
    }
    this.commit(next, '清除图片模型 Key 失败，请检查数据目录权限；原文件未改动')
    return {
      snapshot: { ...this.snapshot(), reason: KEY_CLEARED_REASON },
      revision: this.state.revision,
    }
  }

  captureVerificationTicket(): VisionVerificationTicket {
    this.assertActive()
    const route = this.resolveCustomRoute(false)
    return {
      revision: route.revision,
      generation: route.generation,
      digest: route.digest,
      owner: route.owner,
    }
  }

  recordVerification(
    ticket: VisionVerificationTicket,
    outcome: VisionVerificationOutcome,
  ): VisionModelSettingsView {
    this.assertActive()
    if (
      ticket.revision !== this.state.revision ||
      ticket.generation !== this.state.generation ||
      ticket.owner !== this.owner ||
      ticket.digest !== this.digest(this.state)
    )
      throw new Error('图片模型配置已变化，请重新执行固定合成图验证')
    const next: SettingsFile = {
      ...this.state,
      revision: this.state.revision + 1,
      generation: this.state.generation + 1,
      verify: {
        status: outcome.ok ? 'verified' : 'failed',
        digest: ticket.digest,
        owner: this.owner,
        at: this.now(),
        suite: 1,
        ...(outcome.ok ? {} : { reason: outcome.reason.slice(0, 1000) }),
      },
    }
    this.commit(next, '图片验证状态保存失败，请检查数据目录权限；配置未改变')
    return this.view()
  }

  /**
   * 仅在主进程内部返回可解密 Key。requireVerified=true 时必须仍绑定当前
   * 端点、模型、Key 代次和目录 owner 的成功验证记录。
   */
  resolveCustomRoute(requireVerified: boolean): VisionCustomRoute {
    this.assertActive()
    if (this.state.mode !== 'custom') throw new Error('图片识别当前沿用文字模型')
    if (!this.state.baseUrl || !this.state.model || !this.state.key)
      throw new Error('图片模型配置不完整，请先保存地址、模型和 Key')
    if (requireVerified) {
      const verification = this.verificationState()
      if (verification.status !== 'verified') throw new Error(verification.reason)
    }
    if (!this.safeStorage.isEncryptionAvailable())
      throw new Error('系统加密不可用，无法读取图片模型 Key')
    let apiKey: string
    try {
      apiKey = this.safeStorage.decryptString(Buffer.from(this.state.key.ciphertext, 'base64'))
    } catch {
      throw new Error('图片模型 Key 无法解密，请重新填写并保存')
    }
    return {
      baseUrl: this.state.baseUrl,
      model: this.state.model,
      apiKey,
      revision: this.state.revision,
      generation: this.state.generation,
      digest: this.digest(this.state),
      owner: this.owner,
    }
  }
}

export { defaultVisionModelSnapshot }

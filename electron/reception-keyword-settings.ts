import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { ReceptionKeywordKind } from '../src/shared/contracts/backend'

/** 独立保存关键词开关，避免把“关闭匹配”误实现成清空关键词原文。 */
const fileSchema = z
  .object({
    version: z.literal(1),
    handoffEnabled: z.boolean(),
    manualReplyEnabled: z.boolean(),
  })
  .strict()

export interface ReceptionKeywordMatchSettings {
  handoffEnabled: boolean
  manualReplyEnabled: boolean
}

const defaultSettings: ReceptionKeywordMatchSettings = {
  handoffEnabled: true,
  manualReplyEnabled: true,
}

const kindSchema = z.enum(['handoff', 'manual'])
const keywordTextCommandSchema = z
  .object({
    kind: kindSchema,
    mode: z.literal('keywords'),
    keywords: z.array(z.string()).max(1000),
    expectedKeywords: z.array(z.string()).max(1000),
  })
  .strict()
const keywordSwitchCommandSchema = z
  .object({
    kind: kindSchema,
    mode: z.literal('enabled'),
    enabled: z.boolean(),
    expectedEnabled: z.boolean(),
  })
  .strict()
const keywordCommandSchema = z.discriminatedUnion('mode', [
  keywordTextCommandSchema,
  keywordSwitchCommandSchema,
])
export type ReceptionKeywordSaveInput = z.infer<typeof keywordCommandSchema>

const labels: Record<ReceptionKeywordKind, string> = {
  handoff: '全局人工关键词',
  manual: '客服接管关键词',
}

export function normalizeReceptionKeywords(input: unknown, kind: ReceptionKeywordKind): string[] {
  const label = labels[kind]
  if (!Array.isArray(input)) throw new Error(`${label}格式无效`)
  const keywords: string[] = []
  for (const value of input) {
    if (typeof value !== 'string') throw new Error(`${label}必须为文本`)
    const word = value.trim()
    if (!word) continue
    if (word.length > 30) throw new Error(`${label}每个最多 30 个字符`)
    if (!keywords.includes(word)) keywords.push(word)
  }
  if (keywords.length > 100) throw new Error(`${label}最多 100 个`)
  return keywords
}

/** IPC 业务命令只接受关键词文本或开关两类严格字段，不能借保存命令改写其他配置。 */
export function parseReceptionKeywordSaveInput(input: unknown): ReceptionKeywordSaveInput {
  const parsed = keywordCommandSchema.safeParse(input)
  if (!parsed.success) throw new Error('关键词设置参数无效')
  return parsed.data
}

function fieldOf(kind: ReceptionKeywordKind) {
  return kind === 'handoff' ? ('handoffEnabled' as const) : ('manualReplyEnabled' as const)
}

export class ReceptionKeywordSettingsStore {
  private file: string
  private current: ReceptionKeywordMatchSettings

  constructor(dataDir: string) {
    this.file = path.join(dataDir, 'reception-keyword-settings.json')
    this.current = this.#load()
  }

  #load(): ReceptionKeywordMatchSettings {
    if (!fs.existsSync(this.file)) return { ...defaultSettings }
    let raw: unknown
    try {
      raw = JSON.parse(fs.readFileSync(this.file, 'utf8'))
    } catch {
      throw new Error('关键词开关配置损坏，原文件未改动，请恢复备份后重试')
    }
    const parsed = fileSchema.safeParse(raw)
    if (!parsed.success) throw new Error('关键词开关配置无效，原文件未改动，请恢复备份后重试')
    return {
      handoffEnabled: parsed.data.handoffEnabled,
      manualReplyEnabled: parsed.data.manualReplyEnabled,
    }
  }

  #write(value: ReceptionKeywordMatchSettings): void {
    fs.mkdirSync(path.dirname(this.file), { recursive: true })
    const temporary = `${this.file}.${randomUUID()}.tmp`
    try {
      fs.writeFileSync(temporary, JSON.stringify({ version: 1, ...value }, null, 2), {
        mode: 0o600,
        flag: 'wx',
      })
      fs.renameSync(temporary, this.file)
    } finally {
      if (fs.existsSync(temporary)) fs.unlinkSync(temporary)
    }
  }

  snapshot(): ReceptionKeywordMatchSettings {
    return { ...this.current }
  }

  saveEnabled(
    kind: ReceptionKeywordKind,
    enabled: boolean,
    expectedEnabled: boolean,
  ): { settings: ReceptionKeywordMatchSettings; changed: boolean } {
    const field = fieldOf(kind)
    if (this.current[field] !== expectedEnabled)
      throw new Error('关键词开关已更新，请重新载入后再修改')
    if (this.current[field] === enabled) return { settings: this.snapshot(), changed: false }
    const next = { ...this.current, [field]: enabled }
    try {
      this.#write(next)
    } catch {
      throw new Error('关键词开关保存失败，请检查数据目录权限；原文件未改动')
    }
    this.current = next
    return { settings: this.snapshot(), changed: true }
  }
}

export interface ReceptionKeywordSafety {
  handoffKeywords: string[]
  manualReplyKeywords: string[]
}

/**
 * 全局开关只影响继承全局配置的店铺；本店自定义关键词仍按原语义生效。
 * 客服接管开关只过滤卖家侧关键词，不禁用其他 AI 暂停/恢复规则。
 */
export function resolveReceptionKeywordSafety(
  safety: ReceptionKeywordSafety,
  customKeywords: string[] | undefined,
  settings: ReceptionKeywordMatchSettings,
): ReceptionKeywordSafety {
  return {
    handoffKeywords:
      customKeywords !== undefined
        ? [...customKeywords]
        : settings.handoffEnabled
          ? [...safety.handoffKeywords]
          : [],
    manualReplyKeywords: settings.manualReplyEnabled ? [...safety.manualReplyKeywords] : [],
  }
}

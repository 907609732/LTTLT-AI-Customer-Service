import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import {
  defaultReplyPacing,
  replyPacingModeSchema,
  replyPacingSchema,
  type ReplyPacing,
} from '../src/shared/contracts/backend'
import { replyPacingRange } from '../src/shared/reply-pacing'

/**
 * 同一买家回复节奏独立保存在本机业务目录，而不是塞进厂商 config.json：
 * 厂商配置结构固定且会整体校验，旧字段 perUidMinIntervalMs 需要原样保留用于审计/回退。
 * 首次没有该文件时按 1～3 秒随机迁移，之后不再覆盖用户保存的新模式。
 * 读取失败必须明确报错并保留原文件，不能静默回默认把用户自定义范围“缩短”。
 */
const pacingFields = {
  mode: replyPacingModeSchema,
  customMinSeconds: z.number().int().min(1).max(3600),
  customMaxSeconds: z.number().int().min(1).max(3600),
}

/** 下限大于上限在保存、加载和快照中都视为非法，不做隐式排序或裁剪。 */
const orderedRange = (
  value: { customMinSeconds: number; customMaxSeconds: number },
  context: { addIssue: (issue: { code: 'custom'; message: string }) => void },
) => {
  if (value.customMinSeconds > value.customMaxSeconds)
    context.addIssue({ code: 'custom', message: '随机间隔下限不能大于上限' })
}

const fileSchema = z
  .object({
    version: z.literal(1),
    ...pacingFields,
    migratedAt: z.number().int().nonnegative().optional(),
    migratedFromLegacyMs: z.number().int().min(0).max(3600000).optional(),
  })
  .strict()
  .superRefine(orderedRange)

/** 所有写入口都必须带上界面载入时的预期值，CAS 不能被省略绕过。 */
export const replyPacingSaveSchema = z
  .object({ ...pacingFields, expected: replyPacingSchema })
  .strict()
  .superRefine(orderedRange)
export type ReplyPacingSaveInput = z.infer<typeof replyPacingSaveSchema>

const toSnapshot = (value: ReplyPacing): ReplyPacing => ({
  mode: value.mode,
  customMinSeconds: value.customMinSeconds,
  customMaxSeconds: value.customMaxSeconds,
})

export class ReplyPacingStore {
  private file: string
  private current: ReplyPacing
  private migration: { migratedAt?: number; migratedFromLegacyMs?: number } = {}

  constructor(dataDir: string, legacyIntervalMs: number) {
    this.file = path.join(dataDir, 'reply-pacing.json')
    this.current = this.#load(legacyIntervalMs)
  }

  #load(legacyIntervalMs: number): ReplyPacing {
    if (!fs.existsSync(this.file)) {
      // 首次迁移：旧账号的 60 秒或旧固定值一律改成 1～3 秒随机；
      // 旧值本身仍留在 config.json（perUidMinIntervalMs），这里只记录迁移来源。
      this.migration = {
        migratedAt: Date.now(),
        migratedFromLegacyMs: Number.isFinite(legacyIntervalMs)
          ? Math.min(3600000, Math.max(0, Math.round(legacyIntervalMs)))
          : undefined,
      }
      const value = { ...defaultReplyPacing }
      try {
        this.#write(value)
      } catch {
        // 初始化写失败会让用户以为已迁移，必须显式失败而不是继续按默认值运行。
        throw new Error('回复间隔配置无法初始化，请检查数据目录权限后重试')
      }
      return value
    }
    let raw: unknown
    try {
      raw = JSON.parse(fs.readFileSync(this.file, 'utf8'))
    } catch {
      throw new Error('回复间隔配置损坏，原文件未改动，请恢复备份后重试')
    }
    const parsed = fileSchema.safeParse(raw)
    if (!parsed.success) throw new Error('回复间隔配置无效，原文件未改动，请恢复备份后重试')
    this.migration = {
      migratedAt: parsed.data.migratedAt,
      migratedFromLegacyMs: parsed.data.migratedFromLegacyMs,
    }
    return toSnapshot(parsed.data)
  }

  #write(value: ReplyPacing): void {
    const payload = {
      version: 1 as const,
      ...toSnapshot(value),
      ...(this.migration.migratedAt === undefined ? {} : { migratedAt: this.migration.migratedAt }),
      ...(this.migration.migratedFromLegacyMs === undefined
        ? {}
        : { migratedFromLegacyMs: this.migration.migratedFromLegacyMs }),
    }
    fs.mkdirSync(path.dirname(this.file), { recursive: true })
    const temporary = `${this.file}.${randomUUID()}.tmp`
    try {
      fs.writeFileSync(temporary, JSON.stringify(payload), { mode: 0o600, flag: 'wx' })
      fs.renameSync(temporary, this.file)
    } finally {
      // 写入或改名失败时原文件保持不动，只清理本次临时文件。
      if (fs.existsSync(temporary)) fs.unlinkSync(temporary)
    }
  }

  snapshot(): ReplyPacing {
    return toSnapshot(this.current)
  }

  save(input: unknown): ReplyPacing {
    let value: ReplyPacingSaveInput
    try {
      value = replyPacingSaveSchema.parse(input)
    } catch {
      throw new Error('回复间隔参数无效：请选择模式，自定义范围为 1～3600 整数秒且下限不大于上限')
    }
    const current = this.current
    if (
      value.expected.mode !== current.mode ||
      value.expected.customMinSeconds !== current.customMinSeconds ||
      value.expected.customMaxSeconds !== current.customMaxSeconds
    )
      throw new Error('回复间隔配置已更新，请载入已保存设置后再修改')
    const next: ReplyPacing = {
      mode: value.mode,
      customMinSeconds: value.customMinSeconds,
      customMaxSeconds: value.customMaxSeconds,
    }
    if (
      next.mode === current.mode &&
      next.customMinSeconds === current.customMinSeconds &&
      next.customMaxSeconds === current.customMaxSeconds
    )
      return toSnapshot(current)
    try {
      this.#write(next)
    } catch {
      // 写盘失败时 current 保持旧值，只有真正落盘成功才对外生效。
      throw new Error('回复间隔保存失败，请检查数据目录权限；原文件未改动')
    }
    this.current = next
    return toSnapshot(next)
  }
}

/**
 * 按买家抽取一次等待间隔，并把本次结果缓存到自有 TypeScript：
 * - 缓存键包含模式与范围指纹，保存新设置后当前等待立即按新节奏重算；
 * - 缓存键包含上次发送时间，发送成功后下一次等待重新抽取；
 * - 缓存键包含店铺与买家，互不影响；同一买家旧键会被清理，避免无限增长。
 * 厂商引擎只调用本函数并读取结果，不保存业务规则。
 * 至少 1 秒；非法持久值直接拒绝解析，而不是偷偷排序成“合法”范围。
 */
export function createUidIntervalResolver(read: () => ReplyPacing) {
  const cache = new Map<string, number>()
  return (context: unknown, random?: () => number): number => {
    const value = context && typeof context === 'object' ? context : {}
    const storeId = String(Reflect.get(value, 'storeId') ?? '')
    const uid = String(Reflect.get(value, 'uid') ?? '')
    const lastSentAt = Number(Reflect.get(value, 'lastSentAt')) || 0
    const pacing = read()
    const range = replyPacingRange(pacing)
    if (
      !Number.isInteger(range.minSeconds) ||
      !Number.isInteger(range.maxSeconds) ||
      range.minSeconds < 1 ||
      range.maxSeconds > 3600 ||
      range.minSeconds > range.maxSeconds
    )
      throw new Error('回复间隔范围无效')
    const fingerprint = `${pacing.mode}:${range.minSeconds}:${range.maxSeconds}`
    const key = `${storeId}\n${uid}\n${lastSentAt}\n${fingerprint}`
    const cached = cache.get(key)
    if (cached !== undefined) return cached
    const minMs = range.minSeconds * 1000
    const maxMs = range.maxSeconds * 1000
    let intervalMs = minMs
    if (maxMs > minMs) {
      const ratio = Number(typeof random === 'function' ? random() : Math.random())
      const safeRatio = Number.isFinite(ratio) ? Math.min(1, Math.max(0, ratio)) : 0
      intervalMs = Math.round(minMs + safeRatio * (maxMs - minMs))
    }
    for (const existing of cache.keys())
      if (existing.startsWith(`${storeId}\n${uid}\n`)) cache.delete(existing)
    cache.set(key, intervalMs)
    return intervalMs
  }
}

import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { storeSendModeSchema, type StoreSendModeState } from '../src/shared/contracts/review'

const storeIdSchema = z.string().trim().min(1).max(64)
const fileSchema = z.object({
  version: z.literal(1),
  stores: z.record(z.string(), storeSendModeSchema),
})

/** 当前账号业务目录内保存显式选择；批准与候选不落盘，缺失或损坏配置一律审核。 */
export class StoreSendModes {
  private modes = new Map<string, 'review' | 'auto'>()
  private revisions = new Map<string, number>()
  private file: string
  constructor(dataDir: string) {
    this.file = path.join(dataDir, 'store-send-modes.json')
    try {
      const saved = fileSchema.parse(JSON.parse(fs.readFileSync(this.file, 'utf8')))
      for (const [id, mode] of Object.entries(saved.stores))
        if (storeIdSchema.safeParse(id).success) this.modes.set(id, mode)
    } catch {
      // 无有效保存证据时不能恢复自动发送。
    }
  }
  read(storeId: string): StoreSendModeState {
    return { mode: this.modes.get(storeId) ?? 'review', revision: this.revisions.get(storeId) ?? 0 }
  }
  set(storeId: string, mode: unknown): StoreSendModeState {
    const id = storeIdSchema.parse(storeId),
      value = storeSendModeSchema.parse(mode)
    if (this.read(id).mode === value) return this.read(id)
    const next = new Map(this.modes)
    next.set(id, value)
    fs.mkdirSync(path.dirname(this.file), { recursive: true })
    const temporary = `${this.file}.${randomUUID()}.tmp`
    try {
      fs.writeFileSync(
        temporary,
        JSON.stringify({ version: 1, stores: Object.fromEntries(next) }),
        {
          mode: 0o600,
          flag: 'wx',
        },
      )
      fs.renameSync(temporary, this.file)
    } finally {
      if (fs.existsSync(temporary)) fs.unlinkSync(temporary)
    }
    this.modes = next
    this.revisions.set(id, this.read(id).revision + 1)
    return this.read(id)
  }
}

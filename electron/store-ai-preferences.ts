import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
const identitySchema = z
  .object({
    platform: z.string().min(1).max(40),
    mallId: z.string().min(1).max(100),
    customerServiceId: z.string().min(1).max(100),
  })
  .strict()
export type StoreAiIdentity = z.infer<typeof identitySchema>
const fileSchema = z.object({ version: z.literal(1), stores: z.record(z.string(), identitySchema) })
/** 仅保存显式成功开启所绑定的身份；运行时停机和批准状态不写入此文件。 */
export class StoreAiPreferences {
  private stores = new Map<string, StoreAiIdentity>()
  private file: string
  constructor(dataDir: string) {
    this.file = path.join(dataDir, 'store-ai-preferences.json')
    try {
      this.stores = new Map(
        Object.entries(fileSchema.parse(JSON.parse(fs.readFileSync(this.file, 'utf8'))).stores),
      )
    } catch {
      /* 缺失或损坏时没有恢复授权。 */
    }
  }
  read(id: string) {
    const value = this.stores.get(id)
    return value ? { ...value } : undefined
  }
  enable(id: string, identity: StoreAiIdentity) {
    this.write(id, identitySchema.parse(identity))
  }
  disable(id: string) {
    this.write(id)
  }
  private write(id: string, identity?: StoreAiIdentity) {
    z.string().min(1).max(64).parse(id)
    if (!identity && !this.stores.has(id)) return
    const next = new Map(this.stores)
    if (identity) next.set(id, identity)
    else next.delete(id)
    fs.mkdirSync(path.dirname(this.file), { recursive: true })
    const temporary = `${this.file}.${randomUUID()}.tmp`
    try {
      fs.writeFileSync(
        temporary,
        JSON.stringify({ version: 1, stores: Object.fromEntries(next) }),
        { mode: 0o600, flag: 'wx' },
      )
      fs.renameSync(temporary, this.file)
    } finally {
      if (fs.existsSync(temporary)) fs.unlinkSync(temporary)
    }
    this.stores = next
  }
}

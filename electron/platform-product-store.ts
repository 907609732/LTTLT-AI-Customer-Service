import fs from 'node:fs'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { z } from 'zod'
import {
  platformProductDetailSchema,
  type PlatformProductDetail,
} from '../src/shared/contracts/platform-product'

interface Options {
  directory: string
  assertActive(): void
  assertStore(storeId: string): void
}
const storedSchema = z
  .object({ version: z.literal(1), items: z.array(platformProductDetailSchema).max(10000) })
  .strict()
  .refine(
    (value) => new Set(value.items.map((row) => row.productId)).size === value.items.length,
    '商品来源重复',
  )
/** Source snapshots are separate from edited knowledge; directory is already account-scoped. */
export function createPlatformProductStore(options: Options) {
  const cache = new Map<
    string,
    {
      signature: string
      state: z.infer<typeof storedSchema>
      byId: Map<string, PlatformProductDetail>
    }
  >()
  const check = (storeId: string) => {
    z.string().trim().min(1).max(64).parse(storeId)
    options.assertActive()
    options.assertStore(storeId)
  }
  const file = (storeId: string) =>
    path.join(
      options.directory,
      'platform-products',
      createHash('sha256').update(storeId).digest('hex') + '.json',
    )
  const load = (storeId: string) => {
    check(storeId)
    const target = file(storeId)
    if (!fs.existsSync(target)) {
      cache.delete(storeId)
      return storedSchema.parse({ version: 1, items: [] })
    }
    try {
      const stat = fs.statSync(target)
      if (stat.size > 32 * 1024 * 1024) throw Error('超出容量')
      const signature = [stat.dev, stat.ino, stat.size, stat.mtimeMs, stat.ctimeMs].join(':')
      const current = cache.get(storeId)
      if (current?.signature === signature) return current.state
      const state = storedSchema.parse(JSON.parse(fs.readFileSync(target, 'utf8')))
      cache.set(storeId, {
        signature,
        state,
        byId: new Map(state.items.map((row) => [row.productId, row])),
      })
      // Bound per-runtime memory while making same-store catalog/retrieval reads linear.
      if (cache.size > 4) cache.delete(cache.keys().next().value!)
      return state
    } catch {
      cache.delete(storeId)
      throw Error('平台商品来源存档损坏或超出容量，原文件未修改')
    }
  }
  return {
    get(storeId: string, productId: string): PlatformProductDetail | null {
      z.string().trim().min(1).max(100).parse(productId)
      const state = load(storeId)
      const cached = cache.get(storeId)
      return structuredClone(
        cached
          ? (cached.byId.get(productId) ?? null)
          : (state.items.find((row) => row.productId === productId) ?? null),
      )
    },
    upsert(storeId: string, input: unknown): void {
      check(storeId)
      const detail = platformProductDetailSchema.parse(input),
        state = load(storeId)
      const old = state.items.find((row) => row.productId === detail.productId)
      if (old && old.capturedAt > detail.capturedAt) throw Error('商品来源已更新，拒绝较早采集结果')
      const next = storedSchema.parse({
        version: 1,
        items: [...state.items.filter((row) => row.productId !== detail.productId), detail],
      })
      const content = JSON.stringify(next)
      if (Buffer.byteLength(content) > 32 * 1024 * 1024) throw Error('平台商品来源存档超出容量')
      check(storeId)
      const target = file(storeId),
        temporary = target + '.' + randomUUID() + '.tmp'
      fs.mkdirSync(path.dirname(target), { recursive: true })
      try {
        fs.writeFileSync(temporary, content, { flag: 'wx', mode: 0o600 })
        check(storeId)
        fs.renameSync(temporary, target)
        cache.delete(storeId)
      } finally {
        if (fs.existsSync(temporary)) fs.unlinkSync(temporary)
      }
    },
  }
}

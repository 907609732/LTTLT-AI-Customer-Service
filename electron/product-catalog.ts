import fs from 'node:fs'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { z } from 'zod'
import { productsPageSchema, type Product } from '../src/shared/contracts/backend'
import {
  productCatalogPageSchema,
  productCatalogQuerySchema,
  setProductCodesSchema,
} from '../src/shared/contracts/product-catalog'

interface Options {
  directory: string
  execute(command: {
    action: 'list-products'
    storeId: string
    values: { offset: number; limit: number }
  }): Promise<unknown>
  assertActive(): void
  assertStore(storeId: string): void
}
const storedSchema = z
  .object({
    version: z.literal(1),
    revision: z.number().int().nonnegative(),
    items: z
      .array(
        z
          .object({ id: z.string().min(1).max(128), merchantCode: z.string().trim().max(100) })
          .strict(),
      )
      .max(10000),
  })
  .strict()
  .refine(
    (value) => new Set(value.items.map((row) => row.id)).size === value.items.length,
    '编码存档存在重复商品',
  )
type Stored = z.infer<typeof storedSchema>
const nativePageSchema = z.object({ status: z.literal('ok'), data: productsPageSchema })
const writes = new Map<string, Promise<void>>()

/** Adds local merchant codes without changing upstream product IDs, records or retrieval policy. */
export function createProductCatalog(options: Options) {
  const check = (storeId: string) => {
    z.string().min(1).max(64).parse(storeId)
    options.assertActive()
    options.assertStore(storeId)
  }
  const file = (storeId: string) =>
    path.join(
      options.directory,
      'product-codes',
      createHash('sha256').update(storeId).digest('hex') + '.json',
    )
  function load(storeId: string): Stored {
    check(storeId)
    const target = file(storeId)
    if (!fs.existsSync(target)) return { version: 1, revision: 0, items: [] }
    if (fs.statSync(target).size > 4 * 1024 * 1024)
      throw Error('商品编码存档超出容量，原文件未修改')
    try {
      return storedSchema.parse(JSON.parse(fs.readFileSync(target, 'utf8')))
    } catch {
      throw Error('商品编码存档损坏，原文件未修改，请恢复备份')
    }
  }
  async function allProducts(storeId: string) {
    check(storeId)
    const rows: Product[] = [],
      ids = new Set<string>()
    let total: number | undefined, revision: number | undefined
    for (let offset = 0; offset <= 10000; offset += 100) {
      check(storeId)
      const page = nativePageSchema.parse(
        await options.execute({ action: 'list-products', storeId, values: { offset, limit: 100 } }),
      ).data
      check(storeId)
      if (
        !Number.isInteger(page.total) ||
        page.total < 0 ||
        page.total > 10000 ||
        !Number.isInteger(page.revision) ||
        page.revision < 0 ||
        page.items.length > 100
      )
        throw Error('商品列表超出容量或分页数据无效')
      if (total !== undefined && (page.total !== total || page.revision !== revision))
        throw Error('商品在采集期间已变化，请刷新重试')
      total = page.total
      revision = page.revision
      if (!page.items.length && rows.length < total) throw Error('商品分页为空，未采用不完整结果')
      for (const row of page.items) {
        if (row.storeId !== storeId || ids.has(row.id))
          throw Error('商品分页重复或店铺不符，未采用不完整结果')
        ids.add(row.id)
        rows.push(row)
      }
      if (rows.length > total) throw Error('商品数量与平台分页总数不一致')
      if (rows.length === total) return { revision, rows }
    }
    throw Error('商品列表超出单次读取容量')
  }
  function commit(storeId: string, state: Stored) {
    check(storeId)
    const target = file(storeId),
      temporary = target + '.' + randomUUID() + '.tmp'
    fs.mkdirSync(path.dirname(target), { recursive: true })
    try {
      fs.writeFileSync(temporary, JSON.stringify(storedSchema.parse(state)), {
        flag: 'wx',
        mode: 0o600,
      })
      fs.renameSync(temporary, target)
    } finally {
      if (fs.existsSync(temporary)) fs.unlinkSync(temporary)
    }
  }
  return {
    async list(storeId: string, values: unknown) {
      const query = productCatalogQuerySchema.parse(values)
      const codes = load(storeId)
      const products = await allProducts(storeId)
      check(storeId)
      if (load(storeId).revision !== codes.revision) throw Error('商品编码已更新，请刷新重试')
      const byId = new Map(codes.items.map((row) => [row.id, row.merchantCode]))
      const needle = query.query.toLocaleLowerCase(),
        codeNeedle = query.merchantCode.toLocaleLowerCase()
      const rows = products.rows
        .map((row) => ({ ...row, merchantCode: byId.get(row.id) ?? '' }))
        .filter(
          (row) =>
            (!needle ||
              row.title.toLocaleLowerCase().includes(needle) ||
              row.productId.toLocaleLowerCase().includes(needle)) &&
            (!codeNeedle || row.merchantCode.toLocaleLowerCase().includes(codeNeedle)),
        )
      return productCatalogPageSchema.parse({
        revision: products.revision,
        codesRevision: codes.revision,
        total: rows.length,
        items: rows.slice(query.offset, query.offset + query.limit),
      })
    },
    async setCodes(storeId: string, input: unknown) {
      const request = setProductCodesSchema.parse(input)
      check(storeId)
      const target = file(storeId)
      const previous = writes.get(target) ?? Promise.resolve()
      const job = previous.then(async () => {
        const codes = load(storeId)
        if (codes.revision !== request.revision) throw Error('商品编码已更新，请刷新后重新设置')
        const products = await allProducts(storeId)
        const byId = new Map(products.rows.map((row) => [row.id, row]))
        for (const row of request.rows) {
          const product = byId.get(row.id)
          if (!product) throw Error('商品不存在或不属于此店铺')
          if (product.version !== row.version) throw Error('商品已更新，请刷新后重新设置编码')
        }
        check(storeId)
        if (load(storeId).revision !== request.revision)
          throw Error('商品编码已更新，请刷新后重新设置')
        const next = new Map(codes.items.map((row) => [row.id, row.merchantCode]))
        for (const row of request.rows) {
          if (row.merchantCode) next.set(row.id, row.merchantCode)
          else next.delete(row.id)
        }
        // Discard metadata for removed product UUIDs; never attach an old code to a new product.
        const items = [...next]
          .filter(([id]) => byId.has(id))
          .map(([id, merchantCode]) => ({ id, merchantCode }))
        commit(storeId, { version: 1, revision: codes.revision + 1, items })
        return { revision: codes.revision + 1 }
      })
      const tail = job.then(
        () => {},
        () => {},
      )
      writes.set(target, tail)
      try {
        return await job
      } finally {
        if (writes.get(target) === tail) writes.delete(target)
      }
    },
  }
}

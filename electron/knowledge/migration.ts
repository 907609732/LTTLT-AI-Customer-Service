import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  copyFileSync,
  writeFileSync,
  statSync,
} from 'node:fs'
import { join, dirname } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { z } from 'zod'
import { platformProductDetailSchema } from '../../src/shared/contracts/platform-product'
import type { KnowledgeMigrationState } from '../../src/shared/contracts/knowledge'
import type { KnowledgeRepository } from './repository'
import {
  legacyProductSchema,
  legacyIntentSchema,
  ingestLegacyProduct,
  ingestLegacyIntent,
} from './legacy'
const digest = (bytes: string | Uint8Array) => createHash('sha256').update(bytes).digest('hex')
const productsSchema = z
  .object({
    version: z.literal(1),
    revision: z.number().int().nonnegative(),
    items: z.array(legacyProductSchema).max(10000),
  })
  .strict()
  .refine(
    (value) =>
      new Set(value.items.map((row) => row.id)).size === value.items.length &&
      new Set(value.items.map((row) => JSON.stringify([row.storeId, row.productId]))).size ===
        value.items.length,
    '重复商品',
  )
const intentsSchema = z
  .object({
    version: z.literal(1),
    revision: z.number().int().nonnegative(),
    packs: z.array(legacyIntentSchema).max(100),
  })
  .strict()
  .refine(
    (value) => new Set(value.packs.map((row) => row.id)).size === value.packs.length,
    '重复知识包',
  )
const platformSchema = z
  .object({ version: z.literal(1), items: z.array(platformProductDetailSchema).max(10000) })
  .strict()
  .refine(
    (value) => new Set(value.items.map((row) => row.productId)).size === value.items.length,
    '重复平台来源',
  )
/** Input paths are fixed main-process locations; callers never provide renderer paths. */
export function migrateLegacyKnowledge(
  repo: KnowledgeRepository,
  directory: string,
): KnowledgeMigrationState {
  const completed = repo.getMetadata('migration-v1')
  if (completed) {
    const state = JSON.parse(completed) as KnowledgeMigrationState
    if (state.status === 'complete') return state
  }
  const files = ['product-knowledge.json', 'intent-knowledge.json'].filter((file) =>
    existsSync(join(directory, file)),
  )
  const platformDirectory = join(directory, 'platform-products')
  if (existsSync(platformDirectory))
    for (const file of readdirSync(platformDirectory))
      if (/^[a-zA-Z0-9_-]+\.json$/.test(file) && statSync(join(platformDirectory, file)).isFile())
        files.push(`platform-products/${file}`)
  if (!files.length)
    return { status: 'not-needed', error: '', backupDirectory: null, inputHashes: {}, idMap: {} }
  const state: KnowledgeMigrationState = {
    status: 'failed',
    error: '',
    backupDirectory: join(directory, 'knowledge-migration-backups', randomUUID()),
    inputHashes: {},
    idMap: {},
  }
  try {
    mkdirSync(state.backupDirectory!, { recursive: true })
    for (const file of files) {
      const from = join(directory, file),
        to = join(state.backupDirectory!, file)
      mkdirSync(dirname(to), { recursive: true })
      copyFileSync(from, to)
      if (statSync(from).size > 32 * 1024 * 1024) throw Error('旧知识文件超过32MB，未迁移')
      state.inputHashes[file] = digest(readFileSync(to))
    }
    writeFileSync(
      join(state.backupDirectory!, 'input-manifest.json'),
      JSON.stringify(state.inputHashes, null, 2),
    )
    const productState = files.includes('product-knowledge.json')
      ? productsSchema.parse(
          JSON.parse(readFileSync(join(state.backupDirectory!, 'product-knowledge.json'), 'utf8')),
        )
      : { version: 1, revision: 0, items: [] }
    const intentState = files.includes('intent-knowledge.json')
      ? intentsSchema.parse(
          JSON.parse(readFileSync(join(state.backupDirectory!, 'intent-knowledge.json'), 'utf8')),
        )
      : { version: 1, revision: 0, packs: [] }
    const rawPlatforms = files
      .filter((file) => file.startsWith('platform-products/'))
      .map((file) => ({
        file,
        state: platformSchema.parse(
          JSON.parse(readFileSync(join(state.backupDirectory!, file), 'utf8')),
        ),
      }))
    repo.transaction(() => {
      for (const product of productState.items) {
        const mapping = ingestLegacyProduct(repo, product, true)
        state.idMap[`product:${product.id}`] = mapping.canonicalId
        state.idMap[`binding:${product.id}`] = mapping.bindingId
      }
      for (const pack of intentState.packs) {
        ingestLegacyIntent(repo, pack, true)
        state.idMap[`intent:${pack.id}`] = pack.id
        for (const [index, entry] of pack.entries.entries()) {
          if (entry.question === '【学习来源审计，请保持停用】') {
            const sourceId = repo.getMetadata(`legacy-audit:${pack.id}:${index}`)
            if (sourceId) state.idMap[`audit:${pack.id}:${index}`] = sourceId
          }
        }
      }
      const stores = [
        ...new Set([
          ...productState.items.map((row) => row.storeId),
          ...intentState.packs.flatMap((pack) => pack.storeIds),
        ]),
      ]
      // Existing stores.json only helps map hashed source names; it is never copied into the knowledge DB.
      if (existsSync(join(directory, 'stores.json'))) {
        const registry: unknown = JSON.parse(readFileSync(join(directory, 'stores.json'), 'utf8'))
        const listSchema = z.array(z.object({ id: z.string().min(1).max(200) }).passthrough())
        const schema = z.union([listSchema, z.object({ stores: listSchema }).passthrough()])
        const parsed = schema.safeParse(registry)
        if (parsed.success)
          stores.push(
            ...(Array.isArray(parsed.data) ? parsed.data : parsed.data.stores).map(
              (store) => store.id,
            ),
          )
      }
      for (const platform of rawPlatforms) {
        const storeId = stores.find(
          (store) => `platform-products/${digest(store)}.json` === platform.file,
        )
        if (!storeId && platform.state.items.length)
          throw Error('无法确认平台来源店铺，拒绝猜测关联')
        if (!storeId) continue
        for (const detail of platform.state.items) {
          let binding = repo
            .listBindings()
            .find(
              (row) => row.storeId === storeId && row.productId === detail.productId && !row.skuId,
            )
          if (!binding) {
            const canonical = repo.saveCanonical({ title: detail.title, code: detail.merchantCode })
            binding = repo.bindProduct({
              canonicalId: canonical.id,
              storeId,
              productId: detail.productId,
              title: detail.title,
            })
          }
          const raw = repo.saveSource({
            kind: 'platform',
            storeId,
            bindingId: binding.id,
            label: detail.title,
            text: JSON.stringify(detail),
            locator: { url: detail.sourceUrl },
          })
          state.idMap[`platform:${storeId}:${detail.productId}`] = raw.id
          for (const sku of detail.skus)
            if (sku.skuId)
              repo.bindProduct({
                canonicalId: binding.canonicalId,
                storeId,
                productId: detail.productId,
                skuId: sku.skuId,
                title: sku.specs.map((spec) => `${spec.name}:${spec.value}`).join(' '),
              })
        }
      }
      if (
        repo.rows('legacy_products').length !== productState.items.length ||
        repo.rows('legacy_intents').length !== intentState.packs.length
      )
        throw Error('迁移数量核验失败')
      const migratedProducts = repo.products.list.bind(repo.products)
      for (const product of productState.items)
        if (
          migratedProducts(product.storeId, { limit: 100 }).total < 1 ||
          repo.row<{ enabled: boolean }>('legacy_products', product.id)?.enabled !== product.enabled
        )
          throw Error('迁移启停核验失败')
      repo.setMetadata('legacy-products-revision', String(productState.revision))
      repo.setMetadata('legacy-intents-revision', String(intentState.revision))
      for (const file of files)
        if (digest(readFileSync(join(directory, file))) !== state.inputHashes[file])
          throw Error('旧资料在迁移期间变化，已回滚，请关闭旧写入后重试')
      state.status = 'complete'
      state.error = ''
      repo.setMetadata('migration-v1', JSON.stringify(state))
    })
    return state
  } catch (error) {
    state.status = 'failed'
    state.error = error instanceof Error ? error.message : '知识迁移失败'
    state.idMap = {}
    repo.setMetadata('migration-v1', JSON.stringify(state))
    return state
  }
}

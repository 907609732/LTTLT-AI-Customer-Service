import { createHash, randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { z } from 'zod'
import {
  productsPageSchema,
  type BackendCommand,
  type BackendResult,
  type BackendSnapshot,
  type Product,
} from '../src/shared/contracts/backend'
import {
  syncApplySchema,
  syncRequestSchema,
  syncRollbackSchema,
  type SyncBackup,
  type SyncPreview,
  type SyncRequest,
  type SyncResult,
  type SyncSection,
} from '../src/shared/contracts/store-sync'

/** Port must use the current account's backend, and reject inactive/restart-required workspaces. */
export interface StoreSyncPort {
  snapshot(): BackendSnapshot
  execute(command: BackendCommand): Promise<BackendResult>
  assertActive(): void
}
const fieldsSchema = z.record(z.string(), z.unknown())
const operationSchema = z
  .object({
    storeId: z.string().min(1).max(64),
    section: z.enum(['products', 'welcome', 'vision', 'handoff']),
    key: z.string(),
    before: fieldsSchema.nullable(),
    after: fieldsSchema,
    state: z.enum(['pending', 'writing', 'applied', 'restoring', 'restored']),
  })
  .strict()
type Operation = z.infer<typeof operationSchema>
const journalSchema = z
  .object({
    version: z.literal(1),
    backupId: z.string().uuid(),
    createdAt: z.number(),
    sourceStoreId: z.string(),
    targetStoreIds: z.array(z.string()),
    status: z.enum(['completed', 'failed', 'rolled-back', 'rollback-blocked']),
    error: z.string().optional(),
    operations: z.array(operationSchema).max(2000),
  })
  .strict()
type Journal = z.infer<typeof journalSchema>
type StoreState = {
  products: Product[]
  welcome: Record<string, unknown>
  vision: Record<string, unknown>
  handoff: Record<string, unknown>
}
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const productFields = (p: Product): Record<string, unknown> => ({
  productId: p.productId,
  title: p.title,
  description: p.description,
  specifications: p.specifications,
  price: p.price,
  enabled: p.enabled,
})
const businessFields = (section: SyncSection, value: Record<string, unknown> | null) => {
  if (!value) return null
  if (section === 'products') return productFields(value as Product)
  if (section === 'welcome') return { text: value.text, enabled: value.enabled }
  if (section === 'vision') return { enabled: value.enabled }
  return value
}
const same = (
  section: SyncSection,
  a: Record<string, unknown> | null,
  b: Record<string, unknown> | null,
) => hash(businessFields(section, a)) === hash(businessFields(section, b))

/** Narrow business-copy coordinator: all writes reuse versioned upstream commands; no arbitrary JSON patches. */
export function createStoreSync({ directory, port }: { directory: string; port: StoreSyncPort }) {
  const plans = new Map<
    string,
    { request: SyncRequest; preview: SyncPreview; fingerprint: string; operations: Operation[] }
  >()
  let busy = false
  let disposed = false
  const check = () => {
    if (disposed) throw Error('同步服务已关闭')
    port.assertActive()
    return port.snapshot()
  }
  const file = (id: string) => path.join(directory, `${z.string().uuid().parse(id)}.json`)
  function save(journal: Journal) {
    mkdirSync(directory, { recursive: true })
    const target = file(journal.backupId)
    // Flush before renaming: an operation never starts before its recovery intent is on disk.
    const temporary = `${target}.tmp`
    writeFileSync(temporary, JSON.stringify(journalSchema.parse(journal)), {
      encoding: 'utf8',
      mode: 0o600,
      flush: true,
    })
    renameSync(temporary, target)
  }
  function read(id: string) {
    return journalSchema.parse(JSON.parse(readFileSync(file(id), 'utf8')))
  }
  async function exclusive<T>(work: () => Promise<T>): Promise<T> {
    check()
    if (busy) throw Error('正在同步或回滚，请等待当前操作完成')
    busy = true
    try {
      return await work()
    } finally {
      busy = false
    }
  }
  async function command(
    action: BackendCommand['action'],
    storeId: string,
    values: Record<string, unknown>,
  ) {
    const snap = check()
    if (!snap.stores.some((s) => s.id === storeId)) throw Error('店铺已移除，请重新预览')
    return port.execute({ workspaceId: snap.workspaceId, action, storeId, values })
  }
  async function state(storeId: string, sections: SyncSection[]): Promise<StoreState> {
    const snap = check()
    if (!snap.stores.some((s) => s.id === storeId)) throw Error('店铺已移除，请重新预览')
    const products: Product[] = []
    let revision: number | undefined
    if (sections.includes('products')) {
      for (let offset = 0; ; offset += 100) {
        const page = productsPageSchema.parse(
          (await command('list-products', storeId, { offset, limit: 100 })).data,
        )
        if (revision !== undefined && page.revision !== revision)
          throw Error('商品已变化，请重新预览')
        if (page.items.some((p) => p.storeId !== storeId) || page.total > 10000)
          throw Error('商品店铺或数量异常')
        revision = page.revision
        products.push(...page.items)
        if (products.length >= page.total) break
        if (!page.items.length) throw Error('商品分页不完整')
      }
      if (new Set(products.map((p) => p.productId)).size !== products.length)
        throw Error('商品编号重复')
    }
    return {
      products,
      welcome: { ...(snap.welcomeByStore[storeId] || { text: '', enabled: false, version: 0 }) },
      vision: { ...(snap.visionByStore[storeId] || { enabled: false, version: 0 }) },
      handoff: snap.handoffByStore[storeId]
        ? { mode: 'custom', keywords: [...snap.handoffByStore[storeId].keywords] }
        : { mode: 'inherit' },
    }
  }
  function current(s: StoreState, op: Operation): Record<string, unknown> | null {
    return op.section === 'products'
      ? (s.products.find((p) => p.productId === op.key) as Record<string, unknown> | undefined) ||
          null
      : s[op.section]
  }
  async function collect(request: SyncRequest) {
    const all: Record<string, StoreState> = Object.create(null)
    for (const id of [request.sourceStoreId, ...request.targetStoreIds])
      all[id] = await state(id, request.sections)
    return all
  }
  function fingerprint(request: SyncRequest, all: Record<string, StoreState>) {
    return hash({
      workspaceId: check().workspaceId,
      stores: [request.sourceStoreId, ...request.targetStoreIds].map((id) => ({
        id,
        products: request.sections.includes('products') ? all[id].products : undefined,
        welcome: request.sections.includes('welcome') ? all[id].welcome : undefined,
        vision: request.sections.includes('vision') ? all[id].vision : undefined,
        handoff: request.sections.includes('handoff') ? all[id].handoff : undefined,
      })),
    })
  }
  async function preview(input: unknown): Promise<SyncPreview> {
    return exclusive(async () => {
      const request = syncRequestSchema.parse(input)
      const all = await collect(request),
        source = all[request.sourceStoreId]
      const rows: SyncPreview['rows'] = [],
        operations: Operation[] = []
      const entries: { section: SyncSection; key: string; after: Record<string, unknown> }[] = []
      for (const section of request.sections) {
        if (section === 'products')
          for (const id of request.productIds) {
            const product = source.products.find((p) => p.productId === id)
            if (!product) throw Error(`源店商品不存在：${id}`)
            entries.push({ section, key: id, after: productFields(product) })
          }
        else
          entries.push({ section, key: section, after: businessFields(section, source[section])! })
      }
      for (const storeId of request.targetStoreIds)
        for (const entry of entries) {
          const op: Operation = { ...entry, storeId, before: null, state: 'pending' }
          op.before = current(all[storeId], op)
          const exists =
            entry.section === 'products'
              ? Boolean(op.before)
              : entry.section === 'handoff'
                ? op.before?.mode === 'custom'
                : Number(op.before?.version) > 0
          const action = same(op.section, op.before, op.after)
            ? 'unchanged'
            : exists && request.conflict === 'skip'
              ? 'skip'
              : exists
                ? 'replace'
                : 'add'
          rows.push({ storeId, section: op.section, key: op.key, action })
          if (action === 'add' || action === 'replace') operations.push(op)
        }
      if (operations.length > 2000) throw Error('单次同步最多 2000 个变更，请缩小范围')
      const value: SyncPreview = {
        planId: randomUUID(),
        expiresAt: Date.now() + 10 * 60_000,
        rows,
        warnings: [
          '商品按相同商品编号复制，请确认各店商品编号对应；不会修改平台商品。',
          '只复制本店配置；继承关键词仍使用当前工作区全局规则。同步不会开启店铺 AI。',
          '失败可能已完成部分变更，请使用对应备份回滚；回滚不会覆盖后续人工修改。',
        ],
      }
      for (const [id, p] of plans) if (p.preview.expiresAt < Date.now()) plans.delete(id)
      if (plans.size >= 20) plans.delete(plans.keys().next().value!)
      plans.set(value.planId, {
        request,
        preview: value,
        fingerprint: fingerprint(request, all),
        operations,
      })
      return structuredClone(value)
    })
  }
  async function write(
    op: Operation,
    value: Record<string, unknown> | null,
    existing: Record<string, unknown> | null,
  ) {
    if (op.section === 'products') {
      if (!value) {
        if (existing)
          await command('remove-product', op.storeId, {
            id: existing.id,
            version: existing.version,
            confirmed: true,
          })
        return
      }
      await command('save-product', op.storeId, {
        ...businessFields('products', value),
        ...(existing ? { id: existing.id, version: existing.version } : {}),
      })
    } else if (op.section === 'handoff') await command('save-store-handoff', op.storeId, value!)
    else
      await command(
        op.section === 'welcome' ? 'save-welcome' : 'save-vision-settings',
        op.storeId,
        { ...businessFields(op.section, value), version: existing?.version || 0 },
      )
  }
  function result(j: Journal): SyncResult {
    return {
      backupId: j.backupId,
      status: j.status,
      applied: j.operations.filter(
        (o) => o.state === 'applied' || o.state === 'restoring' || o.state === 'restored',
      ).length,
      restored: j.operations.filter((o) => o.state === 'restored').length,
      ...(j.error ? { error: j.error } : {}),
    }
  }
  async function apply(input: unknown): Promise<SyncResult> {
    return exclusive(async () => {
      const { planId } = syncApplySchema.parse(input),
        plan = plans.get(planId)
      if (!plan || plan.preview.expiresAt < Date.now()) throw Error('预览已过期，请重新预览')
      plans.delete(planId)
      if (fingerprint(plan.request, await collect(plan.request)) !== plan.fingerprint)
        throw Error('源店或目标店已更新，请重新预览')
      const j: Journal = {
        version: 1,
        backupId: randomUUID(),
        createdAt: Date.now(),
        sourceStoreId: plan.request.sourceStoreId,
        targetStoreIds: plan.request.targetStoreIds,
        status: 'failed',
        operations: structuredClone(plan.operations),
      }
      save(j)
      try {
        for (const op of j.operations) {
          const old = current(await state(op.storeId, [op.section]), op)
          if (hash(old) !== hash(op.before)) throw Error('目标配置已变化，停止同步')
          op.state = 'writing'
          save(j)
          await write(op, op.after, old)
          op.state = 'applied'
          save(j)
        }
        j.status = 'completed'
      } catch (error) {
        j.error = error instanceof Error ? error.message : String(error)
      }
      save(j)
      return result(j)
    })
  }
  async function rollback(input: unknown): Promise<SyncResult> {
    return exclusive(async () => {
      const { backupId } = syncRollbackSchema.parse(input),
        j = read(backupId)
      check()
      if (
        j.operations.some(
          (op) => op.storeId === j.sourceStoreId || !j.targetStoreIds.includes(op.storeId),
        )
      )
        throw Error('备份目标范围异常，拒绝回滚')
      if (j.status === 'rolled-back') return result(j)
      j.error = undefined
      try {
        // Validate every affected row before undoing anything, so known conflicts do not cause partial rollback.
        const pending: { op: Operation; old: Record<string, unknown> | null }[] = []
        for (const op of [...j.operations].reverse()) {
          if (op.state === 'pending' || op.state === 'restored') continue
          const old = current(await state(op.storeId, [op.section]), op)
          if (
            hash(old) === hash(op.before) ||
            (op.state === 'restoring' && same(op.section, old, op.before))
          ) {
            // A failed write still at its original value was never applied; do not count it as restored.
            op.state =
              op.state === 'writing' && hash(old) === hash(op.before) ? 'pending' : 'restored'
            continue
          }
          const expectedVersion = Number(op.before?.version || 0) + 1
          if (
            !same(op.section, old, op.after) ||
            (op.section !== 'handoff' && old?.version !== expectedVersion)
          )
            throw Error(`${op.storeId} / ${op.key} 已有后续修改，回滚被阻止`)
          pending.push({ op, old })
        }
        for (const { op, old } of pending) {
          if (hash(current(await state(op.storeId, [op.section]), op)) !== hash(old))
            throw Error('回滚期间配置变化，请重新核对')
          op.state = 'restoring'
          save(j)
          await write(op, op.before, old)
          op.state = 'restored'
          save(j)
        }
        j.status = 'rolled-back'
      } catch (error) {
        j.status = 'rollback-blocked'
        j.error = error instanceof Error ? error.message : String(error)
      }
      save(j)
      return result(j)
    })
  }
  function backups(): SyncBackup[] {
    check()
    mkdirSync(directory, { recursive: true })
    return readdirSync(directory)
      .filter((n) => /^[0-9a-f-]{36}\.json$/i.test(n))
      .map((n) => {
        const j = read(n.slice(0, -5))
        return {
          ...result(j),
          createdAt: j.createdAt,
          sourceStoreId: j.sourceStoreId,
          targetStoreIds: j.targetStoreIds,
        }
      })
      .sort((a, b) => b.createdAt - a.createdAt)
  }
  return {
    preview,
    apply,
    rollback,
    backups,
    isBusy: () => busy,
    dispose: () => {
      disposed = true
      plans.clear()
    },
  }
}

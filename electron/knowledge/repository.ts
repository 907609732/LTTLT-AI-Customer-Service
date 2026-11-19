import { isRecoverableKnowledgeJob } from '../../src/shared/knowledge-progress'
import { createHash, randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join, dirname, toNamespacedPath } from 'node:path'
import { z } from 'zod'
import {
  knowledgeDraftSchema,
  knowledgeScopeSchema,
  knowledgeSourceInputSchema,
  knowledgeSettingsSchema,
  knowledgePageSchema,
  knowledgePublishSchema,
  canonicalProductInputSchema,
  productBindingInputSchema,
  knowledgeCommandSchema,
  knowledgeQuerySchema,
  knowledgeResolveSchema,
  type CanonicalProduct,
  type ProductBinding,
  type KnowledgeDraftInput,
  type KnowledgeVersion,
  type KnowledgeEntry,
  type KnowledgeSourceInput,
  type KnowledgeSource,
  type KnowledgeAsset,
  type KnowledgePublishInput,
  type KnowledgeResolveInput,
  type KnowledgeCitation,
  type KnowledgeSettings,
  type KnowledgePageInput,
  type KnowledgePage,
  type KnowledgeMissPageInput,
  type KnowledgeJob,
  type KnowledgeMiss,
  type KnowledgeBackupManifest,
  type KnowledgeMigrationState,
  type KnowledgeCommand,
  type KnowledgeQuery,
} from '../../src/shared/contracts/knowledge'
import { KNOWLEDGE_PRODUCT_PROFILE_SOURCE_LABEL } from '../../src/shared/contracts/knowledge-product-profile'
import { eligibleKnowledge, resolveKnowledgeRows } from './resolver'
import { migrateLegacyKnowledge } from './migration'
import { createLegacyPorts } from './legacy'
import {
  assertKnowledgeWriterStopped,
  registerKnowledgeWriter,
  unregisterKnowledgeWriter,
} from './lifecycle'
import { knowledgeRequire } from './node-loader'
import { pruneToFamily } from './backup-scope'
import { pruneToStore } from './backup-store-scope'
import { questionConflictKey, repairAutomaticConflictKeys } from './conflict-keys'
import { assertNoInterruptedKnowledgeRestore } from './restore-intent'
import { clearKnowledgeCopy } from './clear'
import type { KnowledgeClearScope } from '../../src/shared/contracts/knowledge-client'
const { DatabaseSync } = knowledgeRequire('node:sqlite') as typeof import('node:sqlite')
type Table =
  | 'canonical'
  | 'bindings'
  | 'sources'
  | 'entries'
  | 'jobs'
  | 'misses'
  | 'assets'
  | 'legacy_products'
  | 'legacy_intents'
const hash = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex')
export interface KnowledgeRepositoryOptions {
  directory: string
  workspaceId: string
  now?: () => number
}
export function createKnowledgeRepository(options: KnowledgeRepositoryOptions) {
  return new KnowledgeRepository(options)
}
export class KnowledgeRepository {
  private readonly db: import('node:sqlite').DatabaseSync
  private readonly now: () => number
  private depth = 0
  private closed = false
  private migration: KnowledgeMigrationState = {
    status: 'not-needed',
    error: '',
    backupDirectory: null,
    inputHashes: {},
    idMap: {},
  }
  readonly products: ReturnType<typeof createLegacyPorts>['products']
  readonly intents: ReturnType<typeof createLegacyPorts>['intents']
  constructor(private readonly options: KnowledgeRepositoryOptions) {
    mkdirSync(options.directory, { recursive: true })
    assertKnowledgeWriterStopped(options.directory)
    assertNoInterruptedKnowledgeRestore(options.directory)
    this.now = options.now ?? Date.now
    // Preserve account directories; SQLite needs an explicit Windows namespace for deep paths.
    this.db = new DatabaseSync(toNamespacedPath(join(options.directory, 'knowledge.sqlite')))
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL) STRICT;
      INSERT OR IGNORE INTO metadata VALUES('revision','0');
      CREATE TABLE IF NOT EXISTS canonical(id TEXT PRIMARY KEY,body TEXT NOT NULL) STRICT;
      CREATE TABLE IF NOT EXISTS bindings(id TEXT PRIMARY KEY,canonical_id TEXT NOT NULL REFERENCES canonical(id),store_id TEXT NOT NULL,product_id TEXT NOT NULL,sku_id TEXT NOT NULL,active INTEGER NOT NULL,body TEXT NOT NULL,UNIQUE(store_id,product_id,sku_id)) STRICT;
      CREATE INDEX IF NOT EXISTS binding_store ON bindings(store_id,active,product_id);
      CREATE TABLE IF NOT EXISTS sources(id TEXT PRIMARY KEY,store_id TEXT NOT NULL,binding_id TEXT REFERENCES bindings(id),body TEXT NOT NULL) STRICT;
      CREATE INDEX IF NOT EXISTS source_binding ON sources(binding_id);
      CREATE TABLE IF NOT EXISTS source_versions(id TEXT NOT NULL,revision INTEGER NOT NULL,body TEXT NOT NULL,PRIMARY KEY(id,revision)) STRICT;
      CREATE TABLE IF NOT EXISTS entries(id TEXT PRIMARY KEY,body TEXT NOT NULL) STRICT;
      CREATE INDEX IF NOT EXISTS entry_approved_canonical ON entries(json_extract(body,'$.approved.scope.canonicalId'));
      CREATE INDEX IF NOT EXISTS entry_approved_binding ON entries(json_extract(body,'$.approved.scope.bindingId'));
      CREATE TABLE IF NOT EXISTS entry_versions(id TEXT NOT NULL,revision INTEGER NOT NULL,reviewed INTEGER NOT NULL,body TEXT NOT NULL,PRIMARY KEY(id,revision)) STRICT;
      CREATE TABLE IF NOT EXISTS reviews(id TEXT PRIMARY KEY,entry_id TEXT NOT NULL,revision INTEGER NOT NULL,at INTEGER NOT NULL,reason TEXT NOT NULL) STRICT;
      CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY,body TEXT NOT NULL) STRICT;
      CREATE TABLE IF NOT EXISTS misses(id TEXT PRIMARY KEY,body TEXT NOT NULL) STRICT;
      CREATE TABLE IF NOT EXISTS assets(id TEXT PRIMARY KEY,body TEXT NOT NULL) STRICT;
      CREATE TABLE IF NOT EXISTS legacy_products(id TEXT PRIMARY KEY,body TEXT NOT NULL) STRICT;
      CREATE TABLE IF NOT EXISTS legacy_intents(id TEXT PRIMARY KEY,body TEXT NOT NULL) STRICT;`)
    const ports = createLegacyPorts(this)
    this.products = ports.products
    this.intents = ports.intents
    this.migration = migrateLegacyKnowledge(this, options.directory)
    if (this.migration.status !== 'failed')
      this.transaction(() => {
        repairAutomaticConflictKeys(this.db)
        for (const job of this.rows<KnowledgeJob>('jobs'))
          if (
            job.status === 'running' ||
            (['learn', 'collect', 'import', 'daily-check'].includes(job.kind) &&
              job.status === 'queued')
          )
            this.put('jobs', {
              ...job,
              status:
                job.kind === 'learn' && job.checkpoint.state === 'submitted'
                  ? 'needs-confirmation'
                  : 'paused',
              revision: job.revision + 1,
              error: '应用已退出；请确认后继续，未自动重试模型调用',
              updatedAt: this.now(),
            })
      })
    registerKnowledgeWriter(options.directory)
  }
  get revision() {
    return Number(this.getMetadata('revision') ?? '0')
  }
  get readOnly() {
    return this.migration.status === 'failed'
  }
  get directory() {
    return this.options.directory
  }
  getMigrationState(): KnowledgeMigrationState {
    return structuredClone(this.migration)
  }
  getMetadata(key: string): string | null {
    this.assertOpen()
    const row = this.db.prepare('SELECT value FROM metadata WHERE key=?').get(key) as
      | { value: string }
      | undefined
    return row?.value ?? null
  }
  setMetadata(key: string, value: string) {
    this.assertWritable()
    this.db.prepare('INSERT OR REPLACE INTO metadata VALUES(?,?)').run(key, value)
  }
  private assertOpen() {
    if (this.closed) throw Error('知识仓储已关闭')
  }
  assertWritable() {
    this.assertOpen()
    if (this.readOnly) throw Error('知识迁移失败，旧数据只读，请恢复备份后重试')
  }
  transaction<T>(run: () => T): T {
    this.assertWritable()
    if (this.depth) return run()
    this.db.exec('BEGIN IMMEDIATE')
    this.depth++
    try {
      const result = run()
      this.db
        .prepare("UPDATE metadata SET value=CAST(value AS INTEGER)+1 WHERE key='revision'")
        .run()
      this.db.exec('COMMIT')
      return result
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    } finally {
      this.depth--
    }
  }
  rows<T>(table: Table): T[] {
    this.assertOpen()
    return this.db
      .prepare(`SELECT body FROM ${table} ORDER BY rowid`)
      .all()
      .map((row) => JSON.parse((row as { body: string }).body) as T)
  }
  row<T>(table: Table, id: string): T | null {
    this.assertOpen()
    const row = this.db.prepare(`SELECT body FROM ${table} WHERE id=?`).get(id) as
      | { body: string }
      | undefined
    return row ? (JSON.parse(row.body) as T) : null
  }
  put<T extends { id: string }>(table: Exclude<Table, 'bindings' | 'sources'>, value: T) {
    this.assertWritable()
    this.db
      .prepare(`INSERT OR REPLACE INTO ${table}(id,body) VALUES(?,?)`)
      .run(value.id, JSON.stringify(value))
    return value
  }
  deleteRow(table: Table, id: string) {
    this.assertWritable()
    this.db.prepare(`DELETE FROM ${table} WHERE id=?`).run(id)
  }
  private expectRevision(
    old: { revision: number } | null,
    expected: number | undefined,
    id?: string,
  ) {
    if (id && !old) throw Error('资料不存在')
    if (old && old.revision !== expected) throw Error('revision conflict：资料已更新，请刷新')
  }
  saveCanonical(input: z.input<typeof canonicalProductInputSchema>): CanonicalProduct {
    const value = canonicalProductInputSchema.parse(input)
    if (value.id && this.getMetadata(`removed-canonical:${value.id}`) === '1')
      throw Error('商品已从全库移除，请从备份恢复')
    return this.transaction(() => {
      const old = value.id ? this.getCanonical(value.id) : null
      this.expectRevision(old, value.expectedRevision, value.id)
      return this.put('canonical', {
        id: old?.id ?? randomUUID(),
        title: value.title,
        code: value.code,
        revision: (old?.revision ?? 0) + 1,
        updatedAt: this.now(),
      })
    })
  }
  getCanonical(id: string) {
    return this.row<CanonicalProduct>('canonical', id)
  }
  bindProduct(input: z.input<typeof productBindingInputSchema>): ProductBinding {
    const value = productBindingInputSchema.parse(input)
    return this.transaction(() => {
      if (!this.getCanonical(value.canonicalId)) throw Error('共享商品不存在')
      if (this.getMetadata(`removed-canonical:${value.canonicalId}`) === '1')
        throw Error('共享商品已从全库移除')
      const cleared = !value.id
        ? this.rows<ProductBinding>('bindings').find(
            (b) =>
              !b.active &&
              b.storeId === value.storeId &&
              b.productId === value.productId &&
              b.skuId === value.skuId &&
              (this.getMetadata(`cleared-binding:${b.id}`) === '1' ||
                this.getMetadata(`removed-canonical:${b.canonicalId}`) === '1'),
          )
        : undefined
      const old = value.id ? this.getBinding(value.id) : (cleared ?? null)
      if (!cleared) this.expectRevision(old, value.expectedRevision, value.id)
      // Recollection reuses the physical identity, but never revives a removed family's facts.
      // Tombstone retained sources before moving this identity into the fresh family.
      if (
        cleared &&
        this.getMetadata(`cleared-binding:${cleared.id}`) !== '1' &&
        this.getMetadata(`removed-canonical:${cleared.canonicalId}`) === '1'
      ) {
        for (const entry of this.rows<KnowledgeEntry>('entries')) {
          if (
            entry.status !== 'withdrawn' &&
            [entry.draft.scope, ...(entry.approved ? [entry.approved.scope] : [])].some(
              (scope) => scope.kind === 'binding' && scope.bindingId === cleared.id,
            )
          )
            this.withdraw(entry.id, entry.revision)
        }
        for (const source of this.listSources({ bindingId: cleared.id })) {
          if (!source.removed)
            this.saveSource({
              id: source.id,
              expectedRevision: source.revision,
              kind: source.kind,
              storeId: source.storeId,
              bindingId: source.bindingId,
              label: source.label,
              text: source.text,
              locator: source.locator,
              assetIds: source.assetIds,
              removed: true,
            })
          this.setMetadata(`cleared-source:${source.id}`, '1')
        }
      }
      if (
        old &&
        (old.storeId !== value.storeId ||
          old.productId !== value.productId ||
          old.skuId !== value.skuId)
      )
        throw Error('商品绑定身份（店铺、商品编号、SKU）不能直接修改，请新建绑定并重新审核')
      const next: ProductBinding = {
        id: old?.id ?? randomUUID(),
        canonicalId: value.canonicalId,
        storeId: value.storeId,
        productId: value.productId,
        skuId: value.skuId,
        title: value.title,
        active: true,
        revision: (old?.revision ?? 0) + 1,
        updatedAt: this.now(),
      }
      this.db
        .prepare(
          'INSERT INTO bindings(id,canonical_id,store_id,product_id,sku_id,active,body) VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET canonical_id=excluded.canonical_id,store_id=excluded.store_id,product_id=excluded.product_id,sku_id=excluded.sku_id,active=excluded.active,body=excluded.body',
        )
        .run(
          next.id,
          next.canonicalId,
          next.storeId,
          next.productId,
          next.skuId,
          1,
          JSON.stringify(next),
        )
      this.db.prepare('DELETE FROM metadata WHERE key=?').run(`cleared-binding:${next.id}`)
      return next
    })
  }
  getBinding(id: string) {
    return this.row<ProductBinding>('bindings', id)
  }
  listBindings(canonicalId?: string) {
    return this.rows<ProductBinding>('bindings').filter(
      (binding) => binding.active && (!canonicalId || binding.canonicalId === canonicalId),
    )
  }
  unlinkBinding(id: string, expectedRevision: number) {
    return this.transaction(() => {
      const old = this.getBinding(id)
      this.expectRevision(old, expectedRevision, id)
      const targets = old!.skuId
        ? [old!]
        : [
            old!,
            ...this.listBindings().filter(
              (binding) =>
                binding.id !== id &&
                binding.storeId === old!.storeId &&
                binding.productId === old!.productId,
            ),
          ]
      let result = old!
      for (const target of targets) {
        const next = {
          ...target,
          active: false,
          revision: target.revision + 1,
          updatedAt: this.now(),
        }
        this.db
          .prepare('UPDATE bindings SET active=0,body=? WHERE id=?')
          .run(JSON.stringify(next), target.id)
        if (target.id === id) result = next
      }
      return result
    })
  }
  removeStore(storeId: string) {
    return this.transaction(() => {
      // Store removal revokes applications without modifying the shared approved version.
      this.setMetadata(`removed-store:${storeId}`, '1')
      for (const binding of this.listBindings().filter((b) => b.storeId === storeId)) {
        const current = this.getBinding(binding.id)
        if (current?.active) this.unlinkBinding(current.id, current.revision)
      }
      for (const job of this.rows<KnowledgeJob>('jobs').filter(
        (job) =>
          job.storeId === storeId && !['succeeded', 'failed', 'cancelled'].includes(job.status),
      ))
        this.updateJob(job.id, { expectedRevision: job.revision, status: 'cancelled' })
      for (const entry of this.rows<KnowledgeEntry>('entries')) {
        const scope = entry.draft.scope
        if (scope.kind === 'store' && scope.storeId === storeId)
          this.withdraw(entry.id, entry.revision)
      }
    })
  }
  removeCanonical(canonicalId: string) {
    return this.transaction(() => {
      const bindings = this.listBindings(canonicalId),
        ids = new Set(bindings.map((b) => b.id))
      for (const b of bindings)
        if (this.getBinding(b.id)?.active) this.unlinkBinding(b.id, this.getBinding(b.id)!.revision)
      for (const e of this.rows<KnowledgeEntry>('entries')) {
        const scopes = [e.draft.scope, ...(e.approved ? [e.approved.scope] : [])]
        if (
          scopes.some((s) =>
            s.kind === 'canonical'
              ? s.canonicalId === canonicalId
              : s.kind === 'binding' && ids.has(s.bindingId),
          )
        )
          this.withdraw(e.id, e.revision)
      }
      for (const job of this.rows<KnowledgeJob>('jobs'))
        if (
          !['succeeded', 'cancelled'].includes(job.status) &&
          [...ids].some((id) => JSON.stringify(job.payload).includes(JSON.stringify(id)))
        )
          this.updateJob(job.id, {
            expectedRevision: job.revision,
            status: 'cancelled',
            error: '所属同款已从全库移除',
          })
      this.setMetadata(`removed-canonical:${canonicalId}`, '1')
    })
  }
  saveSource(input: KnowledgeSourceInput): KnowledgeSource {
    const value = knowledgeSourceInputSchema.parse(input)
    return this.transaction(() => {
      const old = value.id ? this.getSource(value.id) : null
      this.expectRevision(old, value.expectedRevision, value.id)
      if (value.bindingId && this.getBinding(value.bindingId)?.storeId !== value.storeId)
        throw Error('来源店铺与绑定不符')
      for (const assetId of value.assetIds)
        if (!this.row<KnowledgeAsset>('assets', assetId)) throw Error('附件不存在')
      const digest = hash(
        JSON.stringify({
          text: value.text,
          locator: value.locator,
          assetIds: value.assetIds,
          ...(value.removed ? { removed: true } : {}),
        }),
      )
      if (old?.hash === digest) return old
      const next: KnowledgeSource = {
        id: old?.id ?? randomUUID(),
        kind: value.kind,
        storeId: value.storeId,
        ...(value.bindingId ? { bindingId: value.bindingId } : {}),
        label: value.label,
        removed: value.removed ?? false,
        text: value.text,
        locator: value.locator,
        assetIds: value.assetIds,
        revision: (old?.revision ?? 0) + 1,
        hash: digest,
        updatedAt: this.now(),
      }
      this.db
        .prepare(
          'INSERT INTO sources(id,store_id,binding_id,body) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET store_id=excluded.store_id,binding_id=excluded.binding_id,body=excluded.body',
        )
        .run(next.id, next.storeId, next.bindingId ?? null, JSON.stringify(next))
      this.db
        .prepare('INSERT INTO source_versions VALUES(?,?,?)')
        .run(next.id, next.revision, JSON.stringify(next))
      if (old)
        for (const entry of this.rows<KnowledgeEntry>('entries'))
          if (
            entry.approved?.sourceRefs.some(
              (ref) => ref.sourceId === next.id && ref.revision !== next.revision,
            )
          )
            this.put('entries', { ...entry, status: 'stale', approved: null })
      return next
    })
  }
  getSource(id: string) {
    return this.row<KnowledgeSource>('sources', id)
  }
  listSources(filter: { storeId?: string; bindingId?: string } = {}) {
    const rows = this.db
      .prepare(
        "SELECT body FROM sources WHERE (?='' OR store_id=?) AND (?='' OR binding_id=?) ORDER BY rowid",
      )
      .all(
        filter.storeId ?? '',
        filter.storeId ?? '',
        filter.bindingId ?? '',
        filter.bindingId ?? '',
      ) as { body: string }[]
    return rows.map((row) => JSON.parse(row.body) as KnowledgeSource)
  }
  sourceVersions(id: string) {
    return this.db
      .prepare('SELECT body FROM source_versions WHERE id=? ORDER BY revision DESC')
      .all(id)
      .map((row) => JSON.parse((row as { body: string }).body) as KnowledgeSource)
  }
  addAsset(bytes: Uint8Array, input: { name: string; mimeType: string }): KnowledgeAsset {
    z.string().max(1000).parse(input.name)
    z.string().max(200).parse(input.mimeType)
    if (bytes.byteLength > 100 * 1024 * 1024) throw Error('附件超出100MB')
    return this.transaction(() => {
      const digest = hash(bytes)
      const existing = this.row<KnowledgeAsset>('assets', digest)
      if (existing) return existing
      const asset: KnowledgeAsset = { id: digest, sha256: digest, size: bytes.byteLength, ...input }
      const path = join(this.options.directory, 'assets', digest)
      mkdirSync(dirname(path), { recursive: true })
      if (!existsSync(path)) writeFileSync(path, bytes, { flag: 'wx', mode: 0o600 })
      return this.put('assets', asset)
    })
  }
  readAsset(id: string): Uint8Array {
    const asset = this.row<KnowledgeAsset>('assets', id)
    if (!asset) throw Error('附件不存在')
    const bytes = readFileSync(join(this.options.directory, 'assets', asset.sha256))
    if (hash(bytes) !== asset.sha256) throw Error('附件校验失败')
    return bytes
  }
  saveDraft(input: KnowledgeDraftInput): KnowledgeVersion {
    // Accept only editable properties; saved version metadata is deliberately not trusted.
    const parsed = knowledgeDraftSchema.parse(input)
    return this.transaction(() => {
      const old = parsed.id ? this.getEntry(parsed.id) : null
      this.expectRevision(old, parsed.expectedRevision, parsed.id)
      const scope = knowledgeScopeSchema.parse(parsed.scope)
      if (scope.kind === 'canonical' && !this.getCanonical(scope.canonicalId))
        throw Error('共享商品不存在')
      if (
        scope.kind === 'canonical' &&
        this.getMetadata(`removed-canonical:${scope.canonicalId}`) === '1'
      )
        throw Error('共享商品已删除')
      if (scope.kind === 'binding' && !this.getBinding(scope.bindingId)?.active)
        throw Error('商品绑定不存在')
      if (parsed.field !== 'fact' && scope.kind !== 'binding' && scope.kind !== 'store')
        throw Error('共享商品不得保存dynamic价格、库存或活动')
      for (const ref of parsed.sourceRefs)
        if (
          this.getSource(ref.sourceId)?.removed ||
          this.getSource(ref.sourceId)?.revision !== ref.revision
        )
          throw Error('source来源已变化或移除')
      const next: KnowledgeVersion = {
        id: old?.id ?? randomUUID(),
        revision: (old?.revision ?? 0) + 1,
        scope,
        question: parsed.question,
        answer: parsed.answer,
        keywords: parsed.keywords,
        field: parsed.field,
        conflictKey: parsed.conflictKey || questionConflictKey(parsed.question),
        origin: parsed.origin,
        sourceRefs: parsed.sourceRefs,
        ...(parsed.modelEvidence ? { modelEvidence: parsed.modelEvidence } : {}),
        expiresAt:
          parsed.expiresAt ??
          (parsed.field === 'fact'
            ? null
            : this.now() + this.getSettings().dynamicTtlMinutes * 60000),
        updatedAt: this.now(),
      }
      this.put('entries', {
        id: next.id,
        revision: next.revision,
        status: 'draft',
        draft: next,
        approved: old?.approved ?? null,
      } satisfies KnowledgeEntry)
      this.db
        .prepare('INSERT INTO entry_versions VALUES(?,?,0,?)')
        .run(next.id, next.revision, JSON.stringify(next))
      return next
    })
  }
  getEntry(id: string) {
    return this.row<KnowledgeEntry>('entries', id)
  }
  entryVersions(id: string) {
    return this.db
      .prepare('SELECT body,reviewed FROM entry_versions WHERE id=? ORDER BY revision DESC')
      .all(id)
      .map((row) => ({
        version: JSON.parse((row as { body: string }).body) as KnowledgeVersion,
        reviewed: (row as { reviewed: number }).reviewed === 1,
      }))
  }
  publish(input: KnowledgePublishInput) {
    return this.publishReviewed(input, 'human-review')
  }
  publishReviewed(
    input: KnowledgePublishInput,
    reason: 'human-review' | 'legacy-preserved' | 'manual-correction',
  ) {
    const value = knowledgePublishSchema.parse(input)
    return this.transaction(() => {
      const entry = this.getEntry(value.entryId)
      if (!entry) throw Error('知识不存在')
      for (const ref of entry.draft.sourceRefs)
        if (
          value.expectedSourceRevisions[ref.sourceId] !== ref.revision ||
          this.getSource(ref.sourceId)?.removed ||
          this.getSource(ref.sourceId)?.revision !== ref.revision
        )
          throw Error('source来源已变化，请重新学习审核')
      this.expectRevision(entry, value.expectedDraftRevision, entry.id)
      if (Object.keys(value.expectedSourceRevisions).length !== entry.draft.sourceRefs.length)
        throw Error('source来源审核集合不匹配')
      const scope = entry.draft.scope
      if (
        scope.kind === 'canonical' &&
        this.getMetadata(`removed-canonical:${scope.canonicalId}`) === '1'
      )
        throw Error('共享商品已删除')
      if (scope.kind === 'binding' && !this.getBinding(scope.bindingId)?.active)
        throw Error('绑定已解除')
      if (
        reason !== 'legacy-preserved' &&
        entry.draft.expiresAt !== null &&
        entry.draft.expiresAt <= this.now()
      )
        throw Error('动态资料已过期')
      const next = { ...entry, status: 'approved' as const, approved: entry.draft }
      this.put('entries', next)
      this.db
        .prepare('UPDATE entry_versions SET reviewed=1 WHERE id=? AND revision=?')
        .run(entry.id, entry.revision)
      this.db
        .prepare('INSERT INTO reviews VALUES(?,?,?,?,?)')
        .run(randomUUID(), entry.id, entry.revision, this.now(), reason)
      return {
        ...next,
        affectedBindings:
          scope.kind === 'canonical'
            ? this.listBindings(scope.canonicalId)
            : scope.kind === 'binding'
              ? [this.getBinding(scope.bindingId)!]
              : [],
      }
    })
  }
  withdraw(id: string, expectedRevision: number) {
    return this.transaction(() => {
      const old = this.getEntry(id)
      this.expectRevision(old, expectedRevision, id)
      const next = {
        ...old!,
        revision: old!.revision + 1,
        draft: { ...old!.draft, revision: old!.revision + 1, updatedAt: this.now() },
        status: 'withdrawn' as const,
        approved: null,
      }
      this.db
        .prepare('INSERT INTO entry_versions VALUES(?,?,0,?)')
        .run(id, next.revision, JSON.stringify(next.draft))
      return this.put('entries', next)
    })
  }
  resolveKnowledge(input: KnowledgeResolveInput, options: { productOnly?: boolean } = {}) {
    if (this.getMetadata(`removed-store:${input.storeId}`) === '1')
      return {
        citations: [],
        characters: 0,
        omitted: 0,
        productStatus: 'unknown' as const,
        expiredFields: [],
      }
    const rows = this.resolutionRows(input)
    // Training identity checks use the reviewed scope, even while a differently scoped draft is edited.
    const entries = options.productOnly
      ? rows.entries.filter(
          (entry) =>
            entry.approved?.scope.kind === 'canonical' || entry.approved?.scope.kind === 'binding',
        )
      : rows.entries
    return resolveKnowledgeRows(rows.bindings, entries, input, this.now())
  }
  private resolutionRows(input: KnowledgeResolveInput) {
    const context = knowledgeResolveSchema.parse(input)
    const bindings = (
      this.db
        .prepare(
          "SELECT body FROM bindings WHERE store_id=? AND product_id=? AND active=1 AND (sku_id='' OR sku_id=?)",
        )
        .all(context.storeId, context.productId, context.skuId) as { body: string }[]
    ).map((row) => JSON.parse(row.body) as ProductBinding)
    const canonicalIds = JSON.stringify([
        ...new Set(bindings.map((binding) => binding.canonicalId)),
      ]),
      bindingIds = JSON.stringify(bindings.map((binding) => binding.id))
    // Scope in SQL before parsing text or constructing MiniSearch: raw sources are never read here.
    const rows = this.db
      .prepare(
        `SELECT body FROM entries WHERE json_extract(body,'$.approved') IS NOT NULL AND (json_extract(body,'$.approved.scope.storeId')=? OR EXISTS(SELECT 1 FROM json_each(json_extract(body,'$.approved.scope.storeIds')) WHERE value=?) OR json_extract(body,'$.approved.scope.canonicalId') IN (SELECT value FROM json_each(?)) OR json_extract(body,'$.approved.scope.bindingId') IN (SELECT value FROM json_each(?)))`,
      )
      .all(context.storeId, context.storeId, canonicalIds, bindingIds) as { body: string }[]
    return { bindings, entries: rows.map((row) => JSON.parse(row.body) as KnowledgeEntry) }
  }
  validateCitations(citations: KnowledgeCitation[]) {
    const invalid = citations.filter((citation) => {
      if (this.getMetadata(`removed-store:${citation.context.storeId}`) === '1') return true
      const entry = this.getEntry(citation.entryId)
      if (
        !entry?.approved ||
        entry.status === 'stale' ||
        entry.status === 'withdrawn' ||
        entry.approved.revision !== citation.entryRevision
      )
        return true
      if (entry.approved.expiresAt !== null && entry.approved.expiresAt <= this.now()) return true
      if (
        citation.sourceRefs.some((ref) => this.getSource(ref.sourceId)?.revision !== ref.revision)
      )
        return true
      const input = { ...citation.context, query: '' },
        rows = this.resolutionRows(input)
      const scope = eligibleKnowledge(rows.bindings, rows.entries, input)
      return scope.scopeVersion !== citation.scopeVersion
    })
    return { valid: invalid.length === 0, invalidEntryIds: invalid.map((c) => c.entryId) }
  }
  private page<T>(items: T[], input: KnowledgePageInput): KnowledgePage<T> {
    const page = knowledgePageSchema.parse(input)
    return {
      items: items.slice(page.offset, page.offset + page.limit),
      total: items.length,
      revision: this.revision,
    }
  }
  productKnowledgeCounts(binding: ProductBinding) {
    const count = (part: 'draft' | 'approved') =>
      (
        this.db
          .prepare(
            `SELECT COUNT(*) AS count FROM entries WHERE json_extract(body,'$.${part}') IS NOT NULL AND (json_extract(body,'$.${part}.scope.canonicalId')=? OR json_extract(body,'$.${part}.scope.bindingId')=?) ${part === 'draft' ? "AND json_extract(body,'$.status')='draft'" : ''}`,
          )
          .get(binding.canonicalId, binding.id) as { count: number }
      ).count
    return { approved: count('approved'), drafts: count('draft') }
  }
  productPlatformPrice(binding: ProductBinding) {
    const rows = this.db
      .prepare(
        `SELECT json_extract(s.body,'$.text') AS text
         FROM sources s JOIN bindings b ON b.id=s.binding_id
         WHERE b.store_id=? AND b.product_id=? AND b.active=1
           AND json_extract(s.body,'$.kind')='platform'
           AND COALESCE(json_extract(s.body,'$.removed'),0)=0
           AND json_extract(s.body,'$.label')='平台动态快照'
           AND json_valid(json_extract(s.body,'$.text'))
           AND NOT EXISTS(SELECT 1 FROM metadata m WHERE m.key='cleared-source:'||s.id AND m.value='1')
         ORDER BY json_extract(json_extract(s.body,'$.text'),'$.capturedAt') DESC, s.rowid DESC`,
      )
      .all(binding.storeId, binding.productId) as { text: string }[]
    // Only usable prices contribute. A newer price-less SKU must not hide an older shown price,
    // and one old displayed SKU must make the displayed price projection expired.
    const priceTimes = new Map<string, number>()
    for (const row of rows) {
      const parsed = z
        .object({
          price: z.string().max(100).optional(),
          capturedAt: z.number().finite().nonnegative(),
        })
        .passthrough()
        .safeParse(JSON.parse(row.text))
      if (!parsed.success) continue
      const price = parsed.data.price?.trim()
      if (!price) continue
      const previous = priceTimes.get(price)
      priceTimes.set(
        price,
        previous === undefined
          ? parsed.data.capturedAt
          : Math.min(previous, parsed.data.capturedAt),
      )
    }
    const prices = [...priceTimes.keys()].slice(0, 8)
    const capturedAt = prices.length
      ? Math.min(...prices.map((price) => priceTimes.get(price)!))
      : null
    const expiresAt =
      capturedAt === null ? null : capturedAt + this.getSettings().dynamicTtlMinutes * 60000
    return {
      prices,
      capturedAt,
      expiresAt,
      expired: expiresAt !== null && expiresAt <= this.now(),
    }
  }
  productSummary(binding: ProductBinding) {
    const skuCount = (
      this.db
        .prepare(
          "SELECT count(*) AS count FROM bindings WHERE store_id=? AND product_id=? AND active=1 AND sku_id<>''",
        )
        .get(binding.storeId, binding.productId) as { count: number }
    ).count
    const source = this.db
      .prepare(
        "SELECT json_extract(json_extract(s.body,'$.text'),'$.skus[0].specs') AS specs,json_extract(json_extract(s.body,'$.text'),'$.merchantCode') AS code FROM sources s WHERE s.binding_id=? AND COALESCE(json_extract(s.body,'$.removed'),0)=0 AND json_extract(s.body,'$.label')='平台静态资料' AND json_valid(json_extract(s.body,'$.text')) AND NOT EXISTS(SELECT 1 FROM metadata m WHERE m.key='cleared-source:'||s.id AND m.value='1') LIMIT 1",
      )
      .get(binding.id) as { specs: string | null; code: string | null } | undefined
    const specifications = source?.specs
      ? z
          .array(z.object({ name: z.string(), value: z.string() }))
          .parse(JSON.parse(source.specs))
          .map((s) => `${s.name}：${s.value}`)
          .slice(0, 4)
      : []
    const catalog = this.db
      .prepare(
        "SELECT json_extract(json_extract(s.body,'$.text'),'$.merchantCode') AS code FROM sources s WHERE s.binding_id=? AND COALESCE(json_extract(s.body,'$.removed'),0)=0 AND json_extract(s.body,'$.label')='平台目录快照' AND json_valid(json_extract(s.body,'$.text')) AND NOT EXISTS(SELECT 1 FROM metadata m WHERE m.key='cleared-source:'||s.id AND m.value='1') LIMIT 1",
      )
      .get(binding.id) as { code: string | null } | undefined
    const capture = this.db
      .prepare(
        "SELECT min(json_extract(json_extract(s.body,'$.text'),'$.capturedAt')) AS at FROM sources s JOIN bindings b ON b.id=s.binding_id WHERE b.store_id=? AND b.product_id=? AND b.active=1 AND COALESCE(json_extract(s.body,'$.removed'),0)=0 AND NOT EXISTS(SELECT 1 FROM metadata m WHERE m.key='cleared-source:'||s.id AND m.value='1') AND json_extract(s.body,'$.label')='平台动态快照' AND json_valid(json_extract(s.body,'$.text'))",
      )
      .get(binding.storeId, binding.productId) as { at: number | null }
    const capturedAt = capture.at,
      expiresAt =
        capturedAt === null ? null : capturedAt + this.getSettings().dynamicTtlMinutes * 60000
    return {
      skuCount,
      specifications,
      capturedAt,
      expiresAt,
      expired: expiresAt !== null && expiresAt <= this.now(),
      code: catalog?.code ?? source?.code ?? '',
    }
  }
  listProducts(input: KnowledgePageInput & { storeId: string }) {
    const page = knowledgePageSchema.parse(input)
    const search = page.search?.toLowerCase() ?? ''
    const visibleManual = `s2.binding_id=b.id AND json_extract(s2.body,'$.kind')='manual' AND COALESCE(json_extract(s2.body,'$.removed'),0)=0 AND json_extract(s2.body,'$.label')='${KNOWLEDGE_PRODUCT_PROFILE_SOURCE_LABEL}' AND NOT EXISTS(SELECT 1 FROM metadata m WHERE m.key='cleared-source:'||s2.id AND m.value='1')`
    const manualTitle = `COALESCE((SELECT CASE WHEN json_valid(json_extract(s2.body,'$.text')) THEN json_extract(json_extract(s2.body,'$.text'),'$.title') END FROM sources s2 WHERE ${visibleManual} LIMIT 1),'')`
    const where = `b.store_id=? AND b.active=1 AND b.sku_id='' AND (?='' OR instr(lower(json_extract(c.body,'$.title')||' '||json_extract(c.body,'$.code')||' '||b.product_id||' '||json_extract(b.body,'$.title')||' '||${manualTitle}),?)>0)`
    const total = (
      this.db
        .prepare(
          `SELECT COUNT(*) AS count FROM bindings b JOIN canonical c ON c.id=b.canonical_id WHERE ${where}`,
        )
        .get(input.storeId, search, search) as { count: number }
    ).count
    const bindings = this.db
      .prepare(
        `SELECT b.body FROM bindings b JOIN canonical c ON c.id=b.canonical_id WHERE ${where} ORDER BY b.rowid LIMIT ? OFFSET ?`,
      )
      .all(input.storeId, search, search, page.limit, page.offset) as { body: string }[]
    const bindingIds = bindings.map((row) => (JSON.parse(row.body) as ProductBinding).id)
    const placeholders = bindingIds.map(() => '?').join(',')
    const sourceRows = bindingIds.length
      ? (this.db
          .prepare(
            `SELECT s.binding_id AS bindingId,
                    json_extract(s.body,'$.kind') AS kind,
                    json_extract(s.body,'$.label') AS label,
                    json_extract(s.body,'$.assetIds[0]') AS asset0,
                    json_extract(s.body,'$.assetIds[1]') AS asset1,
                    json_extract(s.body,'$.assetIds[2]') AS asset2,
                    CASE WHEN json_valid(json_extract(s.body,'$.text'))
                      THEN substr(json_extract(json_extract(s.body,'$.text'),'$.copy'),1,200) END AS manualCopy,
                    CASE WHEN json_valid(json_extract(s.body,'$.text'))
                      THEN substr(json_extract(json_extract(s.body,'$.text'),'$.title'),1,500) END AS manualTitle,
                    CASE WHEN json_valid(json_extract(s.body,'$.text'))
                      THEN substr(json_extract(json_extract(s.body,'$.text'),'$.description'),1,200) END AS platformDescription
             FROM sources s
             WHERE s.binding_id IN (${placeholders}) AND COALESCE(json_extract(s.body,'$.removed'),0)=0
               AND NOT EXISTS(SELECT 1 FROM metadata m WHERE m.key='cleared-source:'||s.id AND m.value='1')
             ORDER BY s.rowid`,
          )
          .all(...bindingIds) as {
          bindingId: string
          kind: KnowledgeSource['kind']
          label: string
          asset0: string | null
          asset1: string | null
          asset2: string | null
          manualCopy: string | null
          manualTitle: string | null
          platformDescription: string | null
        }[])
      : []
    const sourcesByBinding = new Map<string, typeof sourceRows>()
    for (const row of sourceRows) {
      const list = sourcesByBinding.get(row.bindingId) ?? []
      list.push(row)
      sourcesByBinding.set(row.bindingId, list)
    }
    const candidateAssets = new Set<string>()
    for (const list of sourcesByBinding.values())
      for (const row of list)
        for (const id of [row.asset0, row.asset1, row.asset2]) if (id) candidateAssets.add(id)
    const imageAssets = new Set(
      candidateAssets.size
        ? (
            this.db
              .prepare(
                `SELECT id FROM assets WHERE id IN (${[...candidateAssets].map(() => '?').join(',')}) AND json_extract(body,'$.mimeType') LIKE 'image/%'`,
              )
              .all(...candidateAssets) as { id: string }[]
          ).map((row) => row.id)
        : [],
    )
    const items = bindings.map((row) => {
      const binding = JSON.parse(row.body) as ProductBinding
      // SQL extracts bounded list data for this page; full source text and image bytes stay on demand.
      const sources = sourcesByBinding.get(binding.id) ?? []
      const manual = sources.find(
        (source) =>
          source.kind === 'manual' && source.label === KNOWLEDGE_PRODUCT_PROFILE_SOURCE_LABEL,
      )
      const staticSource = sources.find((source) => source.label === '平台静态资料')
      const catalogSource = sources.find((source) => source.label === '平台目录快照')
      // Once a manual source exists, an intentionally cleared copy must stay empty instead of
      // falling back to old platform text (the detail reader uses the same rule).
      const summary = (
        manual
          ? manual.manualCopy
          : staticSource?.platformDescription || catalogSource?.platformDescription
      )
        ?.replace(/\s+/g, ' ')
        .trim()
      const imageAssetIds: string[] = []
      const addImage = (id: string | null) => {
        if (id && imageAssets.has(id) && !imageAssetIds.includes(id) && imageAssetIds.length < 3)
          imageAssetIds.push(id)
      }
      if (manual) [manual.asset0, manual.asset1, manual.asset2].forEach(addImage)
      const platformImages = sources.find((source) => source.label === '平台图片资料')
      if (platformImages)
        [platformImages.asset0, platformImages.asset1, platformImages.asset2].forEach(addImage)
      const catalog = catalogSource
      if (catalog) addImage(catalog.asset0)
      for (const source of sources) [source.asset0, source.asset1, source.asset2].forEach(addImage)
      const knowledge = this.productKnowledgeCounts(binding),
        canonical = this.getCanonical(binding.canonicalId)!
      return {
        canonical,
        binding,
        displayTitle: manual?.manualTitle || binding.title || canonical.title,
        summary: summary || '',
        imageAssetIds,
        productSummary: this.productSummary(binding),
        sources: sources.length,
        approved: knowledge.approved,
        drafts: knowledge.drafts,
        sourceSummary: {
          count: sources.length,
          kinds: [...new Set(sources.map((source) => source.kind))],
          thumbnailAssetId: imageAssetIds[0] ?? null,
        },
      }
    })
    return { items, total, revision: this.revision }
  }
  listCanonicals(input: KnowledgePageInput = {}) {
    const page = knowledgePageSchema.parse(input),
      search = page.search?.toLowerCase() ?? ''
    const where =
      "NOT EXISTS(SELECT 1 FROM metadata m WHERE m.key='removed-canonical:'||canonical.id AND m.value='1') AND (?='' OR instr(lower(json_extract(body,'$.title')||' '||json_extract(body,'$.code')),?)>0)"
    const total = (
      this.db
        .prepare(`SELECT COUNT(*) AS count FROM canonical WHERE ${where}`)
        .get(search, search) as { count: number }
    ).count
    const rows = this.db
      .prepare(`SELECT body FROM canonical WHERE ${where} ORDER BY rowid LIMIT ? OFFSET ?`)
      .all(search, search, page.limit, page.offset) as { body: string }[]
    return {
      items: rows.map((row) => JSON.parse(row.body) as CanonicalProduct),
      total,
      revision: this.revision,
    }
  }
  listEntries(input: KnowledgePageInput & { status?: KnowledgeEntry['status'] } = {}) {
    const { status, ...page } = input
    const bindings = this.listBindings()
    return this.page(
      this.rows<KnowledgeEntry>('entries').filter(
        (entry) =>
          (!status || entry.status === status) &&
          (!page.storeId || this.scopeIncludesStore(entry.draft.scope, page.storeId, bindings)) &&
          (!page.search ||
            [entry.draft.question, entry.draft.answer].join(' ').includes(page.search)),
      ),
      page,
    )
  }
  private scopeIncludesStore(
    scope: KnowledgeVersion['scope'],
    storeId: string,
    bindings = this.listBindings(),
  ) {
    if (this.getMetadata(`removed-store:${storeId}`) === '1') return false
    if (scope.kind === 'template') return scope.storeIds.includes(storeId)
    if (scope.kind === 'store') return scope.storeId === storeId
    return bindings.some(
      (binding) =>
        binding.storeId === storeId &&
        (scope.kind === 'canonical'
          ? binding.canonicalId === scope.canonicalId
          : binding.id === scope.bindingId),
    )
  }
  summary(storeId?: string) {
    return {
      revision: this.revision,
      products: this.listBindings().filter((binding) => !storeId || binding.storeId === storeId)
        .length,
      entries: this.rows<KnowledgeEntry>('entries').filter(
        (entry) => !storeId || this.scopeIncludesStore(entry.draft.scope, storeId),
      ).length,
      pending: this.listEntries({ storeId, status: 'draft', limit: 1 }).total,
      jobs: this.listJobs({ storeId, limit: 1 }).total,
      // The header badge is actionable work only; history remains queryable by explicit status.
      misses: this.listMisses({ storeId, status: 'open', limit: 1 }).total,
      readOnly: this.readOnly,
      migration: this.getMigrationState(),
    }
  }
  detail(canonicalId: string, storeId?: string) {
    const bindings = this.listBindings(canonicalId).filter((b) => !storeId || b.storeId === storeId)
    const entries = this.rows<KnowledgeEntry>('entries').filter((e) =>
      e.draft.scope.kind === 'canonical'
        ? e.draft.scope.canonicalId === canonicalId
        : e.draft.scope.kind === 'binding' &&
          bindings.some(
            (b) => b.id === (e.draft.scope.kind === 'binding' ? e.draft.scope.bindingId : ''),
          ),
    )
    const dependencies = new Set(
      entries
        .flatMap((e) => [e.draft, ...(e.approved ? [e.approved] : [])])
        .flatMap((version) => version.sourceRefs.map((ref) => ref.sourceId)),
    )
    return {
      canonical: this.getCanonical(canonicalId),
      bindings,
      entries,
      sources: this.listSources().filter(
        (s) => bindings.some((b) => b.id === s.bindingId) || dependencies.has(s.id),
      ),
    }
  }
  getSettings(): KnowledgeSettings {
    return knowledgeSettingsSchema.parse(JSON.parse(this.getMetadata('settings') ?? '{}'))
  }
  saveSettings(input: Partial<KnowledgeSettings>) {
    return this.transaction(() => {
      const settings = knowledgeSettingsSchema.parse({ ...this.getSettings(), ...input })
      this.setMetadata('settings', JSON.stringify(settings))
      return settings
    })
  }
  createJob(input: Pick<KnowledgeJob, 'kind' | 'storeId' | 'payload'>): KnowledgeJob {
    return this.transaction(() => {
      const parsed = z
        .object({
          kind: z.enum(['collect', 'learn', 'daily-check', 'import']),
          storeId: z.string().min(1).max(200),
          payload: z.record(z.string(), z.unknown()),
        })
        .strict()
        .parse(input)
      return this.put('jobs', {
        ...parsed,
        id: randomUUID(),
        revision: 1,
        status: 'queued',
        checkpoint: {},
        progress: { completed: 0, total: null },
        error: '',
        createdAt: this.now(),
        updatedAt: this.now(),
      } satisfies KnowledgeJob)
    })
  }
  getJob(id: string) {
    return this.row<KnowledgeJob>('jobs', id)
  }
  updateJob(
    id: string,
    input: {
      expectedRevision: number
      status?: KnowledgeJob['status']
      checkpoint?: Record<string, unknown>
      progress?: KnowledgeJob['progress']
      error?: string
    },
  ) {
    return this.transaction(() => {
      const old = this.getJob(id)
      this.expectRevision(old, input.expectedRevision, id)
      const changes = z
        .object({
          expectedRevision: z.number().int().positive(),
          status: z
            .enum([
              'queued',
              'running',
              'paused',
              'needs-confirmation',
              'succeeded',
              'failed',
              'cancelled',
            ])
            .optional(),
          checkpoint: z.record(z.string(), z.unknown()).optional(),
          progress: z
            .object({
              completed: z.number().int().nonnegative(),
              total: z.number().int().nonnegative().nullable(),
            })
            .optional(),
          error: z.string().max(4000).optional(),
        })
        .strict()
        .parse(input)
      const patch: Partial<typeof changes> = { ...changes }
      delete patch.expectedRevision
      return this.put('jobs', {
        ...old!,
        ...patch,
        revision: old!.revision + 1,
        updatedAt: this.now(),
      })
    })
  }
  hasUnfinishedDailyCheck(storeId: string) {
    return Boolean(
      this.db
        .prepare(
          "SELECT id FROM jobs WHERE json_extract(body,'$.storeId')=? AND json_extract(body,'$.kind')='daily-check' AND json_extract(body,'$.status') NOT IN ('succeeded','cancelled') LIMIT 1",
        )
        .get(storeId),
    )
  }
  listJobs(input: KnowledgePageInput = {}) {
    return this.page(
      this.rows<KnowledgeJob>('jobs')
        .filter((job) => !input.storeId || job.storeId === input.storeId)
        .reverse()
        .sort(
          (a, b) => Number(isRecoverableKnowledgeJob(b)) - Number(isRecoverableKnowledgeJob(a)),
        ),
      input,
    )
  }
  recordMiss(input: {
    storeId: string
    productId?: string
    skuId?: string
    question: string
    conversationId?: string
    reason?: KnowledgeMiss['reason']
    context?: KnowledgeMiss['context']
  }): KnowledgeMiss {
    return this.transaction(() => {
      const parsed = z
        .object({
          storeId: z.string().min(1).max(200),
          productId: z.string().max(200).default(''),
          skuId: z.string().max(200).default(''),
          question: z.string().trim().min(1).max(10000),
          conversationId: z.string().max(200).optional(),
          reason: z.enum(['unknown-product', 'expired-field', 'no-eligible-knowledge']).optional(),
          context: z
            .array(z.object({ from: z.string().max(20), content: z.string().max(600) }).strict())
            .max(6)
            .optional(),
        })
        .strict()
        .parse(input)
      const id = hash(
        JSON.stringify([
          parsed.storeId,
          parsed.productId,
          parsed.skuId,
          parsed.question
            .normalize('NFKC')
            .toLowerCase()
            .replace(/[\s\p{P}]+/gu, ''),
        ]),
      )
      const old = this.row<KnowledgeMiss>('misses', id)
      return this.put('misses', {
        id,
        storeId: parsed.storeId,
        productId: parsed.productId,
        skuId: parsed.skuId,
        question: parsed.question,
        reason: parsed.reason ?? old?.reason,
        source: 'reception',
        context: parsed.context ?? old?.context ?? [],
        count: (old?.count ?? 0) + 1,
        conversationIds: [
          ...new Set([
            ...(old?.conversationIds ?? []),
            ...(parsed.conversationId ? [parsed.conversationId] : []),
          ]),
        ].slice(-100),
        status: 'open',
        firstSeenAt: old?.firstSeenAt ?? this.now(),
        lastSeenAt: this.now(),
      })
    })
  }
  getMiss(id: string) {
    return this.row<KnowledgeMiss>('misses', id)
  }
  updateMiss(id: string, status: KnowledgeMiss['status']) {
    return this.transaction(() => {
      const old = this.row<KnowledgeMiss>('misses', id)
      if (!old) throw Error('问题不存在')
      return this.put('misses', {
        ...old,
        status: z.enum(['open', 'resolved', 'ignored']).parse(status),
      })
    })
  }
  listMisses(input: KnowledgeMissPageInput = {}) {
    const { status, ...pageInput } = input
    const page = knowledgePageSchema.parse(pageInput),
      search = page.search?.toLocaleLowerCase() ?? ''
    return this.page(
      this.rows<KnowledgeMiss>('misses')
        .filter(
          (miss) =>
            (!page.storeId || miss.storeId === page.storeId) &&
            (!status || miss.status === status) &&
            (!search || miss.question.toLocaleLowerCase().includes(search)),
        )
        .sort((a, b) => b.lastSeenAt - a.lastSeenAt),
      page,
    )
  }
  createBackup(
    destination: string,
    scope?: { canonicalId?: string; storeId?: string },
  ): KnowledgeBackupManifest & { directory: string } {
    this.assertOpen()
    if (scope?.canonicalId && scope.storeId) throw Error('备份不能同时选择店铺和共享商品')
    const directory = join(destination, `knowledge-${this.now()}-${randomUUID()}`)
    mkdirSync(directory, { recursive: true })
    const database = join(directory, 'knowledge.sqlite')
    this.db.prepare('VACUUM INTO ?').run(toNamespacedPath(database))
    const snapshot = new DatabaseSync(toNamespacedPath(database))
    let scoped: KnowledgeBackupManifest['scope'], snapshotAssets: KnowledgeAsset[]
    try {
      if (scope?.storeId) scoped = pruneToStore(snapshot, scope.storeId)
      else if (scope?.canonicalId) scoped = pruneToFamily(snapshot, scope.canonicalId)
      snapshotAssets = (
        snapshot.prepare('SELECT body FROM assets').all() as { body: string }[]
      ).map((row) => JSON.parse(String(row.body)) as KnowledgeAsset)
    } finally {
      snapshot.close()
    }
    const files: KnowledgeBackupManifest['files'] = []
    const add = (path: string) => {
      const bytes = readFileSync(join(directory, path))
      files.push({ path, sha256: hash(bytes), size: bytes.length })
    }
    add('knowledge.sqlite')
    // A store restore can retain both the original and an isolated clone of identical bytes.
    // The archive is content-addressed, so the file and manifest entry are written once.
    for (const asset of new Map(snapshotAssets.map((asset) => [asset.sha256, asset])).values()) {
      const bytes = this.readAsset(asset.id)
      mkdirSync(join(directory, 'assets'), { recursive: true })
      writeFileSync(join(directory, 'assets', asset.sha256), bytes, { flag: 'wx', mode: 0o600 })
      add(`assets/${asset.sha256}`)
    }
    const manifest: KnowledgeBackupManifest = {
      version: 1,
      createdAt: this.now(),
      revision: this.revision,
      ...(scoped ? { scope: scoped } : {}),
      files,
    }
    writeFileSync(join(directory, 'manifest.json'), JSON.stringify(manifest, null, 2))
    if (!this.readOnly) this.setMetadata('lastBackupDirectory', directory)
    return { ...manifest, directory }
  }
  getLastBackupDirectory() {
    return this.getMetadata('lastBackupDirectory')
  }
  /** Internal main-process staging operation; deliberately absent from the public command schema. */
  clearBackupCopy(scope: KnowledgeClearScope) {
    this.transaction(() => clearKnowledgeCopy(this.db, scope, this.now()))
  }
  query(query: KnowledgeQuery) {
    query = knowledgeQuerySchema.parse(query)
    switch (query.type) {
      case 'canonicals':
        return this.listCanonicals(query.page)
      case 'summary':
        return this.summary(query.storeId)
      case 'products':
        return this.listProducts(query.page)
      case 'detail':
        return this.detail(query.canonicalId, query.storeId)
      case 'entries':
        return this.listEntries({ ...query.page, status: query.status })
      case 'resolve':
        return this.resolveKnowledge(query.input)
      case 'jobs':
        return this.listJobs(query.page)
      case 'misses':
        return this.listMisses(query.page)
      case 'settings':
        return this.getSettings()
    }
  }
  execute(command: KnowledgeCommand) {
    command = knowledgeCommandSchema.parse(command)
    switch (command.type) {
      case 'save-canonical':
        return this.saveCanonical(command.canonical)
      case 'bind-product':
        return this.bindProduct(command.binding)
      case 'update-miss':
        return this.updateMiss(command.missId, command.status)
      case 'save-draft':
        return this.saveDraft(command.draft)
      case 'publish':
        return this.publish(command.review)
      case 'withdraw':
        return this.withdraw(command.entryId, command.expectedRevision)
      case 'unlink':
        return this.unlinkBinding(command.bindingId, command.expectedRevision)
      case 'save-settings':
        return this.saveSettings(command.settings)
      case 'cancel-job':
        return this.updateJob(command.jobId, {
          expectedRevision: command.expectedRevision,
          status: 'cancelled',
        })
    }
  }
  dispose() {
    if (!this.closed) {
      this.db.close()
      this.closed = true
      unregisterKnowledgeWriter(this.options.directory)
    }
  }
}

import { readFileSync, mkdirSync, existsSync, copyFileSync, renameSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { z } from 'zod'
import { assertKnowledgeWriterStopped } from './lifecycle'
import type {
  KnowledgeBackupManifest,
  KnowledgeSource,
  KnowledgeVersion,
  KnowledgeEntry,
  ProductBinding,
} from '../../src/shared/contracts/knowledge'
import { knowledgeRequire } from './node-loader'
import { mergeFamily, familyClosure, familyMergeState } from './backup-scope'
import {
  knowledgeDraftSchema,
  knowledgeSourceInputSchema,
  productBindingInputSchema,
  canonicalProductInputSchema,
} from '../../src/shared/contracts/knowledge'
const { DatabaseSync } = knowledgeRequire('node:sqlite') as typeof import('node:sqlite')
const manifestSchema = z
  .object({
    version: z.literal(1),
    createdAt: z.number().nonnegative(),
    revision: z.number().int().nonnegative(),
    scope: z
      .object({
        kind: z.literal('family'),
        canonicalId: z.string().min(1),
        storeIds: z.array(z.string()),
        bindingIds: z.array(z.string()),
        dependencyBindingIds: z.array(z.string()),
        originalFiles: z.array(z.string()),
      })
      .strict()
      .optional(),
    files: z
      .array(
        z
          .object({
            path: z.string().regex(/^(knowledge\.sqlite|assets\/[a-f0-9]{64})$/),
            sha256: z.string().regex(/^[a-f0-9]{64}$/),
            size: z.number().int().nonnegative(),
          })
          .strict(),
      )
      .min(1),
  })
  .strict()
/** Main-process path API only. Restore callers stop jobs and dispose the repository first. */
export function inspectKnowledgeBackup(backupDirectory: string): KnowledgeBackupManifest {
  const manifest = manifestSchema.parse(
    JSON.parse(readFileSync(join(backupDirectory, 'manifest.json'), 'utf8')),
  )
  if (
    manifest.files.filter((file) => file.path === 'knowledge.sqlite').length !== 1 ||
    new Set(manifest.files.map((file) => file.path)).size !== manifest.files.length
  )
    throw Error('备份清单重复或缺少数据库')
  for (const file of manifest.files) {
    const bytes = readFileSync(join(backupDirectory, file.path))
    if (
      bytes.length !== file.size ||
      createHash('sha256').update(bytes).digest('hex') !== file.sha256
    )
      throw Error('备份hash校验失败')
    if (file.path.startsWith('assets/') && file.path !== `assets/${file.sha256}`)
      throw Error('附件地址与hash不符')
  }
  // Node 24 supports readOnly; the project's Node 22 declaration predates that option.
  const readOptions = { open: true, readOnly: true }
  const probe = new DatabaseSync(join(backupDirectory, 'knowledge.sqlite'), readOptions)
  try {
    const integrity = probe.prepare('PRAGMA integrity_check').get() as { integrity_check: string }
    if (
      integrity.integrity_check !== 'ok' ||
      probe.prepare('PRAGMA foreign_key_check').all().length
    )
      throw Error('备份数据库关系校验失败')
    const schema = probe
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('canonical','bindings','sources','entries','entry_versions','metadata','assets')",
      )
      .all()
    if (schema.length !== 7) throw Error('备份数据库格式不兼容')
    for (const row of probe.prepare('SELECT id,body FROM canonical').all() as {
      id: string
      body: string
    }[]) {
      const canonical = JSON.parse(
        row.body,
      ) as import('../../src/shared/contracts/knowledge').CanonicalProduct
      const { revision, updatedAt, ...input } = canonical
      canonicalProductInputSchema.parse(input)
      if (
        canonical.id !== row.id ||
        !Number.isInteger(revision) ||
        revision < 1 ||
        !Number.isFinite(updatedAt)
      )
        throw Error('商品版本无效')
    }
    for (const row of probe.prepare('SELECT * FROM bindings').all() as {
      id: string
      canonical_id: string
      store_id: string
      product_id: string
      sku_id: string
      active: number
      body: string
    }[]) {
      const binding = JSON.parse(
        row.body,
      ) as import('../../src/shared/contracts/knowledge').ProductBinding
      const { revision, updatedAt, active, ...input } = binding
      productBindingInputSchema.parse(input)
      if (
        binding.id !== row.id ||
        binding.canonicalId !== row.canonical_id ||
        binding.storeId !== row.store_id ||
        binding.productId !== row.product_id ||
        binding.skuId !== row.sku_id ||
        Number(active) !== row.active ||
        !Number.isInteger(revision) ||
        revision < 1 ||
        !Number.isFinite(updatedAt)
      )
        throw Error('商品物理身份校验失败')
    }
    const referenced = probe.prepare('SELECT body FROM assets').all() as { body: string }[]
    for (const row of referenced) {
      const asset = z
        .object({ sha256: z.string().regex(/^[a-f0-9]{64}$/) })
        .passthrough()
        .parse(JSON.parse(row.body))
      if (!manifest.files.some((file) => file.path === `assets/${asset.sha256}`))
        throw Error('备份缺少附件')
    }
    for (const row of probe.prepare('SELECT id,revision,body FROM source_versions').all() as {
      id: string
      revision: number
      body: string
    }[]) {
      const source = JSON.parse(String(row.body)) as KnowledgeSource
      const { revision, hash, updatedAt, ...input } = source
      knowledgeSourceInputSchema.parse(input)
      if (
        source.id !== row.id ||
        revision !== row.revision ||
        typeof hash !== 'string' ||
        typeof updatedAt !== 'number'
      )
        throw Error('来源版本不完整')
      if (
        source.bindingId &&
        !probe
          .prepare('SELECT id FROM bindings WHERE id=? AND store_id=?')
          .get(source.bindingId, source.storeId)
      )
        throw Error('历史来源关联不存在')
      const digest = createHash('sha256')
        .update(
          JSON.stringify({
            text: source.text,
            locator: source.locator,
            assetIds: source.assetIds,
            ...(source.removed ? { removed: true } : {}),
          }),
        )
        .digest('hex')
      if (digest !== hash) throw Error('来源内容hash不一致')
      for (const assetId of [
        ...source.assetIds,
        source.locator.assetId,
        source.locator.imageAssetId,
      ].filter((id): id is string => Boolean(id)))
        if (!probe.prepare('SELECT id FROM assets WHERE id=?').get(assetId))
          throw Error('历史来源附件缺失')
    }
    for (const row of probe.prepare('SELECT id,revision,body FROM entry_versions').all() as {
      id: string
      revision: number
      body: string
    }[]) {
      const version = JSON.parse(String(row.body)) as KnowledgeVersion
      const { revision, updatedAt, ...input } = version
      knowledgeDraftSchema.parse(input)
      if (version.id !== row.id || revision !== row.revision || typeof updatedAt !== 'number')
        throw Error('知识版本不完整')
      if (
        (version.scope.kind === 'canonical' &&
          !probe.prepare('SELECT id FROM canonical WHERE id=?').get(version.scope.canonicalId)) ||
        (version.scope.kind === 'binding' &&
          !probe.prepare('SELECT id FROM bindings WHERE id=?').get(version.scope.bindingId))
      )
        throw Error('历史知识范围缺失')
      for (const ref of version.sourceRefs)
        if (
          !probe
            .prepare('SELECT id FROM source_versions WHERE id=? AND revision=?')
            .get(ref.sourceId, ref.revision)
        )
          throw Error('历史知识引用缺失')
      const imageId = version.modelEvidence?.imageAssetId
      if (imageId && !probe.prepare('SELECT id FROM assets WHERE id=?').get(imageId))
        throw Error('历史图像依据缺失')
    }
    for (const row of probe.prepare('SELECT id,body FROM sources').all() as {
      id: string
      body: string
    }[]) {
      const source = JSON.parse(row.body) as KnowledgeSource
      const saved = probe
        .prepare('SELECT body FROM source_versions WHERE id=? AND revision=?')
        .get(source.id, source.revision) as { body: string } | undefined
      if (source.id !== row.id || saved?.body !== row.body) throw Error('当前来源与历史不一致')
    }
    const reviewSchema = z
      .object({
        id: z.string().min(1),
        entry_id: z.string().min(1),
        revision: z.number().int().positive(),
        at: z.number().int().nonnegative(),
        reason: z.enum(['human-review', 'legacy-preserved', 'manual-correction']),
      })
      .strict()
    for (const raw of probe.prepare('SELECT * FROM reviews').all()) {
      const parsed = reviewSchema.safeParse(raw)
      if (!parsed.success) throw Error('审核记录格式无效')
      const row = parsed.data
      if (
        !probe
          .prepare('SELECT id FROM entry_versions WHERE id=? AND revision=? AND reviewed=1')
          .get(row.entry_id, row.revision)
      )
        throw Error('审核记录引用不存在')
    }
    if (
      probe
        .prepare(
          'SELECT id FROM entry_versions v WHERE reviewed NOT IN (0,1) OR (reviewed=1 AND NOT EXISTS(SELECT 1 FROM reviews r WHERE r.entry_id=v.id AND r.revision=v.revision)) LIMIT 1',
        )
        .get()
    )
      throw Error('历史已审核版本缺少有效审核记录')
    for (const row of probe.prepare('SELECT body FROM entries').all() as { body: string }[]) {
      const entry = JSON.parse(String(row.body)) as KnowledgeEntry
      if (
        entry.approved &&
        !probe
          .prepare('SELECT id FROM entry_versions WHERE id=? AND revision=? AND reviewed=1')
          .get(entry.id, entry.approved.revision)
      )
        throw Error('已发布知识缺少审核版本')
      for (const version of [entry.draft, ...(entry.approved ? [entry.approved] : [])]) {
        const saved = probe
          .prepare('SELECT body FROM entry_versions WHERE id=? AND revision=?')
          .get(version.id, version.revision) as { body: string } | undefined
        if (!saved || saved.body !== JSON.stringify(version))
          throw Error('当前知识与历史版本不一致')
      }
    }
    if (manifest.scope) {
      const scope = manifest.scope,
        closure = familyClosure(probe, scope.canonicalId)
      for (const [table, ids] of [
        ['canonical', closure.canonicals],
        ['bindings', closure.bindings],
        ['sources', closure.sources],
        ['entries', closure.entries],
        ['assets', closure.assets],
      ] as const) {
        const actual = probe.prepare(`SELECT id FROM ${table}`).all() as { id: string }[]
        if (actual.length !== ids.size || actual.some((row) => !ids.has(row.id)))
          throw Error('备份范围包含无关商品或资料')
      }
      const equal = (a: string[], b: string[]) =>
        JSON.stringify([...a].sort()) === JSON.stringify([...b].sort())
      const stores = (
        probe.prepare('SELECT store_id,id FROM bindings').all() as {
          store_id: string
          id: string
        }[]
      )
        .filter((row) => closure.primaryBindings.has(row.id))
        .map((row) => row.store_id)
      if (
        !equal(scope.bindingIds, [...closure.primaryBindings]) ||
        !equal(scope.storeIds, [...new Set(stores)]) ||
        !equal(
          scope.dependencyBindingIds,
          [...closure.bindings].filter((id) => !closure.primaryBindings.has(id)),
        )
      )
        throw Error('备份范围清单与实际资料不一致')
    }
  } finally {
    probe.close()
  }
  return manifest
}
export function knowledgeBackupScope(backupDirectory: string) {
  const readOptions = { open: true, readOnly: true },
    db = new DatabaseSync(join(backupDirectory, 'knowledge.sqlite'), readOptions)
  try {
    return {
      stores: (
        db.prepare('SELECT DISTINCT store_id FROM bindings').all() as {
          store_id: string
        }[]
      )
        .map((r) => r.store_id)
        .sort(),
      activeStores: (
        db.prepare('SELECT DISTINCT store_id FROM bindings WHERE active=1').all() as {
          store_id: string
        }[]
      ).map((row) => row.store_id),
      bindings: (db.prepare('SELECT body FROM bindings').all() as { body: string }[]).map(
        (r) => JSON.parse(r.body) as import('../../src/shared/contracts/knowledge').ProductBinding,
      ),
      originalFiles: (
        db.prepare("SELECT value FROM metadata WHERE key LIKE 'original-file:%'").all() as {
          value: string
        }[]
      ).map((r) => z.object({ name: z.string() }).parse(JSON.parse(r.value)).name),
    }
  } finally {
    db.close()
  }
}
/** Both databases are read-only. The cached plan is pinned to the live repository revision. */
export function knowledgeRestoreImpact(
  backupDirectory: string,
  currentDirectory: string,
  canonicalId?: string,
) {
  const readOptions = { open: true, readOnly: true }
  const source = new DatabaseSync(join(backupDirectory, 'knowledge.sqlite'), readOptions)
  const target = new DatabaseSync(join(currentDirectory, 'knowledge.sqlite'), readOptions)
  const rows = <T>(db: InstanceType<typeof DatabaseSync>, table: string): T[] =>
    (db.prepare(`SELECT body FROM ${table}`).all() as { body: string }[]).map(
      (row) => JSON.parse(row.body) as T,
    )
  try {
    const incomingBindings = rows<ProductBinding>(source, 'bindings'),
      currentBindings = rows<ProductBinding>(target, 'bindings')
    const incomingEntries = rows<KnowledgeEntry>(source, 'entries'),
      currentEntries = rows<KnowledgeEntry>(target, 'entries')
    const incomingSources = rows<KnowledgeSource>(source, 'sources'),
      currentSources = rows<KnowledgeSource>(target, 'sources')
    const family = canonicalId ? familyMergeState(target, source, canonicalId) : undefined
    const incomingIds = new Set(incomingBindings.map((b) => b.id)),
      incomingEntryIds = new Set(incomingEntries.map((e) => e.id)),
      incomingSourceIds = new Set(incomingSources.map((s) => s.id))
    const deactivatedBindings = family
      ? currentBindings.filter(
          (b) =>
            family.old?.primaryBindings.has(b.id) && !family.incoming.primaryBindings.has(b.id),
        )
      : []
    const removedBindings = family ? [] : currentBindings.filter((b) => !incomingIds.has(b.id))
    const removedEntries = currentEntries.filter(
      (e) => !incomingEntryIds.has(e.id) && (!family || family.replaceableEntries.has(e.id)),
    )
    const affectedCurrentEntries = family
      ? currentEntries.filter((e) => family.replaceableEntries.has(e.id))
      : currentEntries
    const removedSources = family ? [] : currentSources.filter((s) => !incomingSourceIds.has(s.id))
    const allBindings = [...incomingBindings, ...currentBindings]
    const stores = new Set(
      [...incomingBindings, ...deactivatedBindings, ...removedBindings].map((b) => b.storeId),
    )
    for (const source of [...incomingSources, ...(family ? [] : currentSources)])
      stores.add(source.storeId)
    for (const entry of [...incomingEntries, ...affectedCurrentEntries])
      for (const version of [entry.draft, ...(entry.approved ? [entry.approved] : [])]) {
        const scope = version.scope
        if (scope.kind === 'store') stores.add(scope.storeId)
        else if (scope.kind === 'template') scope.storeIds.forEach((id) => stores.add(id))
        else
          for (const b of allBindings.filter((b) =>
            scope.kind === 'binding'
              ? b.id === scope.bindingId
              : b.canonicalId === scope.canonicalId,
          ))
            stores.add(b.storeId)
      }
    if (!family)
      for (const db of [source, target])
        for (const table of ['jobs', 'misses'])
          for (const row of rows<{ storeId: string }>(db, table)) stores.add(row.storeId)
    return {
      restoredBindings: incomingBindings,
      deactivatedBindings,
      removedBindings,
      stores: [...stores].sort(),
      restoredEntries: incomingEntries.length,
      removedEntries: removedEntries.length,
      restoredSources: incomingSources.length,
      removedSources: removedSources.length,
    }
  } finally {
    target.close()
    source.close()
  }
}
export function restoreKnowledgeBackup(options: {
  directory: string
  backupDirectory: string
}): KnowledgeBackupManifest {
  assertKnowledgeWriterStopped(options.directory)
  const manifest = inspectKnowledgeBackup(options.backupDirectory)
  mkdirSync(options.directory, { recursive: true })
  const staged = join(options.directory, `knowledge-restore-${randomUUID()}.sqlite`)
  try {
    if (manifest.scope && existsSync(join(options.directory, 'knowledge.sqlite'))) {
      const current = new DatabaseSync(join(options.directory, 'knowledge.sqlite'))
      try {
        current.prepare('VACUUM INTO ?').run(staged)
      } finally {
        current.close()
      }
      const readOptions = { open: true, readOnly: true }
      const target = new DatabaseSync(staged),
        source = new DatabaseSync(join(options.backupDirectory, 'knowledge.sqlite'), readOptions)
      try {
        mergeFamily(target, source, manifest.scope.canonicalId)
      } finally {
        target.close()
        source.close()
      }
    } else copyFileSync(join(options.backupDirectory, 'knowledge.sqlite'), staged)
  } catch (cause) {
    if (existsSync(staged)) rmSync(staged)
    throw cause
  }
  const archive = join(options.directory, `knowledge-pre-restore-${randomUUID()}`)
  mkdirSync(archive)
  try {
    // Content-addressed assets are additive, so earlier snapshots remain recoverable.
    for (const file of manifest.files.filter((file) => file.path.startsWith('assets/'))) {
      mkdirSync(join(options.directory, 'assets'), { recursive: true })
      copyFileSync(join(options.backupDirectory, file.path), join(options.directory, file.path))
    }
    for (const name of ['knowledge.sqlite', 'knowledge.sqlite-wal', 'knowledge.sqlite-shm']) {
      if (existsSync(join(options.directory, name)))
        renameSync(join(options.directory, name), join(archive, name))
    }
    renameSync(staged, join(options.directory, 'knowledge.sqlite'))
  } catch (error) {
    for (const name of ['knowledge.sqlite', 'knowledge.sqlite-wal', 'knowledge.sqlite-shm']) {
      if (existsSync(join(archive, name)) && !existsSync(join(options.directory, name)))
        renameSync(join(archive, name), join(options.directory, name))
    }
    throw error
  } finally {
    if (existsSync(staged)) rmSync(staged)
  }
  return manifest
}

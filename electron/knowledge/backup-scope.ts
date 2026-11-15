import type { DatabaseSync } from 'node:sqlite'
import type {
  KnowledgeBackupManifest,
  KnowledgeEntry,
  KnowledgeSource,
  KnowledgeVersion,
  ProductBinding,
  KnowledgeAsset,
} from '../../src/shared/contracts/knowledge'
type Row = Record<string, string | number | null>
const bodyRows = <T>(db: DatabaseSync, table: string): T[] =>
  (db.prepare(`SELECT body FROM ${table}`).all() as { body: string }[]).map(
    (row) => JSON.parse(String(row.body)) as T,
  )
const idsIn = (value: unknown, key: string): string[] => {
  if (!value || typeof value !== 'object') return []
  if (Array.isArray(value)) return value.flatMap((v) => idsIn(v, key))
  return Object.entries(value).flatMap(([k, v]) =>
    k === key && typeof v === 'string' ? [v] : idsIn(v, key),
  )
}
export function familyClosure(db: DatabaseSync, canonicalId: string) {
  const canonical = db.prepare('SELECT id FROM canonical WHERE id=?').get(canonicalId)
  if (!canonical) throw Error('共享商品不存在')
  const allBindings = bodyRows<ProductBinding>(db, 'bindings')
  const bindings = new Set(
    allBindings.filter((b) => b.canonicalId === canonicalId).map((b) => b.id),
  )
  const owns = (v: KnowledgeVersion) =>
    v.scope.kind === 'canonical'
      ? v.scope.canonicalId === canonicalId
      : v.scope.kind === 'binding' && bindings.has(v.scope.bindingId)
  const versions = bodyRows<KnowledgeVersion>(db, 'entry_versions')
  const entries = new Set(versions.filter(owns).map((v) => v.id))
  for (const e of bodyRows<KnowledgeEntry>(db, 'entries'))
    if (owns(e.draft) || (e.approved && owns(e.approved))) entries.add(e.id)
  const sources = new Set(
    bodyRows<KnowledgeSource>(db, 'sources')
      .filter((s) => s.bindingId && bindings.has(s.bindingId))
      .map((s) => s.id),
  )
  const retainedVersions = versions.filter((v) => entries.has(v.id))
  for (const v of retainedVersions) for (const ref of v.sourceRefs) sources.add(ref.sourceId)
  const allSources = bodyRows<KnowledgeSource>(db, 'source_versions')
  const assets = new Set<string>()
  const collectAssets = (value: unknown) => {
    for (const id of [...idsIn(value, 'assetId'), ...idsIn(value, 'imageAssetId')]) assets.add(id)
  }
  retainedVersions.forEach(collectAssets)
  for (const s of allSources.filter((s) => sources.has(s.id))) {
    s.assetIds.forEach((id) => assets.add(id))
    collectAssets(s)
  }
  // An original may hold rows for several products. Include the immutable original registration,
  // not unrelated parsed rows; scope preview explicitly discloses whole-file dependencies.
  const metadata = db.prepare('SELECT key,value FROM metadata').all() as {
    key: string
    value: string
  }[]
  const originalIds = new Set(
    metadata.filter((m) => m.key.startsWith('original-file:')).map((m) => m.key.slice(14)),
  )
  for (const s of allSources)
    if (originalIds.has(s.id) && s.assetIds.some((id) => assets.has(id))) sources.add(s.id)
  const primaryBindings = new Set(bindings)
  for (const s of allSources.filter((s) => sources.has(s.id))) {
    if (s.bindingId) bindings.add(s.bindingId)
    s.assetIds.forEach((id) => assets.add(id))
    collectAssets(s)
  }
  for (const v of retainedVersions) if (v.scope.kind === 'binding') bindings.add(v.scope.bindingId)
  const canonicals = new Set([
    canonicalId,
    ...allBindings.filter((b) => bindings.has(b.id)).map((b) => b.canonicalId),
  ])
  for (const v of retainedVersions)
    if (v.scope.kind === 'canonical') canonicals.add(v.scope.canonicalId)
  const metadataKeys = new Set(
    metadata
      .filter(
        (m) =>
          m.key === 'revision' ||
          m.key === 'migration-v1' ||
          m.key.startsWith('import-document:') ||
          (m.key.startsWith('original-file:') && sources.has(m.key.slice(14))) ||
          (m.key.startsWith('import-item:') && sources.has(m.value)) ||
          (m.key.startsWith('legacy-') && (entries.has(m.value) || canonicals.has(m.value))),
      )
      .map((m) => m.key),
  )
  return {
    canonicalId,
    canonicals,
    bindings,
    primaryBindings,
    entries,
    sources,
    assets,
    metadataKeys,
  }
}
export function pruneToFamily(
  db: DatabaseSync,
  canonicalId: string,
): NonNullable<KnowledgeBackupManifest['scope']> {
  const c = familyClosure(db, canonicalId)
  db.exec('PRAGMA foreign_keys=OFF; BEGIN IMMEDIATE')
  try {
    for (const [table, ids] of [
      ['canonical', c.canonicals],
      ['bindings', c.bindings],
      ['entries', c.entries],
      ['entry_versions', c.entries],
      ['reviews', c.entries],
      ['sources', c.sources],
      ['source_versions', c.sources],
      ['assets', c.assets],
      ['metadata', c.metadataKeys],
    ] as const) {
      const key = table === 'reviews' ? 'entry_id' : table === 'metadata' ? 'key' : 'id'
      const remove = db.prepare(`DELETE FROM ${table} WHERE ${key}=?`)
      for (const row of db.prepare(`SELECT DISTINCT ${key} AS id FROM ${table}`).all() as {
        id: string
      }[])
        if (!ids.has(String(row.id))) remove.run(row.id)
    }
    db.exec(
      'DELETE FROM jobs; DELETE FROM misses; DELETE FROM legacy_products; DELETE FROM legacy_intents; COMMIT; PRAGMA foreign_keys=ON; VACUUM;',
    )
  } catch (cause) {
    db.exec('ROLLBACK')
    throw cause
  }
  const bindings = bodyRows<ProductBinding>(db, 'bindings').filter((b) =>
    c.primaryBindings.has(b.id),
  )
  return {
    kind: 'family',
    canonicalId,
    storeIds: [...new Set(bindings.map((b) => b.storeId))].sort(),
    bindingIds: [...c.primaryBindings].sort(),
    dependencyBindingIds: [...c.bindings].filter((id) => !c.primaryBindings.has(id)).sort(),
    originalFiles: bodyRows<KnowledgeAsset>(db, 'assets')
      .map((a) => a.name)
      .sort(),
  }
}
/** Shared with confirmation planning so current-only removals use the same ownership rule. */
export function familyMergeState(target: DatabaseSync, source: DatabaseSync, canonicalId: string) {
  const incoming = familyClosure(source, canonicalId)
  const old = target.prepare('SELECT id FROM canonical WHERE id=?').get(canonicalId)
    ? familyClosure(target, canonicalId)
    : undefined
  const owned = (v: KnowledgeVersion) =>
    v.scope.kind === 'canonical'
      ? v.scope.canonicalId === canonicalId
      : v.scope.kind === 'binding' && Boolean(old?.primaryBindings.has(v.scope.bindingId))
  const externalEntries = new Set(
    bodyRows<KnowledgeEntry>(target, 'entries')
      .filter((e) => !owned(e.draft) || (e.approved && !owned(e.approved)))
      .map((e) => e.id),
  )
  const replaceableEntries = new Set(
    [...(old?.entries ?? [])].filter((id) => !externalEntries.has(id)),
  )
  const externalSources = new Set(
    bodyRows<KnowledgeVersion>(target, 'entry_versions')
      .filter((v) => !owned(v) || externalEntries.has(v.id))
      .flatMap((v) => v.sourceRefs.map((ref) => ref.sourceId)),
  )
  return { incoming, old, owned, externalSources, replaceableEntries }
}
/** Merge into a CLOSED, staged copy. External dependency identities must already match exactly. */
export function mergeFamily(target: DatabaseSync, source: DatabaseSync, canonicalId: string) {
  const { incoming, old, owned, externalSources, replaceableEntries } = familyMergeState(
    target,
    source,
    canonicalId,
  )
  const sourceBindings = bodyRows<ProductBinding>(source, 'bindings')
  for (const e of bodyRows<KnowledgeEntry>(target, 'entries'))
    if (incoming.entries.has(e.id) && (!owned(e.draft) || (e.approved && !owned(e.approved))))
      throw Error('此知识已调整至其他商品，无法局部覆盖')
  for (const b of sourceBindings) {
    const physical = target
      .prepare(
        'SELECT id,canonical_id FROM bindings WHERE store_id=? AND product_id=? AND sku_id=?',
      )
      .get(b.storeId, b.productId, b.skuId) as { id: string; canonical_id: string } | undefined
    if (physical && (physical.id !== b.id || physical.canonical_id !== b.canonicalId))
      throw Error('恢复商品与现有实体身份冲突，未重定向其他商品')
  }
  target.exec('PRAGMA foreign_keys=OFF; BEGIN IMMEDIATE')
  try {
    // Source/entry dependencies shared by unrelated retained entries are never overwritten silently.
    for (const table of [
      'canonical',
      'bindings',
      'sources',
      'entries',
      'source_versions',
      'entry_versions',
      'reviews',
      'assets',
    ] as const) {
      const rows = source.prepare(`SELECT * FROM ${table}`).all() as Row[]
      for (const row of rows) {
        const primary =
          table === 'canonical'
            ? row.id === canonicalId
            : table === 'bindings'
              ? incoming.primaryBindings.has(String(row.id))
              : table === 'entries' || table === 'entry_versions'
                ? incoming.entries.has(String(row.id))
                : table === 'reviews'
                  ? incoming.entries.has(String(row.entry_id))
                  : table === 'assets'
                    ? false
                    : !externalSources.has(String(row.id)) &&
                      (!old ||
                        old.sources.has(String(row.id)) ||
                        !target.prepare(`SELECT id FROM ${table} WHERE id=?`).get(row.id))
        const keys = table.endsWith('_versions') ? ['id', 'revision'] : ['id']
        const prior = target
          .prepare(`SELECT * FROM ${table} WHERE ${keys.map((k) => `${k}=?`).join(' AND ')}`)
          .get(...keys.map((k) => row[k]!)) as Row | undefined
        if (!primary && prior && JSON.stringify(prior) !== JSON.stringify(row))
          throw Error('恢复依赖与其他商品现有资料冲突，请核对后使用完整备份')
      }
    }
    if (old) {
      for (const [table, ids, key] of [
        ['entry_versions', replaceableEntries, 'id'],
        ['reviews', replaceableEntries, 'entry_id'],
        ['entries', replaceableEntries, 'id'],
      ] as const)
        for (const id of ids) target.prepare(`DELETE FROM ${table} WHERE ${key}=?`).run(id)
      for (const binding of bodyRows<ProductBinding>(target, 'bindings').filter(
        (b) => old.primaryBindings.has(b.id) && !incoming.primaryBindings.has(b.id),
      )) {
        const next = { ...binding, active: false, revision: binding.revision + 1 }
        target
          .prepare('UPDATE bindings SET active=0,body=? WHERE id=?')
          .run(JSON.stringify(next), binding.id)
      }
      // Existing source history is retained; replacing a family restores its version set exactly.
      for (const id of old.sources)
        if (incoming.sources.has(id) && !externalSources.has(id))
          target.prepare('DELETE FROM source_versions WHERE id=?').run(id)
    }
    for (const table of [
      'canonical',
      'bindings',
      'sources',
      'source_versions',
      'entries',
      'entry_versions',
      'reviews',
      'assets',
      'metadata',
    ] as const) {
      for (const row of source.prepare(`SELECT * FROM ${table}`).all() as Row[]) {
        if (table === 'metadata' && (row.key === 'revision' || row.key === 'migration-v1')) continue
        if (
          table === 'metadata' &&
          String(row.key).startsWith('import-document:') &&
          target.prepare('SELECT key FROM metadata WHERE key=?').get(row.key)
        )
          continue
        const columns = Object.keys(row)
        target
          .prepare(
            `INSERT OR REPLACE INTO ${table}(${columns.join(',')}) VALUES(${columns.map(() => '?').join(',')})`,
          )
          .run(...columns.map((k) => row[k]!))
      }
    }
    target.prepare("UPDATE metadata SET value=CAST(value AS INTEGER)+1 WHERE key='revision'").run()
    target.prepare('DELETE FROM metadata WHERE key=?').run(`removed-canonical:${canonicalId}`)
    if (target.prepare('PRAGMA foreign_key_check').all().length) throw Error('恢复关系不完整')
    target.exec('COMMIT; PRAGMA foreign_keys=ON;')
  } catch (cause) {
    target.exec('ROLLBACK')
    throw cause
  }
}

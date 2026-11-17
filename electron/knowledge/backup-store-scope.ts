import { createHash, randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import type {
  CanonicalProduct,
  KnowledgeAsset,
  KnowledgeBackupManifest,
  KnowledgeEntry,
  KnowledgeSource,
  KnowledgeVersion,
  ProductBinding,
} from '../../src/shared/contracts/knowledge'
import { clearKnowledgeCopy } from './clear'

type Row = Record<string, string | number | null>
type StoreScope = Extract<NonNullable<KnowledgeBackupManifest['scope']>, { kind: 'store' }>
const rows = <T>(db: DatabaseSync, table: string): T[] =>
  (db.prepare(`SELECT body FROM ${table}`).all() as { body: string }[]).map(
    (row) => JSON.parse(row.body) as T,
  )
const assetIds = (value: unknown): string[] => {
  if (!value || typeof value !== 'object') return []
  if (Array.isArray(value)) return value.flatMap(assetIds)
  return Object.entries(value).flatMap(([key, item]) =>
    ['assetId', 'imageAssetId'].includes(key) && typeof item === 'string' ? [item] : assetIds(item),
  )
}
const sourceAssetIds = (source: KnowledgeSource) => [
  ...source.assetIds,
  ...assetIds(source.locator),
]
/**
 * Current ownership selects entries; every historical revision and review of those entries is
 * retained as audit evidence. Other-store bindings are kept only when they are required by a
 * selected source and are never treated as primary store ownership.
 */
export function storeClosure(db: DatabaseSync, storeId: string) {
  const allBindings = rows<ProductBinding>(db, 'bindings')
  const primaryBindings = new Set(allBindings.filter((b) => b.storeId === storeId).map((b) => b.id))
  const primaryCanonicals = new Set(
    allBindings.filter((b) => primaryBindings.has(b.id)).map((b) => b.canonicalId),
  )
  const owns = (version: KnowledgeVersion) =>
    version.scope.kind === 'store'
      ? version.scope.storeId === storeId
      : version.scope.kind === 'template'
        ? version.scope.storeIds.includes(storeId)
        : version.scope.kind === 'binding'
          ? primaryBindings.has(version.scope.bindingId)
          : primaryCanonicals.has(version.scope.canonicalId)
  const entries = new Set(
    rows<KnowledgeEntry>(db, 'entries')
      .filter((entry) => owns(entry.draft) || Boolean(entry.approved && owns(entry.approved)))
      .map((entry) => entry.id),
  )
  const versions = rows<KnowledgeVersion>(db, 'entry_versions').filter((version) =>
    entries.has(version.id),
  )
  const currentSources = rows<KnowledgeSource>(db, 'sources')
  const sourceVersions = rows<KnowledgeSource>(db, 'source_versions')
  const sources = new Set(
    currentSources.filter((source) => source.storeId === storeId).map((s) => s.id),
  )
  for (const version of versions) for (const ref of version.sourceRefs) sources.add(ref.sourceId)

  const metadata = db.prepare('SELECT key,value FROM metadata').all() as {
    key: string
    value: string
  }[]
  const originalIds = new Set(
    metadata.filter((m) => m.key.startsWith('original-file:')).map((m) => m.key.slice(14)),
  )
  const assets = new Set<string>()
  let changed = true
  while (changed) {
    const before = sources.size + assets.size
    for (const version of versions) {
      for (const id of assetIds(version)) assets.add(id)
    }
    for (const source of [...currentSources, ...sourceVersions]) {
      if (!sources.has(source.id)) continue
      for (const id of sourceAssetIds(source)) assets.add(id)
    }
    // The registered original file can have rows for several products. Keep its immutable
    // original source but not the unrelated parsed rows; preview discloses the whole-file caveat.
    for (const source of [...currentSources, ...sourceVersions]) {
      if (originalIds.has(source.id) && source.assetIds.some((id) => assets.has(id)))
        sources.add(source.id)
    }
    changed = before !== sources.size + assets.size
  }

  const bindings = new Set(primaryBindings)
  const sourceById = new Map(currentSources.map((source) => [source.id, source]))
  for (const id of sources) {
    const source = sourceById.get(id)
    if (source?.bindingId) bindings.add(source.bindingId)
  }
  for (const version of versions)
    if (version.scope.kind === 'binding') bindings.add(version.scope.bindingId)

  const canonicals = new Set(primaryCanonicals)
  for (const binding of allBindings)
    if (bindings.has(binding.id)) canonicals.add(binding.canonicalId)
  for (const version of versions)
    if (version.scope.kind === 'canonical') canonicals.add(version.scope.canonicalId)

  const metadataKeys = new Set(
    metadata
      .filter(
        (item) =>
          item.key === 'revision' ||
          (item.key.startsWith('original-file:') && sources.has(item.key.slice(14))) ||
          (item.key.startsWith('import-item:') && sources.has(item.value)) ||
          (item.key.startsWith('legacy-') &&
            (entries.has(item.value) || canonicals.has(item.value))),
      )
      .map((item) => item.key),
  )
  return {
    storeId,
    primaryCanonicals,
    canonicals,
    bindings,
    primaryBindings,
    entries,
    sources,
    assets,
    metadataKeys,
  }
}

function appliesToStore(
  value: KnowledgeVersion,
  storeId: string,
  closure: ReturnType<typeof storeClosure>,
) {
  return value.scope.kind === 'store'
    ? value.scope.storeId === storeId
    : value.scope.kind === 'template'
      ? value.scope.storeIds.includes(storeId)
      : value.scope.kind === 'binding'
        ? closure.primaryBindings.has(value.scope.bindingId)
        : closure.primaryCanonicals.has(value.scope.canonicalId)
}

/** Strip the other shop's side of an entry whose ownership changed between revisions. */
function sanitizeStoreEntries(
  db: DatabaseSync,
  storeId: string,
  closure: ReturnType<typeof storeClosure>,
) {
  for (const entry of rows<KnowledgeEntry>(db, 'entries')) {
    const draftApplies = appliesToStore(entry.draft, storeId, closure)
    const approvedApplies = Boolean(
      entry.approved && appliesToStore(entry.approved, storeId, closure),
    )
    if (!draftApplies && !approvedApplies) continue
    const draft = draftApplies ? entry.draft : entry.approved!
    const approved = approvedApplies ? entry.approved : null
    const status =
      !draftApplies && approvedApplies
        ? 'approved'
        : !approvedApplies
          ? entry.status === 'withdrawn'
            ? 'withdrawn'
            : 'draft'
          : entry.status
    if (
      draft === entry.draft &&
      approved === entry.approved &&
      status === entry.status &&
      Math.max(draft.revision, approved?.revision ?? 0) === entry.revision
    )
      continue
    db.prepare('UPDATE entries SET body=? WHERE id=?').run(
      JSON.stringify({
        ...entry,
        revision: Math.max(draft.revision, approved?.revision ?? 0),
        status,
        draft,
        approved,
      }),
      entry.id,
    )
  }
  const retained = new Set<string>()
  for (const row of db.prepare('SELECT id,revision,body FROM entry_versions').all() as {
    id: string
    revision: number
    body: string
  }[]) {
    const version = JSON.parse(row.body) as KnowledgeVersion
    if (!appliesToStore(version, storeId, closure)) {
      db.prepare('DELETE FROM entry_versions WHERE id=? AND revision=?').run(row.id, row.revision)
    } else retained.add(`${row.id}:${row.revision}`)
  }
  for (const row of db.prepare('SELECT entry_id,revision FROM reviews').all() as {
    entry_id: string
    revision: number
  }[])
    if (!retained.has(`${row.entry_id}:${row.revision}`))
      db.prepare('DELETE FROM reviews WHERE entry_id=? AND revision=?').run(
        row.entry_id,
        row.revision,
      )
}

export function pruneToStore(db: DatabaseSync, storeId: string): StoreScope {
  const prune = (closure: ReturnType<typeof storeClosure>) => {
    for (const [table, ids] of [
      ['canonical', closure.canonicals],
      ['bindings', closure.bindings],
      ['entries', closure.entries],
      ['entry_versions', closure.entries],
      ['reviews', closure.entries],
      ['sources', closure.sources],
      ['source_versions', closure.sources],
      ['assets', closure.assets],
      ['metadata', closure.metadataKeys],
    ] as const) {
      const key = table === 'reviews' ? 'entry_id' : table === 'metadata' ? 'key' : 'id'
      const remove = db.prepare(`DELETE FROM ${table} WHERE ${key}=?`)
      for (const row of db.prepare(`SELECT DISTINCT ${key} AS id FROM ${table}`).all() as {
        id: string
      }[])
        if (!ids.has(row.id)) remove.run(row.id)
    }
  }
  const initial = storeClosure(db, storeId)
  db.exec('PRAGMA foreign_keys=OFF; BEGIN IMMEDIATE')
  try {
    prune(initial)
    sanitizeStoreEntries(db, storeId, initial)
    // Removing another shop's side can make a source, canonical, binding or asset unreachable.
    // Recompute the exact projection before writing the manifest.
    const closure = storeClosure(db, storeId)
    prune(closure)
    db.exec(
      'DELETE FROM jobs; DELETE FROM misses; DELETE FROM legacy_products; DELETE FROM legacy_intents; COMMIT; PRAGMA foreign_keys=ON; VACUUM;',
    )
    return {
      kind: 'store',
      storeId,
      storeIds: [storeId],
      bindingIds: [...closure.primaryBindings].sort(),
      dependencyBindingIds: [...closure.bindings]
        .filter((id) => !closure.primaryBindings.has(id))
        .sort(),
      originalFiles: rows<KnowledgeAsset>(db, 'assets')
        .map((asset) => asset.name)
        .sort(),
    }
  } catch (cause) {
    try {
      db.exec('ROLLBACK')
    } finally {
      db.exec('PRAGMA foreign_keys=ON')
    }
    throw cause
  }
}

/** Immutable foreign binding evidence is checked, never installed or overwritten for another shop. */
export function checkStoreDependencies(
  target: DatabaseSync,
  source: DatabaseSync,
  storeId: string,
) {
  const closure = storeClosure(source, storeId)
  for (const binding of rows<ProductBinding>(source, 'bindings').filter(
    (item) => !closure.primaryBindings.has(item.id),
  )) {
    const prior = target.prepare('SELECT body FROM bindings WHERE id=?').get(binding.id) as
      | { body: string }
      | undefined
    if (!prior || JSON.stringify(JSON.parse(prior.body)) !== JSON.stringify(binding))
      throw Error('本店备份依赖的外店商品身份缺失或已变化，未修改任何店铺')
  }
  return closure
}

/** Restore A as isolated identities. B's existing facts, sources and canonicals are untouched. */
export function mergeStore(target: DatabaseSync, source: DatabaseSync, storeId: string) {
  const incoming = checkStoreDependencies(target, source, storeId)
  const sourceBindings = rows<ProductBinding>(source, 'bindings')
  const ownBindings = sourceBindings.filter((binding) => incoming.primaryBindings.has(binding.id))
  const maps = {
    canonical: new Map<string, string>(),
    bindings: new Map<string, string>(),
    sources: new Map<string, string>(),
    entries: new Map<string, string>(),
    assets: new Map<string, string>(),
  }

  for (const id of incoming.primaryCanonicals) maps.canonical.set(id, randomUUID())
  for (const id of incoming.entries) maps.entries.set(id, randomUUID())
  for (const id of incoming.sources) maps.sources.set(id, randomUUID())

  const targetBindings = rows<ProductBinding>(target, 'bindings')
  for (const binding of ownBindings) {
    const sameId = targetBindings.find((item) => item.id === binding.id)
    if (
      sameId &&
      (sameId.storeId !== storeId ||
        sameId.productId !== binding.productId ||
        sameId.skuId !== binding.skuId)
    )
      throw Error('本店商品标识与已有实体身份冲突')
    const physical = targetBindings.find(
      (item) =>
        item.storeId === storeId &&
        item.productId === binding.productId &&
        item.skuId === binding.skuId,
    )
    maps.bindings.set(binding.id, physical?.id ?? binding.id)
  }

  const targetAssets = rows<KnowledgeAsset>(target, 'assets')
  const sourceAssets = rows<KnowledgeAsset>(source, 'assets')
  const mappedAssets = new Map<string, KnowledgeAsset>()
  for (const asset of sourceAssets) {
    // Assets are immutable and content-addressed, but the restored A identities must not alias a
    // B-owned row. A deterministic clone also makes repeating the same archive idempotent.
    const id = createHash('sha256')
      .update(`knowledge-store-asset:${storeId}:${asset.id}:${asset.sha256}`)
      .digest('hex')
    const sameId = targetAssets.find((item) => item.id === id)
    if (sameId && sameId.sha256 !== asset.sha256) throw Error('本店备份附件标识与其他资料冲突')
    const clone = sameId ?? { ...asset, id }
    maps.assets.set(asset.id, clone.id)
    mappedAssets.set(asset.id, clone)
    if (!sameId) targetAssets.push(clone)
  }

  const asset = (id: string) => {
    const mapped = maps.assets.get(id)
    if (!mapped) throw Error('本店备份缺少附件闭包')
    return mapped
  }
  const canonical = (id: string) => {
    const mapped = maps.canonical.get(id)
    if (!mapped) throw Error('本店备份包含无关共享商品')
    return mapped
  }
  const applies = (value: KnowledgeVersion) =>
    value.scope.kind === 'store'
      ? value.scope.storeId === storeId
      : value.scope.kind === 'template'
        ? value.scope.storeIds.includes(storeId)
        : value.scope.kind === 'binding'
          ? incoming.primaryBindings.has(value.scope.bindingId)
          : incoming.primaryCanonicals.has(value.scope.canonicalId)
  const retainedVersions = new Set<string>()
  for (const row of source.prepare('SELECT body FROM entry_versions').all() as { body: string }[]) {
    const value = JSON.parse(row.body) as KnowledgeVersion
    if (incoming.entries.has(value.id) && applies(value))
      retainedVersions.add(`${value.id}:${value.revision}`)
  }
  const version = (value: KnowledgeVersion): KnowledgeVersion => ({
    ...value,
    id: maps.entries.get(value.id) ?? '',
    scope:
      value.scope.kind === 'canonical'
        ? { kind: 'canonical', canonicalId: canonical(value.scope.canonicalId) }
        : value.scope.kind === 'binding' && maps.bindings.has(value.scope.bindingId)
          ? { kind: 'binding', bindingId: maps.bindings.get(value.scope.bindingId)! }
          : { kind: 'store', storeId },
    sourceRefs: value.sourceRefs.map((ref) => {
      const sourceId = maps.sources.get(ref.sourceId)
      if (!sourceId) throw Error('本店备份知识引用了缺失来源')
      return { ...ref, sourceId }
    }),
    ...(value.modelEvidence
      ? {
          modelEvidence: {
            ...value.modelEvidence,
            imageAssetId: asset(value.modelEvidence.imageAssetId),
          },
        }
      : {}),
  })
  if ([...maps.entries.values()].some((id) => !id)) throw Error('本店备份知识身份无效')
  const cloneSource = (value: KnowledgeSource): KnowledgeSource => {
    const { bindingId, ...rest } = value
    const locator = {
      ...value.locator,
      ...(value.locator.assetId ? { assetId: asset(value.locator.assetId) } : {}),
      ...(value.locator.imageAssetId ? { imageAssetId: asset(value.locator.imageAssetId) } : {}),
    }
    const next = {
      ...rest,
      id: maps.sources.get(value.id)!,
      storeId,
      ...(bindingId && maps.bindings.has(bindingId)
        ? { bindingId: maps.bindings.get(bindingId)! }
        : {}),
      assetIds: value.assetIds.map(asset),
      locator,
    }
    return {
      ...next,
      hash: createHash('sha256')
        .update(
          JSON.stringify({
            text: next.text,
            locator: next.locator,
            assetIds: next.assetIds,
            ...(next.removed ? { removed: true } : {}),
          }),
        )
        .digest('hex'),
    }
  }
  const insert = (table: string, row: Row) => {
    const keys = Object.keys(row)
    target
      .prepare(
        `INSERT OR REPLACE INTO ${table}(${keys.join(',')}) VALUES(${keys.map(() => '?').join(',')})`,
      )
      .run(...keys.map((key) => row[key]!))
  }

  target.exec('PRAGMA foreign_keys=OFF; BEGIN IMMEDIATE')
  try {
    clearKnowledgeCopy(target, { kind: 'store', storeId }, Date.now())
    for (const value of rows<CanonicalProduct>(source, 'canonical')) {
      if (!incoming.primaryCanonicals.has(value.id)) continue
      const next = { ...value, id: canonical(value.id) }
      insert('canonical', { id: next.id, body: JSON.stringify(next) })
    }
    for (const binding of ownBindings) {
      const next = {
        ...binding,
        id: maps.bindings.get(binding.id)!,
        canonicalId: canonical(binding.canonicalId),
      }
      insert('bindings', {
        id: next.id,
        canonical_id: next.canonicalId,
        store_id: storeId,
        product_id: next.productId,
        sku_id: next.skuId,
        active: Number(next.active),
        body: JSON.stringify(next),
      })
      target.prepare('DELETE FROM metadata WHERE key=?').run(`cleared-binding:${next.id}`)
    }
    for (const value of mappedAssets.values()) {
      if (!target.prepare('SELECT id FROM assets WHERE id=?').get(value.id))
        insert('assets', { id: value.id, body: JSON.stringify(value) })
    }
    for (const value of rows<KnowledgeSource>(source, 'sources')) {
      const next = cloneSource(value)
      insert('sources', {
        id: next.id,
        store_id: storeId,
        binding_id: next.bindingId ?? null,
        body: JSON.stringify(next),
      })
      insert('metadata', {
        key: `restored-source-origin:${next.id}`,
        value: JSON.stringify({
          storeId: value.storeId,
          bindingId: value.bindingId,
          sourceId: value.id,
        }),
      })
    }
    for (const row of source.prepare('SELECT * FROM source_versions').all() as Row[]) {
      const next = cloneSource(JSON.parse(String(row.body)) as KnowledgeSource)
      insert('source_versions', { ...row, id: next.id, body: JSON.stringify(next) })
    }
    for (const value of rows<KnowledgeEntry>(source, 'entries')) {
      const draftApplies = applies(value.draft)
      const approvedApplies = Boolean(value.approved && applies(value.approved))
      if (!draftApplies && !approvedApplies) throw Error('本店备份知识未应用于当前店铺')
      const draft = version(draftApplies ? value.draft : value.approved!)
      const approved = approvedApplies ? version(value.approved!) : null
      // Changing ownership is legitimate. Never turn another shop's current draft/approval into
      // A's own: retain A's side and leave B's live copy untouched.
      const status =
        !draftApplies && approvedApplies
          ? 'approved'
          : !approvedApplies
            ? value.status === 'withdrawn'
              ? 'withdrawn'
              : 'draft'
            : value.status
      const next = {
        ...value,
        id: maps.entries.get(value.id)!,
        revision: Math.max(draft.revision, approved?.revision ?? 0),
        status,
        draft,
        approved,
      }
      insert('entries', { id: next.id, body: JSON.stringify(next) })
    }
    for (const row of source.prepare('SELECT * FROM entry_versions').all() as Row[]) {
      const value = JSON.parse(String(row.body)) as KnowledgeVersion
      if (!retainedVersions.has(`${value.id}:${value.revision}`)) continue
      const next = version(value)
      insert('entry_versions', { ...row, id: next.id, body: JSON.stringify(next) })
    }
    for (const row of source.prepare('SELECT * FROM reviews').all() as Row[]) {
      const entryId = maps.entries.get(String(row.entry_id))
      if (!entryId) throw Error('本店备份审核记录引用了缺失知识')
      if (!retainedVersions.has(`${row.entry_id}:${row.revision}`)) continue
      insert('reviews', { ...row, id: randomUUID(), entry_id: entryId })
    }
    for (const row of source
      .prepare(
        "SELECT key,value FROM metadata WHERE key LIKE 'original-file:%' OR key LIKE 'import-item:%'",
      )
      .all() as { key: string; value: string }[]) {
      if (row.key.startsWith('original-file:')) {
        const sourceId = maps.sources.get(row.key.slice(14))
        if (sourceId) insert('metadata', { key: `original-file:${sourceId}`, value: row.value })
      } else {
        const sourceId = maps.sources.get(row.value)
        // Never overwrite an existing import identity: it may belong to another shop's file.
        if (sourceId && !target.prepare('SELECT key FROM metadata WHERE key=?').get(row.key))
          insert('metadata', { key: row.key, value: sourceId })
      }
    }
    target.prepare("UPDATE metadata SET value=CAST(value AS INTEGER)+1 WHERE key='revision'").run()
    if (target.prepare('PRAGMA foreign_key_check').all().length) throw Error('本店恢复关系不完整')
    target.exec('COMMIT; PRAGMA foreign_keys=ON;')
  } catch (cause) {
    try {
      target.exec('ROLLBACK')
    } finally {
      target.exec('PRAGMA foreign_keys=ON')
    }
    throw cause
  }
}

import type { DatabaseSync } from 'node:sqlite'
import { join } from 'node:path'
import type {
  KnowledgeAsset,
  KnowledgeEntry,
  KnowledgeJob,
  KnowledgeScope,
  KnowledgeSource,
  KnowledgeVersion,
  ProductBinding,
} from '../../src/shared/contracts/knowledge'
import { clearKnowledgeCopy } from './clear'

const rows = <T>(db: DatabaseSync, table: string): T[] =>
  (db.prepare(`SELECT body FROM ${table}`).all() as { body: string }[]).map(
    (row) => JSON.parse(row.body) as T,
  )

type EntryVersionRow = { id: string; revision: number; reviewed: number; body: string }

export interface KnowledgeStorePurgeResult {
  bindings: number
  entries: number
  entryVersions: number
  sources: number
  sourceVersions: number
  assets: number
  jobs: number
  misses: number
  legacyProducts: number
  legacyIntents: number
  assetFiles: string[]
}

const versionAssetIds = (version: KnowledgeVersion) =>
  version.modelEvidence?.imageAssetId ? [version.modelEvidence.imageAssetId] : []

const sourceAssetIds = (source: KnowledgeSource) =>
  [...source.assetIds, source.locator.assetId, source.locator.imageAssetId].filter(
    (id): id is string => typeof id === 'string' && Boolean(id),
  )

const count = (db: DatabaseSync, table: string) =>
  Number(
    (db.prepare(`SELECT count(*) AS value FROM ${table}`).get() as { value: number | bigint })
      .value,
  )

/**
 * Physically removes only data attributable to one store. The existing clear helper
 * first withholds the store's applicability from shared entries and revokes its current
 * evidence; this function then deletes the now-unreferenced store rows instead of
 * leaving tombstones. Canonicals are never deleted, and cross-store evidence retained by
 * another store's current/history rows is kept.
 */
export function purgeStoreKnowledge(
  db: DatabaseSync,
  directory: string,
  storeId: string,
  now: number,
): KnowledgeStorePurgeResult {
  const before = {
    bindings: count(db, 'bindings'),
    entries: count(db, 'entries'),
    entryVersions: count(db, 'entry_versions'),
    sources: count(db, 'sources'),
    sourceVersions: count(db, 'source_versions'),
    assets: count(db, 'assets'),
    jobs: count(db, 'jobs'),
    misses: count(db, 'misses'),
    legacyProducts: count(db, 'legacy_products'),
    legacyIntents: count(db, 'legacy_intents'),
  }
  const bindings = rows<ProductBinding>(db, 'bindings')
  const own = new Set(bindings.filter((binding) => binding.storeId === storeId).map((b) => b.id))
  const orphanCanonicals = new Set(
    bindings
      .filter((binding) => own.has(binding.id))
      .map((binding) => binding.canonicalId)
      .filter(
        (canonicalId) =>
          !bindings.some(
            (binding) =>
              binding.canonicalId === canonicalId && binding.storeId !== storeId && binding.active,
          ),
      ),
  )
  const jobs = rows<KnowledgeJob>(db, 'jobs').filter((job) => job.storeId === storeId)
  const jobIds = new Set(jobs.map((job) => job.id))
  const legacyIntents = rows<{ id: string; storeIds: string[] }>(db, 'legacy_intents')
  const removedLegacyIntents = new Set(
    legacyIntents
      .filter(
        (pack) => pack.storeIds.includes(storeId) && pack.storeIds.every((id) => id === storeId),
      )
      .map((pack) => pack.id),
  )

  const scopeIsStoreOnly = (scope: KnowledgeScope) => {
    if (scope.kind === 'store') return scope.storeId === storeId
    if (scope.kind === 'binding') return own.has(scope.bindingId)
    if (scope.kind === 'template') return scope.storeIds.includes(storeId)
    return orphanCanonicals.has(scope.canonicalId)
  }
  const appliesToAnotherStore = (scope: KnowledgeScope) => {
    if (scope.kind === 'store') return scope.storeId !== storeId
    if (scope.kind === 'binding') return !own.has(scope.bindingId)
    // Empty template is a global/shared draft; it must never be treated as store-only.
    if (scope.kind === 'template')
      return scope.storeIds.length === 0 || scope.storeIds.some((id) => id !== storeId)
    return !orphanCanonicals.has(scope.canonicalId)
  }

  // Only assets reached from this store's own entries/sources can be considered for
  // removal. B's unreferenced uploads have no storeId in the content-addressed table,
  // so a global "orphan" sweep would be unsafe.
  const targetAssetIds = new Set<string>()
  const collectTargetVersion = (version: KnowledgeVersion | null) => {
    if (!version || !scopeIsStoreOnly(version.scope)) return
    for (const id of versionAssetIds(version)) targetAssetIds.add(id)
  }
  for (const entry of rows<KnowledgeEntry>(db, 'entries')) {
    collectTargetVersion(entry.draft)
    collectTargetVersion(entry.approved)
  }
  for (const row of db.prepare('SELECT body FROM entry_versions').all() as { body: string }[])
    collectTargetVersion(JSON.parse(row.body) as KnowledgeVersion)
  for (const source of rows<KnowledgeSource>(db, 'sources')) {
    if (source.storeId !== storeId && !own.has(source.bindingId ?? '')) continue
    for (const id of sourceAssetIds(source)) targetAssetIds.add(id)
  }
  for (const row of db.prepare('SELECT body FROM source_versions').all() as { body: string }[]) {
    const source = JSON.parse(row.body) as KnowledgeSource
    if (source.storeId !== storeId && !own.has(source.bindingId ?? '')) continue
    for (const id of sourceAssetIds(source)) targetAssetIds.add(id)
  }

  // Reuse the reviewed clear semantics instead of inventing a second scope algorithm.
  clearKnowledgeCopy(db, { kind: 'store', storeId }, now)

  const entries = rows<KnowledgeEntry>(db, 'entries')
  const targetEntryIds = new Set<string>()
  for (const entry of entries) {
    const appliesOutside =
      appliesToAnotherStore(entry.draft.scope) ||
      (entry.approved ? appliesToAnotherStore(entry.approved.scope) : false)
    if (!appliesOutside) targetEntryIds.add(entry.id)
  }
  for (const id of targetEntryIds) {
    db.prepare('DELETE FROM reviews WHERE entry_id=?').run(id)
    db.prepare('DELETE FROM entry_versions WHERE id=?').run(id)
    db.prepare('DELETE FROM entries WHERE id=?').run(id)
  }

  // Other-store entries can retain immutable audit history. Only their store-scoped
  // versions are removed here; their remaining versions and evidence stay intact.
  const versions = db
    .prepare('SELECT id,revision,reviewed,body FROM entry_versions')
    .all() as EntryVersionRow[]
  for (const row of versions) {
    if (targetEntryIds.has(row.id)) continue
    const version = JSON.parse(row.body) as KnowledgeVersion
    if (!scopeIsStoreOnly(version.scope)) continue
    db.prepare('DELETE FROM entry_versions WHERE id=? AND revision=?').run(row.id, row.revision)
    db.prepare('DELETE FROM reviews WHERE entry_id=? AND revision=?').run(row.id, row.revision)
  }

  for (const id of own) db.prepare('DELETE FROM bindings WHERE id=?').run(id)

  const remainingEntries = rows<KnowledgeEntry>(db, 'entries')
  const remainingVersions = db
    .prepare('SELECT id,revision,reviewed,body FROM entry_versions')
    .all() as EntryVersionRow[]
  const referencedSources = new Set<string>()
  for (const entry of remainingEntries)
    for (const version of [entry.draft, entry.approved])
      if (version) for (const ref of version.sourceRefs) referencedSources.add(ref.sourceId)
  for (const row of remainingVersions)
    for (const ref of (JSON.parse(row.body) as KnowledgeVersion).sourceRefs)
      referencedSources.add(ref.sourceId)

  const removedSources = new Set<string>()
  for (const source of rows<KnowledgeSource>(db, 'sources')) {
    if (source.storeId !== storeId && !own.has(source.bindingId ?? '')) continue
    if (referencedSources.has(source.id)) continue
    removedSources.add(source.id)
    db.prepare('DELETE FROM source_versions WHERE id=?').run(source.id)
    db.prepare('DELETE FROM sources WHERE id=?').run(source.id)
  }

  const referencedAssets = new Set<string>()
  for (const source of rows<KnowledgeSource>(db, 'sources'))
    for (const id of sourceAssetIds(source)) referencedAssets.add(id)
  for (const row of db.prepare('SELECT body FROM source_versions').all() as { body: string }[]) {
    const source = JSON.parse(row.body) as KnowledgeSource
    for (const id of sourceAssetIds(source)) referencedAssets.add(id)
  }
  for (const entry of remainingEntries)
    for (const version of [entry.draft, entry.approved])
      if (version) for (const id of versionAssetIds(version)) referencedAssets.add(id)
  for (const row of remainingVersions)
    for (const id of versionAssetIds(JSON.parse(row.body) as KnowledgeVersion))
      referencedAssets.add(id)

  const assetFiles = new Set<string>()
  const removedAssets: KnowledgeAsset[] = []
  for (const asset of rows<KnowledgeAsset>(db, 'assets')) {
    if (!targetAssetIds.has(asset.id) || referencedAssets.has(asset.id)) continue
    removedAssets.push(asset)
    // Keep the digest tombstone until the file unlink succeeds; a retry can then
    // finish the file step even though the asset row is already gone.
    db.prepare('INSERT OR REPLACE INTO metadata VALUES(?,?)').run(
      `purged-asset:${storeId}:${asset.sha256}`,
      '1',
    )
    db.prepare('DELETE FROM assets WHERE id=?').run(asset.id)
  }
  for (const asset of removedAssets) assetFiles.add(join(directory, 'assets', asset.sha256))
  for (const row of db
    .prepare('SELECT key FROM metadata WHERE key LIKE ?')
    .all(`purged-asset:${storeId}:%`) as { key: string }[]) {
    const sha256 = row.key.slice(`purged-asset:${storeId}:`.length)
    if (/^[a-f0-9]{64}$/.test(sha256)) assetFiles.add(join(directory, 'assets', sha256))
  }

  for (const id of jobIds) {
    db.prepare('DELETE FROM jobs WHERE id=?').run(id)
    db.prepare('DELETE FROM metadata WHERE key LIKE ?').run(`learning-rejected-response:${id}:%`)
  }
  db.prepare('DELETE FROM metadata WHERE key=?').run(`daily-check:${storeId}`)
  for (const row of db
    .prepare("SELECT key,value FROM metadata WHERE key LIKE 'learning-estimate:%'")
    .all() as {
    key: string
    value: string
  }[]) {
    try {
      if ((JSON.parse(row.value) as { storeId?: unknown }).storeId === storeId)
        db.prepare('DELETE FROM metadata WHERE key=?').run(row.key)
    } catch {
      // Leave unrelated or malformed global metadata untouched.
    }
  }
  for (const id of removedSources) {
    db.prepare('DELETE FROM metadata WHERE key IN (?,?)').run(
      `cleared-source:${id}`,
      `legacy-source:${id}`,
    )
  }
  for (const id of own) db.prepare('DELETE FROM metadata WHERE key=?').run(`cleared-binding:${id}`)
  for (const id of removedLegacyIntents)
    db.prepare('DELETE FROM metadata WHERE key=?').run(`legacy-intent-mappings:${id}`)
  // Never remove a shared canonical row or another store's content. The marker only
  // blocks late writes and future resolution for this removed store.
  db.prepare('INSERT OR REPLACE INTO metadata VALUES(?,?)').run(`removed-store:${storeId}`, '1')
  db.prepare('INSERT OR REPLACE INTO metadata VALUES(?,?)').run(`purged-store:${storeId}`, '1')

  return {
    bindings: before.bindings - count(db, 'bindings'),
    entries: before.entries - count(db, 'entries'),
    entryVersions: before.entryVersions - count(db, 'entry_versions'),
    sources: before.sources - count(db, 'sources'),
    sourceVersions: before.sourceVersions - count(db, 'source_versions'),
    assets: before.assets - count(db, 'assets'),
    jobs: before.jobs - count(db, 'jobs'),
    misses: before.misses - count(db, 'misses'),
    legacyProducts: before.legacyProducts - count(db, 'legacy_products'),
    legacyIntents: before.legacyIntents - count(db, 'legacy_intents'),
    assetFiles: [...assetFiles],
  }
}

export function knowledgeStoreScope(scope: KnowledgeScope, storeId: string): boolean {
  if (scope.kind === 'store') return scope.storeId === storeId
  if (scope.kind === 'template') return scope.storeIds.includes(storeId)
  return false
}

export function isStorePurged(db: DatabaseSync, storeId: string): boolean {
  const row = db
    .prepare('SELECT value FROM metadata WHERE key=?')
    .get(`purged-store:${storeId}`) as { value: string } | undefined
  return row?.value === '1'
}

export { versionAssetIds }

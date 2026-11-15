import { createHash, randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import type { KnowledgeClearScope } from '../../src/shared/contracts/knowledge-client'
import type {
  KnowledgeEntry,
  KnowledgeVersion,
  ProductBinding,
  KnowledgeSource,
} from '../../src/shared/contracts/knowledge'

const rows = <T>(db: DatabaseSync, table: string): T[] =>
  (db.prepare(`SELECT body FROM ${table}`).all() as { body: string }[]).map(
    (r) => JSON.parse(r.body) as T,
  )

/** Only called on a main-owned backup copy. Histories remain immutable for store-scoped removal. */
export function clearKnowledgeCopy(db: DatabaseSync, scope: KnowledgeClearScope, now: number) {
  const metadata = (key: string, value: string) =>
    db.prepare('INSERT OR REPLACE INTO metadata VALUES(?,?)').run(key, value)
  if (scope.kind === 'account') {
    for (const table of [
      'reviews',
      'entry_versions',
      'entries',
      'source_versions',
      'sources',
      'bindings',
      'canonical',
      'jobs',
      'misses',
      'assets',
      'legacy_products',
      'legacy_intents',
    ])
      db.exec(`DELETE FROM ${table}`)
    db.exec(
      "DELETE FROM metadata WHERE key NOT IN ('revision','settings','migration-v1','lastBackupDirectory')",
    )
  } else {
    const bindings = rows<ProductBinding>(db, 'bindings')
    const own = new Set(bindings.filter((b) => b.storeId === scope.storeId).map((b) => b.id))
    const orphan = new Set(
      bindings
        .filter((b) => own.has(b.id))
        .map((b) => b.canonicalId)
        .filter((id) => !bindings.some((b) => b.active && b.canonicalId === id && !own.has(b.id))),
    )
    const narrow = (v: KnowledgeVersion | null): KnowledgeVersion | null => {
      if (!v) return null
      const s = v.scope
      if (
        (s.kind === 'store' && s.storeId === scope.storeId) ||
        (s.kind === 'binding' && own.has(s.bindingId)) ||
        (s.kind === 'canonical' && orphan.has(s.canonicalId))
      )
        return null
      if (s.kind !== 'template' || !s.storeIds.includes(scope.storeId)) return v
      const storeIds = s.storeIds.filter((id) => id !== scope.storeId)
      return storeIds.length ? { ...v, scope: { kind: 'template', storeIds } } : null
    }
    for (const entry of rows<KnowledgeEntry>(db, 'entries')) {
      let draft = narrow(entry.draft),
        approved = narrow(entry.approved)
      if (draft === entry.draft && approved === entry.approved) continue
      let revision = entry.revision
      const version = (v: KnowledgeVersion, reviewed: boolean) => {
        const next = { ...v, revision: ++revision, updatedAt: now }
        db.prepare('INSERT INTO entry_versions VALUES(?,?,?,?)').run(
          next.id,
          next.revision,
          reviewed ? 1 : 0,
          JSON.stringify(next),
        )
        // Removing applicability copies existing reviewed content; it never approves new facts or broadens scope.
        if (reviewed)
          db.prepare('INSERT INTO reviews VALUES(?,?,?,?,?)').run(
            randomUUID(),
            next.id,
            next.revision,
            now,
            'manual-correction',
          )
        return next
      }
      let status = entry.status
      if (!draft && !approved) {
        draft = version(entry.draft, false)
        status = 'withdrawn'
      } else {
        const same = entry.approved?.revision === entry.draft.revision
        if (approved && approved !== entry.approved) approved = version(approved, true)
        if (!draft) {
          draft = version(approved!, Boolean(approved))
          approved = draft
          if (status === 'draft') status = 'approved'
        } else if (same && approved) draft = approved
        else draft = version(draft, false)
        if (!approved && status === 'approved') status = 'draft'
      }
      db.prepare('UPDATE entries SET body=? WHERE id=?').run(
        JSON.stringify({ ...entry, revision, draft, approved, status }),
        entry.id,
      )
    }
    // Evidence used by retained entries (including their histories) belongs to their audit closure.
    const retained = new Set(
      rows<KnowledgeEntry>(db, 'entries')
        .filter((e) => e.status !== 'withdrawn')
        .map((e) => e.id),
    )
    const dependencies = new Set(
      rows<KnowledgeVersion>(db, 'entry_versions')
        .filter((v) => retained.has(v.id))
        .flatMap((v) => v.sourceRefs.map((r) => r.sourceId)),
    )
    for (const source of rows<KnowledgeSource>(db, 'sources')) {
      if (source.storeId !== scope.storeId) continue
      // Retained cross-shop evidence is immutable lineage, not this shop's next import identity.
      metadata(`cleared-source:${source.id}`, '1')
      if (dependencies.has(source.id) || source.removed) continue
      // Preserve original bytes/hash and versions; the current tombstone prevents further use.
      const hash = createHash('sha256')
        .update(
          JSON.stringify({
            text: source.text,
            locator: source.locator,
            assetIds: source.assetIds,
            removed: true,
          }),
        )
        .digest('hex')
      const next = { ...source, hash, removed: true, revision: source.revision + 1, updatedAt: now }
      db.prepare('UPDATE sources SET body=? WHERE id=?').run(JSON.stringify(next), source.id)
      db.prepare('INSERT INTO source_versions VALUES(?,?,?)').run(
        next.id,
        next.revision,
        JSON.stringify(next),
      )
    }
    for (const b of bindings.filter((b) => own.has(b.id))) {
      const next = { ...b, active: false, revision: b.revision + 1, updatedAt: now }
      db.prepare('UPDATE bindings SET active=0,body=? WHERE id=?').run(JSON.stringify(next), b.id)
      metadata(`cleared-binding:${b.id}`, '1')
    }
    for (const table of ['jobs', 'misses', 'legacy_products'])
      for (const row of rows<{ id: string; storeId: string }>(db, table))
        if (row.storeId === scope.storeId) db.prepare(`DELETE FROM ${table} WHERE id=?`).run(row.id)
    for (const pack of rows<{ id: string; storeIds: string[] }>(db, 'legacy_intents')) {
      if (!pack.storeIds.includes(scope.storeId)) continue
      const storeIds = pack.storeIds.filter((id) => id !== scope.storeId)
      if (!storeIds.length) db.prepare('DELETE FROM legacy_intents WHERE id=?').run(pack.id)
      else
        db.prepare('UPDATE legacy_intents SET body=? WHERE id=?').run(
          JSON.stringify({ ...pack, storeIds }),
          pack.id,
        )
    }
    for (const id of orphan) metadata(`removed-canonical:${id}`, '1')
  }
  // Even accounts with no previous import must never resurrect old JSON after a clear.
  const migration = db.prepare('SELECT value FROM metadata WHERE key=?').get('migration-v1') as
    | { value: string }
    | undefined
  if (!migration || JSON.parse(migration.value).status !== 'complete')
    metadata(
      'migration-v1',
      JSON.stringify({
        status: 'complete',
        error: '',
        backupDirectory: null,
        inputHashes: {},
        idMap: {},
      }),
    )
}

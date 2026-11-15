import { createHash } from 'node:crypto'
import {
  knowledgeDraftSchema,
  type KnowledgeEntry,
  type KnowledgeVersion,
} from '../../src/shared/contracts/knowledge'

/** Keep existing short-key overrides compatible; long questions retain their complete identity. */
export function questionConflictKey(question: string) {
  return question.length <= 300
    ? question
    : `question-sha256:${createHash('sha256').update(JSON.stringify(question)).digest('hex')}`
}

/** Only the known pre-fix automatic format is repairable. Call inside the writer transaction. */
export function repairAutomaticConflictKeys(db: import('node:sqlite').DatabaseSync) {
  const history = db.prepare('SELECT id,revision,body FROM entry_versions').all() as {
    id: string
    revision: number
    body: string
  }[]
  const keys = new Map<string, string>()
  for (const row of history) {
    const version = JSON.parse(row.body) as KnowledgeVersion
    if (version.conflictKey.length > 300 && version.conflictKey === version.question) {
      const { revision, updatedAt, ...input } = version
      if (revision !== row.revision || version.id !== row.id || !Number.isFinite(updatedAt))
        throw Error('历史知识版本不完整，不能修复自动标识')
      const key = questionConflictKey(version.question)
      // Never turn arbitrary corrupt or out-of-contract historical rows into accepted data.
      knowledgeDraftSchema.parse({ ...input, conflictKey: key })
      keys.set(version.conflictKey, key)
    }
  }
  if (!keys.size) return
  const repair = (version: KnowledgeVersion) => {
    const key = keys.get(version.conflictKey)
    return key ? { ...version, conflictKey: key } : version
  }
  for (const row of history) {
    const version = JSON.parse(row.body) as KnowledgeVersion
    if (keys.has(version.conflictKey))
      db.prepare('UPDATE entry_versions SET body=? WHERE id=? AND revision=?').run(
        JSON.stringify(repair(version)),
        row.id,
        row.revision,
      )
  }
  for (const row of db.prepare('SELECT id,body FROM entries').all() as {
    id: string
    body: string
  }[]) {
    const entry = JSON.parse(row.body) as KnowledgeEntry
    if (
      keys.has(entry.draft.conflictKey) ||
      (entry.approved && keys.has(entry.approved.conflictKey))
    )
      db.prepare('UPDATE entries SET body=? WHERE id=?').run(
        JSON.stringify({
          ...entry,
          draft: repair(entry.draft),
          approved: entry.approved && repair(entry.approved),
        }),
        row.id,
      )
  }
}

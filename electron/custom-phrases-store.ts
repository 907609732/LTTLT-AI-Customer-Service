import fs from 'node:fs'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import {
  phraseScopeSchema,
  phraseLibrarySchema,
  phraseSaveSchema,
  phraseRemoveSchema,
  phraseImportSchema,
  parsePhraseImport,
  type PhraseScope,
  type PhraseLibrary,
  type PhraseSave,
  type PhraseRemove,
  type PhraseImport,
} from '../src/shared/customer-service/custom-phrases'

/** Synchronous atomic writes serialize all windows in the owning main process. */
export class CustomPhraseStore {
  constructor(private readonly root: string) {}
  private file(scope: PhraseScope) {
    const value = phraseScopeSchema.parse(scope)
    // workspaceId is an ephemeral IPC lease; account isolation is supplied by the owning data directory.
    const key = createHash('sha256').update(value.storeId).digest('hex')
    return path.join(this.root, `${key}.json`)
  }
  list(scope: PhraseScope): PhraseLibrary {
    const file = this.file(scope)
    try {
      if (fs.statSync(file).size > 4_000_000) throw new Error('oversized')
      return phraseLibrarySchema.parse(JSON.parse(fs.readFileSync(file, 'utf8')))
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT')
        return { revision: 0, rows: [] }
      throw new Error('自定义话术文件无法读取或已损坏；请保留原文件并恢复备份')
    }
  }
  private current(scope: PhraseScope, revision: number) {
    const current = this.list(scope)
    if (current.revision !== revision)
      throw new Error('话术已变化，请刷新后重试，避免覆盖其他窗口的修改')
    return current
  }
  private write(scope: PhraseScope, value: PhraseLibrary) {
    const next = phraseLibrarySchema.parse(value)
    fs.mkdirSync(this.root, { recursive: true })
    const file = this.file(scope),
      temporary = `${file}.${randomUUID()}.tmp`
    try {
      fs.writeFileSync(temporary, JSON.stringify(next), { mode: 0o600, flag: 'wx' })
      fs.renameSync(temporary, file)
    } finally {
      if (fs.existsSync(temporary)) fs.unlinkSync(temporary)
    }
    return next
  }
  save(scope: PhraseScope, input: PhraseSave): PhraseLibrary {
    const value = phraseSaveSchema.parse(input)
    const current = this.current(scope, value.revision)
    const index = value.id ? current.rows.findIndex((row) => row.id === value.id) : -1
    if (value.id && index < 0) throw new Error('话术不存在，请刷新后重试')
    const row = { ...value.draft, id: value.id ?? randomUUID() }
    if (index < 0) current.rows.push(row)
    else current.rows[index] = row
    return this.write(scope, { ...current, revision: current.revision + 1 })
  }
  remove(scope: PhraseScope, input: PhraseRemove): PhraseLibrary {
    const value = phraseRemoveSchema.parse(input),
      current = this.current(scope, value.revision)
    if (!current.rows.some((row) => row.id === value.id))
      throw new Error('话术不存在，请刷新后重试')
    return this.write(scope, {
      revision: current.revision + 1,
      rows: current.rows.filter((row) => row.id !== value.id),
    })
  }
  import(scope: PhraseScope, input: PhraseImport): PhraseLibrary {
    const value = phraseImportSchema.parse(input)
    const drafts = parsePhraseImport(value.text),
      current = this.current(scope, value.revision)
    const key = (row: { title: string; scene: string; reply: string }) =>
      JSON.stringify([row.title, row.scene, row.reply])
    const seen = new Set(current.rows.map(key))
    for (const draft of drafts) {
      if (!seen.has(key(draft))) {
        current.rows.push({ ...draft, id: randomUUID() })
        seen.add(key(draft))
      }
    }
    return this.write(scope, { ...current, revision: current.revision + 1 })
  }
}

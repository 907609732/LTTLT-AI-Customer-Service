import { readFileSync, mkdirSync, existsSync, copyFileSync, renameSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { z } from 'zod'
import { assertKnowledgeWriterStopped } from './lifecycle'
import type { KnowledgeBackupManifest } from '../../src/shared/contracts/knowledge'
import { knowledgeRequire } from './node-loader'
const { DatabaseSync } = knowledgeRequire('node:sqlite') as typeof import('node:sqlite')
const manifestSchema = z
  .object({
    version: z.literal(1),
    createdAt: z.number().nonnegative(),
    revision: z.number().int().nonnegative(),
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
export function restoreKnowledgeBackup(options: {
  directory: string
  backupDirectory: string
}): KnowledgeBackupManifest {
  assertKnowledgeWriterStopped(options.directory)
  const manifest = manifestSchema.parse(
    JSON.parse(readFileSync(join(options.backupDirectory, 'manifest.json'), 'utf8')),
  )
  if (
    manifest.files.filter((file) => file.path === 'knowledge.sqlite').length !== 1 ||
    new Set(manifest.files.map((file) => file.path)).size !== manifest.files.length
  )
    throw Error('备份清单重复或缺少数据库')
  for (const file of manifest.files) {
    const bytes = readFileSync(join(options.backupDirectory, file.path))
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
  const probe = new DatabaseSync(join(options.backupDirectory, 'knowledge.sqlite'), readOptions)
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
    const referenced = probe.prepare('SELECT body FROM assets').all() as { body: string }[]
    for (const row of referenced) {
      const asset = z
        .object({ sha256: z.string().regex(/^[a-f0-9]{64}$/) })
        .passthrough()
        .parse(JSON.parse(row.body))
      if (!manifest.files.some((file) => file.path === `assets/${asset.sha256}`))
        throw Error('备份缺少附件')
    }
  } finally {
    probe.close()
  }
  mkdirSync(options.directory, { recursive: true })
  const staged = join(options.directory, `knowledge-restore-${randomUUID()}.sqlite`)
  copyFileSync(join(options.backupDirectory, 'knowledge.sqlite'), staged)
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

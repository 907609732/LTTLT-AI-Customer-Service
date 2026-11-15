import { knowledgeRequire } from '../electron/knowledge/node-loader'
const { DatabaseSync } = knowledgeRequire('node:sqlite') as typeof import('node:sqlite')
import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { createKnowledgeRepository, restoreKnowledgeBackup } from '../electron/knowledge'
import { inspectKnowledgeBackup, knowledgeBackupScope } from '../electron/knowledge/backup'
import {
  knowledgeDraftSchema,
  type KnowledgeEntry,
  type KnowledgeVersion,
  type KnowledgeBackupManifest,
} from '../src/shared/contracts/knowledge'

it.each([301, 4000])(
  'round trips a %i-character question through save, publish, reopen, edit and full/family restore',
  (length) => {
    const dir = mkdtempSync(join(tmpdir(), 'knowledge-long-question-'))
    const directory = join(dir, 'live')
    let repo = createKnowledgeRepository({ directory, workspaceId: 'w' })
    try {
      const canonical = repo.saveCanonical({ title: 'long question' })
      repo.bindProduct({ canonicalId: canonical.id, storeId: 'a', productId: 'p' })
      const question = '问'.repeat(length - 1) + '甲'
      const version = repo.saveDraft({
        scope: { kind: 'canonical', canonicalId: canonical.id },
        question,
        answer: 'answer',
      })
      const other = repo.saveDraft({
        scope: version.scope,
        question: question.slice(0, -1) + '乙',
        answer: 'different',
      })
      expect(version.conflictKey.length).toBeLessThanOrEqual(300)
      expect(version.conflictKey).not.toBe(other.conflictKey)
      repo.publish({ entryId: version.id, expectedDraftRevision: 1, expectedSourceRevisions: {} })
      repo.dispose()
      repo = createKnowledgeRepository({ directory, workspaceId: 'reopened' })
      const reopened = repo.getEntry(version.id)!.draft
      const revision = reopened.revision,
        input = knowledgeDraftSchema.strip().parse(reopened)
      const edited = repo.saveDraft(
        knowledgeDraftSchema.parse({ ...input, expectedRevision: revision, answer: 'edited' }),
      )
      expect(edited.question).toBe(question)
      for (const scope of [undefined, { canonicalId: canonical.id }]) {
        const backup = repo.createBackup(join(dir, 'backups'), scope)
        inspectKnowledgeBackup(backup.directory)
        repo.dispose()
        restoreKnowledgeBackup({ directory, backupDirectory: backup.directory })
        repo = createKnowledgeRepository({ directory, workspaceId: 'restored' })
        expect(repo.getEntry(version.id)?.draft).toEqual(edited)
        expect(repo.getEntry(version.id)?.approved).toEqual(version)
        expect(repo.entryVersions(version.id)).toHaveLength(2)
      }
    } finally {
      repo.dispose()
      rmSync(dir, { recursive: true, force: true })
    }
  },
)

it('repairs already-written automatic long keys in current, approved and every historical version without changing reviews or sources', () => {
  const dir = mkdtempSync(join(tmpdir(), 'knowledge-old-long-key-'))
  const directory = join(dir, 'live')
  let repo = createKnowledgeRepository({ directory, workspaceId: 'w' })
  try {
    const canonical = repo.saveCanonical({ title: 'legacy' })
    const binding = repo.bindProduct({ canonicalId: canonical.id, storeId: 'a', productId: 'p' })
    const source = repo.saveSource({
      kind: 'manual',
      storeId: 'a',
      bindingId: binding.id,
      label: 'evidence',
      text: 'original',
    })
    const question = '旧'.repeat(4000)
    const input = {
      scope: { kind: 'canonical' as const, canonicalId: canonical.id },
      question,
      answer: 'one',
      conflictKey: 'temporary-valid-key',
      sourceRefs: [{ sourceId: source.id, revision: 1 }],
    }
    const version = repo.saveDraft(input)
    repo.publish({
      entryId: version.id,
      expectedDraftRevision: 1,
      expectedSourceRevisions: { [source.id]: 1 },
    })
    repo.saveDraft({ ...input, id: version.id, expectedRevision: 1, answer: 'two' })
    repo.saveDraft({ ...input, id: version.id, expectedRevision: 2, answer: 'three' })
    repo.publish({
      entryId: version.id,
      expectedDraftRevision: 3,
      expectedSourceRevisions: { [source.id]: 1 },
    })
    repo.saveDraft({ ...input, id: version.id, expectedRevision: 3, answer: 'four' })
    const legacyBackup = repo.createBackup(join(dir, 'old-archive'))
    repo.dispose()
    const oldDb = new DatabaseSync(join(directory, 'knowledge.sqlite'))
    const reviews = oldDb.prepare('SELECT * FROM reviews ORDER BY revision').all()
    for (const row of oldDb.prepare('SELECT id,body FROM entries').all() as {
      id: string
      body: string
    }[]) {
      const entry = JSON.parse(row.body) as KnowledgeEntry
      entry.draft.conflictKey = question
      entry.approved!.conflictKey = question
      oldDb.prepare('UPDATE entries SET body=? WHERE id=?').run(JSON.stringify(entry), row.id)
    }
    for (const row of oldDb.prepare('SELECT id,revision,body FROM entry_versions').all() as {
      id: string
      revision: number
      body: string
    }[]) {
      const history = JSON.parse(row.body) as KnowledgeVersion
      history.conflictKey = question
      oldDb
        .prepare('UPDATE entry_versions SET body=? WHERE id=? AND revision=?')
        .run(JSON.stringify(history), row.id, row.revision)
    }
    oldDb.close()
    // Model an archive already generated by the old writer, including its valid file hash.
    copyFileSync(
      join(directory, 'knowledge.sqlite'),
      join(legacyBackup.directory, 'knowledge.sqlite'),
    )
    const legacyBytes = readFileSync(join(legacyBackup.directory, 'knowledge.sqlite'))
    const legacyManifest = JSON.parse(
      readFileSync(join(legacyBackup.directory, 'manifest.json'), 'utf8'),
    ) as KnowledgeBackupManifest
    const databaseFile = legacyManifest.files.find((file) => file.path === 'knowledge.sqlite')!
    databaseFile.sha256 = createHash('sha256').update(legacyBytes).digest('hex')
    databaseFile.size = legacyBytes.length
    writeFileSync(join(legacyBackup.directory, 'manifest.json'), JSON.stringify(legacyManifest))
    expect(() => inspectKnowledgeBackup(legacyBackup.directory)).toThrow()
    repo = createKnowledgeRepository({ directory, workspaceId: 'repaired' })
    for (const row of repo.entryVersions(version.id)) {
      expect(row.version.conflictKey.length).toBeLessThanOrEqual(300)
      expect(row.version.question).toBe(question)
      expect(row.version.sourceRefs).toEqual(input.sourceRefs)
    }
    const current = repo.getEntry(version.id)!
    expect(current.approved).toEqual(
      repo.entryVersions(version.id).find((v) => v.version.revision === 3)!.version,
    )
    const revision = current.draft.revision,
      editable = knowledgeDraftSchema.strip().parse(current.draft)
    repo.saveDraft({ ...editable, expectedRevision: revision, answer: 'five' })
    for (const scope of [undefined, { canonicalId: canonical.id }]) {
      const backup = repo.createBackup(join(dir, 'backups'), scope)
      inspectKnowledgeBackup(backup.directory)
      repo.dispose()
      restoreKnowledgeBackup({ directory, backupDirectory: backup.directory })
      repo = createKnowledgeRepository({ directory, workspaceId: 'restored' })
      expect(repo.entryVersions(version.id)).toHaveLength(5)
      const check = new DatabaseSync(join(backup.directory, 'knowledge.sqlite'))
      expect(check.prepare('SELECT * FROM reviews ORDER BY revision').all()).toEqual(reviews)
      check.close()
    }
    expect(() => inspectKnowledgeBackup(legacyBackup.directory)).toThrow()
    expect(readFileSync(join(legacyBackup.directory, 'knowledge.sqlite'))).toEqual(legacyBytes)
  } finally {
    repo.dispose()
    rmSync(dir, { recursive: true, force: true })
  }
})

it('backs up one canonical family with historical assets and restores it without changing unrelated families', () => {
  const dir = mkdtempSync(join(tmpdir(), 'knowledge-family-'))
  let repo = createKnowledgeRepository({ directory: join(dir, 'live'), workspaceId: 'w' })
  try {
    const a = repo.saveCanonical({ title: '甲' }),
      b = repo.saveCanonical({ title: '乙' })
    const one = repo.bindProduct({ canonicalId: a.id, storeId: 's', productId: 'a' })
    repo.bindProduct({ canonicalId: a.id, storeId: 't', productId: 'other', skuId: 'red' })
    repo.bindProduct({ canonicalId: b.id, storeId: 's', productId: 'b' })
    const oldAsset = repo.addAsset(Buffer.from('old pixels'), {
      name: '历史.png',
      mimeType: 'image/png',
    })
    const source = repo.saveSource({
      storeId: 's',
      bindingId: one.id,
      kind: 'document',
      label: '多商品原件.csv',
      text: '旧资料',
      assetIds: [oldAsset.id],
      locator: { assetId: oldAsset.id },
    })
    repo.setMetadata(
      `original-file:${source.id}`,
      JSON.stringify({ name: '多商品原件.csv', extension: '.csv', mimeType: 'text/csv' }),
    )
    const evidenceAsset = repo.addAsset(Buffer.from('evidence only'), {
      name: '依据.png',
      mimeType: 'image/png',
    })
    const draft = repo.saveDraft({
      scope: { kind: 'canonical', canonicalId: a.id },
      question: '材质',
      answer: '纯棉',
      modelEvidence: {
        kind: 'image-text',
        imageAssetId: evidenceAsset.id,
        locator: { page: 1, tile: 2 },
        quote: '纯棉',
      },
      sourceRefs: [{ sourceId: source.id, revision: 1 }],
    })
    repo.publish({
      entryId: draft.id,
      expectedDraftRevision: 1,
      expectedSourceRevisions: { [source.id]: 1 },
    })
    repo.saveSource({
      id: source.id,
      expectedRevision: 1,
      storeId: 's',
      bindingId: one.id,
      kind: 'document',
      label: source.label,
      text: '新资料',
      removed: true,
    })
    expect(
      repo.listProducts({ storeId: 's' }).items.find((row) => row.canonical.id === a.id)?.sources,
    ).toBe(0)
    const backup = repo.createBackup(join(dir, 'backups'), { canonicalId: a.id })
    expect(backup.scope).toMatchObject({ kind: 'family', canonicalId: a.id, storeIds: ['s', 't'] })
    expect(backup.files.some((file) => file.path === `assets/${oldAsset.sha256}`)).toBe(true)
    repo.saveCanonical({ id: a.id, expectedRevision: 1, title: '甲改' })
    repo.saveCanonical({ id: b.id, expectedRevision: 1, title: '乙保留修改' })
    repo.dispose()
    restoreKnowledgeBackup({ directory: join(dir, 'live'), backupDirectory: backup.directory })
    repo = createKnowledgeRepository({ directory: join(dir, 'live'), workspaceId: 'new' })
    expect(repo.getCanonical(a.id)?.title).toBe('甲')
    expect(repo.getCanonical(b.id)?.title).toBe('乙保留修改')
    expect(repo.getSource(source.id)?.removed).toBe(true)
    expect(repo.sourceVersions(source.id)).toHaveLength(2)
    expect(repo.entryVersions(draft.id)).toHaveLength(1)
    expect(repo.getEntry(draft.id)?.draft.modelEvidence?.imageAssetId).toBe(evidenceAsset.id)
    expect(Buffer.from(repo.readAsset(evidenceAsset.id)).toString()).toBe('evidence only')
    expect(repo.getMetadata(`original-file:${source.id}`)).toContain('多商品原件.csv')
    expect(Buffer.from(repo.readAsset(oldAsset.id)).toString()).toBe('old pixels')
    expect(
      JSON.parse(readFileSync(join(backup.directory, 'manifest.json'), 'utf8')).scope.kind,
    ).toBe('family')
  } finally {
    repo.dispose()
    rmSync(dir, { recursive: true, force: true })
  }
})
it('retains post-backup identity audit but removes its active scope, and refuses changed shared dependencies atomically', () => {
  const dir = mkdtempSync(join(tmpdir(), 'knowledge-family-edge-'))
  let repo = createKnowledgeRepository({ directory: join(dir, 'live'), workspaceId: 'w' })
  try {
    const a = repo.saveCanonical({ title: 'A' }),
      b = repo.saveCanonical({ title: 'B' })
    const root = repo.bindProduct({ canonicalId: a.id, storeId: 's', productId: 'a' })
    const other = repo.bindProduct({ canonicalId: b.id, storeId: 's', productId: 'b' })
    const source = repo.saveSource({
      storeId: 's',
      bindingId: root.id,
      kind: 'manual',
      label: 'shared source',
      text: 'v1',
    })
    const v = repo.saveDraft({
      scope: { kind: 'canonical', canonicalId: a.id },
      question: '说明',
      answer: 'v1',
      sourceRefs: [{ sourceId: source.id, revision: 1 }],
    })
    repo.publish({
      entryId: v.id,
      expectedDraftRevision: 1,
      expectedSourceRevisions: { [source.id]: 1 },
    })
    const backup = repo.createBackup(join(dir, 'backup'), { canonicalId: a.id })
    const moved = repo.saveDraft({
      scope: { kind: 'canonical', canonicalId: a.id },
      question: '迁移问答',
      answer: '保留B',
    })
    repo.saveDraft({
      id: moved.id,
      expectedRevision: moved.revision,
      scope: { kind: 'canonical', canonicalId: b.id },
      question: '迁移问答',
      answer: '保留B',
    })
    const extra = repo.bindProduct({
      canonicalId: a.id,
      storeId: 's',
      productId: 'a',
      skuId: 'new',
    })
    repo.saveSource({
      storeId: 's',
      bindingId: extra.id,
      kind: 'manual',
      label: 'new',
      text: 'new',
    })
    repo.dispose()
    restoreKnowledgeBackup({ directory: join(dir, 'live'), backupDirectory: backup.directory })
    repo = createKnowledgeRepository({ directory: join(dir, 'live'), workspaceId: 'new' })
    expect(repo.getBinding(extra.id)?.active).toBe(false)
    expect(repo.getEntry(moved.id)?.draft.answer).toBe('保留B')
    const previewBackup = repo.createBackup(join(dir, 'preview-backup'))
    expect(
      knowledgeBackupScope(previewBackup.directory).bindings.find((b) => b.id === extra.id)?.active,
    ).toBe(false)
    expect(knowledgeBackupScope(previewBackup.directory).activeStores).toEqual(['s'])
    const changed = repo.saveSource({
      id: source.id,
      expectedRevision: 1,
      storeId: 's',
      bindingId: root.id,
      kind: 'manual',
      label: 'shared source',
      text: 'v2',
    })
    const otherDraft = repo.saveDraft({
      scope: { kind: 'binding', bindingId: other.id },
      question: 'B说明',
      answer: 'v2',
      sourceRefs: [{ sourceId: source.id, revision: changed.revision }],
    })
    repo.publish({
      entryId: otherDraft.id,
      expectedDraftRevision: 1,
      expectedSourceRevisions: { [source.id]: changed.revision },
    })
    repo.dispose()
    expect(() =>
      restoreKnowledgeBackup({ directory: join(dir, 'live'), backupDirectory: backup.directory }),
    ).toThrow(/其他商品|依赖/)
    repo = createKnowledgeRepository({ directory: join(dir, 'live'), workspaceId: 'verify' })
    expect(repo.getEntry(otherDraft.id)?.approved?.answer).toBe('v2')
    expect(repo.getSource(source.id)?.text).toBe('v2')
    expect(inspectKnowledgeBackup(backup.directory).scope?.canonicalId).toBe(a.id)
  } finally {
    repo.dispose()
    rmSync(dir, { recursive: true, force: true })
  }
})

it('rejects a scoped manifest claiming a full snapshot and deleted canonical re-publication', () => {
  const dir = mkdtempSync(join(tmpdir(), 'knowledge-scope-invalid-'))
  const repo = createKnowledgeRepository({ directory: join(dir, 'live'), workspaceId: 'w' })
  try {
    const a = repo.saveCanonical({ title: 'A' }),
      b = repo.saveCanonical({ title: 'B' })
    const binding = repo.bindProduct({ canonicalId: a.id, storeId: 's', productId: 'a' })
    repo.bindProduct({ canonicalId: b.id, storeId: 's', productId: 'b' })
    const entry = repo.saveDraft({
      scope: { kind: 'canonical', canonicalId: a.id },
      question: 'q',
      answer: 'a',
    })
    const backup = repo.createBackup(join(dir, 'backup'))
    const manifest = JSON.parse(readFileSync(join(backup.directory, 'manifest.json'), 'utf8'))
    manifest.scope = {
      kind: 'family',
      canonicalId: a.id,
      storeIds: ['s'],
      bindingIds: [binding.id],
      dependencyBindingIds: [],
      originalFiles: [],
    }
    writeFileSync(join(backup.directory, 'manifest.json'), JSON.stringify(manifest))
    expect(() => inspectKnowledgeBackup(backup.directory)).toThrow(/范围/)
    repo.removeCanonical(a.id)
    expect(() =>
      repo.saveDraft({
        scope: { kind: 'canonical', canonicalId: a.id },
        question: 'q',
        answer: 'a',
      }),
    ).toThrow(/移除|删除/)
    expect(() =>
      repo.publish({
        entryId: entry.id,
        expectedDraftRevision: repo.getEntry(entry.id)!.revision,
        expectedSourceRevisions: {},
      }),
    ).toThrow(/移除|删除/)
  } finally {
    repo.dispose()
    rmSync(dir, { recursive: true, force: true })
  }
})

it('rejects internally inconsistent publication even when file hashes have been regenerated', () => {
  const dir = mkdtempSync(join(tmpdir(), 'knowledge-review-invalid-')),
    repo = createKnowledgeRepository({ directory: join(dir, 'live'), workspaceId: 'w' })
  try {
    const draft = repo.saveDraft({
      scope: { kind: 'store', storeId: 's' },
      question: 'q',
      answer: 'a',
    })
    repo.publish({ entryId: draft.id, expectedDraftRevision: 1, expectedSourceRevisions: {} })
    const backup = repo.createBackup(join(dir, 'backup')),
      file = join(backup.directory, 'knowledge.sqlite')
    const db = new DatabaseSync(file)
    db.exec('UPDATE entry_versions SET reviewed=0; DELETE FROM reviews;')
    db.close()
    const manifest = JSON.parse(readFileSync(join(backup.directory, 'manifest.json'), 'utf8')),
      bytes = readFileSync(file)
    const item = manifest.files.find((entry: { path: string }) => entry.path === 'knowledge.sqlite')
    item.size = bytes.length
    item.sha256 = createHash('sha256').update(bytes).digest('hex')
    writeFileSync(join(backup.directory, 'manifest.json'), JSON.stringify(manifest))
    expect(() => inspectKnowledgeBackup(backup.directory)).toThrow(/审核/)
  } finally {
    repo.dispose()
    rmSync(dir, { recursive: true, force: true })
  }
})

it.each(['current', 'historical'] as const)(
  'rejects missing review audit for a %s reviewed version without touching live files',
  (mode) => {
    const dir = mkdtempSync(join(tmpdir(), 'knowledge-audit-missing-'))
    const repo = createKnowledgeRepository({ directory: join(dir, 'live'), workspaceId: 'w' })
    try {
      const first = repo.saveDraft({
        scope: { kind: 'store', storeId: 's' },
        question: '问题',
        answer: '版本一',
      })
      repo.publish({ entryId: first.id, expectedDraftRevision: 1, expectedSourceRevisions: {} })
      if (mode === 'historical') {
        const second = repo.saveDraft({
          id: first.id,
          expectedRevision: 1,
          scope: first.scope,
          question: '问题',
          answer: '版本二',
        })
        repo.publish({
          entryId: second.id,
          expectedDraftRevision: second.revision,
          expectedSourceRevisions: {},
        })
      }
      const backup = repo.createBackup(join(dir, 'backup')),
        file = join(backup.directory, 'knowledge.sqlite')
      const db = new DatabaseSync(file)
      db.prepare('DELETE FROM reviews WHERE revision=1').run()
      expect(
        (
          db.prepare('SELECT reviewed FROM entry_versions WHERE revision=1').get() as {
            reviewed: number
          }
        ).reviewed,
      ).toBe(1)
      db.close()
      const manifest = JSON.parse(readFileSync(join(backup.directory, 'manifest.json'), 'utf8')),
        bytes = readFileSync(file)
      const item = manifest.files.find((row: { path: string }) => row.path === 'knowledge.sqlite')
      item.size = bytes.length
      item.sha256 = createHash('sha256').update(bytes).digest('hex')
      writeFileSync(join(backup.directory, 'manifest.json'), JSON.stringify(manifest))
      expect(() => inspectKnowledgeBackup(backup.directory)).toThrow(/审核/)
      repo.dispose()
      const before = readFileSync(join(dir, 'live', 'knowledge.sqlite'))
      expect(() =>
        restoreKnowledgeBackup({ directory: join(dir, 'live'), backupDirectory: backup.directory }),
      ).toThrow(/审核/)
      expect(readFileSync(join(dir, 'live', 'knowledge.sqlite'))).toEqual(before)
    } finally {
      repo.dispose()
      rmSync(dir, { recursive: true, force: true })
    }
  },
)
it('accepts actual migrated legacy-preserved reviews in backup and restore', () => {
  const dir = mkdtempSync(join(tmpdir(), 'knowledge-audit-legacy-'))
  writeFileSync(
    join(dir, 'intent-knowledge.json'),
    JSON.stringify({
      version: 1,
      revision: 1,
      packs: [
        {
          id: '22222222-2222-4222-8222-222222222222',
          version: 1,
          updatedAt: 100,
          name: '历史问答',
          enabled: true,
          storeIds: ['s'],
          productIds: [],
          entries: [{ question: '发货', answer: '48小时', keywords: [], enabled: true }],
        },
      ],
    }),
  )
  let repo = createKnowledgeRepository({ directory: dir, workspaceId: 'w' })
  try {
    expect(repo.getMigrationState().status).toBe('complete')
    const backup = repo.createBackup(join(dir, 'backups')),
      db = new DatabaseSync(join(backup.directory, 'knowledge.sqlite'))
    expect(
      db.prepare("SELECT id FROM reviews WHERE reason='legacy-preserved'").all().length,
    ).toBeGreaterThan(0)
    db.close()
    expect(() => inspectKnowledgeBackup(backup.directory)).not.toThrow()
    repo.dispose()
    restoreKnowledgeBackup({ directory: dir, backupDirectory: backup.directory })
    repo = createKnowledgeRepository({ directory: dir, workspaceId: 'new' })
    expect(repo.resolveKnowledge({ storeId: 's', query: '发货' }).citations[0]?.answer).toBe(
      '48小时',
    )
  } finally {
    repo.dispose()
    rmSync(dir, { recursive: true, force: true })
  }
})

import { knowledgeRequire } from '../electron/knowledge/node-loader'
const { DatabaseSync } = knowledgeRequire('node:sqlite') as typeof import('node:sqlite')
import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { createKnowledgeRepository, restoreKnowledgeBackup } from '../electron/knowledge'
import { inspectKnowledgeBackup, knowledgeBackupScope } from '../electron/knowledge/backup'

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

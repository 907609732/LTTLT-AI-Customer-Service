import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { expect, it } from 'vitest'
import { createKnowledgeRepository, restoreKnowledgeBackup } from '../electron/knowledge'
import { inspectKnowledgeBackup } from '../electron/knowledge/backup'
import { createKnowledgeRuntime } from '../electron/knowledge-runtime'
import { knowledgeRequire } from '../electron/knowledge/node-loader'
import type { KnowledgeRestorePreview } from '../src/shared/contracts/knowledge-client'
const { DatabaseSync } = knowledgeRequire('node:sqlite') as typeof import('node:sqlite')

it('store snapshot restores A through isolated copies without changing B shared resolution or private records', () => {
  const root = mkdtempSync(join(tmpdir(), 'knowledge-store-backup-')),
    directory = join(root, 'live')
  let repo = createKnowledgeRepository({ directory, workspaceId: 'w' })
  try {
    const shared = repo.saveCanonical({ title: 'shared' }),
      unrelated = repo.saveCanonical({ title: 'B only' })
    const a = repo.bindProduct({ canonicalId: shared.id, storeId: 'a', productId: 'pa' })
    const aSku = repo.bindProduct({
      canonicalId: shared.id,
      storeId: 'a',
      productId: 'pa',
      skuId: 'red',
    })
    const b = repo.bindProduct({ canonicalId: shared.id, storeId: 'b', productId: 'pb' })
    const bPrivate = repo.bindProduct({
      canonicalId: unrelated.id,
      storeId: 'b',
      productId: 'private',
    })
    const bSource = repo.saveSource({
      storeId: 'b',
      bindingId: b.id,
      kind: 'manual',
      label: 'shared evidence',
      text: 'old fact',
    })
    const bSecretSource = repo.saveSource({
      storeId: 'b',
      bindingId: bPrivate.id,
      kind: 'manual',
      label: 'B private evidence',
      text: 'B private',
    })
    const bSecret = repo.saveDraft({
      scope: { kind: 'binding', bindingId: bPrivate.id },
      question: 'B private',
      answer: 'B secret',
      sourceRefs: [{ sourceId: bSecretSource.id, revision: 1 }],
    })
    repo.publish({
      entryId: bSecret.id,
      expectedDraftRevision: 1,
      expectedSourceRevisions: { [bSecretSource.id]: 1 },
    })
    const fact = repo.saveDraft({
      scope: { kind: 'canonical', canonicalId: shared.id },
      question: 'shipping',
      answer: 'old answer',
      sourceRefs: [{ sourceId: bSource.id, revision: 1 }],
    })
    repo.publish({
      entryId: fact.id,
      expectedDraftRevision: 1,
      expectedSourceRevisions: { [bSource.id]: 1 },
    })
    const template = repo.saveDraft({
      scope: { kind: 'template', storeIds: ['a', 'b'] },
      question: 'service',
      answer: 'old service',
    })
    repo.publish({ entryId: template.id, expectedDraftRevision: 1, expectedSourceRevisions: {} })
    const backup = repo.createBackup(join(root, 'backup'), { storeId: 'a' })
    expect(backup.scope?.kind).toBe('store')
    inspectKnowledgeBackup(backup.directory)
    const probe = new DatabaseSync(join(backup.directory, 'knowledge.sqlite'))
    expect(probe.prepare('SELECT id FROM entries WHERE id=?').get(bSecret.id)).toBeUndefined()
    expect(probe.prepare('SELECT id FROM canonical WHERE id=?').get(unrelated.id)).toBeUndefined()
    expect(probe.prepare('SELECT * FROM jobs').all()).toHaveLength(0)
    probe.close()

    repo.unlinkBinding(aSku.id, aSku.revision)
    const added = repo.bindProduct({
      canonicalId: shared.id,
      storeId: 'a',
      productId: 'pa',
      skuId: 'blue',
    })
    const latest = repo.saveDraft({
      id: fact.id,
      expectedRevision: fact.revision,
      scope: fact.scope,
      question: fact.question,
      answer: 'B current answer',
      sourceRefs: fact.sourceRefs,
    })
    repo.publish({
      entryId: fact.id,
      expectedDraftRevision: latest.revision,
      expectedSourceRevisions: { [bSource.id]: 1 },
    })
    const templateCurrent = repo.saveDraft({
      id: template.id,
      expectedRevision: template.revision,
      scope: template.scope,
      question: template.question,
      answer: 'B current service',
    })
    repo.publish({
      entryId: template.id,
      expectedDraftRevision: templateCurrent.revision,
      expectedSourceRevisions: {},
    })
    const beforeB = repo.resolveKnowledge({
      storeId: 'b',
      productId: 'pb',
      query: 'shipping service',
      limit: 20,
    })
    const bBinding = repo.getBinding(b.id),
      bSourceBefore = repo.getSource(bSource.id),
      bSecretBefore = repo.getEntry(bSecret.id)

    repo.dispose()
    restoreKnowledgeBackup({ directory, backupDirectory: backup.directory })
    repo = createKnowledgeRepository({ directory, workspaceId: 'restored' })
    expect(repo.getBinding(b.id)).toEqual(bBinding)
    expect(repo.getSource(bSource.id)).toEqual(bSourceBefore)
    expect(repo.getEntry(bSecret.id)).toEqual(bSecretBefore)
    const afterB = repo.resolveKnowledge({
      storeId: 'b',
      productId: 'pb',
      query: 'shipping service',
      limit: 20,
    })
    expect(afterB.citations.map((v) => v.answer)).toEqual(beforeB.citations.map((v) => v.answer))
    expect(repo.getEntry(fact.id)?.approved?.answer).toBe('B current answer')
    expect(repo.getEntry(template.id)?.approved?.answer).toBe('B current service')

    const resolvedA = repo.resolveKnowledge({
      storeId: 'a',
      productId: 'pa',
      query: 'shipping service',
      limit: 20,
    })
    const answers = resolvedA.citations.map((v) => v.answer)
    expect(answers).toContain('old answer')
    expect(answers).toContain('old service')
    expect(answers).not.toContain('B current answer')
    expect(answers).not.toContain('B current service')
    expect(answers).not.toContain('must disappear')
    expect(repo.getBinding(a.id)?.canonicalId).not.toBe(shared.id)
    expect(repo.getBinding(a.id)?.active).toBe(true)
    expect(repo.getBinding(aSku.id)?.active).toBe(true)
    expect(repo.getBinding(added.id)?.active).toBe(false)
    const copied = repo
      .listEntries({ storeId: 'a', limit: 100 })
      .items.filter((entry) => entry.draft.question === 'shipping' && entry.id !== fact.id)
    expect(copied.length).toBeGreaterThan(0)

    // Repeating the same archive must replace A's applications, not add another effective copy.
    repo.dispose()
    restoreKnowledgeBackup({ directory, backupDirectory: backup.directory })
    repo = createKnowledgeRepository({ directory, workspaceId: 'restored-again' })
    const repeatedA = repo.resolveKnowledge({
      storeId: 'a',
      productId: 'pa',
      query: 'shipping service',
      limit: 20,
    })
    expect(repeatedA.citations.filter((v) => v.answer === 'old answer')).toHaveLength(1)
    expect(repeatedA.citations.filter((v) => v.answer === 'old service')).toHaveLength(1)
    const repeatedB = repo.resolveKnowledge({
      storeId: 'b',
      productId: 'pb',
      query: 'shipping service',
      limit: 20,
    })
    expect(repeatedB.citations.map((v) => v.answer)).toEqual(beforeB.citations.map((v) => v.answer))
    const full = repo.createBackup(join(root, 'verify'))
    expect(() => inspectKnowledgeBackup(full.directory)).not.toThrow()
  } finally {
    repo.dispose()
    rmSync(root, { recursive: true, force: true })
  }
})

it('retains historical source revisions and old image asset references in a store archive', () => {
  const root = mkdtempSync(join(tmpdir(), 'knowledge-store-history-')),
    directory = join(root, 'live')
  let repo = createKnowledgeRepository({ directory, workspaceId: 'w' })
  try {
    const canonical = repo.saveCanonical({ title: 'history' })
    const binding = repo.bindProduct({
      canonicalId: canonical.id,
      storeId: 'a',
      productId: 'p',
    })
    const oldAsset = repo.addAsset(Buffer.from('old pixels'), {
      name: 'old.png',
      mimeType: 'image/png',
    })
    const newAsset = repo.addAsset(Buffer.from('new pixels'), {
      name: 'new.png',
      mimeType: 'image/png',
    })
    const source = repo.saveSource({
      storeId: 'a',
      bindingId: binding.id,
      kind: 'document',
      label: 'doc.pdf',
      text: 'old source',
      assetIds: [oldAsset.id],
      locator: { assetId: oldAsset.id, page: 1 },
    })
    repo.setMetadata(
      `original-file:${source.id}`,
      JSON.stringify({ name: 'doc.pdf', extension: '.pdf', mimeType: 'application/pdf' }),
    )
    const oldEntry = repo.saveDraft({
      scope: { kind: 'binding', bindingId: binding.id },
      question: 'old question',
      answer: 'old answer',
      sourceRefs: [{ sourceId: source.id, revision: 1 }],
      modelEvidence: {
        kind: 'image-text',
        imageAssetId: oldAsset.id,
        locator: { page: 1, tile: 1 },
        quote: 'old pixels',
      },
    })
    repo.publish({
      entryId: oldEntry.id,
      expectedDraftRevision: 1,
      expectedSourceRevisions: { [source.id]: 1 },
    })
    repo.saveSource({
      id: source.id,
      expectedRevision: 1,
      storeId: 'a',
      bindingId: binding.id,
      kind: 'document',
      label: 'doc.pdf',
      text: 'new source',
      assetIds: [newAsset.id],
      locator: { assetId: newAsset.id, page: 2 },
    })
    const current = repo.saveDraft({
      scope: { kind: 'binding', bindingId: binding.id },
      question: 'current question',
      answer: 'current answer',
      sourceRefs: [{ sourceId: source.id, revision: 2 }],
    })
    repo.publish({
      entryId: current.id,
      expectedDraftRevision: 1,
      expectedSourceRevisions: { [source.id]: 2 },
    })
    const backup = repo.createBackup(join(root, 'backup'), { storeId: 'a' })
    inspectKnowledgeBackup(backup.directory)

    repo.dispose()
    restoreKnowledgeBackup({ directory, backupDirectory: backup.directory })
    repo = createKnowledgeRepository({ directory, workspaceId: 'restored' })
    const copied = repo
      .listEntries({ storeId: 'a', limit: 100 })
      .items.find((entry) => entry.id !== oldEntry.id && entry.draft.question === 'old question')
    expect(copied).toBeDefined()
    const copiedSourceId = copied!.draft.sourceRefs[0]!.sourceId
    expect(copiedSourceId).not.toBe(source.id)
    const versions = repo.sourceVersions(copiedSourceId)
    expect(versions).toHaveLength(2)
    const historical = versions.find((version) => version.revision === 1)!
    expect(historical.locator.assetId).toBeDefined()
    expect(historical.locator.assetId).not.toBe(oldAsset.id)
    expect(Buffer.from(repo.readAsset(historical.locator.assetId!)).toString()).toBe('old pixels')
    expect(copied!.draft.modelEvidence?.imageAssetId).toBeDefined()
    expect(copied!.draft.modelEvidence?.imageAssetId).not.toBe(oldAsset.id)
    expect(Buffer.from(repo.readAsset(copied!.draft.modelEvidence!.imageAssetId)).toString()).toBe(
      'old pixels',
    )
    expect(repo.getMetadata(`original-file:${copiedSourceId}`)).toContain('doc.pdf')
    const full = repo.createBackup(join(root, 'verify'))
    expect(() => inspectKnowledgeBackup(full.directory)).not.toThrow()
  } finally {
    repo.dispose()
    rmSync(root, { recursive: true, force: true })
  }
})

it('does not turn another shop draft or approval into A knowledge when an entry changed ownership', () => {
  const root = mkdtempSync(join(tmpdir(), 'knowledge-store-ownership-')),
    directory = join(root, 'live')
  let repo = createKnowledgeRepository({ directory, workspaceId: 'w' })
  try {
    const approvedB = repo.saveDraft({
      scope: { kind: 'store', storeId: 'b' },
      question: 'approved-b',
      answer: 'approved-b',
    })
    repo.publish({ entryId: approvedB.id, expectedDraftRevision: 1, expectedSourceRevisions: {} })
    repo.saveDraft({
      id: approvedB.id,
      expectedRevision: 1,
      scope: { kind: 'store', storeId: 'a' },
      question: 'draft-a',
      answer: 'draft-a',
    })
    const approvedA = repo.saveDraft({
      scope: { kind: 'store', storeId: 'a' },
      question: 'approved-a',
      answer: 'approved-a',
    })
    repo.publish({ entryId: approvedA.id, expectedDraftRevision: 1, expectedSourceRevisions: {} })
    repo.saveDraft({
      id: approvedA.id,
      expectedRevision: 1,
      scope: { kind: 'store', storeId: 'b' },
      question: 'draft-b',
      answer: 'draft-b',
    })
    const backup = repo.createBackup(join(root, 'backup'), { storeId: 'a' })
    inspectKnowledgeBackup(backup.directory)
    const packageDb = new DatabaseSync(join(backup.directory, 'knowledge.sqlite'))
    const packaged = JSON.stringify(packageDb.prepare('SELECT body FROM entries').all())
    packageDb.close()
    expect(packaged).not.toContain('approved-b')
    expect(packaged).not.toContain('draft-b')
    repo.dispose()
    restoreKnowledgeBackup({ directory, backupDirectory: backup.directory })
    repo = createKnowledgeRepository({ directory, workspaceId: 'restored' })
    const entries = repo.listEntries({ storeId: 'a', limit: 100 }).items
    const draftOnly = entries.find(
      (entry) => entry.id !== approvedB.id && entry.draft.question === 'draft-a',
    )
    expect(draftOnly).toMatchObject({
      status: 'draft',
      draft: { answer: 'draft-a', scope: { kind: 'store', storeId: 'a' } },
      approved: null,
    })
    const approvalOnly = entries.find(
      (entry) => entry.id !== approvedA.id && entry.approved?.answer === 'approved-a',
    )
    expect(approvalOnly).toMatchObject({
      status: 'approved',
      draft: { answer: 'approved-a', scope: { kind: 'store', storeId: 'a' } },
      approved: { answer: 'approved-a', scope: { kind: 'store', storeId: 'a' } },
    })
    expect(JSON.stringify(entries)).not.toContain('approved-b')
    expect(JSON.stringify(entries)).not.toContain('draft-b')
    const full = repo.createBackup(join(root, 'verify'))
    expect(() => inspectKnowledgeBackup(full.directory)).not.toThrow()
  } finally {
    repo.dispose()
    rmSync(root, { recursive: true, force: true })
  }
})

it('rejects changed foreign evidence before replacing the live database', () => {
  const root = mkdtempSync(join(tmpdir(), 'knowledge-store-dependency-')),
    directory = join(root, 'live')
  let repo = createKnowledgeRepository({ directory, workspaceId: 'w' })
  try {
    const shared = repo.saveCanonical({ title: 'shared' })
    repo.bindProduct({ canonicalId: shared.id, storeId: 'a', productId: 'a' })
    const b = repo.bindProduct({ canonicalId: shared.id, storeId: 'b', productId: 'b' })
    const source = repo.saveSource({
      storeId: 'b',
      bindingId: b.id,
      kind: 'manual',
      label: 'evidence',
      text: 'evidence',
    })
    const entry = repo.saveDraft({
      scope: { kind: 'canonical', canonicalId: shared.id },
      question: 'q',
      answer: 'a',
      sourceRefs: [{ sourceId: source.id, revision: 1 }],
    })
    repo.publish({
      entryId: entry.id,
      expectedDraftRevision: 1,
      expectedSourceRevisions: { [source.id]: 1 },
    })
    const backup = repo.createBackup(join(root, 'backup'), { storeId: 'a' })
    repo.bindProduct({
      id: b.id,
      expectedRevision: b.revision,
      canonicalId: shared.id,
      storeId: 'b',
      productId: 'b',
      title: 'changed dependency',
    })
    repo.dispose()
    const before = readFileSync(join(directory, 'knowledge.sqlite'))
    expect(() => restoreKnowledgeBackup({ directory, backupDirectory: backup.directory })).toThrow(
      /依赖|其他商品/,
    )
    expect(readFileSync(join(directory, 'knowledge.sqlite'))).toEqual(before)
    repo = createKnowledgeRepository({ directory, workspaceId: 'verify' })
    expect(repo.getBinding(b.id)?.title).toBe('changed dependency')
    expect(repo.getEntry(entry.id)?.approved?.answer).toBe('a')
    expect(repo.getSource(source.id)?.text).toBe('evidence')
  } finally {
    repo.dispose()
    rmSync(root, { recursive: true, force: true })
  }
})

it('only accepts a same-store archive for a store preview and rechecks revision, account and shop', async () => {
  const root = mkdtempSync(join(tmpdir(), 'knowledge-store-preview-')),
    directory = join(root, 'live')
  const repo = createKnowledgeRepository({ directory, workspaceId: 'w' })
  let chosen = ''
  let available = ['a', 'b']
  let active = true
  const runtime = createKnowledgeRuntime({
    repository: repo,
    workspaceId: 'w',
    assertActive() {
      if (!active) throw Error('账号已失效')
    },
    changed() {},
    chooseRestore: async () => chosen,
    stores: () =>
      available.map((id) => ({ id, storeName: `Shop ${id.toUpperCase()}`, platform: 'sim-local' })),
  })
  try {
    const canonical = repo.saveCanonical({ title: 'preview' })
    repo.bindProduct({ canonicalId: canonical.id, storeId: 'a', productId: 'a' })
    repo.bindProduct({ canonicalId: canonical.id, storeId: 'b', productId: 'b' })
    const store = repo.createBackup(join(root, 'store-backup'), { storeId: 'a' })
    chosen = store.directory
    const preview = (await runtime.request({
      workspaceId: 'w',
      operation: 'restore-preview',
      storeId: 'a',
    })) as KnowledgeRestorePreview
    expect(preview.targetStoreId).toBe('a')
    expect(preview.scope).toContain('Shop A')
    await expect(
      runtime.request({ workspaceId: 'w', operation: 'restore-preview', storeId: 'b' }),
    ).rejects.toThrow(/其他店铺/)

    const full = repo.createBackup(join(root, 'full-backup'))
    chosen = full.directory
    await expect(
      runtime.request({ workspaceId: 'w', operation: 'restore-preview', storeId: 'a' }),
    ).rejects.toThrow(/不支持全库/)
    const family = repo.createBackup(join(root, 'family-backup'), { canonicalId: canonical.id })
    chosen = family.directory
    await expect(
      runtime.request({ workspaceId: 'w', operation: 'restore-preview', storeId: 'a' }),
    ).rejects.toThrow(/不支持全库/)

    chosen = store.directory
    const revisionPreview = (await runtime.request({
      workspaceId: 'w',
      operation: 'restore-preview',
      storeId: 'a',
    })) as KnowledgeRestorePreview
    repo.saveCanonical({ title: 'changed after preview' })
    expect(() => runtime.prepareRestore(revisionPreview.token)).toThrow(/预览已过期|资料变化/)

    const accountPreview = (await runtime.request({
      workspaceId: 'w',
      operation: 'restore-preview',
      storeId: 'a',
    })) as KnowledgeRestorePreview
    active = false
    expect(() => runtime.prepareRestore(accountPreview.token)).toThrow(/账号已失效/)
    active = true

    const storePreview = (await runtime.request({
      workspaceId: 'w',
      operation: 'restore-preview',
      storeId: 'a',
    })) as KnowledgeRestorePreview
    available = []
    expect(() => runtime.prepareRestore(storePreview.token)).toThrow(/店铺不存在|已移除/)
  } finally {
    runtime.dispose()
    repo.dispose()
    rmSync(root, { recursive: true, force: true })
  }
})

it('rejects a forged store manifest attached to an unpruned account database', () => {
  const root = mkdtempSync(join(tmpdir(), 'knowledge-forged-store-')),
    repo = createKnowledgeRepository({ directory: join(root, 'live'), workspaceId: 'w' })
  try {
    const shared = repo.saveCanonical({ title: 'x' })
    repo.bindProduct({ canonicalId: shared.id, storeId: 'a', productId: 'a' })
    repo.bindProduct({ canonicalId: shared.id, storeId: 'b', productId: 'b' })
    const secret = repo.saveDraft({
      scope: { kind: 'store', storeId: 'b' },
      question: 'secret',
      answer: 'secret',
    })
    const backup = repo.createBackup(join(root, 'backup'))
    const file = join(backup.directory, 'manifest.json'),
      manifest = JSON.parse(readFileSync(file, 'utf8'))
    manifest.scope = {
      kind: 'store',
      storeId: 'a',
      storeIds: ['a'],
      bindingIds: [],
      dependencyBindingIds: [],
      originalFiles: [],
    }
    writeFileSync(file, JSON.stringify(manifest))
    expect(() => inspectKnowledgeBackup(backup.directory)).toThrow()
    expect(repo.getEntry(secret.id)).toBeDefined()
  } finally {
    repo.dispose()
    rmSync(root, { recursive: true, force: true })
  }
})

it('rejects a store archive whose attachment hash no longer matches its manifest', () => {
  const root = mkdtempSync(join(tmpdir(), 'knowledge-store-asset-')),
    repo = createKnowledgeRepository({ directory: join(root, 'live'), workspaceId: 'w' })
  try {
    const canonical = repo.saveCanonical({ title: 'asset' })
    const binding = repo.bindProduct({
      canonicalId: canonical.id,
      storeId: 'a',
      productId: 'a',
    })
    const asset = repo.addAsset(Buffer.from('safe bytes'), {
      name: 'evidence.png',
      mimeType: 'image/png',
    })
    repo.saveSource({
      storeId: 'a',
      bindingId: binding.id,
      kind: 'image',
      label: 'evidence',
      text: 'evidence',
      assetIds: [asset.id],
    })
    const backup = repo.createBackup(join(root, 'backup'), { storeId: 'a' })
    const file = join(backup.directory, 'manifest.json'),
      manifest = JSON.parse(readFileSync(file, 'utf8'))
    const item = manifest.files.find(
      (entry: { path: string }) => entry.path === `assets/${asset.sha256}`,
    )
    item.sha256 = createHash('sha256').update('tampered').digest('hex')
    writeFileSync(file, JSON.stringify(manifest))
    expect(() => inspectKnowledgeBackup(backup.directory)).toThrow(/hash|附件|校验/)
  } finally {
    repo.dispose()
    rmSync(root, { recursive: true, force: true })
  }
})

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { createKnowledgeRepository, restoreKnowledgeBackup } from '../electron/knowledge'
import { inspectKnowledgeBackup } from '../electron/knowledge/backup'
import { createKnowledgeRuntime } from '../electron/knowledge-runtime'
import { createKnowledgeImporter } from '../electron/knowledge/imports'
import type { KnowledgeClearPreview } from '../src/shared/contracts/knowledge-client'

const cleanups: (() => void)[] = []
async function importDone(repo: ReturnType<typeof createKnowledgeRepository>, id: string) {
  for (let i = 0; i < 100; i++) {
    const job = repo.getJob(id)!
    if (job.status === 'succeeded') return
    if (job.status === 'failed') throw Error(JSON.stringify(job))
    await new Promise((done) => setTimeout(done, 10))
  }
  throw Error('import timeout')
}
afterEach(() => {
  vi.useRealTimers()
  cleanups
    .reverse()
    .splice(0)
    .forEach((f) => f())
})
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'knowledge-clear-'))
  cleanups.push(() => rmSync(directory, { recursive: true, force: true }))
  const repo = createKnowledgeRepository({ directory, workspaceId: 'w' })
  cleanups.push(() => repo.dispose())
  const runtime = createKnowledgeRuntime({
    repository: repo,
    workspaceId: 'w',
    assertActive() {},
    changed() {},
    stores: () => ['a', 'b'].map((id) => ({ id, storeName: id, platform: 'sim-local' })),
  })
  const publish = (scope: Parameters<typeof repo.saveDraft>[0]['scope'], answer: string) => {
    const v = repo.saveDraft({ scope, question: answer, answer })
    repo.publish({ entryId: v.id, expectedDraftRevision: v.revision, expectedSourceRevisions: {} })
    return v
  }
  return { directory, repo, runtime, publish }
}
it.each([false, true])(
  'can re-import the identical CSV after clear without changing retained B evidence (shared=%s)',
  async (shared) => {
    const { repo, runtime, directory } = fixture()
    const importer = createKnowledgeImporter({ repository: repo, assertActive() {}, changed() {} })
    cleanups.push(() => importer.dispose())
    const files = [
      { name: 'a.csv', bytes: Buffer.from('productId,title,description\n1,shirt,cotton') },
    ]
    const ids = importer.registerFiles('a', files)
    const initial = await importer.preview('a', ids, [])
    await importDone(repo, importer.apply(initial.previewId, 'a').jobId)
    const source = repo.listSources({ storeId: 'a' }).find((s) => s.bindingId)!
    if (shared) {
      const entry = repo.saveDraft({
        scope: { kind: 'store', storeId: 'b' },
        question: 'cotton?',
        answer: 'yes',
        sourceRefs: [{ sourceId: source.id, revision: source.revision }],
      })
      repo.publish({
        entryId: entry.id,
        expectedDraftRevision: 1,
        expectedSourceRevisions: { [source.id]: source.revision },
      })
    }
    const preview = (await runtime.request({
      workspaceId: 'w',
      operation: 'clear-preview',
      scope: { kind: 'store', storeId: 'a' },
    })) as KnowledgeClearPreview
    const plan = runtime.prepareClear(preview.token, '清除当前店铺')
    importer.dispose()
    repo.dispose()
    restoreKnowledgeBackup({ directory, backupDirectory: plan.backupDirectory })
    const copy = createKnowledgeRepository({ directory, workspaceId: 'new' })
    cleanups.push(() => copy.dispose())
    const next = createKnowledgeImporter({ repository: copy, assertActive() {}, changed() {} })
    cleanups.push(() => next.dispose())
    const reimport = await next.preview('a', next.registerFiles('a', files), [])
    expect(reimport.duplicates).toBe(0)
    await importDone(copy, next.apply(reimport.previewId, 'a').jobId)
    expect(copy.listBindings().filter((b) => b.storeId === 'a')).toHaveLength(1)
    if (shared) expect(copy.getSource(source.id)).toEqual(source)
  },
)
it('backs up before clearing one store, preserves shared knowledge and other-store pending drafts, and allows collecting again', async () => {
  const { repo, runtime, directory, publish } = fixture()
  const product = repo.saveCanonical({ title: 'shared' })
  const a = repo.bindProduct({ canonicalId: product.id, storeId: 'a', productId: 'p' })
  const b = repo.bindProduct({ canonicalId: product.id, storeId: 'b', productId: 'p' })
  const privateA = publish({ kind: 'binding', bindingId: a.id }, 'private-a')
  const privateB = publish({ kind: 'binding', bindingId: b.id }, 'private-b')
  const shared = publish({ kind: 'canonical', canonicalId: product.id }, 'shared')
  const template = publish({ kind: 'template', storeIds: ['a', 'b'] }, 'template')
  repo.saveDraft({
    id: template.id,
    expectedRevision: template.revision,
    scope: { kind: 'template', storeIds: ['a', 'b'] },
    question: 'pending',
    answer: 'pending-b',
  })
  const preview = (await runtime.request({
    workspaceId: 'w',
    operation: 'clear-preview',
    scope: { kind: 'store', storeId: 'a' },
  })) as KnowledgeClearPreview
  const plan = runtime.prepareClear(preview.token, '清除当前店铺')
  expect(repo.getBinding(a.id)?.active).toBe(true)
  inspectKnowledgeBackup(plan.backupDirectory)
  inspectKnowledgeBackup(plan.recoveryDirectory)
  repo.dispose()
  restoreKnowledgeBackup({ directory, backupDirectory: plan.backupDirectory })
  const cleared = createKnowledgeRepository({ directory, workspaceId: 'new' })
  cleanups.push(() => cleared.dispose())
  expect(cleared.listBindings().map((v) => v.id)).toEqual([b.id])
  expect(cleared.getEntry(privateA.id)?.status).toBe('withdrawn')
  expect(cleared.getEntry(privateB.id)?.approved).toEqual(privateB)
  expect(cleared.getEntry(shared.id)?.approved).toEqual(shared)
  expect(cleared.getEntry(template.id)?.approved?.scope).toEqual({
    kind: 'template',
    storeIds: ['b'],
  })
  expect(cleared.getEntry(template.id)?.draft.answer).toBe('pending-b')
  expect(cleared.getEntry(template.id)?.status).toBe('draft')
  expect(cleared.getEntry(template.id)?.draft.scope).toEqual({ kind: 'template', storeIds: ['b'] })
  const newProduct = cleared.saveCanonical({ title: 'recollected' })
  expect(
    cleared.bindProduct({ canonicalId: newProduct.id, storeId: 'a', productId: 'p' }).active,
  ).toBe(true)
  expect(cleared.getEntry(privateA.id)?.approved).toBeNull()
  inspectKnowledgeBackup(cleared.createBackup(join(directory, 'proof')).directory)
  cleared.dispose()
  restoreKnowledgeBackup({ directory, backupDirectory: plan.recoveryDirectory })
  const restored = createKnowledgeRepository({ directory, workspaceId: 'restored' })
  cleanups.push(() => restored.dispose())
  expect(restored.getEntry(template.id)?.approved).toEqual(template)
  expect(restored.getBinding(a.id)?.active).toBe(true)
})
it('clears account knowledge while preserving settings and preventing legacy JSON resurrection', async () => {
  const { repo, runtime, directory, publish } = fixture()
  publish({ kind: 'store', storeId: 'a' }, 'private')
  repo.saveSettings({ dynamicTtlMinutes: 97 })
  const preview = (await runtime.request({
    workspaceId: 'w',
    operation: 'clear-preview',
    scope: { kind: 'account' },
  })) as KnowledgeClearPreview
  const plan = runtime.prepareClear(preview.token, '清空当前账号')
  repo.dispose()
  restoreKnowledgeBackup({ directory, backupDirectory: plan.backupDirectory })
  writeFileSync(
    join(directory, 'product-knowledge.json'),
    'invalid old file must not be re-imported',
  )
  const cleared = createKnowledgeRepository({ directory, workspaceId: 'new' })
  cleanups.push(() => cleared.dispose())
  expect(cleared.readOnly).toBe(false)
  expect(cleared.rows('entries')).toEqual([])
  expect(cleared.rows('canonical')).toEqual([])
  expect(cleared.getSettings().dynamicTtlMinutes).toBe(97)
})
it('rejects wrong confirmation, changed data, expired and reused tokens without clearing live data', async () => {
  const { repo, runtime, publish } = fixture()
  const entry = publish({ kind: 'store', storeId: 'a' }, 'keep')
  const preview = () =>
    runtime.request({
      workspaceId: 'w',
      operation: 'clear-preview',
      scope: { kind: 'store', storeId: 'a' },
    }) as Promise<KnowledgeClearPreview>
  let p = await preview()
  expect(() => runtime.prepareClear(p.token, '清空当前账号')).toThrow()
  expect(() => runtime.prepareClear(p.token, '清除当前店铺')).toThrow()
  p = await preview()
  repo.saveSettings({ dynamicTtlMinutes: 91 })
  expect(() => runtime.prepareClear(p.token, '清除当前店铺')).toThrow(/变化|过期/)
  p = await preview()
  vi.useFakeTimers()
  vi.advanceTimersByTime(600001)
  expect(() => runtime.prepareClear(p.token, '清除当前店铺')).toThrow(/过期/)
  expect(repo.getEntry(entry.id)?.approved).toEqual(entry)
})
it('does not mutate live data when the automatic backup fails', async () => {
  const { repo, runtime, publish } = fixture()
  const entry = publish({ kind: 'store', storeId: 'a' }, 'keep')
  const p = (await runtime.request({
    workspaceId: 'w',
    operation: 'clear-preview',
    scope: { kind: 'account' },
  })) as KnowledgeClearPreview
  vi.spyOn(repo, 'createBackup').mockImplementationOnce(() => {
    throw Error('disk full')
  })
  expect(() => runtime.prepareClear(p.token, '清空当前账号')).toThrow('disk full')
  expect(repo.getEntry(entry.id)?.approved).toEqual(entry)
})
it('preserves other-shop approved content and pending edits even when the same entry changes ownership across versions', async () => {
  const { repo, runtime, directory, publish } = fixture()
  const approvedB = publish({ kind: 'store', storeId: 'b' }, 'approved-b')
  repo.saveDraft({
    id: approvedB.id,
    expectedRevision: 1,
    scope: { kind: 'store', storeId: 'a' },
    question: 'private',
    answer: 'discard-a',
  })
  const approvedA = publish({ kind: 'store', storeId: 'a' }, 'approved-a')
  repo.saveDraft({
    id: approvedA.id,
    expectedRevision: 1,
    scope: { kind: 'store', storeId: 'b' },
    question: 'pending',
    answer: 'keep-b',
  })
  const source = repo.saveSource({
    kind: 'manual',
    storeId: 'a',
    label: 'shared evidence',
    text: 'keep',
  })
  const shared = repo.saveDraft({
    scope: { kind: 'template', storeIds: ['a', 'b'] },
    question: 'shared',
    answer: 'keep shared',
    sourceRefs: [{ sourceId: source.id, revision: 1 }],
  })
  repo.publish({
    entryId: shared.id,
    expectedDraftRevision: 1,
    expectedSourceRevisions: { [source.id]: 1 },
  })
  const p = (await runtime.request({
    workspaceId: 'w',
    operation: 'clear-preview',
    scope: { kind: 'store', storeId: 'a' },
  })) as KnowledgeClearPreview
  const plan = runtime.prepareClear(p.token, '清除当前店铺')
  repo.dispose()
  restoreKnowledgeBackup({ directory, backupDirectory: plan.backupDirectory })
  const copy = createKnowledgeRepository({ directory, workspaceId: 'verify' })
  cleanups.push(() => copy.dispose())
  expect(copy.getEntry(approvedB.id)?.approved?.answer).toBe('approved-b')
  expect(copy.getEntry(approvedB.id)?.draft.scope).toEqual({ kind: 'store', storeId: 'b' })
  expect(copy.getEntry(approvedA.id)?.approved).toBeNull()
  expect(copy.getEntry(approvedA.id)?.draft.answer).toBe('keep-b')
  expect(copy.getSource(source.id)).toEqual(source)
  expect(copy.getEntry(shared.id)?.approved?.sourceRefs).toEqual(shared.sourceRefs)
  inspectKnowledgeBackup(copy.createBackup(join(directory, 'validated')).directory)
})

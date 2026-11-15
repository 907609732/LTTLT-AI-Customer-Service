// @vitest-environment node
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { createKnowledgeRepository } from '../electron/knowledge'
import { createKnowledgeImporter } from '../electron/knowledge/imports'
const cleanup: (() => void)[] = []
afterEach(() =>
  cleanup
    .splice(0)
    .reverse()
    .forEach((f) => f()),
)
function setup() {
  const directory = mkdtempSync(join(tmpdir(), 'knowledge-import-'))
  cleanup.push(() => rmSync(directory, { recursive: true, force: true }))
  const repo = createKnowledgeRepository({ directory, workspaceId: 'w' })
  cleanup.push(() => repo.dispose())
  const importer = createKnowledgeImporter({ repository: repo, assertActive() {}, changed() {} })
  cleanup.push(() => {
    try {
      importer.dispose()
    } catch {
      /* already closed for reopen case */
    }
  })
  return { repo, importer }
}
it('previews CSV targets, duplicates and encoding then applies rows to the selected store only', async () => {
  const { repo, importer } = setup()
  const ids = importer.registerFiles('s', [
    {
      name: 'a.csv',
      bytes: Buffer.from('productId,title,description\n1,衬衫,纯棉\n2,裤子,蓝色\n1,衬衫,纯棉'),
    },
  ])
  const preview = await importer.preview('s', ids, [])
  expect(preview.rows).toHaveLength(3)
  expect(preview.duplicates).toBe(1)
  expect(repo.listBindings()).toHaveLength(0)
  await waitImport(repo, importer.apply(preview.previewId, 's').jobId)
  expect(repo.listBindings().map((b) => [b.storeId, b.productId])).toEqual([
    ['s', '1'],
    ['s', '2'],
  ])
  expect(repo.listSources().filter((s) => s.bindingId)).toHaveLength(2)
  expect(repo.rows('entries')).toHaveLength(0)
  const again = await importer.preview('s', ids, [])
  expect(again.duplicates).toBe(3)
})
it('imports old intents as unapproved store drafts ignoring external store IDs and flags', async () => {
  const { repo, importer } = setup()
  const ids = importer.registerFiles('s', [
    {
      name: 'a.json',
      bytes: Buffer.from(
        JSON.stringify([
          {
            name: '包',
            storeIds: ['other'],
            enabled: true,
            entries: [{ question: '发货', answer: '两天', enabled: true, keywords: [] }],
          },
        ]),
      ),
    },
  ])
  const preview = await importer.preview('s', ids, [])
  await waitImport(repo, importer.apply(preview.previewId, 's').jobId)
  const entries = repo.listEntries({ storeId: 's' }).items
  expect(entries).toHaveLength(1)
  expect(entries[0]?.draft.scope).toEqual({ kind: 'store', storeId: 's' })
  expect(entries[0]?.approved).toBeNull()
})
it('rejects changed target bindings after preview and preserves drafts', async () => {
  const { repo, importer } = setup()
  const c = repo.saveCanonical({ title: 'A' })
  const b = repo.bindProduct({ storeId: 's', productId: '1', canonicalId: c.id })
  const ids = importer.registerFiles('s', [{ name: 'a.txt', bytes: Buffer.from('资料') }], b.id)
  const preview = await importer.preview('s', ids, [b.id])
  repo.bindProduct({
    id: b.id,
    storeId: b.storeId,
    productId: b.productId,
    canonicalId: b.canonicalId,
    expectedRevision: b.revision,
    title: 'changed',
  })
  expect(() => importer.apply(preview.previewId, 's')).toThrow(/变化/)
  expect(repo.listSources().filter((s) => s.label === 'a.txt')).toHaveLength(0)
})

it('persists an import before work and supports pause then manual resume', async () => {
  const { repo, importer } = setup()
  const ids = importer.registerFiles('s', [{ name: 'a.txt', bytes: Buffer.from('一行\n二行') }])
  const preview = await importer.preview('s', ids, [])
  const { jobId } = importer.apply(preview.previewId, 's')
  expect(repo.getJob(jobId)?.status).toBe('queued')
  importer.pause('s', jobId)
  await new Promise((r) => setTimeout(r, 20))
  expect(repo.listSources().filter((s) => s.label === 'a.txt')).toHaveLength(0)
  importer.resume('s', jobId)
  await waitImport(repo, jobId)
  expect(repo.listSources().filter((s) => s.label === 'a.txt')).toHaveLength(2)
})
async function waitImport(repo: ReturnType<typeof createKnowledgeRepository>, id: string) {
  for (let i = 0; i < 100; i++) {
    const job = repo.getJob(id)!
    if (!['queued', 'running'].includes(job.status)) return job
    await new Promise((r) => setTimeout(r, 5))
  }
  throw Error('import not settled')
}
it('normalizes queued import and learning jobs to manual continuation on reopen', () => {
  const { repo } = setup()
  const learn = repo.createJob({ storeId: 's', kind: 'learn', payload: {} }),
    imp = repo.createJob({ storeId: 's', kind: 'import', payload: {} })
  const directory = repo.directory
  repo.dispose()
  const reopened = createKnowledgeRepository({ directory, workspaceId: 'next' })
  cleanup.push(() => reopened.dispose())
  expect(reopened.getJob(learn.id)?.status).toBe('paused')
  expect(reopened.getJob(imp.id)?.status).toBe('paused')
})
it('updates same CSV product material with a new source revision and makes prior approval stale', async () => {
  const { repo, importer } = setup()
  const first = importer.registerFiles('s', [
    { name: 'a.csv', bytes: Buffer.from('productId,title,description\n1,衣服,纯棉') },
  ])
  await waitImport(
    repo,
    importer.apply((await importer.preview('s', first, [])).previewId, 's').jobId,
  )
  const b = repo.listBindings()[0]!,
    source = repo.listSources({ bindingId: b.id })[0]!
  const draft = repo.saveDraft({
    scope: { kind: 'binding', bindingId: b.id },
    question: '材质',
    answer: '纯棉',
    sourceRefs: [{ sourceId: source.id, revision: 1 }],
  })
  repo.publish({
    entryId: draft.id,
    expectedDraftRevision: 1,
    expectedSourceRevisions: { [source.id]: 1 },
  })
  const next = importer.registerFiles('s', [
    { name: 'a.csv', bytes: Buffer.from('productId,title,description\n1,衣服,羊毛') },
  ])
  await waitImport(
    repo,
    importer.apply((await importer.preview('s', next, [])).previewId, 's').jobId,
  )
  expect(repo.listBindings()).toHaveLength(1)
  expect(repo.getSource(source.id)?.revision).toBe(2)
  expect(repo.getEntry(draft.id)?.status).toBe('stale')
  expect(repo.getEntry(draft.id)?.draft.answer).toBe('纯棉')
})
it('does not demote an existing shared image asset when registering identical original bytes', () => {
  const { repo, importer } = setup()
  const bytes = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  const asset = repo.addAsset(bytes, { name: 'platform.png', mimeType: 'image/png' })
  importer.registerFiles('s', [{ name: 'upload.png', bytes }])
  expect(repo.row<{ id: string; mimeType: string }>('assets', asset.id)?.mimeType).toBe('image/png')
})

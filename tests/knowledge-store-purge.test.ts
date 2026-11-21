import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { createKnowledgeRepository } from '../electron/knowledge'
import { createKnowledgeRuntime } from '../electron/knowledge-runtime'
import type { KnowledgeAsset } from '../src/shared/contracts/knowledge'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})
function fixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'knowledge-store-purge-'))
  dirs.push(directory)
  const repo = createKnowledgeRepository({ directory, workspaceId: 'w' })
  return { directory, repo }
}
function publish(
  repo: ReturnType<typeof createKnowledgeRepository>,
  scope: Parameters<typeof repo.saveDraft>[0]['scope'],
  answer: string,
  sourceRefs: Parameters<typeof repo.saveDraft>[0]['sourceRefs'] = [],
) {
  const draft = repo.saveDraft({ scope, question: answer, answer, sourceRefs })
  repo.publish({
    entryId: draft.id,
    expectedDraftRevision: draft.revision,
    expectedSourceRevisions: Object.fromEntries(
      sourceRefs.map((ref) => [ref.sourceId, ref.revision]),
    ),
  })
  return draft
}

it('physically removes only store A data, preserves shared family and B history references', () => {
  const { directory, repo } = fixture()
  const shared = repo.saveCanonical({ title: 'shared' })
  const onlyA = repo.saveCanonical({ title: 'only-a' })
  const a = repo.bindProduct({ canonicalId: shared.id, storeId: 'a', productId: 'a-1' })
  const b = repo.bindProduct({ canonicalId: shared.id, storeId: 'b', productId: 'b-1' })
  const aOnly = repo.bindProduct({ canonicalId: onlyA.id, storeId: 'a', productId: 'a-2' })

  const privateAsset = repo.addAsset(new Uint8Array([1, 2, 3]), {
    name: 'private-a.png',
    mimeType: 'image/png',
  })
  const sharedAsset = repo.addAsset(new Uint8Array([4, 5, 6]), {
    name: 'shared-a.png',
    mimeType: 'image/png',
  })
  const bUnreferenced = repo.addAsset(
    new Uint8Array([7, 8]),
    { name: 'b-unreferenced.png', mimeType: 'image/png' },
    'b',
  )
  const privateSource = repo.saveSource({
    kind: 'manual',
    storeId: 'a',
    label: 'private-a',
    text: 'private a',
    assetIds: [privateAsset.id],
  })
  const sharedSource = repo.saveSource({
    kind: 'manual',
    storeId: 'a',
    label: 'shared-a',
    text: 'shared evidence',
    assetIds: [sharedAsset.id],
  })
  const sourceB = repo.saveSource({
    kind: 'manual',
    storeId: 'b',
    label: 'b',
    text: 'b only',
  })
  const privateA = publish(repo, { kind: 'binding', bindingId: a.id }, 'private-a', [
    { sourceId: privateSource.id, revision: privateSource.revision },
  ])
  const privateB = publish(repo, { kind: 'binding', bindingId: b.id }, 'private-b', [
    { sourceId: sourceB.id, revision: sourceB.revision },
  ])
  const sharedCanonical = publish(repo, { kind: 'canonical', canonicalId: shared.id }, 'shared')
  const template = publish(repo, { kind: 'template', storeIds: ['a', 'b'] }, 'shared-template', [
    { sourceId: sharedSource.id, revision: sharedSource.revision },
  ])
  const globalTemplate = publish(repo, { kind: 'template', storeIds: [] }, 'global-template')
  const onlyAEntry = publish(repo, { kind: 'binding', bindingId: aOnly.id }, 'only-a')
  const jobA = repo.createJob({ kind: 'learn', storeId: 'a', payload: { marker: 'a' } })
  const jobB = repo.createJob({ kind: 'learn', storeId: 'b', payload: { marker: 'b' } })
  const missA = repo.recordMiss({ storeId: 'a', question: 'a miss' })
  const missB = repo.recordMiss({ storeId: 'b', question: 'b miss' })
  expect(fs.existsSync(path.join(directory, 'assets', privateAsset.sha256))).toBe(true)
  expect(fs.existsSync(path.join(directory, 'assets', sharedAsset.sha256))).toBe(true)

  const result = repo.purgeStore('a')

  expect(result.bindings).toBe(2)
  expect(repo.getBinding(a.id)).toBeNull()
  expect(repo.getBinding(aOnly.id)).toBeNull()
  expect(repo.getBinding(b.id)).toEqual(b)
  expect(repo.getEntry(privateA.id)).toBeNull()
  expect(repo.getEntry(onlyAEntry.id)).toBeNull()
  expect(repo.getEntry(privateB.id)?.approved).toEqual(privateB)
  expect(repo.getEntry(sharedCanonical.id)?.approved).toEqual(sharedCanonical)
  expect(repo.getEntry(globalTemplate.id)?.approved).toEqual(globalTemplate)
  expect(repo.getEntry(template.id)?.approved?.scope).toEqual({
    kind: 'template',
    storeIds: ['b'],
  })
  expect(repo.getEntry(template.id)?.approved?.sourceRefs).toEqual(template.sourceRefs)
  expect(repo.getSource(privateSource.id)).toBeNull()
  expect(repo.getSource(sharedSource.id)?.text).toBe('shared evidence')
  expect(repo.getSource(sourceB.id)).toEqual(sourceB)
  expect(repo.getJob(jobA.id)).toBeNull()
  expect(repo.getJob(jobB.id)?.storeId).toBe('b')
  expect(repo.getMiss(missA.id)).toBeNull()
  expect(repo.getMiss(missB.id)?.storeId).toBe('b')
  expect(fs.existsSync(path.join(directory, 'assets', privateAsset.sha256))).toBe(false)
  expect(fs.existsSync(path.join(directory, 'assets', sharedAsset.sha256))).toBe(true)
  expect(repo.row<KnowledgeAsset>('assets', bUnreferenced.id)).not.toBeNull()
  expect(fs.existsSync(path.join(directory, 'assets', bUnreferenced.sha256))).toBe(true)
  expect(repo.getCanonical(shared.id)).toEqual(shared)
  expect(repo.getCanonical(onlyA.id)).toEqual(onlyA)
  expect(repo.getMetadata('removed-store:a')).toBe('1')
  expect(repo.getMetadata('purged-store:a')).toBe('1')

  // Late writes and late job updates fail closed; other stores remain writable.
  expect(() =>
    repo.saveSource({ kind: 'manual', storeId: 'a', label: 'late', text: 'late' }),
  ).toThrow(/彻底移除|晚到/)
  expect(() =>
    repo.updateJob(jobB.id, { expectedRevision: repo.getJob(jobB.id)!.revision, status: 'paused' }),
  ).not.toThrow()
  const before = repo.listSources({ storeId: 'b' })
  expect(repo.purgeStore('a').sources).toBe(0)
  expect(repo.listSources({ storeId: 'b' })).toEqual(before)
  repo.dispose()
})

it('cancels and quiesces a late worker before deleting; the tombstone rejects its write', async () => {
  const { repo } = fixture()
  const runtime = createKnowledgeRuntime({
    repository: repo,
    workspaceId: 'w',
    assertActive() {},
    changed() {},
    stores: () => [{ id: 'a', storeName: 'A', platform: 'sim-local' }],
  })
  const order: string[] = []
  let late: unknown
  runtime.setPipeline({
    async request() {
      throw new Error('not used')
    },
    removeStore() {
      order.push('cancel')
      setTimeout(() => {
        try {
          repo.saveSource({ kind: 'manual', storeId: 'a', label: 'late', text: 'late' })
        } catch (error) {
          late = error
        }
      }, 30)
    },
    async quiesceStore() {
      order.push('quiesce')
      await new Promise((resolve) => setTimeout(resolve, 20))
    },
    dispose() {},
  })
  const summary = await runtime.purgeStore('a')
  expect(order).toEqual(['cancel', 'quiesce'])
  expect(summary.sources).toBe(0)
  await new Promise((resolve) => setTimeout(resolve, 40))
  expect(late).toBeInstanceOf(Error)
  expect(String(late)).toMatch(/晚到/)
  repo.dispose()
})

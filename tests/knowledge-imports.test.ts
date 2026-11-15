// @vitest-environment node
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { createKnowledgeRepository } from '../electron/knowledge'
import { createKnowledgeImporter } from '../electron/knowledge/imports'
import { exportKnowledge } from '../electron/knowledge/export'
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
it.each(['csv', 'json'] as const)(
  'roundtrips %s question text, Unicode, newlines and explicit SKU as unapproved drafts',
  async (format) => {
    const { repo, importer } = setup()
    const c = repo.saveCanonical({ title: '衣服' }),
      root = repo.bindProduct({ canonicalId: c.id, storeId: 's', productId: '1' }),
      sku = repo.bindProduct({ canonicalId: c.id, storeId: 's', productId: '1', skuId: 'red' })
    const v = repo.saveDraft({
      scope: { kind: 'binding', bindingId: sku.id },
      question: '=规格,"红色"\n尺寸?',
      answer: '红色，L\n第二行',
      field: 'fact',
    })
    repo.publish({ entryId: v.id, expectedDraftRevision: v.revision, expectedSourceRevisions: {} })
    const output = exportKnowledge(repo, { storeId: 's', canonicalId: c.id, format })
    if (format === 'csv') expect(output.text).toContain("'=规格")
    const ids = importer.registerFiles('s', [
      { name: `roundtrip.${format}`, bytes: Buffer.from(output.text) },
    ])
    const preview = await importer.preview('s', ids, [root.id])
    await waitImport(repo, importer.apply(preview.previewId, 's').jobId)
    const imported = repo
      .listEntries({ storeId: 's' })
      .items.find((e) => e.draft.origin === 'import')!
    expect(imported.draft.question).toBe(v.question)
    expect(imported.draft.answer).toBe(v.answer)
    expect(imported.draft.scope).toEqual({ kind: 'binding', bindingId: sku.id })
    expect(imported.approved).toBeNull()
  },
)
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
import { readFileSync } from 'node:fs'
import { createCanvas } from '@napi-rs/canvas'
import { createKnowledgeLearner } from '../electron/knowledge/learning'
import type { KnowledgeAsset } from '../src/shared/contracts/knowledge'
function chart(color: string, width = 12) {
  const canvas = createCanvas(width, 12)
  const context = canvas.getContext('2d')
  context.fillStyle = color
  context.fillRect(0, 0, width, 12)
  return canvas.toBuffer('image/png')
}
it('revises changed image pixels at the same logical position and invalidates removed tiles', async () => {
  const { repo, importer } = setup()
  const b = repo.bindProduct({
    storeId: 's',
    productId: '1',
    canonicalId: repo.saveCanonical({ title: 'A' }).id,
  })
  async function ingest(bytes: Buffer) {
    const ids = importer.registerFiles('s', [{ name: 'chart.png', bytes }], b.id)
    const p = await importer.preview('s', ids, [b.id])
    expect((await waitImport(repo, importer.apply(p.previewId, 's').jobId)).status).toBe(
      'succeeded',
    )
  }
  await ingest(chart('red', 1412))
  const parts = repo.listSources({ bindingId: b.id }).filter((s) => s.label === 'chart.png')
  expect(parts).toHaveLength(2)
  const drafts = parts.map((source) => {
    const d = repo.saveDraft({
      scope: { kind: 'binding', bindingId: b.id },
      question: '图中颜色',
      answer: '红色',
      sourceRefs: [{ sourceId: source.id, revision: source.revision }],
    })
    repo.publish({
      entryId: d.id,
      expectedDraftRevision: d.revision,
      expectedSourceRevisions: { [source.id]: source.revision },
    })
    return d
  })
  await ingest(chart('blue'))
  expect(repo.getSource(parts[0]!.id)?.revision).toBe(2)
  expect(repo.getSource(parts[1]!.id)?.revision).toBe(2)
  for (const d of drafts)
    expect(repo.getEntry(d.id)).toMatchObject({
      status: 'stale',
      approved: null,
      draft: { answer: '红色' },
    })
  const learner = createKnowledgeLearner({
    repository: repo,
    assertActive() {},
    changed() {},
    model: {
      vision: () => ({ supported: true, maxImages: 4, reason: '' }),
      complete: async () => '{"candidates":[]}',
    },
  })
  cleanup.push(() => learner.dispose())
  await expect(learner.estimate('s', [b.id], [parts[1]!.id])).rejects.toThrow(/没有可学习/)
  // Reverting to previously imported bytes must revive the same parts, not skip historical hashes.
  await ingest(chart('red', 1412))
  expect(repo.getSource(parts[0]!.id)?.revision).toBe(3)
  expect(repo.getSource(parts[1]!.id)?.revision).toBe(3)
  expect(repo.listSources({ bindingId: b.id }).filter((s) => s.label === 'chart.png')).toHaveLength(
    2,
  )
})
it('invalidates a removed DOCX embedded image while retaining original bytes and source history', async () => {
  const { repo, importer } = setup()
  async function ingest(fixture: string) {
    const ids = importer.registerFiles('s', [
      {
        name: 'guide.docx',
        bytes: readFileSync(join('tests/fixtures/knowledge-ingestion', fixture)),
      },
    ])
    await waitImport(
      repo,
      importer.apply((await importer.preview('s', ids, [])).previewId, 's').jobId,
    )
  }
  await ingest('image.docx')
  const image = repo.listSources().find((s) => s.label === 'guide.docx' && s.locator.imageAssetId)!
  const d = repo.saveDraft({
    scope: { kind: 'store', storeId: 's' },
    question: '图示',
    answer: '旧图',
    sourceRefs: [{ sourceId: image.id, revision: image.revision }],
  })
  repo.publish({
    entryId: d.id,
    expectedDraftRevision: d.revision,
    expectedSourceRevisions: { [image.id]: image.revision },
  })
  await ingest('text.docx')
  expect(repo.getSource(image.id)?.revision).toBe(2)
  expect(repo.getEntry(d.id)?.status).toBe('stale')
  expect(repo.sourceVersions(image.id)[1]?.locator.imageAssetId).toBe(image.locator.imageAssetId)
  expect(repo.readAsset(image.locator.assetId!)).toBeTruthy()
})
it('preserves original filename/type across same-hash raster parsing and model-learning reuse', async () => {
  const { repo, importer } = setup()
  const ids = importer.registerFiles('s', [{ name: 'chart.png', bytes: chart('red') }])
  const original = repo.getSource(ids[0]!)!
  const before = repo.row<KnowledgeAsset>('assets', original.locator.assetId!)!
  const preview = await importer.preview('s', ids, [])
  await waitImport(repo, importer.apply(preview.previewId, 's').jobId)
  expect(repo.row('assets', before.id)).toEqual(before)
  const source = repo.listSources().find((s) => s.label === 'chart.png')!
  let sawPng = false
  const learner = createKnowledgeLearner({
    repository: repo,
    assertActive() {},
    changed() {},
    model: {
      vision: () => ({ supported: true, maxImages: 4, reason: '' }),
      complete: async (input) => {
        sawPng = JSON.stringify(input.messages).includes('data:image/png;base64,')
        return '{"candidates":[]}'
      },
    },
  })
  cleanup.push(() => learner.dispose())
  const estimate = await learner.estimate('s', [], [source.id])
  const job = await learner.start('s', [], [source.id], estimate.estimateId)
  expect((await waitImport(repo, job.jobId)).status).toBe('succeeded')
  expect(sawPng).toBe(true)
  expect(repo.row('assets', before.id)).toEqual(before)
  expect((await importer.preview('s', ids, [])).parts).toBe(1)
  const renamed = importer.registerFiles('s', [{ name: 'same-bytes.png', bytes: chart('red') }])
  expect((await importer.preview('s', renamed, [])).rows[0]?.label).toBe('same-bytes.png')
  expect((await importer.preview('s', ids, [])).rows[0]?.label).toBe('chart.png')
})
it('updates the same PDF page raster without leaving its prior approval active', async () => {
  const { repo, importer } = setup()
  const original = readFileSync('tests/fixtures/knowledge-ingestion/text.pdf')
  const changed = Buffer.from(
    original.toString('latin1').replace('length 50 mm', 'length 60 mm'),
    'latin1',
  )
  expect(changed.equals(original)).toBe(false)
  async function ingest(bytes: Buffer) {
    const ids = importer.registerFiles('s', [{ name: 'guide.pdf', bytes }])
    expect(
      (
        await waitImport(
          repo,
          importer.apply((await importer.preview('s', ids, [])).previewId, 's').jobId,
        )
      ).status,
    ).toBe('succeeded')
  }
  await ingest(original)
  const image = repo.listSources().find((s) => s.label === 'guide.pdf' && s.locator.imageAssetId)!
  const draft = repo.saveDraft({
    scope: { kind: 'store', storeId: 's' },
    question: '长度',
    answer: '50 mm',
    sourceRefs: [{ sourceId: image.id, revision: image.revision }],
  })
  repo.publish({
    entryId: draft.id,
    expectedDraftRevision: draft.revision,
    expectedSourceRevisions: { [image.id]: image.revision },
  })
  await ingest(changed)
  expect(repo.getSource(image.id)?.revision).toBe(2)
  expect(repo.getSource(image.id)?.locator.imageAssetId).not.toBe(image.locator.imageAssetId)
  expect(repo.getEntry(draft.id)).toMatchObject({ status: 'stale', approved: null })
})
it('retires superseded duplicate image sources created before stable part identity', async () => {
  const { repo, importer } = setup()
  const red = importer.registerFiles('s', [{ name: 'chart.png', bytes: chart('red') }])
  await waitImport(
    repo,
    importer.apply((await importer.preview('s', red, [])).previewId, 's').jobId,
  )
  const source = repo.listSources().find((s) => s.label === 'chart.png')!
  const blue = repo.addAsset(chart('blue'), { name: 'chart.png', mimeType: 'image/png' })
  const duplicate = repo.saveSource({
    storeId: 's',
    kind: 'image',
    label: source.label,
    text: source.text,
    locator: { ...source.locator, assetId: blue.id, imageAssetId: blue.id },
    assetIds: [blue.id, blue.id],
  })
  const draft = repo.saveDraft({
    scope: { kind: 'store', storeId: 's' },
    question: '图示',
    answer: '旧版本',
    sourceRefs: [{ sourceId: duplicate.id, revision: 1 }],
  })
  repo.publish({
    entryId: draft.id,
    expectedDraftRevision: 1,
    expectedSourceRevisions: { [duplicate.id]: 1 },
  })
  const next = importer.registerFiles('s', [{ name: 'chart.png', bytes: chart('blue') }])
  await waitImport(
    repo,
    importer.apply((await importer.preview('s', next, [])).previewId, 's').jobId,
  )
  expect(repo.getSource(source.id)?.revision).toBe(2)
  expect(repo.getSource(duplicate.id)?.removed).toBe(true)
  expect(repo.getEntry(draft.id)?.approved).toBeNull()
  expect(() =>
    repo.saveDraft({
      scope: { kind: 'store', storeId: 's' },
      question: '旧',
      answer: '旧',
      sourceRefs: [{ sourceId: duplicate.id, revision: 2 }],
    }),
  ).toThrow(/移除/)
})

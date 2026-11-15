// @vitest-environment node
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { createKnowledgeRepository } from '../electron/knowledge'
import { createKnowledgeLearner } from '../electron/knowledge/learning'
import { estimateContextTokens } from '../electron/context-compression'
import type { KnowledgeModelPort } from '../electron/knowledge-runtime'
const cleanup: (() => void)[] = []
afterEach(() =>
  cleanup
    .splice(0)
    .reverse()
    .forEach((f) => f()),
)
function setup(complete: KnowledgeModelPort['complete']) {
  const directory = mkdtempSync(join(tmpdir(), 'knowledge-learn-'))
  cleanup.push(() => rmSync(directory, { recursive: true, force: true }))
  const repo = createKnowledgeRepository({ directory, workspaceId: 'w' })
  cleanup.push(() => repo.dispose())
  const c = repo.saveCanonical({ title: 'A' })
  const b = repo.bindProduct({ canonicalId: c.id, storeId: 's', productId: '1' })
  const learner = createKnowledgeLearner({
    repository: repo,
    assertActive() {},
    changed() {},
    model: { complete, vision: () => ({ supported: true, maxImages: 4, reason: '' }) },
  })
  cleanup.push(() => learner.dispose())
  return { repo, b, learner }
}
async function settled(repo: ReturnType<typeof createKnowledgeRepository>, id: string) {
  for (let i = 0; i < 100; i++) {
    const job = repo.getJob(id)!
    if (!['queued', 'running'].includes(job.status)) return job
    await new Promise((r) => setTimeout(r, 10))
  }
  throw Error('job did not settle')
}
it('requires an unchanged estimate and chunks every source within actual token budget', async () => {
  const requests: number[] = []
  const { repo, b, learner } = setup(async (input) => {
    requests.push(estimateContextTokens(input.messages))
    return '{"candidates":[]}'
  })
  const source = repo.saveSource({
    storeId: 's',
    bindingId: b.id,
    kind: 'document',
    label: '长资料',
    text: '纯棉50毫米\n'.repeat(5000),
  })
  await expect(learner.start('s', [b.id], [source.id], 'bad')).rejects.toThrow()
  const estimate = await learner.estimate('s', [b.id], [source.id])
  expect(estimate.estimatedTokens).toBeGreaterThan(10000)
  const { jobId } = await learner.start('s', [b.id], [source.id], estimate.estimateId)
  const job = await settled(repo, jobId)
  expect(job.status).toBe('succeeded')
  expect(requests.length).toBeGreaterThan(1)
  expect(Math.max(...requests)).toBeLessThanOrEqual(8192)
  expect(job.progress.completed).toBe(job.progress.total)
})
it('persists uncertain paid calls, bare resume refuses replay and explicit skip continues', async () => {
  let calls = 0
  const { repo, b, learner } = setup(async () => {
    calls++
    throw Error('connection lost after submission')
  })
  const source = repo.saveSource({
    storeId: 's',
    bindingId: b.id,
    kind: 'document',
    label: '资料',
    text: '纯棉',
  })
  const estimate = await learner.estimate('s', [b.id], [source.id])
  const { jobId } = await learner.start('s', [b.id], [source.id], estimate.estimateId)
  expect((await settled(repo, jobId)).status).toBe('needs-confirmation')
  await expect(learner.resume('s', jobId)).rejects.toThrow(/不确定/)
  expect(calls).toBe(1)
  await learner.resolveUncertain('s', jobId, 'skip')
  expect((await settled(repo, jobId)).status).toBe('succeeded')
  expect(calls).toBe(1)
})
it('saves grounded chat candidates to store drafts and rejects invented source IDs', async () => {
  let sourceId = ''
  const { repo, learner } = setup(async () =>
    JSON.stringify({
      candidates: [
        { question: '发货?', answer: '两天发货', evidence: '两天发货', sourceId, field: 'fact' },
      ],
    }),
  )
  const source = repo.saveSource({
    storeId: 's',
    kind: 'chat',
    label: '归档',
    text: '客服：两天发货',
    locator: { messageId: 'm1' },
  })
  sourceId = source.id
  const estimate = await learner.estimate('s', [], [source.id])
  const { jobId } = await learner.start('s', [], [source.id], estimate.estimateId)
  expect((await settled(repo, jobId)).status).toBe('succeeded')
  const entry = repo.listEntries({ storeId: 's' }).items[0]!
  expect(entry.draft.scope).toEqual({ kind: 'store', storeId: 's' })
  expect(entry.approved).toBeNull()
  expect(entry.draft.sourceRefs).toEqual([{ sourceId, revision: 1 }])
  sourceId = 'foreign'
  const second = await learner.estimate('s', [], [source.id])
  const run = await learner.start('s', [], [source.id], second.estimateId)
  expect((await settled(repo, run.jobId)).status).toBe('failed')
  expect(repo.listEntries({ storeId: 's' }).total).toBe(1)
})
it('keeps a submitted call uncertain across SQLite reopen and never writes a late result after disposal', async () => {
  let release!: (value: string) => void
  const { repo, b, learner } = setup(
    () =>
      new Promise((resolve) => {
        release = resolve
      }),
  )
  const source = repo.saveSource({
    storeId: 's',
    bindingId: b.id,
    kind: 'document',
    label: '资料',
    text: '纯棉',
  })
  const estimate = await learner.estimate('s', [b.id], [source.id])
  const { jobId } = await learner.start('s', [b.id], [source.id], estimate.estimateId)
  for (let i = 0; i < 50 && !release; i++) await new Promise((r) => setTimeout(r, 5))
  expect(repo.getJob(jobId)?.checkpoint.state).toBe('submitted')
  learner.dispose()
  const directory = repo.directory
  repo.dispose()
  const reopened = createKnowledgeRepository({ directory, workspaceId: 'new' })
  cleanup.push(() => reopened.dispose())
  const restarted = createKnowledgeLearner({
    repository: reopened,
    assertActive() {},
    changed() {},
    model: {
      vision: () => ({ supported: true, maxImages: 4, reason: '' }),
      complete: async () => {
        throw Error('must not replay')
      },
    },
  })
  cleanup.push(() => restarted.dispose())
  expect(reopened.getJob(jobId)?.status).toBe('needs-confirmation')
  await expect(restarted.resume('s', jobId)).rejects.toThrow(/不确定/)
  release(
    JSON.stringify({
      candidates: [
        { question: '材质', answer: '纯棉', evidence: '纯棉', sourceId: source.id, field: 'fact' },
      ],
    }),
  )
  await new Promise((r) => setTimeout(r, 10))
  expect(reopened.listEntries({ storeId: 's' }).total).toBe(0)
})
it('pins model capabilities and source revisions before paid start', async () => {
  const { repo, b, learner } = setup(async () => {
    throw Error('must not call')
  })
  const source = repo.saveSource({
    storeId: 's',
    bindingId: b.id,
    kind: 'document',
    label: '资料',
    text: '纯棉',
  })
  const estimate = await learner.estimate('s', [b.id], [source.id])
  repo.saveSource({
    id: source.id,
    expectedRevision: 1,
    storeId: 's',
    bindingId: b.id,
    kind: 'document',
    label: '资料',
    text: '羊毛',
  })
  await expect(learner.start('s', [b.id], [source.id], estimate.estimateId)).rejects.toThrow(/变化/)
  expect(repo.listJobs().total).toBe(0)
})
it('uses capture-time expiry for dynamic SKU drafts and excludes raw platform price from shared facts', async () => {
  let sourceId = ''
  const { repo, b, learner } = setup(async () =>
    JSON.stringify({
      candidates: [
        { question: '价格', answer: '19.90', evidence: '19.90', sourceId, field: 'price' },
      ],
    }),
  )
  const source = repo.saveSource({
    storeId: 's',
    bindingId: b.id,
    kind: 'platform',
    label: '平台动态快照',
    text: JSON.stringify({ price: '19.90', capturedAt: 1000 }),
  })
  sourceId = source.id
  repo.saveSource({
    storeId: 's',
    bindingId: b.id,
    kind: 'platform',
    label: '平台完整原始快照',
    text: '19.90',
  })
  const estimate = await learner.estimate(
    's',
    [b.id],
    repo.listSources().map((s) => s.id),
  )
  const { jobId } = await learner.start(
    's',
    [b.id],
    repo.listSources().map((s) => s.id),
    estimate.estimateId,
  )
  expect((await settled(repo, jobId)).status).toBe('succeeded')
  const draft = repo.listEntries({ storeId: 's' }).items[0]!.draft
  expect(draft.scope).toEqual({ kind: 'binding', bindingId: b.id })
  expect(draft.expiresAt).toBe(3601000)
  expect(() =>
    repo.publish({
      entryId: draft.id,
      expectedDraftRevision: draft.revision,
      expectedSourceRevisions: { [source.id]: 1 },
    }),
  ).toThrow(/过期/)
})
it('reuses received responses on manual continuation after a write failure, without another paid call', async () => {
  let calls = 0,
    sourceId = ''
  const { repo, b, learner } = setup(async () => {
    calls++
    return JSON.stringify({
      candidates: [{ sourceId, question: '材质', answer: '纯棉', evidence: '纯棉', field: 'fact' }],
    })
  })
  const source = repo.saveSource({
    storeId: 's',
    bindingId: b.id,
    kind: 'document',
    label: '资料',
    text: '纯棉',
  })
  sourceId = source.id
  const save = repo.saveDraft.bind(repo)
  let fail = true
  repo.saveDraft = (input) => {
    if (fail) {
      fail = false
      throw Error('isolated write failure')
    }
    return save(input)
  }
  const estimate = await learner.estimate('s', [b.id], [source.id])
  const { jobId } = await learner.start('s', [b.id], [source.id], estimate.estimateId)
  expect((await settled(repo, jobId)).status).toBe('failed')
  expect(repo.getJob(jobId)?.checkpoint.state).toBe('received')
  await learner.resume('s', jobId)
  expect((await settled(repo, jobId)).status).toBe('succeeded')
  expect(calls).toBe(1)
  expect(repo.listEntries({ storeId: 's' }).total).toBe(1)
})
it('explicit uncertain retry makes exactly one new call and does not publish', async () => {
  let calls = 0
  const { repo, b, learner } = setup(async () => {
    if (++calls === 1) throw Error('uncertain')
    return '{"candidates":[]}'
  })
  const source = repo.saveSource({
    storeId: 's',
    bindingId: b.id,
    kind: 'document',
    label: '资料',
    text: '纯棉',
  })
  const estimate = await learner.estimate('s', [b.id], [source.id])
  const { jobId } = await learner.start('s', [b.id], [source.id], estimate.estimateId)
  await settled(repo, jobId)
  await learner.resolveUncertain('s', jobId, 'retry')
  expect((await settled(repo, jobId)).status).toBe('succeeded')
  expect(calls).toBe(2)
})
it('accepts more than1000 parsed document locations without truncating the learning selection', async () => {
  const { knowledgePipelineInputSchema } = await import(
    '../src/shared/contracts/knowledge-pipeline'
  )
  const sourceIds = Array.from({ length: 1001 }, (_, i) => `source-${i}`)
  expect(
    knowledgePipelineInputSchema.parse({
      action: 'estimate',
      storeId: 's',
      bindingIds: [],
      sourceIds,
    }),
  ).toMatchObject({ sourceIds })
})

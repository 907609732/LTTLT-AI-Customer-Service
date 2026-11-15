// @vitest-environment node
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
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
function setup(
  complete: KnowledgeModelPort['complete'],
  ocrText?: Parameters<typeof createKnowledgeLearner>[0]['ocrText'],
  minimumIntervalMs = 0,
) {
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
    model: {
      complete,
      vision: () => ({ supported: true, maxImages: 4, reason: '' }),
      minimumIntervalMs: () => minimumIntervalMs,
    },
    ocrText,
  })
  cleanup.push(() => learner.dispose())
  return { repo, b, learner }
}
it('adds cached OCR as untrusted context alongside actual image pixels without changing the system rules', async () => {
  let calls = 0
  const { repo, b, learner } = setup(
    async (input) => {
      calls++
      const content = input.messages[1]!.content
      expect(Array.isArray(content)).toBe(true)
      if (typeof content === 'string') throw Error('pixels missing')
      expect(
        content.some(
          (p) => p.type === 'image_url' && p.image_url.url.startsWith('data:image/png;base64,'),
        ),
      ).toBe(true)
      const metadata = content.find((p) => p.type === 'text')
      expect(metadata?.type === 'text' ? metadata.text : '').toContain('50 mm')
      expect(String(input.messages[0]!.content)).not.toContain('OCR测试文字')
      expect(String(input.messages[0]!.content)).toContain('最多1条')
      expect(String(input.messages[0]!.content)).toContain('"evidence":{"kind":"image-text"')
      expect(estimateContextTokens(input.messages)).toBeLessThanOrEqual(8192)
      return '{"candidates":[]}'
    },
    () => ({ text: '50 mm；OCR测试文字' }),
  )
  const canvas = createCanvas(100, 40),
    a = repo.addAsset(canvas.toBuffer('image/png'), { name: 'image', mimeType: 'image/png' })
  const s = repo.saveSource({
    storeId: 's',
    bindingId: b.id,
    kind: 'image',
    label: '参数图',
    text: '',
    assetIds: [a.id],
  })
  const e = await learner.estimate('s', [b.id], [s.id])
  const j = await learner.start('s', [b.id], [s.id], e.estimateId)
  expect((await settled(repo, j.jobId)).status).toBe('succeeded')
  expect(calls).toBe(1)
  expect(repo.listEntries({ storeId: 's' }).total).toBe(0)
})
async function settled(repo: ReturnType<typeof createKnowledgeRepository>, id: string) {
  for (let i = 0; i < 100; i++) {
    const job = repo.getJob(id)!
    if (!['queued', 'running'].includes(job.status)) return job
    await new Promise((r) => setTimeout(r, 10))
  }
  throw Error('job did not settle')
}
it('paces requests before submission and cancels an unpaid wait without another model call', async () => {
  vi.useFakeTimers()
  try {
    let calls = 0
    const { repo, b, learner } = setup(
      async () => {
        calls++
        return '{"candidates":[]}'
      },
      undefined,
      5000,
    )
    const sources = ['一', '二'].map((text) =>
      repo.saveSource({ storeId: 's', bindingId: b.id, kind: 'document', label: text, text }),
    )
    const ids = sources.map((s) => s.id),
      e = await learner.estimate('s', [b.id], ids),
      j = await learner.start('s', [b.id], ids, e.estimateId)
    await vi.advanceTimersByTimeAsync(1)
    expect(calls).toBe(1)
    expect(repo.getJob(j.jobId)?.checkpoint.state).toBe('ready')
    await vi.advanceTimersByTimeAsync(4990)
    expect(calls).toBe(1)
    learner.pause('s', j.jobId)
    await vi.advanceTimersByTimeAsync(20)
    expect(calls).toBe(1)
    expect(repo.getJob(j.jobId)?.status).toBe('paused')
  } finally {
    vi.useRealTimers()
  }
})
it('retries only a received failed fragment, preserving its response and earlier successful calls', async () => {
  let calls = 0
  const { repo, b, learner } = setup(async () => {
    calls++
    return calls === 2 ? 'truncated' : '{"candidates":[]}'
  })
  const ids = ['一', '二'].map(
    (text) =>
      repo.saveSource({ storeId: 's', bindingId: b.id, kind: 'document', label: text, text }).id,
  )
  const e = await learner.estimate('s', [b.id], ids),
    j = await learner.start('s', [b.id], ids, e.estimateId)
  const failed = await settled(repo, j.jobId)
  expect(failed.progress.completed).toBe(1)
  await learner.retryReceived('s', j.jobId)
  expect(
    JSON.parse(repo.getMetadata(`learning-rejected-response:${j.jobId}:1:${failed.revision}`)!),
  ).toEqual({ response: 'truncated', error: failed.error })
  expect((await settled(repo, j.jobId)).status).toBe('succeeded')
  expect(calls).toBe(3)
  await expect(learner.retryReceived('s', j.jobId)).rejects.toThrow()
  const foreign = repo.createJob({ kind: 'learn', storeId: 'other', payload: {} })
  await expect(learner.retryReceived('s', foreign.id)).rejects.toThrow('本店')
})
it.each(['failed', 'cancelled', 'succeeded'] as const)(
  'rejects received-fragment regeneration for %s without a received failed result',
  async (status) => {
    let calls = 0
    const { repo, learner } = setup(async () => {
      calls++
      return '{"candidates":[]}'
    })
    const j = repo.createJob({ kind: 'learn', storeId: 's', payload: {} })
    const job = repo.updateJob(j.id, {
      expectedRevision: j.revision,
      status,
      checkpoint: { state: status === 'failed' ? 'submitted' : 'received', response: '{}' },
    })
    await expect(learner.retryReceived('s', j.id)).rejects.toThrow()
    expect(calls).toBe(0)
    expect(repo.getJob(j.id)).toEqual(job)
  },
)
it('accepts a single complete JSON code fence while rejecting surrounding prose', async () => {
  for (const [response, status] of [
    ['[]', 'succeeded'],
    ['```json\n{"candidates":[]}\n```', 'succeeded'],
    ['说明\n```json\n{"candidates":[]}\n```', 'failed'],
  ]) {
    const { repo, b, learner } = setup(async () => response!)
    const s = repo.saveSource({
      storeId: 's',
      bindingId: b.id,
      kind: 'document',
      label: '资料',
      text: '纯棉',
    })
    const e = await learner.estimate('s', [b.id], [s.id])
    const j = await learner.start('s', [b.id], [s.id], e.estimateId)
    expect((await settled(repo, j.jobId)).status).toBe(status)
  }
})
it('keeps grounded candidates and reports rejected evidence without saving invented answers', async () => {
  let sourceId = ''
  const { repo, b, learner } = setup(async () =>
    JSON.stringify({
      candidates: [
        { sourceId, question: '材质', answer: '纯棉', evidence: '纯棉', field: 'fact' },
        { sourceId, question: '规格', answer: '大号、小号', evidence: '大号、小号', field: 'fact' },
      ],
    }),
  )
  sourceId = repo.saveSource({
    storeId: 's',
    bindingId: b.id,
    kind: 'document',
    label: '原料',
    text: '纯棉；大号；小号',
  }).id
  const e = await learner.estimate('s', [b.id], [sourceId])
  const j = await learner.start('s', [b.id], [sourceId], e.estimateId)
  const result = await settled(repo, j.jobId)
  expect(result.status).toBe('succeeded')
  expect(result.error).toContain('1条无有效依据')
  expect(repo.listEntries({ storeId: 's' }).items.map((x) => x.draft.answer)).toEqual(['纯棉'])
})
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
it.each(['retry', 'skip'] as const)(
  'does not revive a cancelled submitted call through %s',
  async (decision) => {
    let calls = 0
    const { repo, b, learner } = setup(async () => {
      calls++
      throw Error('uncertain')
    })
    const source = repo.saveSource({
      storeId: 's',
      bindingId: b.id,
      kind: 'document',
      label: 'long',
      text: '纯棉50毫米\n'.repeat(600),
    })
    const estimate = await learner.estimate('s', [b.id], [source.id])
    const { jobId } = await learner.start('s', [b.id], [source.id], estimate.estimateId)
    expect((await settled(repo, jobId)).status).toBe('needs-confirmation')
    learner.cancel('s', jobId)
    const cancelled = repo.getJob(jobId)
    await expect(learner.resolveUncertain('s', jobId, decision)).rejects.toThrow(/不能|终止/)
    await new Promise((r) => setTimeout(r, 20))
    expect(repo.getJob(jobId)).toEqual(cancelled)
    expect(calls).toBe(1)
  },
)
import { createCanvas } from '@napi-rs/canvas'
it('accepts only owned image provenance for a non-text arrow relationship and retains review evidence', async () => {
  let mode = 'valid'
  const prompts: string[] = []
  const { repo, b, learner } = setup(async (input) => {
    prompts.push(String(input.messages[0]!.content))
    const content = input.messages[1]!.content
    if (typeof content === 'string' || content[0]?.type !== 'text')
      throw Error('missing image metadata')
    const metadata = JSON.parse(content[0].text) as {
      sourceId: string
      images?: { imageAssetId: string; locator: { page?: number; image?: number; tile?: number } }[]
    }
    const image = metadata.images?.[0]
    const evidence = {
      kind: 'visual-relationship',
      imageAssetId: image?.imageAssetId ?? asset.id,
      locator: image?.locator ?? { page: 2, tile: 3 },
      relation: 'arrow-to',
      from: '左侧圆形',
      to: '右侧方框',
      observation: '左侧圆形有箭头指向右侧方框',
    }
    if (mode === 'foreign') evidence.imageAssetId = 'foreign-image'
    if (mode === 'wrong-page') evidence.locator = { ...evidence.locator, page: 99 }
    if (mode === 'inference') Object.assign(evidence, { relation: 'causes' })
    return JSON.stringify({
      candidates: [
        {
          sourceId: metadata.sourceId,
          question: '图中如何连接？',
          answer: mode === 'invented-answer' ? '用于高压供电' : evidence.observation,
          evidence: mode === 'bare-ocr' ? '箭头' : evidence,
          field: 'fact',
        },
      ],
    })
  })
  const canvas = createCanvas(100, 40),
    ctx = canvas.getContext('2d')
  ctx.strokeStyle = 'black'
  ctx.beginPath()
  ctx.arc(15, 20, 10, 0, Math.PI * 2)
  ctx.stroke()
  ctx.strokeRect(75, 10, 20, 20)
  ctx.beginPath()
  ctx.moveTo(25, 20)
  ctx.lineTo(70, 20)
  ctx.lineTo(62, 14)
  ctx.moveTo(70, 20)
  ctx.lineTo(62, 26)
  ctx.stroke()
  const asset = repo.addAsset(canvas.toBuffer('image/png'), {
    name: 'diagram.png',
    mimeType: 'image/png',
  })
  const source = repo.saveSource({
    storeId: 's',
    bindingId: b.id,
    kind: 'image',
    label: 'diagram',
    text: '',
    locator: { imageAssetId: asset.id, page: 2, tile: 3 },
    assetIds: [asset.id],
  })
  async function run() {
    const estimate = await learner.estimate('s', [b.id], [source.id])
    return settled(repo, (await learner.start('s', [b.id], [source.id], estimate.estimateId)).jobId)
  }
  expect((await run()).status).toBe('succeeded')
  expect(prompts[0]).toContain('空间')
  expect(prompts[0]).toContain('人工复核')
  expect(repo.listEntries({ storeId: 's' }).items[0]).toMatchObject({
    approved: null,
    draft: {
      modelEvidence: {
        kind: 'visual-relationship',
        locator: { page: 2, tile: 3 },
        relation: 'arrow-to',
      },
      answer: '左侧圆形有箭头指向右侧方框',
    },
  })
  for (mode of ['foreign', 'wrong-page', 'inference', 'invented-answer', 'bare-ocr'])
    expect((await run()).status).toBe('failed')
  expect(repo.listEntries({ storeId: 's' }).total).toBe(1)
  const entry = repo.listEntries({ storeId: 's' }).items[0]!
  learner.dispose()
  const directory = repo.directory
  repo.dispose()
  const reopened = createKnowledgeRepository({ directory, workspaceId: 'reopened' })
  cleanup.push(() => reopened.dispose())
  expect(reopened.getEntry(entry.id)?.draft.modelEvidence).toEqual(entry.draft.modelEvidence)
  expect(reopened.entryVersions(entry.id)[0]?.version.modelEvidence).toEqual(
    entry.draft.modelEvidence,
  )
})
it('keeps text grounding strict when visual relationship evidence is supplied without image bytes', async () => {
  let sourceId = ''
  const { repo, learner } = setup(async () =>
    JSON.stringify({
      candidates: [
        {
          sourceId,
          question: '连接',
          answer: '圆形连接方框',
          evidence: {
            kind: 'visual-relationship',
            imageAssetId: 'fake',
            locator: { tile: 1 },
            relation: 'connected-to',
            from: '圆形',
            to: '方框',
            observation: '圆形连接方框',
          },
        },
      ],
    }),
  )
  sourceId = repo.saveSource({ storeId: 's', kind: 'document', label: 'text', text: '纯棉' }).id
  const estimate = await learner.estimate('s', [], [sourceId])
  expect(
    (await settled(repo, (await learner.start('s', [], [sourceId], estimate.estimateId)).jobId))
      .status,
  ).toBe('failed')
  expect(repo.listEntries({ storeId: 's' }).total).toBe(0)
})
it.each(['retry', 'skip'] as const)(
  'rejects %s for a succeeded job even if an old submitted checkpoint remains',
  async (decision) => {
    let calls = 0
    const { repo, learner } = setup(async () => {
      calls++
      return '{"candidates":[]}'
    })
    const job = repo.createJob({ storeId: 's', kind: 'learn', payload: {} })
    const terminal = repo.updateJob(job.id, {
      expectedRevision: job.revision,
      status: 'succeeded',
      checkpoint: { state: 'submitted' },
    })
    await expect(learner.resolveUncertain('s', job.id, decision)).rejects.toThrow(/不能/)
    expect(repo.getJob(job.id)).toEqual(terminal)
    expect(calls).toBe(0)
  },
)
it('accepts image OCR with owned provenance but rejects extra answers and dynamic promises', async () => {
  let mode = 'valid'
  const { repo, learner } = setup(async (input) => {
    const content = input.messages[1]!.content
    if (typeof content === 'string' || content[0]?.type !== 'text') throw Error('missing metadata')
    const data = JSON.parse(content[0].text) as {
      sourceId: string
      images: { imageAssetId: string; locator: { image: number; tile: number } }[]
    }
    return JSON.stringify({
      candidates: [
        {
          sourceId: mode === 'missing-source' ? undefined : data.sourceId,
          question: '标注长度',
          answer: mode === 'extra' ? '50 mm，防水' : '50 mm',
          field: mode === 'dynamic' ? 'stock' : 'fact',
          evidence: {
            kind: 'image-text',
            ...data.images[0],
            quote: mode === 'subset' ? '01 50 mm' : '50 mm',
          },
        },
      ],
    })
  })
  const canvas = createCanvas(100, 40),
    ctx = canvas.getContext('2d')
  ctx.fillText('50 mm', 5, 20)
  const asset = repo.addAsset(canvas.toBuffer('image/png'), {
    name: 'label.png',
    mimeType: 'image/png',
  })
  const source = repo.saveSource({
    storeId: 's',
    kind: 'image',
    label: 'label',
    text: '',
    locator: { imageAssetId: asset.id, tile: 1 },
    assetIds: [asset.id],
  })
  async function run() {
    const estimate = await learner.estimate('s', [], [source.id])
    return settled(repo, (await learner.start('s', [], [source.id], estimate.estimateId)).jobId)
  }
  expect((await run()).status).toBe('succeeded')
  expect(repo.listEntries({ storeId: 's' }).items[0]?.draft.modelEvidence?.kind).toBe('image-text')
  mode = 'missing-source'
  expect((await run()).status).toBe('succeeded')
  mode = 'subset'
  expect((await run()).status).toBe('succeeded')
  expect(repo.listEntries({ storeId: 's' }).items.some((x) => x.draft.answer === '01 50 mm')).toBe(
    true,
  )
  for (mode of ['extra', 'dynamic']) expect((await run()).status).toBe('failed')
  expect(repo.listEntries({ storeId: 's' }).total).toBe(2)
})

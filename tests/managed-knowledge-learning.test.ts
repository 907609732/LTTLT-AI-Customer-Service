// @vitest-environment node
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createCanvas } from '@napi-rs/canvas'
import { afterEach, expect, it, vi } from 'vitest'
import { createKnowledgeRepository } from '../electron/knowledge'
import { createKnowledgeLearner } from '../electron/knowledge/learning'
import type { KnowledgeLearningSource, KnowledgeModelPort } from '../electron/knowledge-runtime'
import {
  createManagedLearningPort,
  type ManagedLearningPolicyApproval,
} from '../electron/managed-learning'
import type { KnowledgeSourceInput } from '../src/shared/contracts/knowledge'

const cleanup: (() => void)[] = []
afterEach(() =>
  cleanup
    .splice(0)
    .reverse()
    .forEach((f) => f()),
)

type Complete = KnowledgeModelPort['complete']
type Policy = (input: {
  learningSource: KnowledgeLearningSource
  withImages: boolean
  signal?: AbortSignal
}) => Promise<ManagedLearningPolicyApproval>

function fixture(
  options: {
    source?: Partial<KnowledgeSourceInput>
    platform?: string
    complete?: Complete
    policy?: Policy
    image?: { width: number; height: number }
  } = {},
) {
  const directory = mkdtempSync(join(tmpdir(), 'managed-knowledge-learning-'))
  cleanup.push(() => rmSync(directory, { recursive: true, force: true }))
  const repo = createKnowledgeRepository({ directory, workspaceId: 'managed-test' })
  cleanup.push(() => repo.dispose())
  const canonical = repo.saveCanonical({ title: '测试商品' })
  const binding = repo.bindProduct({
    canonicalId: canonical.id,
    storeId: 's',
    productId: 'p1',
  })
  const asset = options.image
    ? repo.addAsset(createCanvas(options.image.width, options.image.height).toBuffer('image/png'), {
        name: 'detail.png',
        mimeType: 'image/png',
      })
    : undefined
  const source = repo.saveSource({
    storeId: 's',
    bindingId: binding.id,
    kind: 'platform',
    label: asset ? '平台图片资料' : '平台静态资料',
    text: asset ? JSON.stringify({ images: [{ assetId: asset.id }] }) : '纯棉',
    locator: { url: 'https://mms.pinduoduo.com/goods/goods_add/index?goods_id=1' },
    ...(asset ? { assetIds: [asset.id] } : {}),
    ...options.source,
  })
  const baseComplete = vi.fn<Complete>(
    options.complete ??
      (async (input) => {
        if (input.purpose === 'learning') expect(input.isCurrent?.()).toBe(true)
        return '{"candidates":[]}'
      }),
  )
  const base: KnowledgeModelPort = {
    complete: baseComplete,
    vision: () => ({ supported: true, maxImages: 4, reason: '' }),
    identity: () => 'managed-test',
    minimumIntervalMs: () => 0,
  }
  const policy = vi.fn<Policy>(
    options.policy ??
      (async () => ({
        policyVersion: 7,
        maxTokens: 2048,
        maxCallsPerProduct: 20,
      })),
  )
  const assertReady = vi.fn()
  const port = createManagedLearningPort({
    base,
    repository: repo,
    platformForStore: () => options.platform ?? 'pdd-web',
    policy,
    assertReady,
  })
  const learner = createKnowledgeLearner({
    repository: repo,
    assertActive() {},
    changed() {},
    model: port,
  })
  cleanup.push(() => learner.dispose())
  return {
    repo,
    canonical,
    binding,
    source,
    baseComplete,
    policy,
    assertReady,
    port,
    learner,
  }
}

async function settled(repo: ReturnType<typeof createKnowledgeRepository>, id: string) {
  for (let i = 0; i < 100; i++) {
    const job = repo.getJob(id)!
    if (!['queued', 'running'].includes(job.status)) return job
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw Error('job did not settle')
}

it('derives typed text metadata and accepts normal plus empty candidates', async () => {
  let withCandidate = true
  const f = fixture({
    complete: async (input) => {
      expect(input.isCurrent?.()).toBe(true)
      expect(input).toMatchObject({
        purpose: 'learning',
        policyVersion: 7,
        learningSource: 'pdd_detail_text',
        maxTokens: 2048,
      })
      expect(input).not.toHaveProperty('purposeVersion')
      expect(input).not.toHaveProperty('learning')
      const content = input.messages[1]?.content
      if (typeof content === 'string' || content?.[0]?.type !== 'text')
        throw Error('missing source metadata')
      const sourceId = (JSON.parse(content[0].text) as { sourceId: string }).sourceId
      return withCandidate
        ? JSON.stringify({
            candidates: [
              {
                sourceId,
                question: '材质',
                answer: '纯棉',
                evidence: '纯棉',
                field: 'fact',
              },
            ],
          })
        : '{"candidates":[]}'
    },
  })
  const estimate = await f.learner.estimate('s', [f.binding.id], [f.source.id])
  const first = await f.learner.start('s', [f.binding.id], [f.source.id], estimate.estimateId)
  expect((await settled(f.repo, first.jobId)).status).toBe('succeeded')
  expect(f.repo.listEntries({ storeId: 's' }).items[0]?.draft.answer).toBe('纯棉')

  withCandidate = false
  const secondEstimate = await f.learner.estimate('s', [f.binding.id], [f.source.id])
  const second = await f.learner.start(
    's',
    [f.binding.id],
    [f.source.id],
    secondEstimate.estimateId,
  )
  expect((await settled(f.repo, second.jobId)).status).toBe('succeeded')
  expect(f.baseComplete).toHaveBeenCalledTimes(2)
  expect(f.policy).toHaveBeenCalledWith(
    expect.objectContaining({ learningSource: 'pdd_detail_text', withImages: false }),
  )
})

it('uses pdd_detail_image only for collector-owned image material and submits before the paid call', async () => {
  const sequence: string[] = []
  const f = fixture({
    source: {
      kind: 'platform',
      label: '平台图片资料',
      text: '',
      assetIds: [],
    },
    complete: async (input) => {
      // The real vendor managed transport checks isCurrent after its account
      // queue and immediately before the paid request.
      expect(input.isCurrent?.()).toBe(true)
      sequence.push('base')
      expect(input).toMatchObject({
        purpose: 'learning',
        policyVersion: 7,
        learningSource: 'pdd_detail_image',
        maxTokens: 2048,
      })
      return '{"candidates":[]}'
    },
  })
  const approved = await f.port.prepareLearning!({
    sourceId: f.source.id,
    withImages: true,
  })
  expect(approved.maxTokens).toBe(2048)
  await f.port.complete({
    messages: [{ role: 'user', content: '识别图片' }],
    learning: {
      sourceId: f.source.id,
      withImages: true,
      beforeSubmit: () => sequence.push('submitted'),
    },
  })
  expect(sequence).toEqual(['submitted', 'base'])
  expect(f.assertReady).toHaveBeenCalled()
})

it.each([
  [
    'non-platform document',
    { kind: 'document' as const, label: '普通资料' },
    'pdd-web',
    /不是拼多多商品详情采集来源/,
  ],
  ['other platform', {}, 'other-web', /不是拼多多店铺/],
  ['unknown collector label', { label: '平台采集范围' }, 'pdd-web', /语义不一致/],
  [
    'untrusted URL',
    { locator: { url: 'https://mms.pinduoduo.com.evil.test/details' } },
    'pdd-web',
    /不是可信的拼多多采集地址/,
  ],
])('rejects %s before policy or a paid request', async (_name, source, platform, message) => {
  const f = fixture({ source, platform })
  await expect(
    f.port.prepareLearning!({ sourceId: f.source.id, withImages: false }),
  ).rejects.toThrow(message)
  expect(f.policy).not.toHaveBeenCalled()
  expect(f.baseComplete).not.toHaveBeenCalled()
})

it('honours cancellation and account readiness before submitting or calling the model', async () => {
  let entered!: () => void
  const policyEntered = new Promise<void>((resolve) => {
    entered = resolve
  })
  const f = fixture({
    policy: ({ signal }) =>
      new Promise((_resolve, reject) => {
        entered()
        signal?.addEventListener('abort', () => reject(Error('托管策略请求已取消')), { once: true })
      }),
  })
  const beforeSubmit = vi.fn()
  const controller = new AbortController()
  const pending = f.port.complete({
    messages: [{ role: 'user', content: '学习' }],
    signal: controller.signal,
    learning: {
      sourceId: f.source.id,
      withImages: false,
      beforeSubmit,
    },
  })
  await policyEntered
  controller.abort()
  await expect(pending).rejects.toThrow(/取消/)
  expect(beforeSubmit).not.toHaveBeenCalled()
  expect(f.baseComplete).not.toHaveBeenCalled()

  f.policy.mockResolvedValueOnce({
    policyVersion: 7,
    maxTokens: 2048,
    maxCallsPerProduct: 20,
  })
  f.assertReady.mockImplementationOnce(() => {
    throw Error('托管账号已切换')
  })
  await expect(
    f.port.complete({
      messages: [{ role: 'user', content: '学习' }],
      learning: {
        sourceId: f.source.id,
        withImages: false,
        beforeSubmit,
      },
    }),
  ).rejects.toThrow(/账号已切换/)
  expect(beforeSubmit).not.toHaveBeenCalled()
  expect(f.baseComplete).not.toHaveBeenCalled()
})

it('does not submit or chat when a persistent managed pause is already present', async () => {
  let paid = 0
  const f = fixture({
    complete: async (input) => {
      if (input.isCurrent?.()) paid++
      return '{"candidates":[]}'
    },
  })
  f.assertReady.mockImplementation(() => {
    throw Error('当前托管 AI 存在持久暂停提示；学习请求未发送')
  })
  const estimate = await f.learner.estimate('s', [f.binding.id], [f.source.id])
  const job = await f.learner.start('s', [f.binding.id], [f.source.id], estimate.estimateId)
  const result = await settled(f.repo, job.jobId)
  expect(result.status).toBe('failed')
  expect(result.checkpoint.state).toBe('ready')
  expect(result.error).toMatch(/持久暂停/)
  expect(paid).toBe(0)
})

it('does not submit when a learning job is paused while queued for the shared managed slot', async () => {
  let entered!: () => void
  const queueEntered = new Promise<void>((resolve) => {
    entered = resolve
  })
  let release!: () => void
  const queueGate = new Promise<void>((resolve) => {
    release = resolve
  })
  let paid = 0
  const f = fixture({
    complete: async (input) => {
      entered()
      await queueGate
      if (input.isCurrent?.()) paid++
      throw Object.assign(Error('排队任务已取消'), { code: 'queued_canceled' })
    },
  })
  const estimate = await f.learner.estimate('s', [f.binding.id], [f.source.id])
  const job = await f.learner.start('s', [f.binding.id], [f.source.id], estimate.estimateId)
  await queueEntered
  f.learner.pause('s', job.jobId)
  release()
  const result = await settled(f.repo, job.jobId)
  expect(result.status).toBe('paused')
  expect(result.checkpoint.state).toBe('ready')
  expect(paid).toBe(0)
})

it('does not submit while the managed queue is cancelled before the paid call', async () => {
  let entered!: () => void
  const queueEntered = new Promise<void>((resolve) => {
    entered = resolve
  })
  let release!: () => void
  const queueGate = new Promise<void>((resolve) => {
    release = resolve
  })
  const f = fixture({
    complete: async (input) => {
      entered()
      await queueGate
      expect(input.isCurrent?.()).toBe(false)
      throw Object.assign(Error('排队任务已取消'), { code: 'queued_canceled' })
    },
  })
  const beforeSubmit = vi.fn()
  const controller = new AbortController()
  const pending = f.port.complete({
    messages: [{ role: 'user', content: '学习' }],
    signal: controller.signal,
    learning: {
      sourceId: f.source.id,
      withImages: false,
      beforeSubmit,
    },
  })
  await queueEntered
  controller.abort()
  release()
  await expect(pending).rejects.toThrow(/取消/)
  expect(beforeSubmit).not.toHaveBeenCalled()
})

it('rejects an image declaration for text material before the request', async () => {
  const f = fixture()
  await expect(
    f.port.complete({
      messages: [{ role: 'user', content: '识别图片' }],
      learning: {
        sourceId: f.source.id,
        withImages: true,
        beforeSubmit: vi.fn(),
      },
    }),
  ).rejects.toThrow(/语义不一致/)
  expect(f.policy).not.toHaveBeenCalled()
  expect(f.baseComplete).not.toHaveBeenCalled()
})

it('leaves the estimate reusable when managed preflight fails before consuming it', async () => {
  let fail = true
  const f = fixture({
    policy: async () => {
      if (fail) throw Error('当前托管服务未提供可校验的商品详情学习策略；未发送学习请求')
      return { policyVersion: 7, maxTokens: 2048, maxCallsPerProduct: 20 }
    },
  })
  const estimate = await f.learner.estimate('s', [f.binding.id], [f.source.id])
  await expect(
    f.learner.start('s', [f.binding.id], [f.source.id], estimate.estimateId),
  ).rejects.toThrow(/未提供/)
  expect(f.repo.listJobs().total).toBe(0)
  fail = false
  const job = await f.learner.start('s', [f.binding.id], [f.source.id], estimate.estimateId)
  expect((await settled(f.repo, job.jobId)).status).toBe('succeeded')
  expect(f.repo.listJobs().total).toBe(1)
})

it('fails before creating a job when the managed learning policy is unavailable', async () => {
  const f = fixture({
    policy: async () => {
      throw Error('当前托管服务未提供可校验的商品详情学习策略；未发送学习请求')
    },
  })
  const estimate = await f.learner.estimate('s', [f.binding.id], [f.source.id])
  await expect(
    f.learner.start('s', [f.binding.id], [f.source.id], estimate.estimateId),
  ).rejects.toThrow(/未提供.*学习策略/)
  expect(f.repo.listJobs().total).toBe(0)
  expect(f.baseComplete).not.toHaveBeenCalled()
})

it('leaves a pre-submit policy failure failed with a ready checkpoint, not uncertain', async () => {
  const policy = vi
    .fn<Policy>()
    .mockResolvedValueOnce({
      policyVersion: 7,
      maxTokens: 2048,
      maxCallsPerProduct: 20,
    })
    .mockRejectedValueOnce(Error('当前学习策略未允许该商品详情来源；学习请求未发送'))
  const f = fixture({ policy })
  const estimate = await f.learner.estimate('s', [f.binding.id], [f.source.id])
  const job = await f.learner.start('s', [f.binding.id], [f.source.id], estimate.estimateId)
  const result = await settled(f.repo, job.jobId)
  expect(result.status).toBe('failed')
  expect(result.checkpoint.state).toBe('ready')
  expect(result.error).toContain('未发送')
  expect(f.baseComplete).not.toHaveBeenCalled()
})

it('treats a managed port that returns without the submit hook as uncertain', async () => {
  const f = fixture({
    complete: async () => '{"candidates":[]}',
  })
  const estimate = await f.learner.estimate('s', [f.binding.id], [f.source.id])
  const job = await f.learner.start('s', [f.binding.id], [f.source.id], estimate.estimateId)
  const result = await settled(f.repo, job.jobId)
  expect(result.status).toBe('needs-confirmation')
  expect(result.error).toMatch(/未在付费调用前确认提交/)
  expect(result.checkpoint.state).toBe('submitted')
})

it('records a known pre-admission rejection as failed rather than possibly charged', async () => {
  const f = fixture({
    complete: async () => {
      throw Object.assign(Error('当前学习策略未启用'), {
        code: 'learning_disabled',
      })
    },
  })
  const estimate = await f.learner.estimate('s', [f.binding.id], [f.source.id])
  const job = await f.learner.start('s', [f.binding.id], [f.source.id], estimate.estimateId)
  const result = await settled(f.repo, job.jobId)
  expect(result.status).toBe('failed')
  expect(result.checkpoint.state).toBe('ready')
  expect(result.error).toContain('计费前')
  expect(result.error).not.toContain('可能已计费')
})

it('rejects a product that exceeds the current call cap across text segments', async () => {
  const f = fixture({
    policy: async () => ({
      policyVersion: 7,
      maxTokens: 2048,
      maxCallsPerProduct: 1,
    }),
  })
  const source = f.repo.saveSource({
    storeId: 's',
    bindingId: f.binding.id,
    kind: 'platform',
    label: '平台静态资料',
    text: 'a'.repeat(4200),
    locator: { url: 'https://mms.pinduoduo.com/goods/goods_add/index?goods_id=1' },
  })
  const estimate = await f.learner.estimate('s', [f.binding.id], [source.id])
  await expect(
    f.learner.start('s', [f.binding.id], [source.id], estimate.estimateId),
  ).rejects.toThrow(/p1.*超过当前策略上限 1/)
  expect(f.repo.listJobs().total).toBe(0)
  expect(f.baseComplete).not.toHaveBeenCalled()
})

it('rechecks the product cap at the submit boundary when policy changes', async () => {
  let policyCalls = 0
  let chat = 0
  const f = fixture({
    policy: async () => ({
      policyVersion: 7,
      maxTokens: 2048,
      maxCallsPerProduct: ++policyCalls === 1 ? 20 : 1,
    }),
    complete: async (input) => {
      if (input.isCurrent?.()) chat++
      return '{"candidates":[]}'
    },
  })
  const source = f.repo.saveSource({
    storeId: 's',
    bindingId: f.binding.id,
    kind: 'platform',
    label: '平台静态资料',
    text: 'a'.repeat(4200),
    locator: { url: 'https://mms.pinduoduo.com/goods/goods_add/index?goods_id=1' },
  })
  const estimate = await f.learner.estimate('s', [f.binding.id], [source.id])
  const job = await f.learner.start('s', [f.binding.id], [source.id], estimate.estimateId)
  const result = await settled(f.repo, job.jobId)
  expect(result.status).toBe('failed')
  expect(result.checkpoint.state).toBe('ready')
  expect(result.error).toMatch(/p1.*超过当前策略上限 1/)
  expect(chat).toBe(0)
})

it('counts root and SKU bindings of the same product together against the cap', async () => {
  const f = fixture({
    policy: async () => ({
      policyVersion: 7,
      maxTokens: 2048,
      maxCallsPerProduct: 1,
    }),
  })
  const sku = f.repo.bindProduct({
    canonicalId: f.canonical.id,
    storeId: 's',
    productId: 'p1',
    skuId: 'sku-1',
  })
  const skuSource = f.repo.saveSource({
    storeId: 's',
    bindingId: sku.id,
    kind: 'platform',
    label: '平台动态快照',
    text: JSON.stringify({ price: '19.90', stock: 20, capturedAt: Date.now() }),
    locator: { url: 'https://mms.pinduoduo.com/goods/goods_add/index?goods_id=1' },
  })
  const estimate = await f.learner.estimate(
    's',
    [f.binding.id, sku.id],
    [f.source.id, skuSource.id],
  )
  await expect(
    f.learner.start('s', [f.binding.id, sku.id], [f.source.id, skuSource.id], estimate.estimateId),
  ).rejects.toThrow(/p1.*超过当前策略上限 1/)
  expect(f.repo.listJobs().total).toBe(0)
  expect(f.baseComplete).not.toHaveBeenCalled()
})

it('counts every image tile against the product cap before creating a job', async () => {
  const f = fixture({
    image: { width: 1500, height: 10 },
    policy: async () => ({
      policyVersion: 7,
      maxTokens: 2048,
      maxCallsPerProduct: 1,
    }),
  })
  const estimate = await f.learner.estimate('s', [f.binding.id], [f.source.id])
  await expect(
    f.learner.start('s', [f.binding.id], [f.source.id], estimate.estimateId),
  ).rejects.toThrow(/p1.*超过当前策略上限 1/)
  expect(f.repo.listJobs().total).toBe(0)
  expect(f.baseComplete).not.toHaveBeenCalled()
})

it('fails before submitted when the source changes during the policy wait', async () => {
  let entered!: () => void
  const policyEntered = new Promise<void>((resolve) => {
    entered = resolve
  })
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  let policyCalls = 0
  let chat = 0
  const f = fixture({
    policy: async () => {
      policyCalls++
      if (policyCalls > 1) {
        entered()
        await gate
      }
      return { policyVersion: 7, maxTokens: 2048, maxCallsPerProduct: 20 }
    },
    complete: async (input) => {
      if (input.isCurrent?.()) chat++
      return '{"candidates":[]}'
    },
  })
  const estimate = await f.learner.estimate('s', [f.binding.id], [f.source.id])
  const job = await f.learner.start('s', [f.binding.id], [f.source.id], estimate.estimateId)
  await policyEntered
  f.repo.saveSource({
    id: f.source.id,
    expectedRevision: f.source.revision,
    storeId: 's',
    bindingId: f.binding.id,
    kind: 'platform',
    label: '平台静态资料',
    text: '羊毛',
    locator: { url: 'https://mms.pinduoduo.com/goods/goods_add/index?goods_id=1' },
  })
  release()
  const result = await settled(f.repo, job.jobId)
  expect(result.status).toBe('failed')
  expect(result.checkpoint.state).toBe('ready')
  expect(result.error).toMatch(/来源或商品关联已变化/)
  expect(chat).toBe(0)
})

it('consumes a managed estimate atomically so concurrent starts create one job', async () => {
  const f = fixture()
  const estimate = await f.learner.estimate('s', [f.binding.id], [f.source.id])
  const results = await Promise.allSettled([
    f.learner.start('s', [f.binding.id], [f.source.id], estimate.estimateId),
    f.learner.start('s', [f.binding.id], [f.source.id], estimate.estimateId),
  ])
  const fulfilled = results.filter(
    (result): result is PromiseFulfilledResult<{ jobId: string }> => result.status === 'fulfilled',
  )
  expect(fulfilled).toHaveLength(1)
  expect(
    results.filter((result) => result.status === 'rejected').map((result) => result.reason),
  ).toEqual([expect.objectContaining({ message: expect.stringMatching(/估算已被使用/) })])
  expect(f.repo.listJobs().total).toBe(1)
  const jobId = fulfilled[0]!.value.jobId
  expect((await settled(f.repo, jobId)).status).toBe('succeeded')
  expect(f.baseComplete).toHaveBeenCalledTimes(1)
})

it('does not accept a new adapter for an old estimate or direct source metadata', async () => {
  const f = fixture()
  const estimate = await f.learner.estimate('s', [f.binding.id], [f.source.id])
  const key = `learning-estimate:${estimate.estimateId}`
  const oldPlan = JSON.parse(f.repo.getMetadata(key)!) as Record<string, unknown>
  oldPlan.version = 1
  f.repo.setMetadata(key, JSON.stringify(oldPlan))
  await expect(
    f.learner.start('s', [f.binding.id], [f.source.id], estimate.estimateId),
  ).rejects.toThrow(/旧版学习估算/)
  expect(f.baseComplete).not.toHaveBeenCalled()

  const messages = [{ role: 'user' as const, content: '普通回复' }]
  await f.port.complete({ messages })
  expect(f.baseComplete).toHaveBeenLastCalledWith({ messages })
  await expect(
    f.port.complete({
      messages,
      purpose: 'learning',
      policyVersion: 7,
      learningSource: 'pdd_detail_text',
    }),
  ).rejects.toThrow(/预检生成/)
  expect(f.baseComplete).toHaveBeenCalledTimes(1)
})

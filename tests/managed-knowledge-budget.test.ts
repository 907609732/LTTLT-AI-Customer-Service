import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createKnowledgeRepository } from '../electron/knowledge'
import { createKnowledgeRuntime } from '../electron/knowledge-runtime'
import type { ManagedContextPolicy } from '../electron/managed-context-policy'
import type { KnowledgeDraftInput, KnowledgeEntry } from '../src/shared/contracts/knowledge'

const disposals: (() => void)[] = []
afterEach(() => {
  vi.useRealTimers()
  disposals
    .splice(0)
    .reverse()
    .forEach((dispose) => dispose())
})

const BASE_POLICY: ManagedContextPolicy = {
  default_model: 'managed-1',
  models: [{ id: 'managed-1', name: '托管模型一' }],
  max_tokens: 512,
  policy_version: 3,
  runtime_context: {
    enabled: true,
    retrieval_budget: 3000,
    retrieval_order: ['binding', 'store', 'canonical', 'template'],
  },
  learning: {
    enabled: false,
    vision_enabled: true,
    allowed_sources: ['pdd_detail_text', 'pdd_detail_image'],
    max_calls_per_product: 20,
    max_output_tokens: 4096,
    requires_review: true,
    video_mode: 'disabled',
    asr_mode: 'disabled',
  },
}

const policy = (
  overrides: Partial<ManagedContextPolicy['runtime_context']> = {},
): ManagedContextPolicy => ({
  ...BASE_POLICY,
  runtime_context: { ...BASE_POLICY.runtime_context, ...overrides },
})

function fixture(lookup?: () => Promise<ManagedContextPolicy | null>) {
  const directory = mkdtempSync(join(tmpdir(), 'managed-knowledge-budget-'))
  disposals.push(() => rmSync(directory, { recursive: true, force: true }))
  const repository = createKnowledgeRepository({ directory, workspaceId: 'workspace' })
  disposals.push(() => repository.dispose())
  const runtime = createKnowledgeRuntime({
    repository,
    workspaceId: 'workspace',
    assertActive: () => {},
    stores: () => [
      { id: 's', storeName: 'Shop', platform: 'sim-local' },
      { id: 'other', storeName: 'Other', platform: 'sim-local' },
    ],
    changed: () => {},
    ...(lookup ? { managedContextPolicy: lookup } : {}),
  })
  disposals.push(() => runtime.dispose())
  const approve = (input: KnowledgeDraftInput): KnowledgeEntry => {
    const draft = repository.saveDraft(input)
    repository.publish({
      entryId: draft.id,
      expectedDraftRevision: draft.revision,
      expectedSourceRevisions: {},
    })
    return repository.getEntry(draft.id)!
  }
  const context = async (
    query: string,
    reviewContext: Record<string, unknown> = { storeId: 's', uid: 'buyer', purpose: 'reply' },
  ) => {
    const rows = (await runtime.context({
      thread: [{ from: 'buyer', content: query }],
      reviewContext,
    })) as { citations: { entryId: string; answer: string }[]; omitted: number }[]
    return rows[0]!
  }
  return { repository, runtime, approve, context }
}

describe('托管接待知识 token 预算', () => {
  it('保留 SKU 绑定的既有冲突胜出，不因预算改写覆盖', async () => {
    const { repository, approve, context } = fixture(async () => policy())
    const canonical = repository.saveCanonical({ title: '带规格商品' })
    const root = repository.bindProduct({
      canonicalId: canonical.id,
      storeId: 's',
      productId: 'p',
    })
    const sku = repository.bindProduct({
      canonicalId: canonical.id,
      storeId: 's',
      productId: 'p',
      skuId: 'red',
    })
    approve({
      scope: { kind: 'binding', bindingId: root.id },
      question: '价格',
      answer: '根商品100元',
      field: 'fact',
    })
    approve({
      scope: { kind: 'binding', bindingId: sku.id },
      question: '价格',
      answer: 'SKU专用200元',
      field: 'fact',
    })
    const result = await context('价格', {
      storeId: 's',
      uid: 'buyer',
      purpose: 'reply',
      productId: 'p',
      skuId: 'red',
    })
    expect(result.citations.map((citation) => citation.answer)).toEqual(['SKU专用200元'])
  }, 30_000)

  it('交换 store/canonical 顺序只改变预算填充，不改变冲突胜出', async () => {
    let order: ManagedContextPolicy['runtime_context']['retrieval_order'] = [
      'binding',
      'store',
      'canonical',
      'template',
    ]
    const { repository, approve, context } = fixture(async () =>
      policy({ retrieval_budget: 256, retrieval_order: order }),
    )
    const canonical = repository.saveCanonical({ title: '顺序商品' })
    repository.bindProduct({ canonicalId: canonical.id, storeId: 's', productId: 'p' })
    approve({
      scope: { kind: 'store', storeId: 's' },
      question: '顺序甲',
      answer: 'a'.repeat(20),
      keywords: ['顺序测试'],
    })
    approve({
      scope: { kind: 'canonical', canonicalId: canonical.id },
      question: '顺序乙',
      answer: 'b'.repeat(20),
      keywords: ['顺序测试'],
    })
    const storeFirst = await context('顺序测试', {
      storeId: 's',
      uid: 'buyer',
      purpose: 'reply',
      productId: 'p',
    })
    order = ['binding', 'canonical', 'store', 'template']
    const canonicalFirst = await context('顺序测试', {
      storeId: 's',
      uid: 'buyer',
      purpose: 'reply',
      productId: 'p',
    })
    expect(storeFirst.citations).toHaveLength(1)
    expect(canonicalFirst.citations).toHaveLength(1)
    expect(storeFirst.citations[0]!.answer).toBe('a'.repeat(20))
    expect(canonicalFirst.citations[0]!.answer).toBe('b'.repeat(20))
    expect(storeFirst.omitted).toBeGreaterThanOrEqual(1)
    expect(canonicalFirst.omitted).toBeGreaterThanOrEqual(1)
  }, 30_000)

  it('超长中文和 emoji 使整条引用被省略，不裁剪问题或答案', async () => {
    const { approve, context } = fixture(async () => policy({ retrieval_budget: 512 }))
    const longAnswer = '超长中文😀'.repeat(500)
    approve({
      scope: { kind: 'store', storeId: 's' },
      question: '长文甲',
      answer: longAnswer,
      keywords: ['长文测试'],
    })
    approve({
      scope: { kind: 'store', storeId: 's' },
      question: '长文乙',
      answer: '短答案',
      keywords: ['长文测试'],
    })
    const result = await context('长文测试')
    expect(result.citations).toHaveLength(1)
    expect(result.citations[0]!.answer).toBe('短答案')
    expect(result.citations.some((citation) => citation.answer.includes('超长中文'))).toBe(false)
    expect(result.omitted).toBeGreaterThanOrEqual(1)
  }, 30_000)

  it('撤回、过期和其他店铺的引用均不进入托管预算结果', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const { repository, approve, context } = fixture(async () => policy())
    const withdrawn = approve({
      scope: { kind: 'store', storeId: 's' },
      question: '排除甲',
      answer: '已撤回资料',
      keywords: ['排除测试'],
    })
    repository.withdraw(withdrawn.id, repository.getEntry(withdrawn.id)!.revision)
    approve({
      scope: { kind: 'store', storeId: 's' },
      question: '排除乙',
      answer: '已过期资料',
      keywords: ['排除测试'],
      expiresAt: Date.now() + 1000,
    })
    approve({
      scope: { kind: 'store', storeId: 'other' },
      question: '排除丙',
      answer: '其他店铺资料',
      keywords: ['排除测试'],
    })
    approve({
      scope: { kind: 'store', storeId: 's' },
      question: '排除丁',
      answer: '仍有效资料',
      keywords: ['排除测试'],
    })
    vi.setSystemTime(Date.now() + 2000)
    const result = await context('排除测试')
    expect(result.citations.map((citation) => citation.answer)).toEqual(['仍有效资料'])
  }, 30_000)

  it('本机、停用和策略读取失败均沿用原有 10 条窗口；启用策略使用更大候选窗口', async () => {
    let mode: 'local' | 'disabled' | 'throw' | 'enabled' = 'local'
    const { approve, context } = fixture(async () => {
      if (mode === 'throw') throw new Error('config unavailable')
      if (mode === 'local') return null
      return policy({
        enabled: mode === 'enabled',
        retrieval_budget: 4096,
      })
    })
    for (let index = 0; index < 15; index++)
      approve({
        scope: { kind: 'store', storeId: 's' },
        question: `遗留${index}`,
        answer: `答复${index}`,
        keywords: ['遗留测试'],
      })
    mode = 'local'
    const local = await context('遗留测试')
    expect(local.citations).toHaveLength(10)
    expect(local.omitted).toBe(5)
    mode = 'disabled'
    const disabled = await context('遗留测试')
    expect(disabled.citations).toHaveLength(10)
    expect(disabled.omitted).toBe(5)
    mode = 'throw'
    const failed = await context('遗留测试')
    expect(failed.citations).toHaveLength(10)
    expect(failed.omitted).toBe(5)
    mode = 'enabled'
    const managed = await context('遗留测试')
    expect(managed.citations).toHaveLength(15)
    expect(managed.omitted).toBe(0)
  }, 30_000)

  it('托管预算只提交完整引用，撤回后发送前复核仍失效', async () => {
    const { repository, runtime, approve } = fixture(async () => policy({ retrieval_budget: 3000 }))
    const entry = approve({
      scope: { kind: 'store', storeId: 's' },
      question: '发货',
      answer: '48小时',
    })
    const rows = (await runtime.context({
      thread: [{ from: 'buyer', content: '发货' }],
      reviewContext: { storeId: 's', uid: 'buyer', purpose: 'reply' },
    })) as { citations: { entryId: string; answer: string }[] }[]
    runtime.captureTrace('managed-trace', rows)
    expect(runtime.citationsCurrent('managed-trace')).toBe(true)
    expect(rows[0]!.citations[0]!.answer).toBe('48小时')
    repository.withdraw(entry.id, repository.getEntry(entry.id)!.revision)
    expect(runtime.citationsCurrent('managed-trace')).toBe(false)
  }, 30_000)
})

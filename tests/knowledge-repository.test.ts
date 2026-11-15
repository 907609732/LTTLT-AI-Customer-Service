import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createKnowledgeRepository, restoreKnowledgeBackup } from '../electron/knowledge'

const cleanups: (() => void)[] = []
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup()
})
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'knowledge-repo-'))
  cleanups.push(() => rmSync(directory, { recursive: true, force: true }))
  let time = 1_000
  const repository = createKnowledgeRepository({
    directory,
    workspaceId: 'lease-one',
    now: () => time,
  })
  cleanups.push(() => repository.dispose())
  return {
    repository,
    directory,
    advance: (ms: number) => {
      time += ms
    },
  }
}
function product(
  repository: ReturnType<typeof createKnowledgeRepository>,
  storeId = 'a',
  productId = 'p',
  canonicalId?: string,
  skuId = '',
) {
  const canonical = canonicalId
    ? repository.getCanonical(canonicalId)!
    : repository.saveCanonical({ title: '棉衬衫' })
  const binding = repository.bindProduct({
    canonicalId: canonical.id,
    storeId,
    productId,
    skuId,
    title: '棉衬衫',
  })
  return { canonical, binding }
}
function publish(
  repository: ReturnType<typeof createKnowledgeRepository>,
  entry: ReturnType<ReturnType<typeof createKnowledgeRepository>['saveDraft']>,
) {
  return repository.publish({
    entryId: entry.id,
    expectedDraftRevision: entry.revision,
    expectedSourceRevisions: Object.fromEntries(
      entry.sourceRefs.map((ref) => [ref.sourceId, ref.revision]),
    ),
  })
}
describe('durable SQLite knowledge repository', () => {
  it('invalidates existing citations when a reviewed override changes the effective answer', () => {
    const { repository } = fixture()
    const { canonical, binding } = product(repository)
    publish(
      repository,
      repository.saveDraft({
        scope: { kind: 'canonical', canonicalId: canonical.id },
        question: '面料',
        answer: '纯棉',
        conflictKey: 'material',
      }),
    )
    const old = repository.resolveKnowledge({
      storeId: 'a',
      productId: 'p',
      query: '面料',
    }).citations
    const draft = repository.saveDraft({
      scope: { kind: 'binding', bindingId: binding.id },
      question: '面料',
      answer: '棉麻',
      conflictKey: 'material',
    })
    expect(repository.validateCitations(old).valid).toBe(true)
    publish(repository, draft)
    expect(repository.validateCitations(old).valid).toBe(false)
    const current = repository.resolveKnowledge({
      storeId: 'a',
      productId: 'p',
      query: '面料',
    }).citations
    repository.withdraw(draft.id, draft.revision)
    expect(repository.validateCitations(current).valid).toBe(false)
  })
  it('removes one store application without withdrawing another store template', () => {
    const { repository } = fixture()
    const template = repository.saveDraft({
      scope: { kind: 'template', storeIds: ['a', 'b'] },
      question: '发货',
      answer: '48小时',
    })
    publish(repository, template)
    repository.removeStore('a')
    expect(repository.resolveKnowledge({ storeId: 'a', query: '发货' }).citations).toEqual([])
    expect(repository.resolveKnowledge({ storeId: 'b', query: '发货' }).citations[0]?.answer).toBe(
      '48小时',
    )
  })
  it('lists retained canonical entities and pages cards with attachment summaries', () => {
    const { repository } = fixture()
    const first = product(repository)
    product(repository, 'a', 'second')
    const asset = repository.addAsset(new Uint8Array([1, 2, 3]), {
      name: '详情.png',
      mimeType: 'image/png',
    })
    repository.saveSource({
      kind: 'image',
      storeId: 'a',
      bindingId: first.binding.id,
      label: '详情图',
      text: '未审核图片提取',
      assetIds: [asset.id],
    })
    const page = repository.listProducts({ storeId: 'a', limit: 1 })
    expect(page.total).toBe(2)
    expect(page.items[0]?.sourceSummary.thumbnailAssetId).toBe(asset.id)
    expect(
      repository.listProducts({ storeId: 'a', offset: 1, limit: 1 }).items[0]?.binding.productId,
    ).toBe('second')
    repository.unlinkBinding(first.binding.id, first.binding.revision)
    expect(repository.listCanonicals({ search: '棉衬衫' }).total).toBe(2)
    expect(
      repository.resolveKnowledge({ storeId: 'a', productId: 'p', query: '未审核图片提取' })
        .citations,
    ).toEqual([])
  })
  it('restores a hash-checked SQLite and attachments snapshot only after the writer stops', () => {
    const { repository, directory } = fixture()
    const { canonical } = product(repository)
    const asset = repository.addAsset(new Uint8Array([6, 7, 8]), {
      name: '图.png',
      mimeType: 'image/png',
    })
    publish(
      repository,
      repository.saveDraft({
        scope: { kind: 'canonical', canonicalId: canonical.id },
        question: '面料',
        answer: '纯棉',
      }),
    )
    repository.createBackup(join(directory, 'backups'))
    const backupDirectory = repository.getLastBackupDirectory()!
    expect(() => restoreKnowledgeBackup({ directory, backupDirectory })).toThrow(/关闭|writer/)
    repository.saveSettings({ dynamicTtlMinutes: 3 })
    repository.dispose()
    restoreKnowledgeBackup({ directory, backupDirectory })
    const restored = createKnowledgeRepository({ directory, workspaceId: 'restored' })
    cleanups.push(() => restored.dispose())
    expect(restored.getSettings().dynamicTtlMinutes).toBe(60)
    expect([...restored.readAsset(asset.id)]).toEqual([6, 7, 8])
    expect(
      restored.resolveKnowledge({ storeId: 'a', productId: 'p', query: '面料' }).citations[0]
        ?.answer,
    ).toBe('纯棉')
  })
  it('pauses interrupted durable jobs without losing checkpoints or retrying model calls', () => {
    const { repository, directory } = fixture()
    const job = repository.createJob({
      kind: 'learn',
      storeId: 'a',
      payload: { sourceIds: ['one'] },
    })
    repository.updateJob(job.id, {
      expectedRevision: 1,
      status: 'running',
      checkpoint: { requestId: 'uncertain' },
    })
    repository.dispose()
    const reopened = createKnowledgeRepository({ directory, workspaceId: 'next' })
    cleanups.push(() => reopened.dispose())
    expect(reopened.getJob(job.id)).toMatchObject({
      status: 'paused',
      checkpoint: { requestId: 'uncertain' },
      revision: 3,
    })
    expect(() => createKnowledgeRepository({ directory, workspaceId: 'duplicate-writer' })).toThrow(
      /writer|打开/,
    )
  })
  it('persists account data independently of workspace lease and keeps drafts out of search', () => {
    const { repository, directory } = fixture()
    const { canonical } = product(repository)
    const draft = repository.saveDraft({
      scope: { kind: 'canonical', canonicalId: canonical.id },
      question: '面料',
      answer: '纯棉',
      field: 'fact',
      origin: 'model',
    })
    expect(
      repository.resolveKnowledge({ storeId: 'a', productId: 'p', query: '面料' }).citations,
    ).toEqual([])
    publish(repository, draft)
    expect(
      repository.resolveKnowledge({ storeId: 'a', productId: 'p', query: '面料' }).citations[0]
        ?.answer,
    ).toBe('纯棉')
    repository.dispose()
    const reopened = createKnowledgeRepository({ directory, workspaceId: 'different-lease' })
    cleanups.push(() => reopened.dispose())
    expect(reopened.listProducts({ storeId: 'a' }).total).toBe(1)
    expect(reopened.getEntry(draft.id)?.approved?.answer).toBe('纯棉')
  })
  it('enforces review revisions and never permits dynamic values on shared products', () => {
    const { repository } = fixture()
    const { canonical } = product(repository)
    const draft = repository.saveDraft({
      scope: { kind: 'canonical', canonicalId: canonical.id },
      question: '面料',
      answer: '纯棉',
      field: 'fact',
    })
    const newer = repository.saveDraft({
      id: draft.id,
      scope: draft.scope,
      question: draft.question,
      field: draft.field,
      answer: '棉麻',
      expectedRevision: draft.revision,
    })
    expect(() => publish(repository, draft)).toThrow(/revision|更新/)
    expect(() =>
      repository.saveDraft({ scope: draft.scope, question: '价格', answer: '10', field: 'price' }),
    ).toThrow(/共享|dynamic/)
    publish(repository, newer)
  })
  it('resolves explicit store/SKU overrides and refuses unknown-product mixing', () => {
    const { repository } = fixture()
    const { canonical, binding } = product(repository)
    const other = product(repository, 'b', 'other', canonical.id)
    const sku = product(repository, 'a', 'p', canonical.id, 'large')
    const base = repository.saveDraft({
      scope: { kind: 'canonical', canonicalId: canonical.id },
      question: '面料',
      answer: '纯棉',
      field: 'fact',
      conflictKey: 'material',
    })
    const override = repository.saveDraft({
      scope: { kind: 'binding', bindingId: binding.id },
      question: '面料',
      answer: '棉麻',
      field: 'fact',
      conflictKey: 'material',
    })
    const skuOverride = repository.saveDraft({
      scope: { kind: 'binding', bindingId: sku.binding.id },
      question: '面料',
      answer: '丝棉',
      field: 'fact',
      conflictKey: 'material',
    })
    for (const entry of [base, override, skuOverride]) publish(repository, entry)
    expect(
      repository
        .resolveKnowledge({ storeId: 'a', productId: 'p', query: '面料' })
        .citations.map((c) => c.answer),
    ).toEqual(['棉麻'])
    expect(
      repository
        .resolveKnowledge({ storeId: 'a', productId: 'p', skuId: 'large', query: '面料' })
        .citations.map((c) => c.answer),
    ).toEqual(['丝棉'])
    expect(
      repository
        .resolveKnowledge({ storeId: 'b', productId: other.binding.productId, query: '面料' })
        .citations.map((c) => c.answer),
    ).toEqual(['纯棉'])
    expect(
      repository.resolveKnowledge({ storeId: 'a', productId: 'unknown', query: '面料 棉衬衫' })
        .citations,
    ).toEqual([])
  })
  it('expires dynamic values and invalidates old citations after overrides, withdrawal and unlink', () => {
    const { repository, advance } = fixture()
    const { canonical, binding } = product(repository)
    product(repository, 'b', 'other', canonical.id)
    const draft = repository.saveDraft({
      scope: { kind: 'binding', bindingId: binding.id },
      question: '价格',
      answer: '十元',
      field: 'price',
      expiresAt: 2_000,
    })
    publish(repository, draft)
    const refs = repository.resolveKnowledge({
      storeId: 'a',
      productId: 'p',
      query: '价格',
    }).citations
    expect(repository.validateCitations(refs).valid).toBe(true)
    expect(
      repository.resolveKnowledge({ storeId: 'a', productId: 'p', skuId: 'unknown', query: '价格' })
        .citations,
    ).toEqual([])
    advance(1_001)
    expect(
      repository.resolveKnowledge({ storeId: 'a', productId: 'p', query: '价格' }).citations,
    ).toEqual([])
    expect(repository.validateCitations(refs).valid).toBe(false)
    const fact = repository.saveDraft({
      scope: { kind: 'canonical', canonicalId: canonical.id },
      question: '面料',
      answer: '纯棉',
      field: 'fact',
    })
    publish(repository, fact)
    const before = repository.resolveKnowledge({
      storeId: 'a',
      productId: 'p',
      query: '面料',
    }).citations
    repository.unlinkBinding(binding.id, binding.revision)
    expect(repository.validateCitations(before).valid).toBe(false)
    expect(
      repository.resolveKnowledge({ storeId: 'b', productId: 'other', query: '面料' }).citations[0]
        ?.answer,
    ).toBe('纯棉')
  })
  it('invalidates only source-dependent knowledge after raw refresh and protects human additions', () => {
    const { repository } = fixture()
    const { canonical, binding } = product(repository)
    const source = repository.saveSource({
      kind: 'platform',
      storeId: 'a',
      bindingId: binding.id,
      label: '详情',
      text: '纯棉',
    })
    const generated = repository.saveDraft({
      scope: { kind: 'canonical', canonicalId: canonical.id },
      question: '面料',
      answer: '纯棉',
      field: 'fact',
      sourceRefs: [{ sourceId: source.id, revision: source.revision }],
      origin: 'model',
    })
    const manual = repository.saveDraft({
      scope: generated.scope,
      question: '洗护',
      answer: '手洗',
      field: 'fact',
    })
    publish(repository, generated)
    publish(repository, manual)
    repository.saveSource({
      id: source.id,
      kind: source.kind,
      storeId: source.storeId,
      bindingId: source.bindingId,
      label: source.label,
      text: '棉麻',
      expectedRevision: source.revision,
    })
    expect(repository.getEntry(generated.id)?.status).toBe('stale')
    expect(() => publish(repository, generated)).toThrow(/source|来源/)
    expect(
      repository
        .resolveKnowledge({ storeId: 'a', productId: 'p', query: '洗护 面料' })
        .citations.map((c) => c.answer),
    ).toEqual(['手洗'])
  })
  it('persists jobs, deduplicated misses and settings, and produces a consistent backup', () => {
    const { repository, directory } = fixture()
    const job = repository.createJob({ kind: 'learn', storeId: 'a', payload: { bindingIds: [] } })
    repository.updateJob(job.id, {
      expectedRevision: job.revision,
      status: 'running',
      progress: { completed: 1, total: null },
    })
    repository.recordMiss({
      storeId: 'a',
      productId: 'p',
      question: '  面料？ ',
      conversationId: 'u',
    })
    repository.recordMiss({ storeId: 'a', productId: 'p', question: '面料？', conversationId: 'v' })
    expect(repository.listMisses({ storeId: 'a' }).items[0]?.count).toBe(2)
    repository.saveSettings({ dynamicTtlMinutes: 25, dailyCheckTime: '10:30' })
    const manifest = repository.createBackup(join(directory, 'backups'))
    expect(manifest.files.some((file) => file.path === 'knowledge.sqlite')).toBe(true)
    expect(repository.getSettings().dynamicTtlMinutes).toBe(25)
    expect(repository.listJobs({ storeId: 'a' }).items).toHaveLength(1)
  })
})

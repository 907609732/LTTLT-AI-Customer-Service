import { mkdtempSync, rmSync, existsSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createKnowledgeRepository, restoreKnowledgeBackup } from '../electron/knowledge'
import { createKnowledgeRuntime } from '../electron/knowledge-runtime'
import { createKnowledgePlatformProducts } from '../electron/knowledge-platform-products'
import { createKnowledgeCompatibilityPorts } from '../electron/knowledge-compatibility'
import { ReviewConsole } from '../electron/review-console'
import { knowledgeReassociateSchema } from '../src/shared/contracts/knowledge-client'
import { emptySnapshot } from '../src/shared/contracts/backend'

const disposals: (() => void)[] = []
afterEach(() =>
  disposals
    .splice(0)
    .reverse()
    .forEach((dispose) => dispose()),
)
function fixture(
  options: Pick<Parameters<typeof createKnowledgeRuntime>[0], 'chooseRestore' | 'stores'> = {
    stores: () => [{ id: 's', storeName: 'Shop', platform: 'sim-local' }],
  },
) {
  const directory = mkdtempSync(join(tmpdir(), 'knowledge-runtime-'))
  disposals.push(() => rmSync(directory, { recursive: true, force: true }))
  const repository = createKnowledgeRepository({ directory, workspaceId: 'workspace' })
  disposals.push(() => repository.dispose())
  let active = true
  const runtime = createKnowledgeRuntime({
    repository,
    workspaceId: 'workspace',
    assertActive: () => {
      if (!active) throw Error('account changed')
    },
    ...options,
    changed: () => {},
  })
  return {
    repository,
    runtime,
    deactivate: () => {
      active = false
    },
  }
}
describe('knowledge runtime boundary and exact request evidence', () => {
  it.each(['family', 'full'] as const)(
    'previews incoming and current-only restore effects for %s and rejects a changed plan',
    async (kind) => {
      let directory = ''
      const { runtime, repository: repo } = fixture({
        chooseRestore: async () => directory,
        stores: () =>
          ['s', 't', 'u'].map((id) => ({
            id,
            storeName: `Shop ${id.toUpperCase()}`,
            platform: 'sim-local',
          })),
      })
      const canonical = repo.saveCanonical({ title: '旧同款' })
      repo.bindProduct({ canonicalId: canonical.id, storeId: 's', productId: 'one' })
      directory = repo.createBackup(
        join(repo.directory, 'backups'),
        kind === 'family' ? { canonicalId: canonical.id } : undefined,
      ).directory
      const current = kind === 'family' ? canonical : repo.saveCanonical({ title: '新同款' })
      const extra = repo.bindProduct({ canonicalId: current.id, storeId: 't', productId: 'two' })
      repo.bindProduct({ canonicalId: current.id, storeId: 't', productId: 'two', skuId: 'red' })
      const general = repo.saveDraft({
        scope: { kind: 'store', storeId: 'u' },
        question: '当前通用问题',
        answer: '当前资料',
      })
      const preview = (await runtime.request({
        workspaceId: 'workspace',
        operation: 'restore-preview',
      })) as import('../src/shared/contracts/knowledge-client').KnowledgeRestorePreview
      expect(preview.stores).toContain('Shop T')
      expect(preview.bindings).toEqual(
        expect.arrayContaining([
          expect.stringMatching(/恢复.*Shop S.*one.*根商品/),
          expect.stringMatching(
            new RegExp(`${kind === 'family' ? '停用' : '移除'}.*Shop T.*two.*red`),
          ),
          expect.stringMatching(
            new RegExp(`${kind === 'family' ? '停用' : '移除'}.*Shop T.*two.*根商品`),
          ),
        ]),
      )
      expect(preview.message).toContain(kind === 'family' ? '停用2个' : '移除2个')
      if (kind === 'full') {
        expect(preview.stores).toContain('Shop U')
        expect(preview.message).toContain('移除1条知识')
      }
      repo.saveCanonical({ title: '预览后的新资料' })
      expect(() => runtime.prepareRestore(preview.token)).toThrow(/预览已过期|资料变化/)
      const fresh = (await runtime.request({
        workspaceId: 'workspace',
        operation: 'restore-preview',
      })) as import('../src/shared/contracts/knowledge-client').KnowledgeRestorePreview
      const plan = runtime.prepareRestore(fresh.token)
      repo.dispose()
      restoreKnowledgeBackup({ directory: plan.directory, backupDirectory: plan.backupDirectory })
      const restored = createKnowledgeRepository({
        directory: plan.directory,
        workspaceId: 'restored',
      })
      disposals.push(() => restored.dispose())
      if (kind === 'family') {
        expect(restored.getBinding(extra.id)?.active).toBe(false)
        expect(restored.getEntry(general.id)?.draft.answer).toBe('当前资料')
        expect(preview.stores).not.toContain('Shop U')
      } else {
        expect(restored.getBinding(extra.id)).toBe(null)
        expect(restored.getEntry(general.id)).toBe(null)
      }
    },
  )

  it('recommends code/title/spec matches but leaves bindings unchanged until explicit human reassociation', async () => {
    const { repository: repo, runtime } = fixture()
    const a = repo.saveCanonical({ title: '纯棉红衬衫', code: 'C01' }),
      b = repo.saveCanonical({ title: '纯棉红衬衫', code: 'C01' }),
      c = repo.saveCanonical({ title: '电池', code: 'Z99' })
    const root = repo.bindProduct({ canonicalId: a.id, storeId: 's', productId: 'a' })
    repo.bindProduct({ canonicalId: b.id, storeId: 's', productId: 'b' })
    repo.bindProduct({ canonicalId: c.id, storeId: 's', productId: 'c' })
    const result = (await runtime.request({
      workspaceId: 'workspace',
      operation: 'recommendations',
      bindingId: root.id,
    })) as { canonical: { id: string }; reasons: string[] }[]
    expect(result[0]!.canonical.id).toBe(b.id)
    expect(result[0]!.reasons).toContain('商品编码相同')
    expect(repo.getBinding(root.id)?.canonicalId).toBe(a.id)
  })
  it('explicit global removal invalidates all family shops while preserving audit history and unrelated goods', async () => {
    const { repository: repo, runtime } = fixture()
    const a = repo.saveCanonical({ title: '删除同款' }),
      b = repo.saveCanonical({ title: '保留' })
    const one = repo.bindProduct({ canonicalId: a.id, storeId: 's', productId: 'one' })
    repo.bindProduct({ canonicalId: b.id, storeId: 's', productId: 'two' })
    const draft = repo.saveDraft({
      scope: { kind: 'canonical', canonicalId: a.id },
      question: '材质',
      answer: '棉',
    })
    repo.publish({ entryId: draft.id, expectedDraftRevision: 1, expectedSourceRevisions: {} })
    await runtime.request({
      workspaceId: 'workspace',
      operation: 'delete-family',
      canonicalId: a.id,
      expectedRevision: a.revision,
      bindings: [{ id: one.id, expectedRevision: one.revision }],
    })
    expect(repo.listBindings(a.id)).toHaveLength(0)
    expect(repo.listCanonicals().items.map((c) => c.id)).toEqual([b.id])
    expect(repo.entryVersions(draft.id).some((v) => v.version.answer === '棉' && v.reviewed)).toBe(
      true,
    )
    expect(repo.getEntry(draft.id)?.status).toBe('withdrawn')
  })
  it('rejects oversized protected trial input before any model call without truncating it', async () => {
    const { runtime } = fixture()
    let calls = 0
    runtime.setModel({
      vision: () => ({ supported: false, reason: '', maxImages: 0 }),
      complete: async () => {
        calls++
        return 'answer'
      },
    })
    let responsive = false
    const timer = setTimeout(() => {
      responsive = true
    }, 0)
    const pending = runtime.request({
      workspaceId: 'workspace',
      operation: 'trial',
      input: { storeId: 's', query: '龘靐齉'.repeat(3000) },
    })
    await expect(pending).rejects.toThrow('预算')
    expect(responsive).toBe(true)
    clearTimeout(timer)
    expect(calls).toBe(0)
  }, 60000)
  it('records substantive coverage gaps with bounded source context and excludes courtesy and trials', async () => {
    const { runtime, repository } = fixture()
    for (const question of ['你好', '谢谢！', '好的', '辛苦了'])
      await runtime.context({
        thread: [{ from: 'buyer', content: question }],
        reviewContext: { storeId: 's', uid: 'buyer', purpose: 'reply' },
      })
    expect(repository.listMisses().total).toBe(0)
    await runtime.context({
      thread: [
        { from: 'seller', content: 'x'.repeat(9000) },
        { from: 'buyer', content: '  可以水洗吗？  ' },
      ],
      reviewContext: { storeId: 's', uid: 'buyer', productId: 'unknown', purpose: 'reply' },
    })
    await runtime.context({
      thread: [{ from: 'buyer', content: '可以水洗吗?' }],
      reviewContext: { storeId: 's', uid: 'buyer2', productId: 'unknown', purpose: 'reply' },
    })
    const misses = repository.listMisses()
    expect(misses.total).toBe(1)
    expect(misses.items[0]).toMatchObject({
      count: 2,
      reason: 'unknown-product',
      source: 'reception',
    })
    expect(JSON.stringify(misses.items[0]!.context).length).toBeLessThan(5000)
  })
  it('does not borrow a root price when a product has SKUs but no SKU identity can be verified', async () => {
    const { runtime, repository } = fixture()
    const canonical = repository.saveCanonical({ title: '有规格的商品' })
    const root = repository.bindProduct({
      canonicalId: canonical.id,
      storeId: 's',
      productId: 'sku-product',
    })
    repository.bindProduct({
      canonicalId: canonical.id,
      storeId: 's',
      productId: 'sku-product',
      skuId: 'variant',
    })
    const draft = repository.saveDraft({
      scope: { kind: 'binding', bindingId: root.id },
      question: '价格',
      answer: '12元',
      field: 'price',
    })
    repository.publish({
      entryId: draft.id,
      expectedDraftRevision: draft.revision,
      expectedSourceRevisions: {},
    })
    const context = await runtime.context({
      thread: [{ from: 'buyer', content: '价格' }],
      reviewContext: { storeId: 's', productId: 'sku-product' },
    })
    expect(JSON.stringify(context)).not.toContain('12元')
  })
  it('rejects phantom shop writes and keeps unapplied public templates available without making them effective', async () => {
    const { runtime, repository } = fixture()
    await expect(
      runtime.request({
        workspaceId: 'workspace',
        operation: 'command',
        command: {
          type: 'save-draft',
          draft: { scope: { kind: 'store', storeId: 'removed' }, question: '问题', answer: '答案' },
        },
      }),
    ).rejects.toThrow('店铺')
    const draft = repository.saveDraft({
      scope: { kind: 'template', storeIds: [] },
      question: '公共模板',
      answer: '尚未应用',
    })
    const page = (await runtime.request({
      workspaceId: 'workspace',
      operation: 'general-entries',
      page: { storeId: 's' },
    })) as { items: { id: string }[] }
    expect(page.items.some((entry) => entry.id === draft.id)).toBe(true)
    expect(repository.resolveKnowledge({ storeId: 's', query: '公共模板' }).citations).toHaveLength(
      0,
    )
  })
  it('fails actual reply context explicitly on migration failure instead of generating with an empty library', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'knowledge-runtime-readonly-'))
    disposals.push(() => rmSync(directory, { recursive: true, force: true }))
    writeFileSync(join(directory, 'product-knowledge.json'), '{corrupt')
    const repository = createKnowledgeRepository({ directory, workspaceId: 'w' })
    disposals.push(() => repository.dispose())
    const runtime = createKnowledgeRuntime({
      repository,
      workspaceId: 'w',
      assertActive: () => {},
      stores: () => [{ id: 's', storeName: 'Shop', platform: 'sim-local' }],
      changed: () => {},
    })
    expect(repository.readOnly).toBe(true)
    await expect(
      runtime.context({
        thread: [{ from: 'buyer', content: '发货' }],
        reviewContext: { storeId: 's', uid: 'buyer', purpose: 'reply' },
      }),
    ).rejects.toThrow('知识迁移失败')
  })
  it('reassociates a complete physical product family atomically while preserving store/SKU facts', async () => {
    const { repository, runtime } = fixture()
    const a = repository.saveCanonical({ title: '旧共享' }),
      b = repository.saveCanonical({ title: '确认的新共享' })
    const root = repository.bindProduct({ canonicalId: a.id, storeId: 's', productId: 'family' })
    const sku = repository.bindProduct({
      canonicalId: a.id,
      storeId: 's',
      productId: 'family',
      skuId: 'one',
    })
    const draft = repository.saveDraft({
      scope: { kind: 'binding', bindingId: sku.id },
      question: '价格',
      answer: '19.9元',
      field: 'price',
    })
    repository.publish({
      entryId: draft.id,
      expectedDraftRevision: draft.revision,
      expectedSourceRevisions: {},
    })
    await runtime.request({
      workspaceId: 'workspace',
      operation: 'reassociate-product',
      input: {
        rootBindingId: root.id,
        canonicalId: b.id,
        expectedCanonicalRevision: b.revision,
        bindings: [root, sku].map((binding) => ({
          id: binding.id,
          expectedRevision: binding.revision,
        })),
      },
    })
    expect(repository.getBinding(root.id)?.canonicalId).toBe(b.id)
    expect(repository.getBinding(sku.id)?.canonicalId).toBe(b.id)
    expect(repository.getEntry(draft.id)?.approved?.answer).toBe('19.9元')
  })
  it('changes nothing when any SKU revision or family membership changed after preview', async () => {
    const { repository, runtime } = fixture()
    const a = repository.saveCanonical({ title: '旧共享' }),
      b = repository.saveCanonical({ title: '确认的新共享' })
    const root = repository.bindProduct({ canonicalId: a.id, storeId: 's', productId: 'family' })
    const sku = repository.bindProduct({
      canonicalId: a.id,
      storeId: 's',
      productId: 'family',
      skuId: 'one',
    })
    repository.bindProduct({
      id: sku.id,
      expectedRevision: sku.revision,
      canonicalId: a.id,
      storeId: 's',
      productId: 'family',
      skuId: 'one',
      title: '更新SKU',
    })
    await expect(
      runtime.request({
        workspaceId: 'workspace',
        operation: 'reassociate-product',
        input: {
          rootBindingId: root.id,
          canonicalId: b.id,
          expectedCanonicalRevision: b.revision,
          bindings: [root, sku].map((binding) => ({
            id: binding.id,
            expectedRevision: binding.revision,
          })),
        },
      }),
    ).rejects.toThrow()
    expect(repository.getBinding(root.id)).toEqual(root)
    expect(repository.getBinding(sku.id)?.canonicalId).toBe(a.id)
  })
  it('blocks the actual approval gate after cited knowledge is withdrawn and preserves its reason', async () => {
    const { repository, runtime } = fixture()
    const draft = repository.saveDraft({
      scope: { kind: 'store', storeId: 's' },
      question: '发货',
      answer: '48小时',
    })
    repository.publish({
      entryId: draft.id,
      expectedDraftRevision: draft.revision,
      expectedSourceRevisions: {},
    })
    const context = await runtime.context({
      thread: [{ from: 'buyer', content: '发货' }],
      reviewContext: { storeId: 's', uid: 'buyer', purpose: 'reply' },
    })
    runtime.captureTrace('exact', context)
    const snapshot = emptySnapshot()
    snapshot.stores = [
      {
        id: 's',
        storeName: 'Shop',
        platform: 'sim-local',
        group: '',
        aiEnabled: true,
        runtime: { open: true, online: true },
      },
    ]
    snapshot.conversations = [
      {
        storeId: 's',
        uid: 'buyer',
        name: 'Buyer',
        status: 'pending',
        messages: [{ from: 'buyer', content: '发货', ts: 1, msgId: '1', type: 'text' }],
      },
    ]
    const review = new ReviewConsole(
      () => snapshot,
      () => {},
    )
    disposals.push(() => review.dispose())
    const pending = review.propose(
      runtime.guardProposal({
        storeId: 's',
        uid: 'buyer',
        text: '48小时',
        traceId: 'exact',
        thread: snapshot.conversations[0]!.messages,
        isCurrent: () => true,
        getHistory: async () => ({ known: true, messages: snapshot.conversations[0]!.messages }),
      }),
    )
    const candidate = review.snapshot().replies[0]!
    repository.withdraw(draft.id, repository.getEntry(draft.id)!.revision)
    await expect(review.decide({ id: candidate.id, approve: true })).rejects.toThrow('引用知识')
    expect(await pending).toBe(false)
    expect(review.snapshot().replies[0]?.reason).toContain('引用知识')
  })
  it('refuses legacy rollback after manager reassociation or a newer manager draft', () => {
    const { repository } = fixture()
    const product = repository.products.save({ storeId: 's', productId: 'p', title: '旧商品' })
    const ports = createKnowledgeCompatibilityPorts(repository)
    const binding = repository.listBindings()[0]!,
      canonical = repository.saveCanonical({ title: '明确共享' })
    repository.bindProduct({
      id: binding.id,
      expectedRevision: binding.revision,
      storeId: binding.storeId,
      productId: binding.productId,
      skuId: binding.skuId,
      title: binding.title,
      canonicalId: canonical.id,
    })
    expect(() => ports.products.save({ ...product, title: '旧入口保存' })).toThrow('知识库')
    expect(repository.getBinding(binding.id)?.canonicalId).toBe(canonical.id)
  })
  it('stores legacy platform refresh in SQLite, invalidates source citations, and never creates JSON', () => {
    const { repository } = fixture()
    const canonical = repository.saveCanonical({ title: '商品' })
    const binding = repository.bindProduct({
      storeId: 's',
      productId: 'p',
      canonicalId: canonical.id,
    })
    const adapter = createKnowledgePlatformProducts({
      repository,
      assertActive: () => {},
      assertStore: () => {},
    })
    const detail = {
      productId: 'p',
      title: '商品',
      merchantCode: 'CODE',
      description: '原始资料',
      attributes: [],
      images: [],
      skus: [],
      capturedAt: 100,
      sourceUrl: 'https://mms.pinduoduo.com/goods/goods_list',
      detailStatus: 'complete',
      detailNote: '',
    }
    adapter.upsert('s', detail)
    const source = repository.listSources({ bindingId: binding.id })[0]!
    const draft = repository.saveDraft({
      scope: { kind: 'binding', bindingId: binding.id },
      question: '材质',
      answer: '棉',
      sourceRefs: [{ sourceId: source.id, revision: source.revision }],
    })
    repository.publish({
      entryId: draft.id,
      expectedDraftRevision: draft.revision,
      expectedSourceRevisions: { [source.id]: source.revision },
    })
    adapter.upsert('s', { ...detail, description: '来源变更', capturedAt: 101 })
    expect(repository.getEntry(draft.id)?.status).toBe('stale')
    expect(adapter.get('s', 'p')?.description).toBe('来源变更')
    expect(existsSync(join(repository.directory, 'platform-products'))).toBe(false)
  })
  it('saves drafts separately from approval and rejects stale workspace/unknown dispatch', async () => {
    const { runtime, repository } = fixture()
    await expect(
      runtime.request({ workspaceId: 'old', operation: 'query', query: { type: 'summary' } }),
    ).rejects.toThrow()
    await expect(
      runtime.request({ workspaceId: 'workspace', operation: 'dispose' }),
    ).rejects.toThrow()
    const draft = repository.saveDraft({
      scope: { kind: 'store', storeId: 's' },
      question: '发货',
      answer: '48小时',
    })
    expect(repository.resolveKnowledge({ storeId: 's', query: '发货' }).citations).toHaveLength(0)
    await runtime.request({
      workspaceId: 'workspace',
      operation: 'command',
      command: {
        type: 'publish',
        review: {
          entryId: draft.id,
          expectedDraftRevision: draft.revision,
          expectedSourceRevisions: {},
        },
      },
    })
    expect(repository.resolveKnowledge({ storeId: 's', query: '发货' }).citations).toHaveLength(1)
  })
  it('binds citations to exact trace, preserves earlier evidence and invalidates after withdraw', async () => {
    const { runtime, repository } = fixture()
    const draft = repository.saveDraft({
      scope: { kind: 'store', storeId: 's' },
      question: '发货',
      answer: '48小时',
    })
    repository.publish({ entryId: draft.id, expectedDraftRevision: 1, expectedSourceRevisions: {} })
    const first = await runtime.context({
      thread: [{ from: 'buyer', content: '发货' }],
      reviewContext: { storeId: 's', uid: 'buyer' },
    })
    runtime.captureTrace('first', first)
    const later = await runtime.context({
      thread: [{ from: 'buyer', content: '不相关' }],
      reviewContext: { storeId: 's', uid: 'buyer' },
    })
    runtime.captureTrace('later', later)
    expect(runtime.citationsCurrent('first')).toBe(true)
    repository.withdraw(draft.id, repository.getEntry(draft.id)!.revision)
    expect(runtime.citationsCurrent('first')).toBe(false)
    expect(runtime.citationsCurrent('later')).toBe(true)
  })
  it('never leaks another product and trials do not record real misses; late completions fail account lease', async () => {
    const { runtime, repository, deactivate } = fixture()
    const c = repository.saveCanonical({ title: 'A' })
    repository.bindProduct({ canonicalId: c.id, storeId: 's', productId: 'a' })
    const v = repository.saveDraft({
      scope: { kind: 'canonical', canonicalId: c.id },
      question: '材质',
      answer: '纯棉',
    })
    repository.publish({
      entryId: v.id,
      expectedDraftRevision: v.revision,
      expectedSourceRevisions: {},
    })
    const rows = await runtime.context({
      thread: [{ from: 'buyer', content: '材质' }],
      reviewContext: { storeId: 's', productId: 'unknown' },
    })
    expect(JSON.stringify(rows)).not.toContain('纯棉')
    expect(repository.listMisses({}).total).toBe(0)
    runtime.setModel({
      vision: () => ({ supported: false, reason: 'no images', maxImages: 0 }),
      complete: async () => {
        deactivate()
        return 'late'
      },
    })
    await expect(
      runtime.complete({ messages: [{ role: 'user', content: 'test' }] }),
    ).rejects.toThrow('account changed')
  })
})

it('accepts one root plus all 1000 verified SKU identities in a family mapping preview', () => {
  const input = {
    rootBindingId: 'root',
    canonicalId: 'family',
    expectedCanonicalRevision: 1,
    bindings: Array.from({ length: 1001 }, (_, index) => ({
      id: index === 0 ? 'root' : `sku-${index}`,
      expectedRevision: 1,
    })),
  }
  expect(knowledgeReassociateSchema.safeParse(input).success).toBe(true)
  input.bindings.push({ id: 'overflow', expectedRevision: 1 })
  expect(knowledgeReassociateSchema.safeParse(input).success).toBe(false)
})

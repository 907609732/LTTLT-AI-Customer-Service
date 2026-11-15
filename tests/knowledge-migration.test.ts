import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { createKnowledgeRepository } from '../electron/knowledge'
const cleanup: (() => void)[] = []
afterEach(() => {
  for (const fn of cleanup.splice(0).reverse()) fn()
})
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'knowledge-migration-'))
  cleanup.push(() => rmSync(directory, { recursive: true, force: true }))
  return directory
}
const product = {
  id: '11111111-1111-4111-8111-111111111111',
  version: 3,
  updatedAt: 100,
  storeId: 'shop',
  productId: 'p',
  title: '棉衬衫',
  description: '纯棉',
  specifications: '手洗',
  price: '20',
  enabled: true,
}
const pack = {
  id: '22222222-2222-4222-8222-222222222222',
  version: 2,
  updatedAt: 100,
  name: '问答',
  enabled: true,
  storeIds: ['shop'],
  productIds: [],
  entries: [
    { question: '发货', answer: '48小时', keywords: [], enabled: true },
    {
      question: '【学习来源审计，请保持停用】',
      answer: '审计不可回答',
      keywords: [],
      enabled: false,
    },
  ],
}
function open(directory: string) {
  const repo = createKnowledgeRepository({ directory, workspaceId: 'lease' })
  cleanup.push(() => repo.dispose())
  return repo
}
describe('knowledge legacy migration', () => {
  it('preserves enabled product-scoped intents without a Product row or existing binding', () => {
    const directory = fixture()
    writeFileSync(
      join(directory, 'intent-knowledge.json'),
      JSON.stringify({
        version: 1,
        revision: 2,
        packs: [{ ...pack, productIds: ['p'], entries: [pack.entries[0]!] }],
      }),
    )
    const repo = open(directory)
    expect(repo.getMigrationState().status).toBe('complete')
    expect(repo.listEntries({ status: 'approved' }).total).toBe(1)
    expect(
      repo.resolveKnowledge({ storeId: 'shop', productId: 'p', query: '发货' }).citations[0]
        ?.answer,
    ).toBe('48小时')
    expect(
      repo.resolveKnowledge({ storeId: 'other', productId: 'p', query: '发货' }).citations,
    ).toEqual([])
    expect(
      repo.resolveKnowledge({ storeId: 'shop', productId: 'other', query: '发货' }).citations,
    ).toEqual([])
    expect(repo.resolveKnowledge({ storeId: 'shop', query: '发货' }).citations).toEqual([])
  })
  it('creates platform snapshot identities before importing their scoped intent answers', () => {
    const directory = fixture(),
      file = createHash('sha256').update('shop').digest('hex') + '.json'
    mkdirSync(join(directory, 'platform-products'))
    writeFileSync(
      join(directory, 'platform-products', file),
      JSON.stringify({
        version: 1,
        items: [
          {
            productId: 'p',
            title: '平台真实标题',
            merchantCode: 'P001',
            description: '未发布原始描述',
            attributes: [],
            images: [],
            skus: [],
            capturedAt: 100,
            sourceUrl: 'https://mms.pinduoduo.com/goods/goods_list',
          },
        ],
      }),
    )
    writeFileSync(
      join(directory, 'intent-knowledge.json'),
      JSON.stringify({
        version: 1,
        revision: 2,
        packs: [{ ...pack, productIds: ['p'], entries: [pack.entries[0]!] }],
      }),
    )
    const repo = open(directory)
    expect(repo.getMigrationState().status).toBe('complete')
    expect(repo.listEntries({ status: 'approved' }).total).toBe(1)
    expect(
      repo.resolveKnowledge({ storeId: 'shop', productId: 'p', query: '发货' }).citations[0]
        ?.answer,
    ).toBe('48小时')
    expect(repo.listProducts({ storeId: 'shop' }).items[0]?.canonical.title).toBe('平台真实标题')
    expect(
      repo.resolveKnowledge({ storeId: 'shop', productId: 'p', query: '未发布原始描述' }).citations,
    ).toEqual([])
  })
  it('legacy product removal also revokes approved SKU answers and their citations', () => {
    const directory = fixture(),
      repo = open(directory)
    const saved = repo.products.save({ ...product, id: undefined, version: undefined })
    const root = repo.listBindings()[0]!
    const sku = repo.bindProduct({
      canonicalId: root.canonicalId,
      storeId: 'shop',
      productId: 'p',
      skuId: 'large',
    })
    const draft = repo.saveDraft({
      scope: { kind: 'binding', bindingId: sku.id },
      question: '面料',
      answer: 'SKU专属面料',
    })
    repo.publish({
      entryId: draft.id,
      expectedDraftRevision: draft.revision,
      expectedSourceRevisions: {},
    })
    const citations = repo.resolveKnowledge({
      storeId: 'shop',
      productId: 'p',
      skuId: 'large',
      query: '面料',
    }).citations
    repo.products.remove('shop', saved.id, saved.version, true)
    expect(repo.listBindings()).toEqual([])
    expect(
      repo.resolveKnowledge({ storeId: 'shop', productId: 'p', skuId: 'large', query: '面料' })
        .citations,
    ).toEqual([])
    expect(repo.validateCitations(citations).valid).toBe(false)
  })
  it('preserves enabled status, separates audit, backs up originals and is idempotent', () => {
    const directory = fixture()
    const original = JSON.stringify({
      version: 1,
      revision: 9,
      items: [
        product,
        {
          ...product,
          id: '33333333-3333-4333-8333-333333333333',
          productId: 'disabled',
          enabled: false,
        },
      ],
    })
    writeFileSync(join(directory, 'product-knowledge.json'), original)
    writeFileSync(
      join(directory, 'intent-knowledge.json'),
      JSON.stringify({ version: 1, revision: 7, packs: [pack] }),
    )
    const repo = open(directory)
    expect(repo.products.list('shop').items.map((row) => row.enabled)).toEqual([true, false])
    expect(
      repo.resolveKnowledge({ storeId: 'shop', productId: 'p', query: '纯棉' }).citations[0]
        ?.answer,
    ).toContain('纯棉')
    expect(repo.resolveKnowledge({ storeId: 'shop', query: '发货' }).citations[0]?.answer).toBe(
      '48小时',
    )
    expect(repo.resolveKnowledge({ storeId: 'shop', query: '审计不可回答' }).citations).toEqual([])
    expect(
      repo.listSources({ storeId: 'shop' }).some((source) => source.kind === 'legacy-audit'),
    ).toBe(true)
    expect(readFileSync(join(directory, 'product-knowledge.json'), 'utf8')).toBe(original)
    const state = repo.getMigrationState()
    expect(state.status).toBe('complete')
    expect(state.inputHashes['product-knowledge.json']).toHaveLength(64)
    expect(state.backupDirectory).toBeTruthy()
    const total = repo.listEntries().total
    repo.dispose()
    const next = open(directory)
    expect(next.listEntries().total).toBe(total)
    expect(next.products.summary().revision).toBe(9)
  })
  it('old save/import commands create drafts and only explicit manual correction publishes', () => {
    const directory = fixture(),
      repo = open(directory)
    const saved = repo.products.save({ ...product, id: undefined, version: undefined })
    expect(saved.enabled).toBe(false)
    expect(
      repo.resolveKnowledge({ storeId: 'shop', productId: 'p', query: '纯棉' }).citations,
    ).toEqual([])
    const savedPack = repo.intents.save({ ...pack, id: undefined, version: undefined })
    expect(savedPack.enabled).toBe(false)
    const correction = repo.intents.learnCorrection({
      question: '发货',
      answer: '48小时',
      source: {
        type: 'quality',
        recordId: '44444444-4444-4444-8444-444444444444',
        qualityVersion: 1,
        storeId: 'shop',
        uid: 'buyer',
        messageTs: 20,
        savedAt: 30,
      },
    })
    expect(correction.enabled).toBe(true)
    expect(repo.resolveKnowledge({ storeId: 'shop', query: '发货' }).citations[0]?.answer).toBe(
      '48小时',
    )
    expect(
      repo.intents.learnCorrection({
        question: '发货',
        answer: '48小时',
        source: {
          type: 'quality',
          recordId: '44444444-4444-4444-8444-444444444444',
          qualityVersion: 1,
          storeId: 'shop',
          uid: 'buyer',
          messageTs: 20,
          savedAt: 30,
        },
      }).id,
    ).toBe(correction.id)
  })
  it('rolls back corrupt inputs, exposes read-only guard and preserves every original', () => {
    const directory = fixture()
    writeFileSync(
      join(directory, 'product-knowledge.json'),
      JSON.stringify({ version: 1, revision: 1, items: [product] }),
    )
    writeFileSync(join(directory, 'intent-knowledge.json'), '{broken')
    const repo = open(directory)
    expect(repo.readOnly).toBe(true)
    expect(repo.getMigrationState().status).toBe('failed')
    expect(repo.listBindings()).toEqual([])
    expect(repo.products.list('shop').items[0]?.title).toBe('棉衬衫')
    expect(() => repo.products.save({ ...product, id: undefined })).toThrow(/只读/)
    expect(() => repo.saveSettings({ dynamicTtlMinutes: 10 })).toThrow(/只读/)
    expect(readFileSync(join(directory, 'intent-knowledge.json'), 'utf8')).toBe('{broken')
  })
  it('imports platform snapshots as raw sources without publishing or merging distinct product IDs', () => {
    const directory = fixture()
    mkdirSync(join(directory, 'platform-products'))
    writeFileSync(
      join(directory, 'product-knowledge.json'),
      JSON.stringify({
        version: 1,
        revision: 1,
        items: [
          { ...product, enabled: false },
          {
            ...product,
            id: '33333333-3333-4333-8333-333333333333',
            productId: 'other',
            enabled: false,
          },
        ],
      }),
    )
    const platformFile = createHash('sha256').update('shop').digest('hex') + '.json'
    writeFileSync(
      join(directory, 'platform-products', platformFile),
      JSON.stringify({
        version: 1,
        items: [
          {
            productId: 'p',
            title: '棉衬衫',
            merchantCode: '001',
            description: '原始详情',
            attributes: [],
            images: ['https://example.com/detail.png'],
            skus: [
              {
                skuId: 'sku1',
                specs: [{ name: '尺码', value: 'M' }],
                merchantCode: 'M001',
                barcode: '00012',
                price: '20',
                stock: 4,
              },
            ],
            capturedAt: 100,
            sourceUrl: 'https://mms.pinduoduo.com/goods/goods_list',
            detailStatus: 'complete',
            detailNote: '',
          },
        ],
      }),
    )
    const repo = open(directory)
    expect(repo.listBindings()).toHaveLength(3)
    expect(new Set(repo.listBindings().map((binding) => binding.canonicalId)).size).toBe(2)
    const raw = repo.listSources({ storeId: 'shop' }).find((source) => source.kind === 'platform')
    expect(raw?.text).toContain('00012')
    expect(raw?.bindingId).toBe(
      repo.listBindings().find((binding) => binding.productId === 'p' && !binding.skuId)?.id,
    )
    expect(
      repo.resolveKnowledge({ storeId: 'shop', productId: 'p', query: '纯棉' }).citations,
    ).toEqual([])
  })
})

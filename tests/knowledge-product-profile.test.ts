import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { createKnowledgeRepository, restoreKnowledgeBackup } from '../electron/knowledge'
import { createKnowledgeProductProfileService } from '../electron/knowledge/product-profile'
import { createKnowledgeRuntime } from '../electron/knowledge-runtime'
import { inspectKnowledgeBackup } from '../electron/knowledge/backup'
import {
  KNOWLEDGE_PRODUCT_PROFILE_MAX_IMAGES,
  KNOWLEDGE_PRODUCT_PROFILE_SOURCE_LABEL,
  knowledgeProductProfileStoredSchema,
} from '../src/shared/contracts/knowledge-product-profile'
import { collectorMaterialLabels } from '../electron/knowledge/collector-materials'

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgQIAK6mS4QAAAABJRU5ErkJggg==',
  'base64',
)
const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xd9])
const cleanups: (() => void)[] = []
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup()
})
function fixture(now = () => Date.now()) {
  const directory = mkdtempSync(join(tmpdir(), 'knowledge-product-profile-'))
  const repository = createKnowledgeRepository({ directory, workspaceId: 'w', now })
  const chooseProductImages = vi.fn<() => Promise<{ name: string; bytes: Uint8Array }[]>>(
    async () => [],
  )
  const service = createKnowledgeProductProfileService({
    repository,
    workspaceId: 'w',
    assertActive: () => {},
    assertStore: () => {},
    chooseProductImages,
    now,
  })
  cleanups.push(() =>
    rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }),
  )
  cleanups.push(() => repository.dispose())
  cleanups.push(() => service.clear())
  return { directory, repository, service, chooseProductImages }
}
function rootProduct(
  repository: ReturnType<typeof createKnowledgeRepository>,
  storeId: string,
  productId = 'same-product',
  title = '平台原标题',
) {
  const canonical = repository.saveCanonical({ title, code: 'SHARED-CODE' })
  const binding = repository.bindProduct({
    canonicalId: canonical.id,
    storeId,
    productId,
    title,
  })
  return { canonical, binding }
}
function staticSource(
  repository: ReturnType<typeof createKnowledgeRepository>,
  binding: ReturnType<typeof rootProduct>['binding'],
  input: { description?: string; price?: string; capturedAt?: number } = {},
) {
  const source = repository.saveSource({
    kind: 'platform',
    storeId: binding.storeId,
    bindingId: binding.id,
    label: collectorMaterialLabels.static,
    text: JSON.stringify({
      productId: binding.productId,
      title: binding.title,
      merchantCode: 'PLATFORM-CODE',
      description: input.description ?? '静态资料描述',
      attributes: [],
      images: [],
      skus: [],
    }),
  })
  if (input.price !== undefined) {
    const price = repository.saveSource({
      kind: 'platform',
      storeId: binding.storeId,
      bindingId: binding.id,
      label: collectorMaterialLabels.dynamic,
      text: JSON.stringify({
        productId: binding.productId,
        skuId: 'red',
        price: input.price,
        stock: 2,
        capturedAt: input.capturedAt ?? Date.now(),
      }),
    })
    return { source, price }
  }
  return { source }
}

it('isolates the same product id between two shops and projects list summaries and only a few images', () => {
  const f = fixture()
  const a = rootProduct(f.repository, 'a')
  const b = rootProduct(f.repository, 'b')
  f.repository.saveCanonical({
    id: a.canonical.id,
    expectedRevision: a.canonical.revision,
    title: '共享名称',
    code: 'SHARED-CODE',
  })
  const imageA = f.repository.addAsset(png, { name: 'a.png', mimeType: 'image/png' })
  const imageB = f.repository.addAsset(jpeg, { name: 'b.jpg', mimeType: 'image/jpeg' })
  f.repository.saveDraft({
    scope: { kind: 'binding', bindingId: a.binding.id },
    question: '甲店问题',
    answer: '甲店答案',
  })
  const aProfile = f.service.read('a', a.binding.id)
  const bProfile = f.service.read('b', b.binding.id)
  expect(aProfile.binding.productId).toBe('same-product')
  expect(bProfile.binding.productId).toBe('same-product')
  expect(aProfile.manualPrice).toBe('')
  expect(bProfile.manualPrice).toBe('')
  expect(aProfile.knowledge).toEqual({ approved: 0, drafts: 1 })
  expect(bProfile.knowledge).toEqual({ approved: 0, drafts: 0 })
  f.repository.saveSource({
    kind: 'manual',
    storeId: 'a',
    bindingId: a.binding.id,
    label: KNOWLEDGE_PRODUCT_PROFILE_SOURCE_LABEL,
    text: JSON.stringify({
      version: 1,
      price: '甲店手工价',
      notes: '甲店备注',
      copy: '甲店手工文案'.repeat(30),
      imageAssetIds: [imageA.id],
    }),
    assetIds: [imageA.id],
  })
  f.repository.saveSource({
    kind: 'manual',
    storeId: 'b',
    bindingId: b.binding.id,
    label: KNOWLEDGE_PRODUCT_PROFILE_SOURCE_LABEL,
    text: JSON.stringify({
      version: 1,
      price: '乙店手工价',
      notes: '乙店备注',
      copy: '乙店手工文案',
      imageAssetIds: [imageB.id],
    }),
    assetIds: [imageB.id],
  })
  const listA = f.repository.listProducts({ storeId: 'a' }).items[0]!
  const listB = f.repository.listProducts({ storeId: 'b' }).items[0]!
  expect(listA.summary).toContain('甲店手工文案')
  expect(listB.summary).toContain('乙店手工文案')
  expect(listA.summary).not.toContain('乙店')
  expect(listA.imageAssetIds).toEqual([imageA.id])
  expect(listB.imageAssetIds).toEqual([imageB.id])
  expect(listA.imageAssetIds!.length).toBeLessThanOrEqual(3)
})

it('requires binding and manual-source CAS for first and concurrent writes while retaining editable values', async () => {
  const f = fixture()
  const { binding } = rootProduct(f.repository, 'a')
  const opened = f.service.read('a', binding.id)
  expect(opened.manualSourceRevision).toBeNull()
  const input = {
    storeId: 'a',
    bindingId: binding.id,
    expectedBindingRevision: opened.binding.revision,
    expectedManualSourceId: null,
    expectedManualSourceRevision: null,
    title: '本店新标题',
    manualPrice: '  ',
    notes: '备注',
    copy: '文案',
    imageTokens: [],
  }
  const results = await Promise.allSettled([f.service.save(input), f.service.save(input)])
  expect(results.filter((row) => row.status === 'fulfilled')).toHaveLength(1)
  expect(results.filter((row) => row.status === 'rejected')).toHaveLength(1)
  const saved = (
    results.find((row) => row.status === 'fulfilled') as PromiseFulfilledResult<
      Awaited<ReturnType<typeof f.service.save>>
    >
  ).value
  expect(saved.manualPrice).toBe('')
  await expect(f.service.save(input)).rejects.toThrow(/变更|冲突|刷新/)
  await expect(
    f.service.save({
      ...input,
      expectedBindingRevision: saved.binding.revision,
      expectedManualSourceId: saved.manualSourceId,
      expectedManualSourceRevision: saved.manualSourceRevision,
      title: '并发旧稿',
    }),
  ).resolves.toMatchObject({ title: '并发旧稿' })
  await expect(
    f.service.save({
      ...input,
      expectedBindingRevision: saved.binding.revision,
      expectedManualSourceId: saved.manualSourceId,
      expectedManualSourceRevision: saved.manualSourceRevision,
      title: '',
    }),
  ).rejects.toThrow(/标题/)
})

it('stages images in memory, discards without database writes, and consumes tokens only after a successful save', async () => {
  const f = fixture()
  const { binding } = rootProduct(f.repository, 'a')
  f.chooseProductImages.mockResolvedValue([
    { name: 'one.png', bytes: png },
    { name: 'two.jpg', bytes: jpeg },
  ])
  const before = f.service.read('a', binding.id)
  const repositoryRevision = f.repository.revision
  const staged = await f.service.stage({
    storeId: 'a',
    bindingId: binding.id,
    expectedBindingRevision: before.binding.revision,
    expectedManualSourceId: null,
    expectedManualSourceRevision: null,
  })
  expect(staged).toHaveLength(2)
  expect(staged[0]!.preview).toMatch(/^data:image\/png;base64,/)
  expect(staged[1]!.preview).toMatch(/^data:image\/jpeg;base64,/)
  expect(f.repository.listSources({ storeId: 'a' })).toHaveLength(0)
  expect(f.repository.revision).toBe(repositoryRevision)
  f.service.discard(staged.map((image) => image.token))
  await expect(
    f.service.save({
      storeId: 'a',
      bindingId: binding.id,
      expectedBindingRevision: before.binding.revision,
      expectedManualSourceId: null,
      expectedManualSourceRevision: null,
      title: '标题',
      manualPrice: '',
      notes: '',
      copy: '',
      imageTokens: staged.map((image) => image.token),
    }),
  ).rejects.toThrow(/暂存|过期|失效/)

  const stagedAgain = await f.service.stage({
    storeId: 'a',
    bindingId: binding.id,
    expectedBindingRevision: before.binding.revision,
    expectedManualSourceId: null,
    expectedManualSourceRevision: null,
  })
  const saved = await f.service.save({
    storeId: 'a',
    bindingId: binding.id,
    expectedBindingRevision: before.binding.revision,
    expectedManualSourceId: null,
    expectedManualSourceRevision: null,
    title: '标题',
    manualPrice: '12.50',
    notes: '',
    copy: '文案',
    imageTokens: stagedAgain.map((image) => image.token),
  })
  const stored = knowledgeProductProfileStoredSchema.parse(
    JSON.parse(f.repository.getSource(saved.manualSourceId!)!.text),
  )
  expect(stored.imageAssetIds).toHaveLength(2)
  expect(f.repository.getSource(saved.manualSourceId!)!.assetIds).toHaveLength(2)
  await expect(
    f.service.save({
      storeId: 'a',
      bindingId: binding.id,
      expectedBindingRevision: saved.binding.revision,
      expectedManualSourceId: saved.manualSourceId,
      expectedManualSourceRevision: saved.manualSourceRevision,
      title: '标题',
      manualPrice: '12.50',
      notes: '',
      copy: '文案',
      imageTokens: stagedAgain.map((image) => image.token),
    }),
  ).rejects.toThrow(/暂存|过期|失效/)
})

it('commits several images and keeps the versioned source and assets across store backup and restore', async () => {
  const f = fixture()
  const a = rootProduct(f.repository, 'a')
  f.chooseProductImages.mockResolvedValue([
    { name: 'a.png', bytes: png },
    { name: 'b.jpg', bytes: jpeg },
  ])
  const opened = f.service.read('a', a.binding.id)
  const staged = await f.service.stage({
    storeId: 'a',
    bindingId: a.binding.id,
    expectedBindingRevision: opened.binding.revision,
    expectedManualSourceId: null,
    expectedManualSourceRevision: null,
  })
  const first = await f.service.save({
    storeId: 'a',
    bindingId: a.binding.id,
    expectedBindingRevision: opened.binding.revision,
    expectedManualSourceId: null,
    expectedManualSourceRevision: null,
    title: '第一版',
    manualPrice: '',
    notes: '第一版备注',
    copy: '第一版文案',
    imageTokens: staged.map((image) => image.token),
  })
  const second = await f.service.save({
    storeId: 'a',
    bindingId: a.binding.id,
    expectedBindingRevision: first.binding.revision,
    expectedManualSourceId: first.manualSourceId,
    expectedManualSourceRevision: first.manualSourceRevision,
    title: '第二版',
    manualPrice: '20.00',
    notes: '第二版备注',
    copy: '第二版文案',
    imageTokens: [],
  })
  const source = f.repository.getSource(second.manualSourceId!)!
  expect(source.assetIds).toHaveLength(2)
  expect(source.revision).toBe(2)
  const [imageA, imageB] = source.assetIds
  const backup = f.repository.createBackup(join(f.directory, 'store-backup'), { storeId: 'a' })
  expect(backup.scope?.kind).toBe('store')
  inspectKnowledgeBackup(backup.directory)
  f.repository.dispose()
  restoreKnowledgeBackup({ directory: f.directory, backupDirectory: backup.directory })
  const restored = createKnowledgeRepository({ directory: f.directory, workspaceId: 'restored' })
  cleanups.push(() => restored.dispose())
  const restoredSource = restored
    .listSources({ storeId: 'a' })
    .find((row) => row.label === KNOWLEDGE_PRODUCT_PROFILE_SOURCE_LABEL)
  expect(restoredSource).toBeDefined()
  expect(restoredSource!.assetIds).toEqual([imageA, imageB])
  expect(restored.sourceVersions(restoredSource!.id).map((row) => row.revision)).toEqual(
    expect.arrayContaining([2, 1]),
  )
  expect(restored.readAsset(imageA!)).toEqual(png)
  expect(restored.readAsset(imageB!)).toEqual(jpeg)
})

it('keeps the dedicated manual source in family backups without copying it to the sibling shop', async () => {
  const f = fixture()
  const canonical = f.repository.saveCanonical({ title: '同款共享商品' })
  const a = f.repository.bindProduct({
    canonicalId: canonical.id,
    storeId: 'a',
    productId: 'same-product',
    title: '甲店根商品',
  })
  const b = f.repository.bindProduct({
    canonicalId: canonical.id,
    storeId: 'b',
    productId: 'same-product',
    title: '乙店根商品',
  })
  const opened = f.service.read('a', a.id)
  await f.service.save({
    storeId: 'a',
    bindingId: a.id,
    expectedBindingRevision: opened.binding.revision,
    expectedManualSourceId: null,
    expectedManualSourceRevision: null,
    title: '甲店独有标题',
    manualPrice: '99.00',
    notes: '甲店独有备注',
    copy: '甲店独有文案',
    imageTokens: [],
  })
  expect(f.service.read('b', b.id).manualSourceId).toBeNull()
  const backup = f.repository.createBackup(join(f.directory, 'family-backup'), {
    canonicalId: canonical.id,
  })
  expect(backup.scope).toMatchObject({ kind: 'family', canonicalId: canonical.id })
  inspectKnowledgeBackup(backup.directory)
  f.repository.dispose()
  restoreKnowledgeBackup({ directory: f.directory, backupDirectory: backup.directory })
  const restored = createKnowledgeRepository({ directory: f.directory, workspaceId: 'restored' })
  cleanups.push(() => restored.dispose())
  const manualA = restored
    .listSources({ storeId: 'a' })
    .filter((row) => row.label === KNOWLEDGE_PRODUCT_PROFILE_SOURCE_LABEL)
  const manualB = restored
    .listSources({ storeId: 'b' })
    .filter((row) => row.label === KNOWLEDGE_PRODUCT_PROFILE_SOURCE_LABEL)
  expect(manualA).toHaveLength(1)
  expect(manualB).toHaveLength(0)
  expect(restored.getBinding(a.id)?.title).toBe('甲店独有标题')
  expect(restored.getBinding(b.id)?.title).toBe('乙店根商品')
})

it('prefills existing platform title and static description and reports only a real expired platform price', () => {
  const now = 10_000_000
  const f = fixture(() => now)
  const { binding } = rootProduct(f.repository, 'a', 'p', '平台标题')
  staticSource(f.repository, binding, {
    description: '平台静态描述，仅用于核对',
    price: '39.90',
    capturedAt: now - 2 * 60 * 60 * 1000,
  })
  const profile = f.service.read('a', binding.id)
  expect(profile.title).toBe('平台标题')
  expect(profile.copy).toBe('平台静态描述，仅用于核对')
  expect(profile.copySource).toBe('platform')
  expect(profile.manualPrice).toBe('')
  expect(profile.platformPrice.prices).toEqual(['39.90'])
  expect(profile.platformPrice.expired).toBe(true)
  expect(profile.images).toEqual([])
})

it('rejects spoofed image contents, caps the gallery and does not stage a late picker result for another revision', async () => {
  const f = fixture()
  const { binding } = rootProduct(f.repository, 'a')
  f.chooseProductImages.mockResolvedValue([
    { name: 'fake.png', bytes: Buffer.from('not-an-image') },
  ])
  await expect(
    f.service.stage({
      storeId: 'a',
      bindingId: binding.id,
      expectedBindingRevision: binding.revision,
      expectedManualSourceId: null,
      expectedManualSourceRevision: null,
    }),
  ).rejects.toThrow(/图片格式|伪装/)

  f.chooseProductImages.mockResolvedValue(
    Array.from({ length: KNOWLEDGE_PRODUCT_PROFILE_MAX_IMAGES + 1 }, (_, index) => ({
      name: `${index}.png`,
      bytes: png,
    })),
  )
  await expect(
    f.service.stage({
      storeId: 'a',
      bindingId: binding.id,
      expectedBindingRevision: binding.revision,
      expectedManualSourceId: null,
      expectedManualSourceRevision: null,
    }),
  ).rejects.toThrow(/8|数量|图片/)

  let resolvePicker!: (value: { name: string; bytes: Uint8Array }[]) => void
  f.chooseProductImages.mockImplementation(
    () =>
      new Promise((resolve) => {
        resolvePicker = resolve
      }),
  )
  const pending = f.service.stage({
    storeId: 'a',
    bindingId: binding.id,
    expectedBindingRevision: binding.revision,
    expectedManualSourceId: null,
    expectedManualSourceRevision: null,
  })
  f.repository.bindProduct({
    id: binding.id,
    expectedRevision: binding.revision,
    canonicalId: binding.canonicalId,
    storeId: 'a',
    productId: binding.productId,
    title: '另一个标题',
  })
  resolvePicker([{ name: 'late.png', bytes: png }])
  await expect(pending).rejects.toThrow(/变更|刷新|冲突/)
})

it('connects typed runtime operations and rejects manual profile sources as learning material', async () => {
  const f = fixture()
  const { binding } = rootProduct(f.repository, 'a')
  f.chooseProductImages.mockResolvedValue([{ name: 'one.png', bytes: png }])
  const runtime = createKnowledgeRuntime({
    repository: f.repository,
    workspaceId: 'w',
    assertActive: () => {},
    stores: () => [{ id: 'a', storeName: 'A', platform: 'sim-local' }],
    changed: () => {},
    chooseProductImages: f.chooseProductImages,
  })
  cleanups.push(() => runtime.dispose())
  const opened = (await runtime.request({
    workspaceId: 'w',
    operation: 'product-profile',
    storeId: 'a',
    bindingId: binding.id,
  })) as Awaited<ReturnType<typeof f.service.read>>
  const staged = (await runtime.request({
    workspaceId: 'w',
    operation: 'product-image-stage',
    storeId: 'a',
    bindingId: binding.id,
    expectedBindingRevision: opened.binding.revision,
    expectedManualSourceId: null,
    expectedManualSourceRevision: null,
  })) as Awaited<ReturnType<typeof f.service.stage>>
  const saved = (await runtime.request({
    workspaceId: 'w',
    operation: 'product-profile-save',
    input: {
      storeId: 'a',
      bindingId: binding.id,
      expectedBindingRevision: opened.binding.revision,
      expectedManualSourceId: null,
      expectedManualSourceRevision: null,
      title: '运行时标题',
      manualPrice: '',
      notes: '',
      copy: '运行时文案',
      imageTokens: staged.map((image) => image.token),
    },
  })) as Awaited<ReturnType<typeof f.service.save>>
  expect(saved.manualSourceId).toBeTruthy()
  await expect(
    runtime.request({
      workspaceId: 'w',
      operation: 'pipeline',
      input: {
        action: 'estimate',
        storeId: 'a',
        bindingIds: [binding.id],
        sourceIds: [saved.manualSourceId!],
      },
    }),
  ).rejects.toThrow(/手工资料|学习/)
  await expect(
    runtime.request({
      workspaceId: 'other',
      operation: 'product-profile',
      storeId: 'a',
      bindingId: binding.id,
    }),
  ).rejects.toThrow(/工作区/)
})

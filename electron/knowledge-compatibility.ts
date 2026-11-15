import type { KnowledgeRepository } from './knowledge'
import { resolveKnowledgeRows } from './knowledge/resolver'
import { z } from 'zod'
/** Legacy CRUD remains available, but cannot roll back newer manager edits. */
export function createKnowledgeCompatibilityPorts(repository: KnowledgeRepository) {
  const repo = repository,
    products = repo.products,
    intents = repo.intents
  function productSignature(id: string) {
    const bindingId = repo.getMetadata(`legacy-binding:${id}`),
      binding = bindingId ? repo.getBinding(bindingId) : null
    return JSON.stringify({
      binding,
      entries: ['legacy-fact', 'legacy-price'].map((key) => {
        const entryId = repo.getMetadata(`${key}:${id}`)
        const entry = entryId ? repo.getEntry(entryId) : null
        return entry ? [entry.id, entry.revision, entry.status] : null
      }),
    })
  }
  function intentSignature(id: string) {
    const keys = z
      .array(z.string())
      .parse(JSON.parse(repo.getMetadata(`legacy-intent-mappings:${id}`) ?? '[]'))
    return JSON.stringify(
      keys.map((key) => {
        const entryId = repo.getMetadata(key)
        const entry = entryId ? repo.getEntry(entryId) : null
        return entry ? [entry.id, entry.revision, entry.status, entry.draft.scope] : null
      }),
    )
  }
  const key = (kind: 'product' | 'intent', id: string) => `knowledge-legacy-guard:${kind}:${id}`
  const signature = (kind: 'product' | 'intent', id: string) =>
    kind === 'product' ? productSignature(id) : intentSignature(id)
  function remember(kind: 'product' | 'intent', id: string) {
    if (!repo.readOnly) repo.setMetadata(key(kind, id), signature(kind, id))
  }
  function guard(kind: 'product' | 'intent', id: string) {
    const before = repo.getMetadata(key(kind, id))
    if (before !== null && before !== signature(kind, id))
      throw Error('知识库已有较新的编辑、审核或共享关联，请到知识库处理；旧入口未覆盖资料')
  }
  const productRows = () =>
    repo.rows<import('../src/shared/contracts/backend').Product>('legacy_products')
  // Persist compatibility baselines once, so restarting never blesses an older editor's state.
  if (!repo.readOnly) {
    for (const row of productRows())
      if (repo.getMetadata(key('product', row.id)) === null) remember('product', row.id)
    for (const row of intents.list())
      if (repo.getMetadata(key('intent', row.id)) === null) remember('intent', row.id)
  }
  const productPort: typeof products = {
    ...products,
    getByProductId(storeId, productId) {
      if (repo.readOnly) return null
      const binding = repo
        .listBindings()
        .find((row) => row.storeId === storeId && row.productId === productId && !row.skuId)
      if (!binding) return null
      const detail = repo.detail(binding.canonicalId, storeId)
      const resolution = resolveKnowledgeRows(
        [binding],
        detail.entries,
        { storeId, productId, query: '', limit: 1, maxCharacters: 60000 },
        Date.now(),
      )
      if (
        !resolution.citations.length ||
        resolution.citations.some((citation) =>
          citation.sourceRefs.some((ref) => {
            const source = repo.getSource(ref.sourceId)
            return !source || source.removed || source.revision !== ref.revision
          }),
        )
      )
        return null
      // Training needs a reviewed identity; actual facts still come only from knowledge.context.
      return {
        id: binding.id,
        storeId,
        productId,
        title: binding.title || detail.canonical?.title || productId,
        description: '',
        specifications: '',
        price: '',
        enabled: true,
        version: binding.revision,
        updatedAt: binding.updatedAt,
      }
    },
    save(input: unknown) {
      const value = z
        .object({ id: z.string().optional(), storeId: z.string(), productId: z.string() })
        .parse(input)
      if (value.id) guard('product', value.id)
      else if (
        repo
          .listBindings()
          .some((b) => b.storeId === value.storeId && b.productId === value.productId && !b.skuId)
      )
        throw Error('知识库已存在此商品，请从知识库编辑或关联')
      const result = products.save(input)
      remember('product', result.id)
      return result
    },
    remove(storeId, id, version, confirmed) {
      guard('product', id)
      return products.remove(storeId, id, version, confirmed)
    },
    importCsv(storeId, csv, options) {
      for (const row of productRows().filter((p) => p.storeId === storeId)) guard('product', row.id)
      if (
        repo
          .listBindings()
          .some(
            (b) =>
              b.storeId === storeId &&
              !b.skuId &&
              !productRows().some((p) => p.storeId === storeId && p.productId === b.productId),
          )
      )
        throw Error('知识库含新管理商品，请使用知识库导入资料，旧CSV不会重新绑定')
      const result = products.importCsv(storeId, csv, options)
      for (const row of productRows().filter((p) => p.storeId === storeId))
        remember('product', row.id)
      return result
    },
  }
  const intentPort: typeof intents = {
    ...intents,
    save(input: unknown) {
      const value = z.object({ id: z.string().optional() }).parse(input)
      if (value.id) guard('intent', value.id)
      const result = intents.save(input)
      remember('intent', result.id)
      return result
    },
    remove(...args) {
      guard('intent', args[0])
      return intents.remove(...args)
    },
    importJson(...args) {
      for (const row of intents.list()) guard('intent', row.id)
      const result = intents.importJson(...args)
      for (const row of intents.list()) remember('intent', row.id)
      return result
    },
    learnCorrection(input) {
      const result = intents.learnCorrection(input)
      remember('intent', result.id)
      return result
    },
  }
  return { products: productPort, intents: intentPort }
}

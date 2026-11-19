import { expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { useKnowledgeProductLearning } from '../src/modules/knowledge/product-learning-controller'
import type { ProductBinding, KnowledgeSource } from '../src/shared/contracts/knowledge'

it('batch learning uses selected bindings, then a single-product action replaces the batch scope', async () => {
  const bindings: ProductBinding[] = ['one', 'two'].map((id) => ({
    id,
    canonicalId: `c-${id}`,
    storeId: 'a',
    productId: id,
    skuId: '',
    title: id,
    revision: 1,
    active: true,
    updatedAt: 1,
  }))
  const query = vi.fn(async () => ({
    sources: [
      { id: 's-one', bindingId: 'one', removed: false },
      { id: 's-two', bindingId: 'two', removed: false },
      { id: 's-unselected', bindingId: 'other', removed: false },
      { id: 's-removed', bindingId: 'one', removed: true },
    ] as KnowledgeSource[],
    bindings,
  }))
  const pipeline = vi.fn(async () => ({ estimateId: 'estimate' }))
  const controller = useKnowledgeProductLearning({
    client: () => ({ query, pipeline }) as never,
    storeId: ref('a'),
    notice: ref(''),
    refresh: async () => {},
    selectBinding: () => {},
  })
  await controller.learnProducts(bindings)
  await controller.startLearn()
  expect(pipeline).toHaveBeenLastCalledWith(
    expect.objectContaining({
      action: 'start',
      bindingIds: ['one', 'two'],
      sourceIds: ['s-one', 's-two'],
    }),
  )
  await controller.learnProduct(bindings[1]!)
  await controller.startLearn()
  expect(pipeline).toHaveBeenLastCalledWith(
    expect.objectContaining({ action: 'start', bindingIds: ['two'], sourceIds: ['s-two'] }),
  )
})

it('does not publish a learning estimate after the shop changes during detail loading', async () => {
  let resolve!: (value: { sources: KnowledgeSource[]; bindings: ProductBinding[] }) => void
  const detail = new Promise<{ sources: KnowledgeSource[]; bindings: ProductBinding[] }>((done) => {
    resolve = done
  })
  const storeId = ref('a')
  const pipeline = vi.fn()
  const controller = useKnowledgeProductLearning({
    client: () => ({ query: () => detail, pipeline }) as never,
    storeId,
    notice: ref(''),
    refresh: async () => {},
    selectBinding: () => {},
  })
  const pending = controller.learnProducts([
    { id: 'one', storeId: 'a', canonicalId: 'c', productId: 'one' } as ProductBinding,
  ])
  storeId.value = 'b'
  controller.reset()
  resolve({ sources: [], bindings: [] })
  await expect(pending).rejects.toThrow('学习范围已变化')
  expect(pipeline).not.toHaveBeenCalled()
  expect(controller.estimate.value).toBeUndefined()
})

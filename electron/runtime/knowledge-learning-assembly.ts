import type { IntentPack } from '../../src/shared/contracts/backend'
import { resultSchema, intentsSchema } from '../../src/shared/contracts/backend'
import { createCollectedProductWriter } from '../collected-products'
import type { KnowledgeRepository } from '../knowledge'
import type { createKnowledgePlatformProducts } from '../knowledge-platform-products'
import { createPlatformLearningService } from '../platform-learning-service'
import type { createPddLearningProvider } from '../pdd-learning-provider'

interface RuntimeStore {
  id: string
  platform: string
}

/**
 * Draft writes and platform learning stay separate from provider ownership: the shared
 * learning provider is created and disposed by the composition root, never here.
 */
export function createKnowledgeLearningAssembly(options: {
  directory: string
  workspaceId: string
  repository: KnowledgeRepository
  platformProducts: ReturnType<typeof createKnowledgePlatformProducts>
  provider: ReturnType<typeof createPddLearningProvider>
  backend: { execute(command: unknown): Promise<unknown> }
  getStore(storeId: string): RuntimeStore | undefined
  hasAdapter(storeId: string): boolean
  assertActive(): void
}) {
  const productWriter = createCollectedProductWriter({
    savePlatformProduct: options.platformProducts.upsert,
    execute: async (command) => {
      if (command.action !== 'list-products') return options.backend.execute(command)
      options.assertActive()
      if (!options.getStore(command.storeId)) throw Error('店铺已移除')
      const offset = typeof command.values.offset === 'number' ? command.values.offset : 0,
        limit = typeof command.values.limit === 'number' ? command.values.limit : 100
      const result = options.repository.listProducts({
        storeId: command.storeId,
        offset,
        limit,
      })
      return {
        status: 'ok',
        message: '',
        data: {
          ...result,
          items: result.items.map((row) => ({
            id: row.binding.id,
            storeId: row.binding.storeId,
            productId: row.binding.productId,
            title: row.binding.title || row.canonical.title,
            description: '',
            specifications: '',
            price: '',
            enabled: false,
            version: row.binding.revision,
            updatedAt: row.binding.updatedAt,
          })),
        },
      }
    },
    assertActive: options.assertActive,
    assertStore: (storeId) => {
      if (!options.getStore(storeId)) throw Error('店铺已移除')
    },
    assertIdentity: async (expected) => {
      options.assertActive()
      const actual = await options.provider.identity(expected.storeId)
      options.assertActive()
      if (
        actual.accountId !== expected.accountId ||
        actual.platformStoreId !== expected.platformStoreId ||
        actual.storeId !== expected.storeId ||
        actual.platform !== expected.platform
      )
        throw Error('采集商品保存前账号或店铺身份已变化')
    },
  })
  const learning = createPlatformLearningService({
    directory: options.directory,
    workspaceId: options.workspaceId,
    port: {
      ...options.provider,
      async identity(storeId) {
        const store = options.getStore(storeId)
        if (!store) throw Error('店铺已移除')
        if (store.platform !== 'pdd-web') throw Error('此平台的主动学习采集尚未接入')
        // 重启后保留登录分区但尚未建立适配器；采集入口复用正常打开店铺流程。
        if (!options.hasAdapter(storeId)) {
          await options.backend.execute({ action: 'open-store', storeId })
          options.assertActive()
          if (!options.getStore(storeId)) throw Error('店铺已移除')
        }
        return options.provider.identity(storeId)
      },
      storeProducts: productWriter.write,
      assertActive: options.assertActive,
      async listPacks(): Promise<IntentPack[]> {
        options.assertActive()
        const result = resultSchema.parse(
          await options.backend.execute({ action: 'list-intent-packs', values: {} }),
        )
        options.assertActive()
        return intentsSchema.parse(result.data).packs
      },
      async savePack(pack) {
        options.assertActive()
        const result = resultSchema.parse(
          await options.backend.execute({ action: 'save-intent-pack', values: pack }),
        )
        options.assertActive()
        const id = typeof result.data.id === 'string' ? result.data.id : ''
        if (!id) throw Error('知识包未返回有效ID')
        return { id }
      },
    },
  })
  return { productWriter, learning }
}

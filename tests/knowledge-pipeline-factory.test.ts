import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createKnowledgeRepository } from '../electron/knowledge'
import { createKnowledgePipelineCoordinator } from '../electron/knowledge/pipeline'
import {
  createKnowledgePipelineAssembly,
  createKnowledgeSourceModel,
  type KnowledgeCollectionProvider,
  type KnowledgePipelineOwner,
} from '../electron/runtime/knowledge-pipeline-assembly'
import { createKnowledgeRuntime, type KnowledgeModelPort } from '../electron/knowledge-runtime'
import { createManagedLearningPort } from '../electron/managed-learning'

const require = createRequire(import.meta.url)

vi.mock('electron', () => ({
  dialog: { showOpenDialog: vi.fn() },
}))

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) {
    if (!root.includes('lingtu-knowledge-pipeline-') || !root.startsWith(tmpdir()))
      throw new Error('无效隔离测试目录')
    rmSync(root, { recursive: true, force: true })
  }
})

describe('知识管线装配', () => {
  it('registers collection before source learning and reads stores lazily', () => {
    const directory = mkdtempSync(join(tmpdir(), 'lingtu-knowledge-pipeline-'))
    roots.push(directory)
    const repository = createKnowledgeRepository({ directory, workspaceId: 'workspace' })
    const pipeline = createKnowledgePipelineCoordinator()
    const register = vi.spyOn(pipeline, 'register')
    const setPipeline = vi.fn()
    let stores = 0,
      conversations = 0,
      dailyStores = 0,
      active = 0
    const knowledge: KnowledgePipelineOwner = {
      setPipeline,
      assertStore: () => {},
      complete: async () => 'answer',
      vision: () => ({ supported: false, reason: '', maxImages: 0 }),
      modelIdentity: () => 'local',
      modelMinimumIntervalMs: () => 0,
    }
    const provider: KnowledgeCollectionProvider = {
      identity: async () => {
        throw Error('not used')
      },
      collectProducts: async () => {
        throw Error('not used')
      },
      readProductImage: async () => {
        throw Error('not used')
      },
    }
    const assembly = createKnowledgePipelineAssembly({
      workspaceId: 'workspace',
      repository,
      knowledge,
      provider,
      assertActive: () => {
        active++
      },
      getStore: (storeId) => {
        stores++
        return { id: storeId, platform: 'pdd-web' }
      },
      conversations: () => {
        conversations++
        return []
      },
      dailyAvailable: () => true,
      dailyStores: () => {
        dailyStores++
        return []
      },
      changed: () => {},
      pipeline,
    })
    try {
      expect(setPipeline).toHaveBeenCalledWith(pipeline)
      expect(register).toHaveBeenCalledTimes(2)
      expect([stores, conversations, dailyStores, active]).toEqual([0, 0, 0, 0])
      const [collector, source] = register.mock.calls.map(([handler]) => handler)
      expect(collector!.handles({ action: 'catalog', storeId: 's' })).toBe(true)
      expect(source!.handles({ action: 'catalog', storeId: 's' })).toBe(false)
      expect(source!.handles({ action: 'choose-sources', storeId: 's' })).toBe(true)
      expect(assembly.daily).toBeDefined()
    } finally {
      repository.dispose()
    }
  })

  it('forwards the live model interval instead of capturing a startup value', () => {
    let interval = 0
    const model = createKnowledgeSourceModel({
      complete: async () => 'answer',
      vision: () => ({ supported: false, reason: '', maxImages: 0 }),
      modelIdentity: () => 'local',
      modelMinimumIntervalMs: () => interval,
    })
    expect(model.minimumIntervalMs?.()).toBe(0)
    interval = 13000
    expect(model.minimumIntervalMs?.()).toBe(13000)
  })

  it('exposes managed preflight dynamically but keeps local Key without it', () => {
    const state: { prepare?: KnowledgeModelPort['prepareLearning'] } = {}
    const source = createKnowledgeSourceModel({
      complete: async () => 'answer',
      get prepareLearning() {
        return state.prepare
      },
      vision: () => ({ supported: false, reason: '', maxImages: 0 }),
      modelIdentity: () => 'local',
      modelMinimumIntervalMs: () => 0,
    })
    expect(source.prepareLearning).toBeUndefined()
    state.prepare = vi.fn(async () => ({ maxTokens: 2048, maxCallsPerProduct: 20 }))
    expect(source.prepareLearning).toBeTypeOf('function')
  })

  it('carries real assembly preflight into the vendor managed chat wire and stops old servers before chat', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'lingtu-knowledge-pipeline-'))
    roots.push(directory)
    const repository = createKnowledgeRepository({ directory, workspaceId: 'workspace' })
    const canonical = repository.saveCanonical({ title: '商品' })
    const binding = repository.bindProduct({
      canonicalId: canonical.id,
      storeId: 's',
      productId: 'p1',
    })
    const source = repository.saveSource({
      storeId: 's',
      bindingId: binding.id,
      kind: 'platform',
      label: '平台静态资料',
      text: '纯棉',
      locator: { url: 'https://mms.pinduoduo.com/goods/goods_add/index?goods_id=p1' },
    })
    const runtime = createKnowledgeRuntime({
      repository,
      workspaceId: 'workspace',
      assertActive() {},
      stores: () => [{ id: 's', storeName: '店铺', platform: 'pdd-web' }],
      changed() {},
      managedContextPolicy: async () => null,
    })
    const chats: Record<string, unknown>[] = []
    let oldServer = false
    const requireFactory = require(resolve('vendor/lingtu-runtime/electron/backend.cjs')) as {
      createBackend: (options: Record<string, unknown>) => {
        dispose(): void
      }
    }
    const backend = requireFactory.createBackend({
      dataDir: directory,
      modelMode: 'managed',
      managedReady: () => {},
      managedChat: async (payload: Record<string, unknown>) => {
        chats.push(payload)
        return { choices: [{ message: { content: '{"candidates":[]}' } }] }
      },
      managerFactory: () => ({
        stateOf: () => ({ open: true, online: true }),
        closeAll() {},
      }),
      adapterFactory: () => ({
        syncAiEnabled: async () => {},
        focusConversation: async () => ({ ok: true }),
        sendText: async () => ({ ok: true }),
      }),
      onKnowledgeModel: (port: KnowledgeModelPort) => {
        runtime.setModel(
          createManagedLearningPort({
            base: {
              complete: port.complete,
              vision: port.vision,
              identity: () => 'managed:test',
              minimumIntervalMs: () => 0,
            },
            repository,
            platformForStore: () => 'pdd-web',
            policy: async () => {
              if (oldServer) throw Error('当前托管服务未提供商品详情学习策略；未发送学习请求')
              return { policyVersion: 11, maxTokens: 2048, maxCallsPerProduct: 20 }
            },
            assertReady() {},
          }),
        )
      },
    })
    const provider: KnowledgeCollectionProvider = {
      identity: async () => {
        throw Error('not used')
      },
      collectProducts: async () => {
        throw Error('not used')
      },
      readProductImage: async () => {
        throw Error('not used')
      },
    }
    try {
      const assembly = createKnowledgePipelineAssembly({
        workspaceId: 'workspace',
        repository,
        knowledge: runtime,
        provider,
        assertActive() {},
        getStore: (storeId) => ({ id: storeId, platform: 'pdd-web' }),
        conversations: () => [],
        dailyAvailable: () => false,
        dailyStores: () => [],
        changed() {},
      })
      const estimate = await assembly.pipeline.request({
        action: 'estimate',
        storeId: 's',
        bindingIds: [binding.id],
        sourceIds: [source.id],
      })
      const started = await assembly.pipeline.request({
        action: 'start',
        kind: 'learn',
        storeId: 's',
        bindingIds: [binding.id],
        sourceIds: [source.id],
        estimateId: estimate.estimateId,
      })
      for (let i = 0; i < 100; i++) {
        const job = repository.getJob(started.jobId)
        if (job && job.status !== 'queued' && job.status !== 'running') break
        await new Promise((resolveWait) => setTimeout(resolveWait, 10))
      }
      expect(repository.getJob(started.jobId)?.status).toBe('succeeded')
      expect(chats).toHaveLength(1)
      expect(chats[0]).toMatchObject({
        purpose: 'learning',
        policy_version: 11,
        learning_source: 'pdd_detail_text',
      })
      expect(chats[0]).not.toHaveProperty('max_tokens')

      oldServer = true
      const stale = await assembly.pipeline.request({
        action: 'estimate',
        storeId: 's',
        bindingIds: [binding.id],
        sourceIds: [source.id],
      })
      await expect(
        assembly.pipeline.request({
          action: 'start',
          kind: 'learn',
          storeId: 's',
          bindingIds: [binding.id],
          sourceIds: [source.id],
          estimateId: stale.estimateId,
        }),
      ).rejects.toThrow(/未提供商品详情学习策略/)
      expect(chats).toHaveLength(1)
    } finally {
      backend.dispose()
      runtime.dispose()
      repository.dispose()
    }
  })
})

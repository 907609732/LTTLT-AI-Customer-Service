import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createKnowledgeRepository } from '../electron/knowledge'
import { createKnowledgePipelineCoordinator } from '../electron/knowledge/pipeline'
import {
  createKnowledgePipelineAssembly,
  createKnowledgeSourceModel,
  type KnowledgeCollectionProvider,
  type KnowledgePipelineOwner,
} from '../electron/runtime/knowledge-pipeline-assembly'

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
})

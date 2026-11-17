import path from 'node:path'
import { readFile, stat } from 'node:fs/promises'
import { dialog } from 'electron'
import type { Conversation } from '../../src/shared/contracts/backend'
import type { KnowledgeRepository } from '../knowledge'
import type {
  KnowledgeModelPort,
  KnowledgePipelinePort,
  KnowledgeRuntime,
} from '../knowledge-runtime'
import { createKnowledgeCollector } from '../knowledge/collector'
import { createKnowledgeDailyCheck } from '../knowledge/daily'
import { createKnowledgeImageOcr } from '../knowledge/image-ocr'
import { createKnowledgePipelineCoordinator } from '../knowledge/pipeline'
import { createKnowledgeSourcePipeline } from '../knowledge/source-pipeline'
import type { createPddLearningProvider } from '../pdd-learning-provider'

/** The knowledge runtime owns the registered pipeline; this assembly only supplies its live ports. */
export interface KnowledgePipelineOwner {
  setPipeline(port: KnowledgePipelinePort): void
  assertStore(storeId: string): void
  complete: KnowledgeRuntime['complete']
  vision: KnowledgeRuntime['vision']
  modelIdentity(): string
  modelMinimumIntervalMs(): number
}
export type KnowledgeCollectionProvider = Pick<
  ReturnType<typeof createPddLearningProvider>,
  'identity' | 'collectProducts' | 'readProductImage'
>
export type KnowledgeImageRecognizer = NonNullable<
  Parameters<typeof createKnowledgeImageOcr>[0]['recognize']
>
type KnowledgePipelineCoordinator = ReturnType<typeof createKnowledgePipelineCoordinator>

/** Keep the model port live: managed mode and per-account limits change after startup. */
export function createKnowledgeSourceModel(
  knowledge: Pick<
    KnowledgePipelineOwner,
    'complete' | 'vision' | 'modelIdentity' | 'modelMinimumIntervalMs'
  >,
): KnowledgeModelPort {
  return {
    complete: knowledge.complete,
    vision: knowledge.vision,
    identity: knowledge.modelIdentity,
    minimumIntervalMs: knowledge.modelMinimumIntervalMs,
  }
}

/**
 * Assembles collection, source import/learning and the daily check behind the single pipeline.
 * Read callbacks stay lazy because backend readiness and platform products are wired later.
 */
export function createKnowledgePipelineAssembly(options: {
  workspaceId: string
  repository: KnowledgeRepository
  knowledge: KnowledgePipelineOwner
  provider: KnowledgeCollectionProvider
  assertActive(): void
  getStore(storeId: string): { id: string; platform: string } | undefined
  conversations(): Conversation[]
  dailyAvailable(): boolean
  dailyStores(): string[]
  changed(): void
  recognizeImage?: KnowledgeImageRecognizer
  pipeline?: KnowledgePipelineCoordinator
}) {
  const pipeline = options.pipeline ?? createKnowledgePipelineCoordinator()
  pipeline.register(
    createKnowledgeCollector({
      repository: options.repository,
      provider: options.provider,
      readImage: options.provider.readProductImage,
      assertActive: options.assertActive,
      getStore: options.getStore,
      changed: options.changed,
    }),
  )
  pipeline.register(
    createKnowledgeSourcePipeline({
      repository: options.repository,
      imageOcr: createKnowledgeImageOcr({
        repository: options.repository,
        assertActive: options.assertActive,
        assertStore: options.knowledge.assertStore,
        recognize: options.recognizeImage,
      }),
      assertStore: options.knowledge.assertStore,
      model: createKnowledgeSourceModel(options.knowledge),
      assertActive: options.assertActive,
      changed: options.changed,
      chats: options.conversations,
      chooseFiles: async () => {
        const result = await dialog.showOpenDialog({
          title: '选择知识资料',
          properties: ['openFile', 'multiSelections'],
          filters: [
            {
              name: '知识资料',
              extensions: [
                'pdf',
                'docx',
                'xlsx',
                'csv',
                'txt',
                'md',
                'png',
                'jpg',
                'jpeg',
                'webp',
                'gif',
                'bmp',
                'json',
              ],
            },
          ],
        })
        options.assertActive()
        if (result.canceled) return []
        if (result.filePaths.length > 100) throw Error('一次最多100份资料')
        return Promise.all(
          result.filePaths.map(async (file) => {
            const info = await stat(file)
            if (!info.isFile() || info.size > 100 * 1024 * 1024)
              throw Error('仅接受100MB以内普通文件')
            return { name: path.basename(file), bytes: await readFile(file) }
          }),
        )
      },
    }),
  )
  options.knowledge.setPipeline(pipeline)
  const daily = createKnowledgeDailyCheck({
    repository: options.repository,
    available: options.dailyAvailable,
    stores: options.dailyStores,
    start: (storeId, bindingIds) =>
      pipeline.request({ action: 'start', kind: 'daily-check', storeId, bindingIds }),
  })
  return { pipeline, daily }
}

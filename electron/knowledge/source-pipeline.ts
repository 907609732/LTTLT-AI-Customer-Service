import type { KnowledgeRepository } from './repository'
import type { KnowledgeModelPort } from '../knowledge-runtime'
import type { KnowledgePipelineHandler } from './pipeline'
import type { Conversation } from '../../src/shared/contracts/backend'
import { createKnowledgeImporter } from './imports'
import { createKnowledgeLearner } from './learning'
import type { createKnowledgeImageOcr } from './image-ocr'
export function createKnowledgeSourcePipeline(options: {
  repository: KnowledgeRepository
  model: KnowledgeModelPort
  assertStore?(storeId: string): void
  assertActive(): void
  changed(): void
  chooseFiles(): Promise<{ name: string; bytes: Uint8Array }[]>
  chats(): Conversation[]
  imageOcr?: ReturnType<typeof createKnowledgeImageOcr>
}): KnowledgePipelineHandler {
  const importer = createKnowledgeImporter(options),
    learner = createKnowledgeLearner({ ...options, ocrText: options.imageOcr?.read })
  let closed = false
  const active = () => {
    if (closed) throw Error('资料服务已关闭')
    options.assertActive()
  }
  return {
    handles(input) {
      return (
        [
          'choose-sources',
          'recognize-images',
          'preview-import',
          'archive-chat',
          'store-materials',
          'review-targets',
          'estimate',
          'resolve-uncertain',
          'retry-received',
        ].includes(input.action) ||
        (input.action === 'start' && ['import', 'learn'].includes(input.kind)) ||
        ('jobId' in input &&
          ['learn', 'import'].includes(options.repository.getJob(input.jobId)?.kind ?? ''))
      )
    },
    async capabilities() {
      active()
      return { import: true, learn: true }
    },
    async request(input) {
      active()
      options.assertStore?.(input.storeId)
      if (input.action === 'recognize-images') {
        if (!options.imageOcr) throw Error('本机图片文字识别尚未接入')
        return options.imageOcr.recognize(input.storeId, input.bindingIds, input.sourceIds)
      }
      if (input.action === 'choose-sources') {
        const files = await options.chooseFiles()
        active()
        return { sourceIds: importer.registerFiles(input.storeId, files, input.bindingId) }
      }
      if (input.action === 'preview-import')
        return importer.preview(input.storeId, input.sourceIds, input.bindingIds ?? [])
      if (input.action === 'archive-chat') {
        if (input.from > input.to) throw Error('聊天起止日期无效')
        const chats = options.chats().filter((c) => c.storeId === input.storeId)
        let textCount = 0,
          mediaCount = 0
        const times: number[] = []
        const files = chats.flatMap((chat) => {
          const ranged = chat.messages.filter((m) => m.ts >= input.from && m.ts <= input.to)
          mediaCount += ranged.filter((m) => m.type && m.type !== 'text').length
          const messages = ranged.filter(
            (m) =>
              ['buyer', 'seller'].includes(m.from) &&
              (!m.type || m.type === 'text') &&
              m.content.trim(),
          )
          textCount += messages.length
          times.push(...messages.map((m) => m.ts))
          return messages.length
            ? [
                {
                  name: `归档-${chat.uid.replace(/[^\p{L}\p{N}_-]/gu, '_').slice(0, 100)}.json`,
                  bytes: Buffer.from(JSON.stringify(messages)),
                },
              ]
            : []
        })
        const sourceIds = importer.registerFiles(input.storeId, files)
        return {
          sourceIds,
          range: `本机归档${files.length}个会话、${textCount}条文字，${mediaCount}条媒体未转写；实际文字时间：${times.length ? new Date(Math.min(...times)).toLocaleString() + ' 至 ' + new Date(Math.max(...times)).toLocaleString() : '无'}。每会话现有归档最多100条；不代表平台全部历史。`,
        }
      }
      if (input.action === 'review-targets')
        return {
          targets: Object.fromEntries(
            input.entryIds.map((id) => {
              const entry = options.repository.getEntry(id)
              if (!entry) throw Error('审核条目不存在')
              const scope = entry.draft.scope
              const bindings =
                scope.kind === 'canonical'
                  ? options.repository.listBindings(scope.canonicalId)
                  : scope.kind === 'binding'
                    ? [options.repository.getBinding(scope.bindingId)].filter((b) => b !== null)
                    : []
              return [
                id,
                bindings.length
                  ? bindings
                      .map(
                        (b) => `${b.storeId}/${b.productId}${b.skuId ? ' · SKU ' + b.skuId : ''}`,
                      )
                      .join('、')
                  : scope.kind === 'store'
                    ? `店铺 ${scope.storeId}`
                    : '通用模板',
              ]
            }),
          ),
        }
      if (input.action === 'store-materials')
        return {
          sourceIds: options.repository
            .listSources({ storeId: input.storeId })
            .filter((s) => !s.bindingId && !s.label.startsWith('原文件：'))
            .map((s) => s.id),
        }
      if (input.action === 'estimate') {
        const ocr =
          options.imageOcr && input.bindingIds.length
            ? await options.imageOcr.recognize(input.storeId, input.bindingIds, input.sourceIds)
            : undefined
        const estimate = await learner.estimate(input.storeId, input.bindingIds, input.sourceIds)
        return {
          ...estimate,
          message:
            (ocr
              ? `已本机OCR识别${ocr.images}张图、${ocr.items.length}个分块，${ocr.characters}字；原图仍交给视觉模型核对。`
              : '') + estimate.message,
        }
      }
      if (input.action === 'start') {
        if (input.kind === 'import') {
          if (!input.estimateId) throw Error('请先预览导入范围')
          return importer.apply(input.estimateId, input.storeId)
        }
        return learner.start(
          input.storeId,
          input.bindingIds ?? [],
          input.sourceIds ?? [],
          input.estimateId,
        )
      }
      if (input.action === 'pause')
        return (
          options.repository.getJob(input.jobId)?.kind === 'import' ? importer : learner
        ).pause(input.storeId, input.jobId)
      if (input.action === 'cancel')
        return (
          options.repository.getJob(input.jobId)?.kind === 'import' ? importer : learner
        ).cancel(input.storeId, input.jobId)
      if (input.action === 'resume')
        return (
          options.repository.getJob(input.jobId)?.kind === 'import' ? importer : learner
        ).resume(input.storeId, input.jobId)
      if (input.action === 'resolve-uncertain')
        return learner.resolveUncertain(input.storeId, input.jobId, input.decision)
      if (input.action === 'retry-received')
        return learner.retryReceived(input.storeId, input.jobId)
      throw Error('资料操作不受支持')
    },
    removeStore(storeId) {
      options.imageOcr?.removeStore(storeId)
      importer.removeStore(storeId)
      learner.removeStore(storeId)
    },
    dispose() {
      options.imageOcr?.dispose()
      importer.dispose()
      learner.dispose()
      closed = true
    },
  }
}

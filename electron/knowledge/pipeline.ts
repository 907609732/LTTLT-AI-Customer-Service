import type { KnowledgePipelinePort } from '../knowledge-runtime'
import type {
  KnowledgePipelineInput,
  KnowledgePipelineResults,
  KnowledgePipelineCapabilities,
} from '../../src/shared/contracts/knowledge-pipeline'
export interface KnowledgePipelineHandler {
  handles(input: KnowledgePipelineInput): boolean
  request(
    input: KnowledgePipelineInput,
  ): Promise<KnowledgePipelineResults[keyof KnowledgePipelineResults]>
  capabilities(storeId: string): Promise<Partial<KnowledgePipelineCapabilities>>
  removeStore(storeId: string): void
  /** Resolve only after aborted workers can no longer write store data. */
  quiesceStore?(storeId: string): Promise<void>
  dispose(): void
}
/** Exactly one runtime registration; source/learning and daily handlers attach behind this dispatcher. */
export function createKnowledgePipelineCoordinator() {
  const handlers: KnowledgePipelineHandler[] = []
  let closed = false
  function cleanup(action: (handler: KnowledgePipelineHandler) => void) {
    const errors: unknown[] = []
    for (const handler of handlers)
      try {
        action(handler)
      } catch (cause) {
        errors.push(cause)
      }
    if (errors.length) throw new AggregateError(errors, '知识任务清理未全部成功')
  }
  const port: KnowledgePipelinePort & { register(handler: KnowledgePipelineHandler): void } = {
    register(handler) {
      if (closed) throw Error('知识任务已关闭')
      handlers.push(handler)
    },
    async request<T extends KnowledgePipelineInput>(
      input: T,
    ): Promise<KnowledgePipelineResults[T['action']]> {
      if (closed) throw Error('知识任务已关闭')
      if (input.action === 'capabilities') {
        const value: KnowledgePipelineCapabilities = {
          catalog: false,
          collect: false,
          import: false,
          learn: false,
          dailyCheck: false,
          reason: '',
        }
        const reasons: string[] = []
        for (const handler of handlers) {
          const capabilities = await handler.capabilities(input.storeId)
          for (const key of ['catalog', 'collect', 'import', 'learn', 'dailyCheck'] as const)
            value[key] ||= capabilities[key] === true
          if (capabilities.reason) reasons.push(capabilities.reason)
        }
        value.reason = reasons.join('；')
        return value as KnowledgePipelineResults[T['action']]
      }
      const handler = handlers.find((handler) => handler.handles(input))
      if (!handler) throw Error('此知识任务能力尚未接入')
      return (await handler.request(input)) as KnowledgePipelineResults[T['action']]
    },
    removeStore(storeId) {
      cleanup((handler) => handler.removeStore(storeId))
    },
    async quiesceStore(storeId) {
      const results = await Promise.allSettled(
        handlers.map((handler) => handler.quiesceStore?.(storeId) ?? Promise.resolve()),
      )
      const errors = results.flatMap((result) =>
        result.status === 'rejected' ? [result.reason] : [],
      )
      if (errors.length) throw new AggregateError(errors, '知识任务未能完全停止')
    },
    dispose() {
      if (closed) return
      closed = true
      cleanup((handler) => handler.dispose())
    },
  }
  return port
}

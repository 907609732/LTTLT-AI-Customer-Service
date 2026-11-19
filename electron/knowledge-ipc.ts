import { knowledgeRequestSchema } from '../src/shared/contracts/knowledge-client'
import { z } from 'zod'
import type { KnowledgeWindowManager } from './knowledge-window'
interface IpcPort {
  handle(name: string, handler: (event: unknown, input: unknown) => unknown): void
  removeHandler(name: string): void
}
/** Authorize the actual main frame before decoding data; always resolve the current account. */
export function registerKnowledgeIpc(options: {
  ipc: IpcPort
  authorize(event: unknown): void
  authorizeHide?(event: unknown): void
  resolve(): { workspaceId: string; request(input: unknown): Promise<unknown> }
  window: KnowledgeWindowManager
  clear?(
    workspaceId: string,
    token: string,
    confirmation: string,
  ): Promise<{ workspaceId: string; recovered: boolean; message: string }>
  restore?(
    workspaceId: string,
    token: string,
  ): Promise<{ workspaceId: string; recovered: boolean; message: string }>
}) {
  const handlers: Record<string, (input: unknown) => unknown> = {
    'knowledge:open': (input) => options.window.open(input),
    'knowledge:context': () => options.window.context(),
    'knowledge:hide': (input) => options.window.hide(z.string().min(1).parse(input)),
    'knowledge:request': (input) => {
      const request = knowledgeRequestSchema.parse(input),
        current = options.resolve()
      if (current.workspaceId !== request.workspaceId) throw Error('知识库工作区已改变')
      if (request.operation === 'clear') {
        if (!options.clear) throw Error('清除服务尚未接入')
        const storeId = options.window.context().storeId
        return options
          .clear(request.workspaceId, request.token, request.confirmation)
          .then((result) => {
            if (options.resolve().workspaceId !== result.workspaceId)
              throw Error('清除后账号已再次改变')
            options.window.rebind(result.workspaceId, storeId)
            return { ...result, context: options.window.context() }
          })
      }
      if (request.operation === 'restore') {
        if (!options.restore) throw Error('恢复服务尚未接入')
        const storeId = options.window.context().storeId
        return options.restore(request.workspaceId, request.token).then((result) => {
          if (options.resolve().workspaceId !== result.workspaceId)
            throw Error('恢复后账号已再次改变')
          options.window.rebind(result.workspaceId, storeId)
          return { ...result, context: options.window.context() }
        })
      }
      return current.request(request).then((result) => {
        if (options.resolve().workspaceId !== request.workspaceId)
          throw Error('知识库工作区已改变，已丢弃旧结果')
        return result
      })
    },
  }
  for (const [name, handler] of Object.entries(handlers))
    options.ipc.handle(name, (event, input) => {
      options.authorize(event)
      if (name === 'knowledge:hide') options.authorizeHide?.(event)
      return handler(input)
    })
  return () => Object.keys(handlers).forEach((name) => options.ipc.removeHandler(name))
}

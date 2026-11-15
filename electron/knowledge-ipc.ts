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
  resolve(): { workspaceId: string; request(input: unknown): Promise<unknown> }
  window: KnowledgeWindowManager
}) {
  const handlers: Record<string, (input: unknown) => unknown> = {
    'knowledge:open': (input) => options.window.open(input),
    'knowledge:context': () => options.window.context(),
    'knowledge:hide': (input) => options.window.hide(z.string().min(1).parse(input)),
    'knowledge:request': (input) => {
      const request = knowledgeRequestSchema.parse(input),
        current = options.resolve()
      if (current.workspaceId !== request.workspaceId) throw Error('知识库工作区已改变')
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
      return handler(input)
    })
  return () => Object.keys(handlers).forEach((name) => options.ipc.removeHandler(name))
}

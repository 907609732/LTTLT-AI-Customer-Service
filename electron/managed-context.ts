import { createHash, randomUUID } from 'node:crypto'
import type { CompressionInput } from './context-compression'

export interface ManagedSummaryInput {
  parent_request_id: string
  history: string
  max_tokens: number
}
/** 服务端摘要接口的上限；客户端先按同一口径拒绝，避免把超限资料当成可重试的普通错误。 */
const HISTORY_LIMIT = 96 * 1024
const SUMMARY_TOKEN_LIMIT = 7000
const MAX_BINDINGS = 16
const CANCELLATION_POLL_MS = 100
const digest = (messages: unknown) =>
  createHash('sha256').update(JSON.stringify(messages)).digest('hex')

/**
 * 免费托管摘要只属于一次具体回复：摘要请求使用新的 parent_request_id，随后用同一 ID
 * 作为这次回复的 client_request_id，服务端才按“每笔回复至多一次内部摘要”免费对账。
 * 绑定表只保存在主进程内存，按摘要后的 messages 摘要匹配，最多保留 16 条。
 */
export function createManagedContextBridge(
  summarize: (
    input: ManagedSummaryInput,
    traceId?: string,
    signal?: AbortSignal,
  ) => Promise<string>,
) {
  const parents = new Map<string, string>()
  const bound = (input: ManagedSummaryInput) => {
    if (!/^[a-f0-9-]{36}$/i.test(input.parent_request_id)) throw new Error('内部摘要父请求标识无效')
    if (!input.history || Buffer.byteLength(input.history) > HISTORY_LIMIT)
      throw new Error('内部摘要资料超过上限，未发送压缩请求')
    if (
      !Number.isInteger(input.max_tokens) ||
      input.max_tokens < 1 ||
      input.max_tokens > SUMMARY_TOKEN_LIMIT
    )
      throw new Error('内部摘要预算无效')
    return input
  }
  return {
    async prepare<T extends { messages: unknown }>(
      prepare: (input: CompressionInput) => Promise<T>,
      input: CompressionInput,
    ): Promise<T> {
      const parent = randomUUID()
      let summarized = false
      const output = await prepare({
        ...input,
        summarize: async ({ history, maxTokens, traceId }) => {
          // 压缩器只能给出当前请求的资料；身份/停止 AI/换店后立刻取消，不等待超时。
          const abort = new AbortController()
          const check = () => {
            if (input.isCurrent && !input.isCurrent()) abort.abort()
          }
          const canceled = () =>
            Object.assign(new Error('上下文准备已取消'), { code: 'queued_canceled' })
          check()
          if (abort.signal.aborted) throw canceled()
          const timer = setInterval(check, CANCELLATION_POLL_MS)
          try {
            const text = await summarize(
              bound({ parent_request_id: parent, history, max_tokens: maxTokens }),
              traceId,
              abort.signal,
            )
            summarized = true
            return text
          } catch (error) {
            // 取消（而不是摘要服务失败）按队列取消处理，不记为压缩失败让用户重试。
            if (abort.signal.aborted || (input.isCurrent && !input.isCurrent())) throw canceled()
            throw error
          } finally {
            clearInterval(timer)
          }
        },
      })
      if (input.isCurrent && !input.isCurrent())
        throw Object.assign(new Error('上下文准备已取消'), { code: 'queued_canceled' })
      if (summarized) {
        if (parents.size >= MAX_BINDINGS) parents.delete(parents.keys().next().value!)
        parents.set(digest(output.messages), parent)
      }
      return output
    },
    /** 摘要只对紧接着的一次回复生效；取用后即删除，避免旧绑定被复用到后来的请求。 */
    bind<T extends { client_request_id: string; messages: unknown }>(payload: T): T {
      const key = digest(payload.messages)
      const parent = parents.get(key)
      if (!parent) return payload
      parents.delete(key)
      return { ...payload, client_request_id: parent }
    },
    clear() {
      parents.clear()
    },
  }
}

import { describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'
import path from 'node:path'
import { createConversationThread } from '../electron/conversation-context'
import type { Conversation } from '../src/shared/contracts/backend'

const message = (content: string, ts: number, from = 'buyer', msgId = content) => ({
  content,
  ts,
  from,
  msgId,
  type: 'text',
})
const archive = (
  storeId: string,
  uid: string,
  messages: Conversation['messages'],
): Conversation => ({
  storeId,
  uid,
  messages,
  name: '测试买家',
  status: 'pending',
})

describe('本机完整已采集上下文', () => {
  it('真实 AiClient 请求正文和调试记录均含归档的商品诉求及实际客服回复', async () => {
    const { AiClient } = createRequire(import.meta.url)(
      path.resolve('vendor/lingtu-runtime/desk-v1/src/main/ai-client.js'),
    ) as {
      AiClient: new (options: Record<string, unknown>) => {
        reply(input: Record<string, unknown>): Promise<unknown>
        dispose(): void
      }
    }
    const calls: { messages: unknown }[] = []
    const traces: Record<string, unknown>[] = []
    const client = new AiClient({
      getConfig: () => ({ ai: { baseUrl: 'http://127.0.0.1:12345/v1', model: 'fixture' } }),
      secretReader: () => '',
      onTrace: (event: Record<string, unknown>) => traces.push(event),
      fetchImpl: async (_url: string, init: { body: string }) => {
        calls.push(JSON.parse(init.body) as { messages: unknown })
        return {
          ok: true,
          text: async () =>
            JSON.stringify({ choices: [{ message: { content: '{"reply":"M8 螺丝"}' } }] }),
        }
      },
    })
    try {
      const thread = createConversationThread(() => [
        archive('s', 'u', [message('想买 M8 螺丝', 10000), message('需要多长？', 20000, 'seller')]),
      ])({ storeId: 's', uid: 'u', history: [], rowMessages: [message('刚才那款', 30000)] })
      await client.reply({ systemPrompt: '测试规则', thread })
      const body = JSON.stringify(calls[0].messages)
      expect(body).toContain('买家：想买 M8 螺丝')
      expect(body).toContain('客服：需要多长？')
      expect(body).toContain('买家：刚才那款')
      expect(traces.find((t) => t.type === 'request')?.messages).toEqual(calls[0].messages)
    } finally {
      client.dispose()
    }
  })
  it('平台历史失败时仍包含早期商品诉求和客服回复，不再截成 20 条', () => {
    const messages = Array.from({ length: 35 }, (_, i) =>
      message(i === 0 ? '需要 M8 螺丝' : `对话${i}`, i * 10000, i % 2 ? 'seller' : 'buyer'),
    )
    const resolve = createConversationThread(() => [archive('shop', 'buyer', messages)])
    const result = resolve({
      storeId: 'shop',
      uid: 'buyer',
      history: [],
      rowMessages: [message('刚才询问的商品', 400000)],
    })
    expect(result).toHaveLength(36)
    expect(result[0].content).toBe('需要 M8 螺丝')
    expect(result[1].from).toBe('seller')
    expect(result.at(-1)?.content).toBe('刚才询问的商品')
  })

  it('同时按店铺和买家隔离，并在每次调用读取最新归档', () => {
    const rows = [
      archive('a', 'u', [message('本店历史', 1)]),
      archive('b', 'u', [message('其他店秘密', 2)]),
      archive('a', 'other', [message('其他买家秘密', 3)]),
    ]
    const resolve = createConversationThread(() => rows)
    const input = { storeId: 'a', uid: 'u', history: [], rowMessages: [] }
    expect(resolve(input).map((m) => m.content)).toEqual(['本店历史'])
    rows[0].messages.push(message('已确认发送的回复', 20, 'seller'))
    expect(resolve(input).map((m) => m.content)).toEqual(['本店历史', '已确认发送的回复'])
  })

  it('合并三种来源、时间排序，保留不同真实 ID 的重复文字，不修改原始归档', () => {
    const rows = [archive('s', 'u', [message('你好', 20000, 'buyer', 'dom:1')])]
    const resolve = createConversationThread(() => rows)
    const result = resolve({
      storeId: 's',
      uid: 'u',
      history: [message('之前回复', 10000, 'seller'), message('你好', 20001, 'buyer', 'real1')],
      rowMessages: [message('你好', 20002, 'buyer', 'real2')],
    })
    expect(result.map((m) => m.msgId)).toEqual(['之前回复', 'real1', 'real2'])
    expect(rows[0].messages[0].msgId).toBe('dom:1')
  })
})

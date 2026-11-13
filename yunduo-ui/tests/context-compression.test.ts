import { createRequire } from 'node:module'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  createContextCompressor,
  estimateContextTokens,
  CONTEXT_TRIGGER,
  CONTEXT_TARGET,
  type CompressionInput,
  type ModelMessages,
} from '../electron/context-compression'

function fixture(): CompressionInput {
  const thread = Array.from({ length: 6 }, (_, i) => ({
    from: i % 2 ? 'seller' : 'buyer',
    content: i < 2 ? '历史买家订单123金额50元，未解决退款。'.repeat(1800) : `最近消息${i}`,
    ts: i + 1,
    type: 'text',
  }))
  return {
    messages: [
      { role: 'system', content: '系统规则不能修改' },
      { role: 'user', content: thread.map((m) => m.content).join('\n') },
    ],
    thread,
    knowledge: [{ title: '本店独有知识' }],
    reviewContext: { storeId: 'shop-A', uid: 'buyer-A' },
    complete: async () => '买家订单123，金额50元，退款未解决，客服没有承诺退款。',
  }
}
describe('16K → 8K 上下文压缩', () => {
  it('阈值以下保持原文且不调用模型，等于 16384 即触发', async () => {
    const compress = createContextCompressor(() => undefined),
      input = fixture()
    const messages: ModelMessages = [
      { role: 'system', content: '规则' },
      { role: 'user', content: '' },
    ]
    const overhead = estimateContextTokens(messages)
    messages[1].content = ' x'.repeat(CONTEXT_TRIGGER - overhead - 1)
    expect(estimateContextTokens(messages)).toBe(CONTEXT_TRIGGER - 1)
    const complete = vi.fn(input.complete)
    const below = await compress({ ...input, messages, complete })
    expect(below.messages).toEqual(messages)
    expect(complete).not.toHaveBeenCalled()
    messages[1].content += ' x'
    expect(estimateContextTokens(messages)).toBe(CONTEXT_TRIGGER)
    const at = await compress({ ...input, messages, complete })
    expect(at.compression.triggered).toBe(true)
    expect(complete).toHaveBeenCalledTimes(1)
  })
  it('保留系统规则、最近原文、图片，旧资料做摘要且总量不超过8192', async () => {
    const input = fixture(),
      original = structuredClone(input.thread)
    const messages = input.messages as ModelMessages
    messages[1].content = [
      { type: 'text', text: String(messages[1].content) },
      { type: 'image_url', image_url: { url: 'https://images.example.com/fixture.png' } },
    ]
    const output = await createContextCompressor(() => undefined)(input)
    expect(output.compression.beforeTokens).toBeGreaterThan(CONTEXT_TRIGGER)
    expect(output.compression.afterTokens).toBeLessThanOrEqual(CONTEXT_TARGET)
    expect(output.messages[0]).toEqual(messages[0])
    expect(JSON.stringify(output.messages)).toContain('最近消息5')
    expect(JSON.stringify(output.messages)).toContain('fixture.png')
    expect(input.thread).toEqual(original)
    expect(output.compression.summary).toContain('没有承诺')
  })
  it('模型不遵守摘要输出长度时只收紧摘要，仍保留最后原文', async () => {
    const input = fixture()
    input.complete = async () => '摘要事实尚未解决。'.repeat(9000)
    const output = await createContextCompressor(() => undefined)(input)
    expect(output.compression.clipped).toBe(true)
    expect(output.compression.afterTokens).toBeLessThanOrEqual(CONTEXT_TARGET)
    expect(output.compression.afterTokens).toBeGreaterThan(7800)
    expect(JSON.stringify(output.messages)).toContain('最近消息5')
  })
  it('保护内容本身过大或摘要失败时终止，不回退发送原始大请求', async () => {
    const compress = createContextCompressor(() => undefined),
      input = fixture()
    input.complete = vi.fn(async () => {
      throw new Error('provider failure')
    })
    await expect(compress(input)).rejects.toMatchObject({ code: 'context_compression_failed' })
    input.messages = [
      { role: 'system', content: '禁止修改系统规则。'.repeat(9000) },
      { role: 'user', content: '你好' },
    ]
    const complete = vi.fn(async () => '不会调用')
    await expect(compress({ ...input, complete })).rejects.toMatchObject({
      code: 'context_compression_failed',
    })
    expect(complete).not.toHaveBeenCalled()
  })
  it('任务失效后不继续摘要，特殊 token 文本作为普通资料处理', async () => {
    const input = fixture(),
      complete = vi.fn(input.complete)
    await expect(
      createContextCompressor(() => undefined)({ ...input, complete, isCurrent: () => false }),
    ).rejects.toMatchObject({ code: 'queued_canceled' })
    expect(complete).not.toHaveBeenCalled()
    expect(estimateContextTokens([{ role: 'user', content: '<|endoftext|>' }])).toBeGreaterThan(0)
  })
  it('真实 AiClient 先请求摘要，再发送压缩后的最终上下文', async () => {
    interface Client {
      reply(options: Record<string, unknown>): Promise<{ reply: string }>
      dispose(): void
    }
    const { AiClient } = createRequire(import.meta.url)(
      path.resolve('vendor/lingtu-runtime/desk-v1/src/main/ai-client.js'),
    ) as { AiClient: new (options: Record<string, unknown>) => Client }
    const calls: { messages: ModelMessages; max_tokens: number }[] = []
    const traces: Record<string, unknown>[] = []
    const trace = (event: unknown) => {
      traces.push(event as Record<string, unknown>)
      return String(traces.length)
    }
    const client = new AiClient({
      getConfig: () => ({
        ai: { provider: 'openai', baseUrl: 'http://127.0.0.1:12345/v1', model: 'fixture-model' },
        reply: {},
      }),
      secretReader: () => '',
      prepareContext: createContextCompressor(trace),
      onTrace: trace,
      fetchImpl: async (_url: string, init: { body: string }) => {
        const body = JSON.parse(init.body) as { messages: ModelMessages; max_tokens: number }
        calls.push(body)
        return {
          ok: true,
          text: async () =>
            JSON.stringify({
              choices: [
                {
                  message: {
                    content:
                      calls.length === 1
                        ? '买家订单123，退款未处理，不新增承诺。'
                        : '{"reply":"压缩后回复"}',
                  },
                },
              ],
            }),
        }
      },
    })
    try {
      const result = await client.reply({
        thread: fixture().thread,
        systemPrompt: '保持客服规则',
        reviewContext: { storeId: 'A', uid: 'buyer' },
      })
      expect(result.reply).toBe('压缩后回复')
      expect(calls).toHaveLength(2)
      expect(calls[0].max_tokens).toBeGreaterThan(512)
      expect(estimateContextTokens(calls[1].messages)).toBeLessThanOrEqual(CONTEXT_TARGET)
      const final = traces.find((t) => t.type === 'request' && t.purpose !== 'compression')
      expect(final?.messages).toEqual(calls[1].messages)
      expect(final?.compression).toMatchObject({ triggered: true })
    } finally {
      client.dispose()
    }
  })
})

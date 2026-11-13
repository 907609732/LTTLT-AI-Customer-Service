import { createRequire } from 'node:module'
import path from 'node:path'
import { expect, it } from 'vitest'

interface Client {
  reply(options: Record<string, unknown>): Promise<{ reply: string }>
  dispose(): void
}
const { AiClient } = createRequire(import.meta.url)(
  path.resolve('vendor/lingtu-runtime/desk-v1/src/main/ai-client.js'),
) as { AiClient: new (options: Record<string, unknown>) => Client }

it('AI 耗时从收到生成请求开始，含上下文准备，到正文完成结束', async () => {
  const events: Record<string, unknown>[] = []
  const before = Date.now()
  const client = new AiClient({
    getConfig: () => ({
      ai: { provider: 'openai', baseUrl: 'http://127.0.0.1:12345/v1', model: 'fixture' },
      reply: {},
    }),
    secretReader: () => '',
    prepareContext: async ({ messages }: { messages: unknown }) => {
      await new Promise((resolve) => setTimeout(resolve, 20))
      return { messages }
    },
    fetchImpl: async () => {
      await new Promise((resolve) => setTimeout(resolve, 20))
      return {
        ok: true,
        text: async () =>
          JSON.stringify({ choices: [{ message: { content: '{"reply":"计时测试"}' } }] }),
      }
    },
    onTrace: (event: unknown) => {
      events.push(event as Record<string, unknown>)
      return 'trace'
    },
  })
  try {
    expect(
      (await client.reply({ thread: [{ from: 'buyer', type: 'text', content: '你好' }] })).reply,
    ).toBe('计时测试')
    const request = events.find((event) => event.type === 'request'),
      result = events.find((event) => event.type === 'result')
    expect(request?.startedAt).toBeGreaterThanOrEqual(before)
    expect(result?.durationMs).toBeTypeOf('number')
    expect(Number(result?.durationMs)).toBeGreaterThanOrEqual(25)
  } finally {
    client.dispose()
  }
})

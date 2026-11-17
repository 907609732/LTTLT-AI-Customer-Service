import { createRequire } from 'node:module'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, it } from 'vitest'
import { createManagedContextBridge, type ManagedSummaryInput } from '../electron/managed-context'
import type { CompressionInput } from '../electron/context-compression'

const require = createRequire(import.meta.url)
const { createBackend } = require('../vendor/lingtu-runtime/electron/backend.cjs') as {
  createBackend(options: Record<string, unknown>): {
    engine: { aiClient: { reply(options: unknown): Promise<unknown> } }
    snapshot(): { modelIssue?: { context?: { requestId?: string } } }
    dispose(): void
  }
}

it('摘要父回复 ID 用于同一笔回复的托管请求，且只索取一次免费摘要', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'lingtu-billing-id-'))
  if (path.dirname(root) !== tmpdir()) throw Error('unexpected temporary directory')
  const summaries: ManagedSummaryInput[] = []
  const traceIds: (string | undefined)[] = []
  let sent = ''
  let failReply = false
  const bridge = createManagedContextBridge(async (input, traceId) => {
    summaries.push(input)
    traceIds.push(traceId)
    return '服务端摘要正文'
  })
  const backend = createBackend({
    dataDir: root,
    modelMode: 'managed',
    resolveManagedRequestId: (messages: unknown, requestId: string) =>
      bridge.bind({ client_request_id: requestId, messages }).client_request_id,
    prepareModelContext: (input: CompressionInput) =>
      bridge.prepare(async (prepared) => {
        const summary = await prepared.summarize!({
          history: JSON.stringify({ earlierMessages: [{ from: 'buyer', content: '较早历史' }] }),
          maxTokens: 512,
          traceId: 'compression-trace',
        })
        return { messages: [{ role: 'user', content: `压缩后：${summary}` }], compression: {} }
      }, input),
    managedChat: async (payload: { client_request_id: string; messages: unknown }) => {
      // 与 electron/local-runtime.ts 相同的装配：回复沿用摘要父请求 ID。
      sent = payload.client_request_id
      if (failReply) throw new Error('合成上游失败')
      return { choices: [{ message: { content: '{"reply":"合成回复"}' } }] }
    },
    managerFactory: () => ({ stateOf: () => ({ open: true, online: true }), closeAll() {} }),
    adapterFactory: () => ({
      syncAiEnabled: async () => {},
      focusConversation: async () => ({ ok: true }),
      sendText: async () => ({ ok: true }),
    }),
  })
  try {
    await backend.engine.aiClient.reply({
      systemPrompt: '规则',
      thread: [{ from: 'buyer', type: 'text', content: '合成问题' }],
    })
    expect(summaries).toHaveLength(1)
    expect(traceIds[0]).toBe('compression-trace')
    // 上游生成的随机 UUID 被摘要父 ID 取代：服务端据此只记账一次内部摘要。
    expect(sent).toBe(summaries[0]!.parent_request_id)
    expect(sent).toMatch(/^[a-f0-9-]{36}$/)
    failReply = true
    await expect(
      backend.engine.aiClient.reply({
        systemPrompt: '规则',
        thread: [{ from: 'buyer', type: 'text', content: '另一笔合成问题' }],
      }),
    ).rejects.toThrow()
    expect(sent).toBe(summaries[1]!.parent_request_id)
    expect(backend.snapshot().modelIssue?.context?.requestId).toBe(sent)
  } finally {
    backend.dispose()
    rmSync(root, { recursive: true, force: true })
  }
})

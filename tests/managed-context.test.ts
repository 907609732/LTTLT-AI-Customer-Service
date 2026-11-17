import { afterEach, describe, expect, it, vi } from 'vitest'
import { createManagedContextBridge, type ManagedSummaryInput } from '../electron/managed-context'
import type { CompressionInput } from '../electron/context-compression'

afterEach(() => vi.useRealTimers())

const compressionInput = (isCurrent?: () => boolean): CompressionInput => ({
  messages: [{ role: 'user', content: '原始问答' }],
  thread: [{ from: 'buyer', content: '合成问题' }],
  isCurrent,
  complete: async () => '本机摘要',
})

describe('免费托管摘要绑定', () => {
  it('摘要父请求 ID 只绑定到紧接着的一次回复，取用后即失效', async () => {
    const summarize = vi.fn(
      async (_input: ManagedSummaryInput, _traceId?: string, _signal?: AbortSignal) => '服务端摘要',
    )
    const bridge = createManagedContextBridge(summarize)
    const compressed = [{ role: 'user', content: '压缩后的请求' }]
    const result = await bridge.prepare(
      async (input) => ({
        messages: compressed,
        summary: await input.summarize!({
          history: JSON.stringify({ earlierMessages: [{ from: 'buyer', content: '较早历史' }] }),
          maxTokens: 512,
          traceId: 'trace-1',
        }),
      }),
      compressionInput(),
    )
    expect(result.summary).toBe('服务端摘要')
    expect(summarize).toHaveBeenCalledTimes(1)
    const sent = summarize.mock.calls[0]![0]
    expect(sent.history).toContain('较早历史')
    expect(sent.max_tokens).toBe(512)
    expect(sent.parent_request_id).toMatch(/^[a-f0-9-]{36}$/)
    expect(summarize.mock.calls[0]![1]).toBe('trace-1')
    const bound = bridge.bind({ client_request_id: 'random-uuid', messages: compressed })
    expect(bound.client_request_id).toBe(sent.parent_request_id)
    // 第二次回复仍使用自己的请求 ID，不把同一摘要免费资格重复使用。
    expect(
      bridge.bind({ client_request_id: 'other-uuid', messages: compressed }).client_request_id,
    ).toBe('other-uuid')
  })

  it('未发生摘要的回复不改变请求 ID', async () => {
    const bridge = createManagedContextBridge(async () => '不应调用')
    const output = await bridge.prepare(
      async (input) => ({ messages: input.messages }),
      compressionInput(),
    )
    expect(output.messages).toEqual([{ role: 'user', content: '原始问答' }])
    const payload = { client_request_id: 'keep-me', messages: output.messages }
    expect(bridge.bind(payload)).toBe(payload)
  })

  it('超过服务端上限的资料与预算在发请求前拒绝', async () => {
    const summarize = vi.fn(async () => '摘要')
    const bridge = createManagedContextBridge(summarize)
    const run = (options: { history: string; maxTokens: number }) =>
      bridge.prepare(
        (input) =>
          input.summarize!({ ...options, traceId: 'trace' }).then((summary) => ({
            messages: [],
            summary,
          })),
        compressionInput(),
      )
    await expect(run({ history: 'x'.repeat(96 * 1024 + 1), maxTokens: 512 })).rejects.toThrow(
      '上限',
    )
    await expect(run({ history: '{}', maxTokens: 7001 })).rejects.toThrow('预算')
    await expect(run({ history: '', maxTokens: 512 })).rejects.toThrow()
    expect(summarize).not.toHaveBeenCalled()
  })

  it('身份或会话不再当前时取消进行中的摘要请求', async () => {
    vi.useFakeTimers()
    let current = true
    const signals: AbortSignal[] = []
    const summarize = vi.fn(
      (_input: ManagedSummaryInput, _traceId?: string, signal?: AbortSignal) =>
        new Promise<string>((_resolve, reject) => {
          signals.push(signal!)
          signal?.addEventListener('abort', () => reject(new Error('canceled')))
        }),
    )
    const bridge = createManagedContextBridge(summarize)
    // 先接住拒绝，避免定时器推进期间出现未处理的 Promise 拒绝。
    let failure: Error | undefined
    const pending = bridge
      .prepare(
        (input) =>
          input.summarize!({ history: '{}', maxTokens: 256 }).then((summary) => ({
            messages: [],
            summary,
          })),
        compressionInput(() => current),
      )
      .catch((error: Error) => {
        failure = error
        return { messages: [], summary: '' }
      })
    await vi.advanceTimersByTimeAsync(1)
    current = false
    await vi.advanceTimersByTimeAsync(200)
    await pending
    // 取消按队列取消呈现，不冒充摘要服务失败让用户重试。
    expect(failure?.message).toBe('上下文准备已取消')
    expect((failure as { code?: string } | undefined)?.code).toBe('queued_canceled')
    expect(signals[0]?.aborted).toBe(true)
  })

  it('清空绑定后不再复用旧摘要的父请求 ID', async () => {
    const bridge = createManagedContextBridge(async () => '摘要')
    const compressed = [{ role: 'user', content: '压缩后的请求' }]
    await bridge.prepare(
      (input) =>
        input.summarize!({ history: '{}', maxTokens: 256 }).then(() => ({ messages: compressed })),
      compressionInput(),
    )
    bridge.clear()
    expect(
      bridge.bind({ client_request_id: 'fresh-uuid', messages: compressed }).client_request_id,
    ).toBe('fresh-uuid')
  })
})

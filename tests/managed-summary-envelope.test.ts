import { expect, it } from 'vitest'
import { createContextCompressor, type CompressionInput } from '../electron/context-compression'

interface HistoryEnvelope {
  earlierMessages: Array<{ messages?: unknown[] }>
  knowledge: unknown[]
}
async function compress(input: Omit<CompressionInput, 'complete'>) {
  let history!: HistoryEnvelope
  const output = await createContextCompressor(() => undefined)({
    ...input,
    complete: async () => {
      throw new Error('不得回退收费聊天接口')
    },
    summarize: async ({ history: raw }) => {
      history = JSON.parse(raw) as HistoryEnvelope
      // 当前服务端 parseSummary 的历史记录数量约束。
      if (!history.earlierMessages.length || history.earlierMessages.length > 100)
        throw new Error('invalid summary')
      return '保留事实的摘要'
    },
  })
  return { history, output }
}

it('超过100条历史保留全部角色、时间和原文，且符合现有摘要接口记录上限', async () => {
  const thread = Array.from({ length: 120 }, (_, i) => ({
    from: i % 2 ? 'seller' : 'buyer',
    ts: i + 1,
    content: `${i}买家订单未处理。`.repeat(20),
    type: 'text',
  }))
  const { history, output } = await compress({
    messages: [
      { role: 'system', content: '客服规则' },
      { role: 'user', content: thread.map((m) => m.content).join('\n') },
    ],
    thread,
    knowledge: [{ title: '商品参考' }],
  })
  const preserved = history.earlierMessages.flatMap((entry) => entry.messages ?? [entry])
  expect(preserved).toEqual(thread.slice(0, -4))
  expect(output.compression.triggered).toBe(true)
})

it('仅检索资料超限时使用明确空历史批次，保留资料和近期买家原文', async () => {
  const knowledge = [{ title: '商品参考', body: '待核对资料。'.repeat(4000) }]
  const { history, output } = await compress({
    messages: [
      { role: 'system', content: '客服规则' },
      { role: 'user', content: knowledge[0].body },
    ],
    thread: [{ from: 'buyer', content: '这件商品如何保修', ts: 1 }],
    knowledge,
  })
  expect(history.earlierMessages).toEqual([{ messages: [] }])
  expect(history.knowledge).toEqual(knowledge)
  expect(JSON.stringify(output.messages)).toContain('这件商品如何保修')
})

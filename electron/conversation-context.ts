import { messageSchema, type Conversation } from '../src/shared/contracts/backend'

interface ThreadInput {
  storeId: string
  uid: string
  rowMessages: unknown[]
  history: unknown[]
}

/** 归档是平台历史接口不可用时的上下文来源；必须同时匹配店铺和买家，不能只按用户 ID 查找。 */
export function createConversationThread(read: () => Conversation[]) {
  return ({ storeId, uid, rowMessages, history }: ThreadInput) => {
    const archived = read().find((c) => c.storeId === storeId && c.uid === String(uid))
    const output: Conversation['messages'] = []
    for (const raw of [...(archived?.messages ?? []), ...history, ...rowMessages]) {
      const parsed = messageSchema.safeParse(raw)
      if (!parsed.success || !['buyer', 'seller'].includes(parsed.data.from)) continue
      const message = { ...parsed.data, type: parsed.data.type || 'text' }
      const realId = (id?: string) => !!id && !/^(dom:|st:|ts:)/.test(id)
      const previous = output.find((m) => {
        if (m.from !== message.from) return false
        if (realId(m.msgId) && realId(message.msgId)) return m.msgId === message.msgId
        // DOM 与接口的临时 ID 不同；只能在短时间内合并同角色、同正文、同媒体类型的重复采集。
        return (
          m.content === message.content &&
          (m.type || 'text') === (message.type || 'text') &&
          Math.abs(m.ts - message.ts) < 8000
        )
      })
      if (previous) {
        if (!realId(previous.msgId) && realId(message.msgId)) previous.msgId = message.msgId
      } else output.push({ ...message })
    }
    // 不在这里截成最近 20 条；全部已保留原文交给统一的 16K/8K 压缩器计量。
    return output.sort((a, b) => a.ts - b.ts)
  }
}

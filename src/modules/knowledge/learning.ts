import { z } from 'zod'
import type { Conversation, IntentPack, Product } from '@/shared/contracts/backend'

export type LearningSource =
  | { kind: 'chat'; storeId: string; uid: string; questionTs: number; answerTs: number }
  | { kind: 'product'; storeId: string; productId: string; version: number; updatedAt: number }
  | { kind: 'document'; storeId: string; label: string; line: number }
  | { kind: 'size'; storeId: string; label: string }
  | {
      kind: 'platform-products' | 'platform-chats'
      storeId: string
      platform: string
      accountId: string
      platformStoreId: string
      taskId: string
      candidateId: string
      recordId: string
      uid?: string
      messageIds: string[]
      capturedAt: number
      sourceUrl?: string
    }
export interface LearningCandidate {
  question: string
  answer: string
  productIds: string[]
  source: LearningSource
  original?: { question: string; answer: string }
}
export const auditQuestion = '【学习来源审计，请保持停用】'
const content = z.object({
  question: z.string().trim().min(1).max(1000),
  answer: z.string().trim().min(1).max(4000),
})

/** 仅整理已经存在的相邻文字，不推断客服答案，也不把模型候选当回复。 */
export function chatCandidates(
  storeId: string,
  conversations: Conversation[],
): LearningCandidate[] {
  const rows: LearningCandidate[] = []
  for (const thread of conversations.filter((row) => row.storeId === storeId)) {
    for (let i = 1; i < thread.messages.length; i++) {
      const question = thread.messages[i - 1]!,
        answer = thread.messages[i]!
      if (question.from !== 'buyer' || answer.from !== 'seller') continue
      if ([question, answer].some((m) => m.type && m.type !== 'text')) continue
      if (
        answer.ts < question.ts ||
        !content.safeParse({ question: question.content, answer: answer.content }).success
      )
        continue
      rows.push({
        question: question.content,
        answer: answer.content,
        productIds: [],
        source: {
          kind: 'chat',
          storeId,
          uid: thread.uid,
          questionTs: question.ts,
          answerTs: answer.ts,
        },
      })
    }
  }
  return rows.slice(0, 100)
}

export function productCandidates(storeId: string, products: Product[]): LearningCandidate[] {
  return products
    .filter((p) => p.storeId === storeId && p.enabled && p.specifications.trim())
    .slice(0, 100)
    .map((p) => ({
      ...content.parse({ question: `${p.title}的尺码/规格是什么？`, answer: p.specifications }),
      productIds: [p.productId],
      source: {
        kind: 'product',
        storeId,
        productId: p.productId,
        version: p.version,
        updatedAt: p.updatedAt,
      },
    }))
}

/** 有明确问答标记才接受；普通文档不能自动猜出事实对应的问法。 */
export function documentCandidates(
  storeId: string,
  label: string,
  text: string,
): LearningCandidate[] {
  z.string().trim().min(1).max(200).parse(label)
  z.string().max(100000).parse(text)
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  const rows: LearningCandidate[] = []
  let question = '',
    answer: string[] = [],
    line = 0,
    answering = false
  const flush = () => {
    if (!question) return
    const parsed = content.parse({ question, answer: answer.join('\n') })
    rows.push({
      ...parsed,
      productIds: [],
      source: { kind: 'document', storeId, label: label.trim(), line },
    })
  }
  lines.forEach((value, index) => {
    const q = /^问[：:]\s*(.*)$/.exec(value),
      a = /^答[：:]\s*(.*)$/.exec(value)
    if (q) {
      flush()
      question = q[1]!
      answer = []
      line = index + 1
      answering = false
    } else if (a && question && !answering) {
      answering = true
      answer.push(a[1]!)
    } else if (answering) answer.push(value)
    else if (value.trim()) throw new Error('请使用每组“问：…\n答：…”格式，不支持未标记文本')
  })
  flush()
  if (!rows.length || rows.length > 100) throw new Error('请提供 1～100 组明确问答')
  return rows
}

export function candidatePack(
  candidate: LearningCandidate,
): Omit<IntentPack, 'id' | 'version' | 'source'> {
  const parsed = content.parse(candidate)
  z.string().min(1).max(64).parse(candidate.source.storeId)
  const audit = JSON.stringify({
    schema: 'lingtu-learning-v1',
    source: candidate.source,
    original: content.parse(candidate.original ?? parsed),
    reviewed: parsed,
    productIds: candidate.productIds,
  })
  if (audit.length > 4000) throw new Error('原文与来源合计超过审计条目容量，请缩短后重新预览')
  return {
    name: `待审核 · ${parsed.question}`.slice(0, 100),
    enabled: false,
    storeIds: [candidate.source.storeId],
    productIds: [...candidate.productIds],
    entries: [
      { ...parsed, keywords: [], enabled: true },
      { question: auditQuestion, keywords: [], answer: audit, enabled: false },
    ],
  }
}

export function candidateExists(candidate: LearningCandidate, packs: IntentPack[]): boolean {
  return packs.some((pack) =>
    pack.entries.some((entry) => {
      if (entry.question !== auditQuestion || entry.enabled) return false
      try {
        const value: unknown = JSON.parse(entry.answer)
        const audit = z
          .object({
            schema: z.literal('lingtu-learning-v1'),
            source: z.unknown(),
            original: content,
            reviewed: content.optional(),
            productIds: z.array(z.string()).optional(),
          })
          .parse(value)
        return (
          JSON.stringify(audit.source) === JSON.stringify(candidate.source) &&
          (audit.reviewed ?? audit.original).question === candidate.question.trim() &&
          (audit.reviewed ?? audit.original).answer === candidate.answer.trim() &&
          JSON.stringify(audit.productIds ?? []) === JSON.stringify(candidate.productIds)
        )
      } catch {
        return false
      }
    }),
  )
}

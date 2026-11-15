import { expect, it } from 'vitest'
import { publishKnowledgeBatch } from '../src/modules/knowledge/batch-review'
import type { KnowledgeEntry } from '../src/shared/contracts/knowledge'
const entries = ['a', 'b', 'c'].map((id) => ({
  id,
  revision: 1,
  status: 'draft',
  approved: null,
  draft: {
    id,
    revision: 1,
    scope: { kind: 'binding', bindingId: id },
    question: id,
    answer: '保留草稿',
    keywords: [],
    field: 'fact',
    conflictKey: id,
    origin: 'manual',
    sourceRefs: [],
    expiresAt: null,
    updatedAt: 0,
  },
})) as KnowledgeEntry[]
it('reports approved, stale failure and excluded per product while continuing the batch', async () => {
  const result = await publishKnowledgeBatch(
    entries,
    ['c'],
    async (entry) => {
      if (entry.id === 'b') throw Error('来源已变化')
      return undefined
    },
    async (entry) => `商品${entry.id}`,
  )
  expect(result.map((r) => [r.target, r.status])).toEqual([
    ['商品a', 'approved'],
    ['商品b', 'failed'],
    ['商品c', 'skipped'],
  ])
  expect(result[1]?.reason).toContain('来源已变化')
  expect(entries[1]?.draft.answer).toBe('保留草稿')
})

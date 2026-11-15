import type { KnowledgeEntry, KnowledgeVersion } from '@/shared/contracts/knowledge'
export interface BatchReviewResult {
  entryId: string
  question: string
  target: string
  status: 'approved' | 'failed' | 'skipped'
  reason: string
}
/** Each item keeps its own optimistic revisions; one conflict cannot conceal prior successful writes. */
export async function publishKnowledgeBatch(
  entries: KnowledgeEntry[],
  excluded: string[],
  publish: (draft: KnowledgeVersion) => Promise<unknown>,
  target: (entry: KnowledgeEntry) => Promise<string>,
): Promise<BatchReviewResult[]> {
  const results: BatchReviewResult[] = []
  for (const entry of entries) {
    const result: BatchReviewResult = {
      entryId: entry.id,
      question: entry.draft.question,
      target: entry.id,
      status: 'skipped',
      reason: '已排除，草稿保留',
    }
    try {
      result.target = await target(entry)
      if (!excluded.includes(entry.id)) {
        await publish(entry.draft)
        result.status = 'approved'
        result.reason = '已审核发布'
      }
    } catch (cause) {
      result.status = 'failed'
      result.reason = cause instanceof Error ? cause.message : String(cause)
    }
    results.push(result)
  }
  return results
}

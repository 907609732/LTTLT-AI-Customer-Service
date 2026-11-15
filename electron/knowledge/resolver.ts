import MiniSearch from 'minisearch'
import { createHash } from 'node:crypto'
import type {
  KnowledgeCitation,
  KnowledgeEntry,
  KnowledgeField,
  KnowledgeResolution,
  KnowledgeResolveInput,
  ProductBinding,
  KnowledgeVersion,
} from '../../src/shared/contracts/knowledge'
import { knowledgeResolveSchema } from '../../src/shared/contracts/knowledge'
const segmenter = new Intl.Segmenter('zh-CN', { granularity: 'word' })
export const tokenizeKnowledge = (text: string) =>
  [...segmenter.segment(text.toLowerCase())]
    .filter((part) => part.isWordLike)
    .map((part) => part.segment)
export function eligibleKnowledge(
  bindings: ProductBinding[],
  entries: KnowledgeEntry[],
  input: KnowledgeResolveInput,
) {
  const context = knowledgeResolveSchema.parse(input)
  const matched = bindings.filter(
    (binding) =>
      binding.active &&
      binding.storeId === context.storeId &&
      binding.productId === context.productId &&
      (!binding.skuId || binding.skuId === context.skuId),
  )
  const canonicalIds = new Set(matched.map((binding) => binding.canonicalId))
  const status = !context.productId
    ? 'unspecified'
    : canonicalIds.size > 1
      ? 'ambiguous'
      : matched.length
        ? 'matched'
        : 'unknown'
  const exact =
    status === 'matched'
      ? (matched.find((binding) => binding.skuId === context.skuId) ?? matched[0])
      : undefined
  const candidates = entries
    .filter((entry) => entry.approved && entry.status !== 'withdrawn' && entry.status !== 'stale')
    .map((entry) => entry.approved!)
    .filter((version) => {
      if (
        version.field !== 'fact' &&
        context.skuId &&
        !matched.some((binding) => binding.skuId === context.skuId)
      )
        return false
      const scope = version.scope
      if (scope.kind === 'template') return scope.storeIds.includes(context.storeId)
      if (scope.kind === 'store') return scope.storeId === context.storeId
      if (!exact) return false
      if (scope.kind === 'canonical') return scope.canonicalId === exact.canonicalId
      return matched.some((binding) => binding.id === scope.bindingId)
    })
  // Include every applicable published override in the fingerprint, including expired ones.
  // A new scoped override invalidates an earlier candidate even if its cited entry did not change.
  const scopeVersion = createHash('sha256')
    .update(
      JSON.stringify({
        context: { storeId: context.storeId, productId: context.productId, skuId: context.skuId },
        bindings: matched.map((b) => [b.id, b.revision]).sort(),
        entries: candidates.map((e) => [e.id, e.revision]).sort(),
      }),
    )
    .digest('hex')
  return { context, matched, exact, status, candidates, scopeVersion } as const
}
export function resolveKnowledgeRows(
  bindings: ProductBinding[],
  entries: KnowledgeEntry[],
  input: KnowledgeResolveInput,
  now: number,
): KnowledgeResolution {
  const scope = eligibleKnowledge(bindings, entries, input)
  function priority(version: KnowledgeVersion) {
    if (version.scope.kind === 'binding')
      return scope.matched.find(
        (binding) =>
          binding.id === (version.scope.kind === 'binding' ? version.scope.bindingId : ''),
      )?.skuId
        ? 4
        : 3
    return version.scope.kind === 'store' ? 2 : version.scope.kind === 'canonical' ? 1 : 0
  }
  const winners = new Map<string, KnowledgeVersion>()
  for (const candidate of scope.candidates) {
    const key = candidate.field + ':' + candidate.conflictKey
    const old = winners.get(key)
    if (
      !old ||
      priority(candidate) > priority(old) ||
      (priority(candidate) === priority(old) && candidate.updatedAt >= old.updatedAt)
    )
      winners.set(key, candidate)
  }
  const expiredFields: KnowledgeField[] = []
  const active = [...winners.values()].filter((version) => {
    if (version.expiresAt !== null && version.expiresAt <= now) {
      expiredFields.push(version.field)
      return false
    }
    return true
  })
  const index = new MiniSearch({
    fields: ['question', 'answer', 'keywords'],
    tokenize: tokenizeKnowledge,
    extractField: (doc, field) =>
      field === 'keywords' ? (doc.keywords as string[]).join(' ') : (doc[field] as string),
  })
  index.addAll(active)
  const hits = scope.context.query.trim()
    ? index.search(scope.context.query, { prefix: true, combineWith: 'OR', boost: { question: 3 } })
    : active.map((version) => ({ id: version.id }))
  let characters = 0,
    omitted = 0
  const citations: KnowledgeCitation[] = []
  for (const hit of hits) {
    const version = active.find((row) => row.id === hit.id)!
    const cost = version.question.length + version.answer.length
    if (
      citations.length >= scope.context.limit ||
      characters + cost > scope.context.maxCharacters
    ) {
      omitted++
      continue
    }
    characters += cost
    citations.push({
      entryId: version.id,
      entryRevision: version.revision,
      question: version.question,
      answer: version.answer,
      field: version.field,
      scope: version.scope,
      bindingId: scope.exact?.id ?? null,
      bindingRevision: scope.exact?.revision ?? null,
      sourceRefs: version.sourceRefs,
      expiresAt: version.expiresAt,
      context: {
        storeId: scope.context.storeId,
        productId: scope.context.productId,
        skuId: scope.context.skuId,
      },
      scopeVersion: scope.scopeVersion,
    })
  }
  return {
    citations,
    characters,
    omitted,
    productStatus: scope.status,
    expiredFields: [...new Set(expiredFields)],
  }
}

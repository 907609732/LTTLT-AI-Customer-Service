import type { KnowledgeRepository } from './repository'
import { knowledgeRequire } from './node-loader'
import type { KnowledgeEntry } from '../../src/shared/contracts/knowledge'
const Papa = knowledgeRequire('papaparse') as {
  unparse(rows: object[], options: { escapeFormulae: RegExp }): string
}
export function exportKnowledge(
  repo: KnowledgeRepository,
  input: { storeId: string; canonicalId?: string; format: 'csv' | 'json' },
) {
  const bindings = repo
    .listBindings()
    .filter(
      (b) =>
        b.storeId === input.storeId && (!input.canonicalId || b.canonicalId === input.canonicalId),
    )
  const rows = repo.rows<KnowledgeEntry>('entries').flatMap((e) => {
    const v = e.draft,
      scope = v.scope
    const targets =
      scope.kind === 'canonical'
        ? bindings.filter((b) => !b.skuId && b.canonicalId === scope.canonicalId)
        : scope.kind === 'binding'
          ? bindings.filter((b) => b.id === scope.bindingId)
          : !input.canonicalId &&
              (scope.kind === 'store'
                ? scope.storeId === input.storeId
                : scope.storeIds.includes(input.storeId))
            ? [undefined]
            : []
    return targets.map((b) => ({
      productIds: b ? [b.productId] : [],
      skuId: b?.skuId ?? '',
      question: v.question,
      answer: v.answer,
      keywords: v.keywords,
      field: v.field,
      expiresAt: v.expiresAt,
    }))
  })
  const text =
    input.format === 'json'
      ? JSON.stringify(
          rows.map(({ productIds, ...entry }) => ({ productIds, entries: [entry] })),
          null,
          2,
        )
      : '\uFEFF' +
        Papa.unparse(
          rows.map((row) => {
            const value = {
              format: 'lingtu-knowledge-v1',
              productIds: JSON.stringify(row.productIds),
              skuId: row.skuId,
              question: row.question,
              answer: row.answer,
              keywords: JSON.stringify(row.keywords),
              field: row.field,
              expiresAt: row.expiresAt === null ? '' : String(row.expiresAt),
            }
            return {
              ...value,
              escapedFields: JSON.stringify(
                Object.entries(value)
                  .filter(([, v]) => /^[=+\-@\t\r]/.test(v))
                  .map(([k]) => k),
              ),
            }
          }),
          { escapeFormulae: /^[=+\-@\t\r]/ },
        )
  return {
    text,
    count: rows.length,
    message:
      '兼容导出仅含当前问答文本、商品/SKU映射与有效期；重新导入为未审核草稿。原件、历史、共享关联及审核记录请用备份。',
  }
}

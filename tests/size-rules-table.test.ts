import { describe, expect, it } from 'vitest'
import {
  blankSizeRuleDraft,
  sizeRuleSchema,
  type SizeRuleRecord,
} from '../src/shared/contracts/size-rules'
import {
  createSizeTableTemplate,
  exportSizeTable,
  previewSizeTable,
} from '../electron/size-rules/table'

function record(): SizeRuleRecord {
  return sizeRuleSchema.parse({
    ...blankSizeRuleDraft(),
    id: '9f7f45ea-896e-4b9a-a78f-2ec39e62fa81',
    version: 1,
    updatedAt: 1,
    name: 'CSV 往返',
    columns: [
      { id: 'c1', name: '胸围', kind: 'number', unit: 'cm' },
      { id: 'c2', name: '材质', kind: 'text', unit: 'none' },
      { id: 'c3', name: '数量', kind: 'number', unit: '件' },
    ],
    rows: [
      { label: 'M', values: { c1: '92~96', c2: '棉, 涤', c3: '2' } },
      { label: 'L', values: { c1: '96~100', c2: '=HYPERLINK("https://bad")', c3: '3' } },
    ],
  })
}

describe('size table CSV/TSV preview and export', () => {
  it('previews CSV and TSV with explicit units and text columns without saving', () => {
    const csv = previewSizeTable(
      '尺码,胸围(cm),衣长(cm),材质(文本)\nM,92~96,64,"棉,涤"\nL,96~100,66,棉',
    )
    expect(csv).toMatchObject({ count: 2 })
    expect(csv.columns[2]).toMatchObject({ name: '材质', kind: 'text', unit: 'none' })
    expect(csv.rows[0]?.values.c3).toBe('棉,涤')

    const tsv = previewSizeTable('规格\t长度(mm)\t数量(件)\n小号\t200\t2')
    expect(tsv.rows[0]?.values.c1).toBe('200')
    expect(tsv.columns[1]).toMatchObject({ name: '数量', unit: '件' })
  })

  it('rejects malformed headers, unsupported units, unequal columns, invalid cells and over 1 MB', () => {
    expect(() => previewSizeTable('规格,长度\n小,20')).toThrow(/单位/)
    expect(() => previewSizeTable('产品,长度(cm)\n小,20')).toThrow(/尺码|规格/)
    expect(() => previewSizeTable('规格,长度(unknown)\n小,20')).toThrow(/单位/)
    expect(() => previewSizeTable('规格,长度(cm)\n小,20,多余')).toThrow(/列数|标题/)
    expect(() => previewSizeTable('规格,长度(cm)\n小,20~10')).toThrow(/区间|数值/)
    expect(() => previewSizeTable('规格,长度(cm)\n小,\u0000')).toThrow(/单元格|数值|格式/)
    expect(() => previewSizeTable('规格,说明(文本)\n小,' + 'a'.repeat(201))).toThrow(/200|长度/)
    expect(() => previewSizeTable('规格,说明(文本)\n小,' + 'a'.repeat(1_048_576))).toThrow(/1 MB/)
  })

  it('exports a formula-safe CSV and round-trips header units and cell values', () => {
    const csv = exportSizeTable(record())
    expect(csv).toContain("'=HYPERLINK")
    expect(csv).not.toContain('\n=HYPERLINK')
    const preview = previewSizeTable(csv)
    const original = record()
    expect(preview.columns.map(({ id: _id, ...column }) => column)).toEqual(
      original.columns.map(({ id: _id, ...column }) => column),
    )
    expect(preview.rows.map((row) => row.values)).toEqual(original.rows.map((row) => row.values))
  })

  it('creates blank, women, men, shoes and storage templates that stay disabled and unbound', () => {
    const blank = createSizeTableTemplate('blank')
    expect(blank).toMatchObject({ enabled: false, bindings: [] })
    for (const kind of ['women', 'men', 'shoes', 'storage'] as const) {
      const draft = createSizeTableTemplate(kind)
      expect(draft.enabled).toBe(false)
      expect(draft.bindings).toEqual([])
      expect(draft.rows.length).toBeGreaterThan(0)
      expect(
        draft.rows.every((row) => Object.values(row.values).every((value) => value === '')),
      ).toBe(true)
    }
  })
})

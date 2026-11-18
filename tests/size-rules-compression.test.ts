// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { createContextCompressor, estimateContextTokens } from '../electron/context-compression'
import {
  createSizeContextPreparation,
  sizeEvidenceFromMessages,
} from '../electron/size-rules/inject'
import type { CompressionInput } from '../electron/context-compression'
import type { SizeRuleContext } from '../src/shared/contracts/size-rules'

const evidence: SizeRuleContext = {
  source: 'size-rule',
  ruleId: '9f7f45ea-896e-4b9a-a78f-2ec39e62fa81',
  ruleVersion: 1,
  storeId: 'a',
  productId: 'g',
  bindingStatus: 'valid',
  name: '身高体重对照',
  columns: [
    { id: 'height', name: '身高', kind: 'number', unit: 'cm' },
    { id: 'weight', name: '体重', kind: 'number', unit: 'kg' },
  ],
  rows: [
    { label: 'M', values: { height: '160~175', weight: '50~65' } },
    { label: 'L', values: { height: '176~185', weight: '66~75' } },
  ],
  totalRows: 2,
  complete: true,
  filteredByLabels: false,
  advice: '',
  requiredMeasurements: [
    { name: '身高', unit: 'cm' },
    { name: '体重', unit: 'kg' },
  ],
  providedMeasurements: [
    { name: '身高', value: 170, unit: 'cm' },
    { name: '体重', value: 60, unit: 'kg' },
  ],
  selectionRequested: true,
  tableQueryRequested: false,
  eligibleLabels: ['M'],
  clarification: '',
}

const thread = [
  { from: 'buyer' as const, type: 'text', content: '我想问尺码' },
  { from: 'seller' as const, type: 'text', content: '请提供身高体重' },
  { from: 'buyer' as const, type: 'text', content: '身高170cm体重60kg' },
  { from: 'buyer' as const, type: 'text', content: '推荐什么尺码' },
]

describe('size evidence and real context compression', () => {
  it('includes protected JSON in the measured messages and keeps it after 16K compression', async () => {
    const compressor = createContextCompressor(() => undefined)
    const prepare = createSizeContextPreparation(
      {
        assertActive: () => {},
        resolve: async () => evidence,
      },
      compressor,
    )
    // This environment's pure-JS tokenizer is slow; 8,500 CJK characters are
    // already above the real 16K trigger without generating a much larger fixture.
    const huge = '测'.repeat(8500)
    const input: CompressionInput = {
      messages: [
        { role: 'system', content: '系统规则' },
        { role: 'user', content: huge },
      ],
      thread,
      reviewContext: { storeId: 'a', productId: 'g' },
      knowledge: [],
      complete: async () => '较早对话摘要',
    }
    const result = await prepare(input)
    expect(result.compression.triggered).toBe(true)
    expect(result.compression.afterTokens).toBeLessThanOrEqual(8192)
    expect(estimateContextTokens(result.messages)).toBeLessThanOrEqual(8192)
    const kept = sizeEvidenceFromMessages(result.messages)
    expect(kept?.eligibleLabels).toEqual(['M'])
    expect(kept?.ruleVersion).toBe(1)
  })
})

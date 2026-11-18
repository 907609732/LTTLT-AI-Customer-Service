import { createRequire } from 'node:module'
import { describe, expect, it, vi } from 'vitest'
import {
  installSizeReplyGuard,
  enforceSizeReply,
  type SizeReplyResolver,
} from '../electron/size-rules/guard'
import {
  createSizeContextPreparation,
  sizeEvidenceFromMessages,
  SIZE_RULES_MARKER,
} from '../electron/size-rules/inject'
import { captureSizeEvidence } from '../electron/size-rules/request-state'
import { applySizeTrainingOutput } from '../electron/size-rules/training-output'
import type { CompressionInput } from '../electron/context-compression'
import type { SizeRuleContext } from '../src/shared/contracts/size-rules'

const { filterBannedWords } = createRequire(import.meta.url)(
  '../vendor/lingtu-runtime/desk-v1/src/main/reply-engine.js',
) as {
  filterBannedWords(text: string, rules: { word: string; replacement: string }[]): string
}

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

describe('final size recommendation guard', () => {
  it('renders positive selection from the table and blocks unknown model labels', () => {
    const guarded = enforceSizeReply(evidence, {
      reply: 'XL 最合适。',
      raw: JSON.stringify({ reply: 'XL 最合适。', sizeLabel: 'XL' }),
      images: ['https://images.example.com/bad.png'],
      handoff: false,
    })
    expect(guarded.reply).not.toMatch(/XL|加大码/)
    expect(guarded.reply).toContain('M')
    expect(guarded.images).toEqual([])

    const variant = enforceSizeReply(evidence, { reply: '加大码更合适。' })
    expect(variant.reply).not.toContain('加大码')
    expect(variant.reply).toContain('M')
  })

  it('uses the canonical eligible answer even if model prose mentions another valid table row', () => {
    const allowed = enforceSizeReply(evidence, {
      reply: '建议优先核对M码，结合身高体重更稳妥。',
      raw: JSON.stringify({ sizeLabel: 'M' }),
    })
    expect(allowed.reply).toContain('M')

    const unknown = enforceSizeReply(evidence, {
      reply: '推荐L码',
      raw: JSON.stringify({ sizeLabel: 'M' }),
    })
    expect(unknown.reply).not.toContain('L码')
    expect(unknown.reply).toContain('M')
  })

  it('uses the clarification instead of a recommendation when measurements are missing', () => {
    const guarded = enforceSizeReply(
      {
        ...evidence,
        eligibleLabels: [],
        clarification: '为核对尺码，请补充身高（cm）、体重（kg）。',
      },
      { reply: '推荐M码', raw: JSON.stringify({ sizeLabel: 'M' }) },
    )
    expect(guarded.reply).toBe('为核对尺码，请补充身高（cm）、体重（kg）。')
  })

  it('leaves explicit specification lookups and ordinary text untrusted-but-unconstrained', () => {
    const direct = enforceSizeReply(
      {
        ...evidence,
        selectionRequested: false,
        tableQueryRequested: true,
        eligibleLabels: [],
      },
      { reply: 'M码衣长64厘米', raw: '{"reply":"M码衣长64厘米"}' },
    )
    expect(direct.reply).toContain('M码')
  })

  it('wraps the real reply client and re-resolves the same evidence method when called', async () => {
    const resolver: SizeReplyResolver = {
      resolve: vi.fn(async () => evidence),
    }
    const client = {
      reply: vi.fn(async (_input: unknown) => ({
        reply: '推荐L码',
        raw: JSON.stringify({ sizeLabel: 'L' }),
      })),
    }
    installSizeReplyGuard(client, resolver)
    const result = (await client.reply({
      thread: [{ from: 'buyer', type: 'text', content: '身高170cm体重60kg选什么' }],
      reviewContext: { storeId: 'a', productId: 'g' },
    })) as { reply: string }
    expect(resolver.resolve).toHaveBeenCalledWith(
      'a',
      'g',
      '身高170cm体重60kg选什么',
      expect.any(Array),
    )
    expect(result.reply).toContain('M')
    expect(result.reply).not.toContain('L码')
  })

  it('validates the final training text without rebuilding or exceeding shop limits', () => {
    const safe = { reply: '按本商' }
    expect(applySizeTrainingOutput(evidence, safe, '')).toEqual(safe)
    expect(() => applySizeTrainingOutput(evidence, { reply: '推荐L码' }, '')).toThrow(/范围外尺码/)
    expect(() => applySizeTrainingOutput(evidence, { reply: 'XL 最合适' }, '')).toThrow(/未知尺码/)
    expect(() =>
      applySizeTrainingOutput(evidence, { reply: '推荐M码' }, '尺码规则已更新，旧候选失效'),
    ).toThrow(/已更新/)
    const filtered = filterBannedWords('M', [{ word: 'M', replacement: 'L' }])
    expect(filtered).toBe('L')
    expect(() => applySizeTrainingOutput(evidence, { reply: filtered.slice(0, 5) }, '')).toThrow(
      /范围外尺码|未知尺码/,
    )
    const safeTruncated = filterBannedWords('按本商品尺码表核对', [{ word: 'M', replacement: 'L' }])
    expect(applySizeTrainingOutput(evidence, { reply: safeTruncated.slice(0, 5) }, '')).toEqual({
      reply: '按本商品尺',
    })
  })

  it('fails closed when the rule version changes while the model response is late', async () => {
    const resolver: SizeReplyResolver = {
      resolve: vi.fn(async () => ({ ...evidence, ruleVersion: 2 })),
    }
    const client = {
      reply: vi.fn(async (_input: unknown) => {
        captureSizeEvidence(evidence)
        return { reply: '推荐M码', raw: JSON.stringify({ sizeLabel: 'M' }) }
      }),
    }
    installSizeReplyGuard(client, resolver)
    const result = (await client.reply({
      thread: [{ from: 'buyer', type: 'text', content: '身高170cm体重60kg选什么' }],
      reviewContext: { storeId: 'a', productId: 'g' },
    })) as { reply: string }
    expect(result.reply).toContain('已更新或停用')
    expect(result.reply).not.toContain('推荐M码')
  })
})

describe('size evidence prompt injection', () => {
  it('puts complete JSON into measured messages before the compressor and keeps it after', async () => {
    let measured = ''
    const next = vi.fn(async (input: CompressionInput) => {
      measured = JSON.stringify(input.messages)
      return {
        messages: input.messages,
        compression: { triggered: false },
      }
    })
    const prepare = createSizeContextPreparation(
      {
        assertActive: () => {},
        resolve: async () => evidence,
      },
      next,
    )
    const result = await prepare({
      messages: [
        { role: 'system', content: 'protected rules' },
        { role: 'user', content: 'buyer: 身高170cm体重60kg选什么' },
      ],
      thread: [{ from: 'buyer', type: 'text', content: '身高170cm体重60kg选什么' }],
      reviewContext: { storeId: 'a', productId: 'g' },
      knowledge: [],
      complete: async () => '',
    })
    expect(measured).toContain(SIZE_RULES_MARKER)
    expect(sizeEvidenceFromMessages(JSON.parse(measured))?.eligibleLabels).toEqual(['M'])
    expect(sizeEvidenceFromMessages(result.messages)?.eligibleLabels).toEqual(['M'])
    expect(next).toHaveBeenCalledOnce()
  })

  it('fails closed instead of sending when a downstream compressor drops the evidence', async () => {
    const next = vi.fn(async () => ({
      messages: [{ role: 'system' as const, content: 'protected rules' }],
      compression: { triggered: true },
    }))
    const prepare = createSizeContextPreparation(
      {
        assertActive: () => {},
        resolve: async () => evidence,
      },
      next,
    )
    await expect(
      prepare({
        messages: [{ role: 'system', content: 'protected rules' }],
        thread: [{ from: 'buyer', type: 'text', content: '推荐什么尺码' }],
        reviewContext: { storeId: 'a', productId: 'g' },
        knowledge: [],
        complete: async () => '',
      }),
    ).rejects.toThrow(/未保留完整尺码证据/)
  })

  it('does not inject evidence for ordinary questions with no matched product rule', async () => {
    const next = vi.fn(async (input: CompressionInput) => ({
      messages: input.messages,
      compression: { triggered: false },
    }))
    const prepare = createSizeContextPreparation(
      {
        assertActive: () => {},
        resolve: async () => null,
      },
      next,
    )
    const result = await prepare({
      messages: [{ role: 'system', content: 'rules' }],
      thread: [{ from: 'buyer', type: 'text', content: '你好' }],
      reviewContext: { storeId: 'a', productId: 'g' },
      knowledge: [],
      complete: async () => '',
    })
    expect(JSON.stringify(result.messages)).not.toContain(SIZE_RULES_MARKER)
  })
})

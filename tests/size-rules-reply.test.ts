import { describe, expect, it, vi } from 'vitest'
import {
  installSizeReplyGuard,
  enforceSizeReply,
  type SizeReplyResolver,
} from '../electron/size-rules/guard'
import { createSizeContextPreparation, SIZE_RULES_MARKER } from '../electron/size-rules/inject'
import { captureSizeEvidence } from '../electron/size-rules/request-state'
import type { CompressionInput } from '../electron/context-compression'
import type { SizeRuleContext } from '../src/shared/contracts/size-rules'

const evidence: SizeRuleContext = {
  source: 'size-rule',
  ruleId: '9f7f45ea-896e-4b9a-a78f-2ec39e62fa81',
  ruleVersion: 1,
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
  eligibleLabels: ['M'],
  clarification: '',
}

describe('final size recommendation guard', () => {
  it('rejects a model label outside eligibleLabels and returns a safe table-based confirmation', () => {
    const guarded = enforceSizeReply(evidence, {
      reply: '推荐L码，更宽松',
      raw: JSON.stringify({ reply: '推荐L码，更宽松', sizeLabel: 'L' }),
      images: ['https://images.example.com/bad.png'],
      handoff: false,
    })
    expect(guarded.reply).not.toContain('L码')
    expect(guarded.reply).toContain('M')
    expect(guarded.images).toEqual([])
  })

  it('accepts an eligible explicit label but rejects an unknown label mentioned in the reply', () => {
    const allowed = enforceSizeReply(evidence, {
      reply: '建议优先核对M码，结合身高体重更稳妥。',
      raw: JSON.stringify({ sizeLabel: 'M' }),
    })
    expect(allowed.reply).toContain('M码')

    const unknown = enforceSizeReply(evidence, {
      reply: '推荐XL码',
      raw: JSON.stringify({ sizeLabel: 'M' }),
    })
    expect(unknown.reply).not.toContain('XL')
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
      { ...evidence, selectionRequested: false, eligibleLabels: [] },
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
  it('injects complete JSON as data and restores it if compression removes the message', async () => {
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
    const text = result.messages
      .map((message) => (typeof message.content === 'string' ? message.content : ''))
      .join('\n')
    expect(text).toContain(SIZE_RULES_MARKER)
    expect(text).toContain('"eligibleLabels":["M"]')
    expect(text).toContain('"rows"')
    expect(next).toHaveBeenCalledOnce()
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

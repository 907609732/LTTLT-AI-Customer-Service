import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'
import { createSizeCandidateGuard } from '../electron/size-rules/candidate-guard'
import { SIZE_RULES_DATA_MARKER } from '../electron/size-rules/inject'
import { SendModeAuthorizations } from '../electron/send-mode-authorizations'
import type { SendProposal } from '../electron/review-console'
import type { SizeRuleContext } from '../src/shared/contracts/size-rules'

const { filterBannedWords } = createRequire(import.meta.url)(
  '../vendor/lingtu-runtime/desk-v1/src/main/reply-engine.js',
) as {
  filterBannedWords(text: string, rules: { word: string; replacement: string }[]): string
}

function evidence(ruleId: string, productId: string): SizeRuleContext {
  return {
    source: 'size-rule',
    ruleId,
    ruleVersion: 1,
    storeId: 'store-a',
    productId,
    bindingStatus: 'valid',
    name: `规则-${productId}`,
    columns: [{ id: 'h', name: '身高', kind: 'number', unit: 'cm' }],
    rows: [{ label: 'M', values: { h: '160~175' } }],
    totalRows: 1,
    complete: true,
    filteredByLabels: false,
    advice: '',
    requiredMeasurements: [{ name: '身高', unit: 'cm' }],
    providedMeasurements: [{ name: '身高', value: 170, unit: 'cm' }],
    selectionRequested: true,
    tableQueryRequested: false,
    eligibleLabels: ['M'],
    clarification: '',
  }
}

function messages(value: SizeRuleContext) {
  return [
    { role: 'system', content: 'rules' },
    { role: 'user', content: SIZE_RULES_DATA_MARKER + JSON.stringify(value) },
  ]
}

describe('size candidate generation binding', () => {
  it('keeps two interleaved buyers on their own trace and invalidates only the changed rule', () => {
    const a = evidence('11111111-1111-4111-8111-111111111111', 'product-a')
    const b = evidence('22222222-2222-4222-8222-222222222222', 'product-b')
    const reasons = new Map([
      [a.ruleId, ''],
      [b.ruleId, ''],
    ])
    const guard = createSizeCandidateGuard({
      currentReason: (value) => reasons.get(value.ruleId) ?? 'unknown',
    })
    guard.capture('trace-a', messages(a))
    guard.capture('trace-b', messages(b))
    const proposalA: {
      traceId: string
      invalidReason?: () => string
      isCurrent: () => boolean
    } = {
      traceId: 'trace-a',
      isCurrent: () => true,
    }
    const proposalB: {
      traceId: string
      invalidReason?: () => string
      isCurrent: () => boolean
    } = {
      traceId: 'trace-b',
      isCurrent: () => true,
    }
    guard.attach(proposalA)
    guard.attach(proposalB)
    expect(proposalA.isCurrent()).toBe(true)
    expect(proposalB.isCurrent()).toBe(true)

    reasons.set(a.ruleId, '规则A已编辑')
    expect(proposalA.invalidReason?.()).toContain('规则A已编辑')
    expect(proposalA.isCurrent()).toBe(false)
    expect(proposalB.isCurrent()).toBe(true)
    expect(proposalB.invalidReason?.()).toBe('')
  })

  it('keeps an existing knowledge/review invalid reason ahead of size metadata', () => {
    const guard = createSizeCandidateGuard({ currentReason: () => '' })
    const value = evidence('44444444-4444-4444-8444-444444444444', 'product-d')
    guard.capture('trace-knowledge', messages(value))
    const proposal = {
      traceId: 'trace-knowledge',
      invalidReason: () => '引用知识已撤回',
      isCurrent: () => true,
    }
    guard.attach(proposal)
    expect(proposal.invalidReason?.()).toContain('引用知识')
    expect(proposal.isCurrent()).toBe(false)
  })

  it('preserves the PDD one-time authorization guard when the size rule changes', async () => {
    const value = evidence('55555555-5555-4555-8555-555555555555', 'product-e')
    let reason = ''
    const guard = createSizeCandidateGuard({
      currentReason: () => reason,
    })
    guard.capture('trace-pdd', messages(value))
    const proposal: SendProposal = {
      traceId: 'trace-pdd',
      storeId: 'store-a',
      uid: 'buyer-e',
      text: '合成回复',
      thread: [],
      isCurrent: () => true,
      getHistory: async () => ({ known: true, messages: [] }),
    }
    guard.attach(proposal)
    const authorizations = new SendModeAuthorizations(() => ({ mode: 'auto', revision: 1 }))
    expect(await authorizations.authorize(proposal, async () => true)).toBe(true)
    const permit = authorizations.consume('store-a', 'buyer-e', '合成回复')
    expect(permit?.()).toBe(true)
    reason = '尺码规则已停用'
    expect(permit?.()).toBe(false)
    expect(proposal.isCurrent()).toBe(false)
  })

  it('fails closed when the bounded evidence map evicted this trace', () => {
    const value = evidence('66666666-6666-4666-8666-666666666666', 'product-f')
    const guard = createSizeCandidateGuard({ currentReason: () => '' })
    for (let index = 0; index < 1001; index += 1) guard.capture(`trace-${index}`, messages(value))
    const evicted: {
      traceId: string
      invalidReason?: () => string
      isCurrent: () => boolean
    } = { traceId: 'trace-0', isCurrent: () => true }
    guard.attach(evicted)
    expect(evicted.isCurrent()).toBe(false)
    expect(evicted.invalidReason?.()).toContain('证据已过期')
    const unknown = { traceId: 'trace-unknown', isCurrent: () => true }
    guard.attach(unknown)
    expect(unknown.isCurrent()).toBe(false)
    const knownNone: { traceId: string; isCurrent: () => boolean } = {
      traceId: 'trace-known-none',
      isCurrent: () => true,
    }
    guard.capture('trace-known-none', [])
    guard.attach(knownNone)
    expect(knownNone.isCurrent()).toBe(true)
  })

  it('rejects a vendor-filtered final text without rewriting it', () => {
    const value = evidence('77777777-7777-4777-8777-777777777777', 'product-g')
    const guard = createSizeCandidateGuard({ currentReason: () => '' })
    guard.capture('trace-final', messages(value))
    const canonical = '按本商品尺码表和你提供的测量值，建议优先核对 M；请以实际测量和商品说明为准。'
    guard.captureReply('trace-final', canonical)
    const rules = [{ word: 'M', replacement: '2XL' }]
    expect(
      guard.finalTextReason(
        { traceId: 'trace-final', text: filterBannedWords(canonical, rules) },
        rules,
      ),
    ).toMatch(/不一致/)
    expect(guard.finalTextReason({ traceId: 'trace-final', text: canonical.slice(0, 5) }, [])).toBe(
      '',
    )
    expect(guard.finalTextReason({ traceId: 'trace-final', text: '推荐L码' })).toMatch(
      /不一致|范围外尺码|未知尺码/,
    )
    expect(
      guard.finalTextReason(
        { traceId: 'trace-final', text: `欢迎咨询\n${canonical}` },
        [],
        '欢迎咨询',
      ),
    ).toBe('')
    expect(
      guard.finalTextReason(
        {
          traceId: 'trace-final',
          text: `欢迎咨询\n${filterBannedWords(canonical, rules)}`,
        },
        rules,
        '欢迎咨询',
      ),
    ).toMatch(/不一致/)
    expect(guard.finalTextReason({ traceId: 'trace-final', text: '按本商品' })).toBe('')
    expect(guard.finalTextReason({ traceId: 'other', text: '推荐M码' })).toContain('证据已过期')
    guard.capture('trace-known-none', [])
    expect(guard.finalTextReason({ traceId: 'trace-known-none', text: '普通回复' })).toBe('')
  })

  it('does not attach evidence from a different trace or fall back to the latest trace', () => {
    const guard = createSizeCandidateGuard({ currentReason: () => '' })
    const value = evidence('33333333-3333-4333-8333-333333333333', 'product-c')
    guard.capture('trace-old', messages(value))
    const proposal = { traceId: 'trace-new', isCurrent: () => true }
    guard.attach(proposal)
    expect(proposal.isCurrent()).toBe(false)
  })
})

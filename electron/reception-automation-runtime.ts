import { z } from 'zod'
import { automationActionSchema } from '../src/shared/contracts/scheduler'
import type { ReceptionScheduler } from './scheduler-runtime'
const id = z.string().trim().min(1).max(100)
const base = { id, storeId: id, uid: id, observedAt: z.number().int().nonnegative() }
const eventSchema = z.discriminatedUnion('type', [
  z
    .object({ ...base, type: z.literal('visitor'), sessionId: id, messageCount: z.literal(0) })
    .strict(),
  z
    .object({ ...base, type: z.literal('unpaid-order'), orderId: id, status: z.literal('unpaid') })
    .strict(),
  z
    .object({
      ...base,
      type: z.literal('transfer-request'),
      availableAgentIds: z.array(id).max(1000),
    })
    .strict(),
])
export const receptionRuleSchema = z
  .object({
    id,
    storeId: id,
    enabled: z.boolean(),
    trigger: z.enum(['visitor', 'unpaid-order', 'transfer-request']),
    actions: z.array(automationActionSchema).min(1).max(5),
  })
  .strict()
  .superRefine((rule, context) => {
    const allowed =
      rule.trigger === 'visitor'
        ? ['welcome-text', 'welcome-image', 'welcome-video']
        : rule.trigger === 'unpaid-order'
          ? ['payment-reminder']
          : ['transfer']
    if (rule.actions.some((a) => !allowed.includes(a.kind)))
      context.addIssue({ code: 'custom', message: '规则动作与触发来源不匹配' })
    if (
      rule.actions.filter((a) => a.kind === 'welcome-text').length > 1 ||
      rule.actions.filter((a) => a.kind === 'welcome-image' || a.kind === 'welcome-video').length >
        4
    )
      context.addIssue({ code: 'custom', message: '欢迎语最多一条文字、四条媒体，各自逐条确认' })
  })
export type ReceptionRule = z.infer<typeof receptionRuleSchema>
const rulesSchema = z.array(receptionRuleSchema).max(100)

/** Accept facts from verified platform collectors, never from renderer-supplied visitor/order claims. */
export class ReceptionAutomation {
  private rules: ReceptionRule[]
  private now: () => number
  constructor(
    private options: {
      scheduler: ReceptionScheduler
      load(): unknown
      save(rules: ReceptionRule[]): void
      now?(): number
    },
  ) {
    this.rules = rulesSchema.parse(options.load() ?? [])
    if (new Set(this.rules.map((r) => r.id)).size !== this.rules.length)
      throw new Error('接待规则编号重复')
    this.now = options.now ?? Date.now
  }
  snapshot() {
    return structuredClone(this.rules)
  }
  saveRule(input: unknown) {
    const rule = receptionRuleSchema.parse(input)
    const next = rulesSchema.parse([...this.rules.filter((r) => r.id !== rule.id), rule])
    this.options.scheduler.cancelRule(rule.id)
    this.options.save(next)
    this.rules = next
  }
  setEnabled(id: string, enabled: boolean) {
    const row = this.rules.find((r) => r.id === id)
    if (!row) throw new Error('接待规则不存在')
    this.saveRule({ ...row, enabled })
  }
  observe(input: unknown): number {
    const event = eventSchema.parse(input)
    if (event.observedAt > this.now() + 5000) throw new Error('事件时间晚于当前时间')
    if (this.now() - event.observedAt > 600000) throw new Error('平台事件已过期，请重新只读采集')
    let count = 0
    for (const rule of this.rules) {
      if (!rule.enabled || rule.storeId !== event.storeId || rule.trigger !== event.type) continue
      const actions = rule.actions.filter((action) => {
        if (action.kind === 'payment-reminder')
          return event.type === 'unpaid-order' && action.orderId === event.orderId
        if (action.kind === 'transfer')
          return (
            event.type === 'transfer-request' && event.availableAgentIds.includes(action.agentId)
          )
        return true
      })
      if (!actions.length) continue
      count += this.options.scheduler.enqueueEvent({
        key: JSON.stringify([
          event.type,
          event.type === 'unpaid-order'
            ? event.orderId
            : event.type === 'visitor'
              ? event.sessionId
              : event.id,
          event.uid,
          event.type === 'visitor' ? event.sessionId : '',
        ]),
        ruleId: rule.id,
        storeId: event.storeId,
        uid: event.uid,
        actions,
      })
    }
    return count
  }
}

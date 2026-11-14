import { z } from 'zod'
import {
  receptionEventSchema,
  receptionRuleSchema,
  type ReceptionRule,
} from '../src/shared/contracts/platform-operations'
import type { ReceptionScheduler } from './scheduler-runtime'
export {
  receptionRuleSchema,
  type ReceptionRule,
} from '../src/shared/contracts/platform-operations'
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
    const old = this.rules.find((r) => r.id === rule.id)
    if (old && old.revision !== rule.revision) throw new Error('接待规则已更新，请载入最新配置')
    rule.revision = (old?.revision ?? 0) + 1
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
  removeRule(id: string, revision: number) {
    const old = this.rules.find((r) => r.id === id)
    if (!old || old.revision !== revision) throw new Error('接待规则已更新，请载入最新配置')
    this.options.scheduler.cancelRule(id)
    const next = this.rules.filter((r) => r.id !== id)
    this.options.save(next)
    this.rules = next
  }
  observe(input: unknown): number {
    const event = receptionEventSchema.parse(input)
    if (event.observedAt > this.now() + 5000) throw new Error('事件时间晚于当前时间')
    if (this.now() - event.observedAt > 600000) throw new Error('平台事件已过期，请重新只读采集')
    let count = 0
    for (const rule of this.rules) {
      if (!rule.enabled || rule.storeId !== event.storeId || rule.trigger !== event.type) continue
      const actions = rule.actions
        .filter((action) => {
          if (action.kind === 'payment-reminder') return event.type === 'unpaid-order'
          if (action.kind === 'transfer')
            return (
              event.type === 'transfer-request' && event.availableAgentIds.includes(action.agentId)
            )
          return true
        })
        .map((action) =>
          action.kind === 'payment-reminder' && event.type === 'unpaid-order'
            ? { ...action, orderId: event.orderId }
            : action,
        )
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
        actions: actions as import('../src/shared/contracts/scheduler').AutomationAction[],
      })
    }
    return count
  }
}

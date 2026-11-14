import type { ReceptionScheduler } from './scheduler-runtime'
import type { ReceptionAutomation } from './reception-automation-runtime'
import {
  receptionCommandSchema,
  receptionEventSchema,
  type PlatformOperationsPort,
  type ReceptionSnapshot,
  type PlatformOperationStoreFacts,
} from '../src/shared/contracts/platform-operations'
import { ReceptionOperationExecutor } from './reception-operation-executor'
interface Options {
  workspaceId: string
  stores(): string[]
  scheduler: ReceptionScheduler
  automation: ReceptionAutomation
  port: PlatformOperationsPort
  now?(): number
  isCurrent?(): boolean
}
export class ReceptionOperationsService {
  readonly executor: ReceptionOperationExecutor
  private facts = new Map<string, PlatformOperationStoreFacts>()
  private timer?: ReturnType<typeof setInterval>
  private polling?: Promise<void>
  private reading?: Promise<void>
  private closed = false
  private error = ''
  constructor(private options: Options) {
    this.executor = new ReceptionOperationExecutor(options)
  }
  private requireCurrent() {
    if (this.closed || !(this.options.isCurrent?.() ?? true))
      throw new Error('工作区已变化或接待服务已关闭')
  }
  private async refreshFacts(): Promise<void> {
    this.requireCurrent()
    if (this.reading) return this.reading
    const refresh = async () => {
      const stores = this.options.stores()
      for (const [storeId] of this.facts)
        if (!stores.includes(storeId)) {
          this.executor.invalidateStore(storeId, '店铺已移除，旧事项已失效')
          this.facts.delete(storeId)
        }
      for (const storeId of stores) {
        try {
          const fact = await this.executor.readExclusive(() =>
            this.options.port.read({ workspaceId: this.options.workspaceId, storeId }),
          )
          this.requireCurrent()
          if (!this.options.stores().includes(storeId)) continue
          if (fact.storeId !== storeId || !fact.accountId || !Number.isFinite(fact.observedAt))
            throw new Error('平台返回了其他店铺或不可信身份')
          const previous = this.facts.get(storeId)
          if (previous && previous.accountId !== fact.accountId)
            this.executor.invalidateStore(storeId, '平台账号已切换，旧事项已失效')
          this.facts.set(storeId, structuredClone(fact))
        } catch {
          this.requireCurrent()
          const previous = this.facts.get(storeId)
          this.facts.set(storeId, {
            storeId,
            storeName: previous?.storeName ?? storeId,
            accountId: previous?.accountId ?? '',
            observedAt: previous?.observedAt ?? 0,
            capabilities: [],
            buyers: [],
            orders: [],
            agents: [],
            error: '读取真实平台能力失败，请打开平台并重新只读采集',
          })
          this.executor.invalidateStore(storeId, '无法确认当前店铺身份，旧事项已失效')
        }
      }
    }
    this.reading = refresh().finally(() => {
      this.reading = undefined
    })
    return this.reading
  }
  async snapshot(): Promise<ReceptionSnapshot> {
    this.requireCurrent()
    await this.refreshFacts()
    this.requireCurrent()
    return structuredClone({
      workspaceId: this.options.workspaceId,
      rules: this.options.automation.snapshot(),
      facts: [...this.facts.values()],
      runs: this.options.scheduler.snapshot().runs,
      error: this.error,
    })
  }
  async execute(input: unknown): Promise<ReceptionSnapshot> {
    const command = receptionCommandSchema.parse(input)
    this.requireCurrent()
    if (command.workspaceId !== this.options.workspaceId) throw new Error('工作区已变化，请刷新')
    if (command.type === 'save-rule') {
      if (!this.options.stores().includes(command.rule.storeId))
        throw new Error('店铺不属于当前工作区')
      if (command.rule.actions.some((action) => action.kind === 'transfer')) {
        await this.refreshFacts()
        const facts = this.facts.get(command.rule.storeId)
        for (const action of command.rule.actions)
          if (
            action.kind === 'transfer' &&
            !facts?.agents.some(
              (agent) =>
                agent.agentId === action.agentId &&
                (agent.canTransfer === true || agent.online === true),
            )
          )
            throw new Error('只能选择当前店铺平台提供的可转接客服')
      }
      this.requireCurrent()
      this.options.automation.saveRule(command.rule)
    } else if (command.type === 'remove-rule')
      this.options.automation.removeRule(command.id, command.revision)
    else if (command.type === 'prepare') await this.executor.prepare(command.id)
    else if (command.type === 'approve') await this.executor.approve(command)
    else if (command.type === 'cancel') this.executor.cancel(command.id)
    else if (command.type === 'inspect') await this.executor.inspect(command.id)
    else await this.poll()
    return this.snapshot()
  }
  async poll(): Promise<void> {
    this.requireCurrent()
    if (this.polling) return this.polling
    const collect = async () => {
      this.options.scheduler.tick()
      await this.refreshFacts()
      for (const storeId of this.options.stores()) {
        if (this.facts.get(storeId)?.error) continue
        try {
          const events = await this.executor.readExclusive(() =>
            this.options.port.observe({ workspaceId: this.options.workspaceId, storeId }),
          )
          this.requireCurrent()
          for (const input of events) {
            const event = receptionEventSchema.parse(input)
            if (event.storeId !== storeId) throw new Error('平台事件店铺不匹配')
            this.options.automation.observe(event)
          }
        } catch {
          this.error = '部分平台事件读取失败，未根据本机空归档推断访客或订单'
        }
      }
      for (const run of this.options.scheduler.snapshot().runs) {
        if (!this.options.stores().includes(run.storeId)) {
          this.executor.invalidateStore(run.storeId, '店铺已移除，旧事项已失效')
          continue
        }
        if (run.state === 'pending' && run.prepared) await this.executor.revalidatePending(run.id)
        else if (['pending', 'blocked'].includes(run.state)) await this.executor.prepare(run.id)
      }
    }
    this.error = ''
    this.polling = collect().finally(() => {
      this.polling = undefined
    })
    return this.polling
  }
  start() {
    this.requireCurrent()
    if (this.timer) return
    this.options.scheduler.start()
    const poll = () => {
      void this.poll().catch(() => {
        this.error = '接待采集或存储失败，请刷新核对；未自动执行'
      })
    }
    poll()
    this.timer = setInterval(poll, 60000)
    this.timer.unref?.()
  }
  pause() {
    if (this.timer) clearInterval(this.timer)
    this.timer = undefined
    this.options.scheduler.pause()
  }
  invalidateStore(storeId: string, reason: string) {
    this.executor.invalidateStore(storeId, reason)
  }
  dispose() {
    if (this.timer) clearInterval(this.timer)
    this.timer = undefined
    this.closed = true
    this.executor.dispose()
  }
}

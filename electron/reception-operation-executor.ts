import { randomUUID } from 'node:crypto'
import type { ReceptionScheduler } from './scheduler-runtime'
import {
  preparedPlatformOperationSchema,
  operationEvidenceSchema,
  type PlatformOperationsPort,
  type PreparedPlatformOperation,
  type PlatformOperationResult,
} from '../src/shared/contracts/platform-operations'

/** One explicit approval consumes one immutable prepared item. Never retries platform writes. */
export class ReceptionOperationExecutor {
  private tail: Promise<void> = Promise.resolve()
  private closed = false
  private clock: () => number
  constructor(
    private options: {
      workspaceId: string
      scheduler: ReceptionScheduler
      port: PlatformOperationsPort
      now?: () => number
      isCurrent?(): boolean
    },
  ) {
    this.clock = options.now ?? Date.now
  }
  private current() {
    return !this.closed && (this.options.isCurrent?.() ?? true)
  }
  private serial<T>(job: () => Promise<T>): Promise<T> {
    const pending = this.tail.then(job)
    this.tail = pending.then(
      () => {},
      () => {},
    )
    return pending
  }
  private run(id: string) {
    return this.options.scheduler.snapshot().runs.find((row) => row.id === id)
  }
  /** Share the write mutex with trusted read-only platform collectors. */
  readExclusive<T>(read: () => Promise<T>): Promise<T> {
    return this.serial(async () => {
      if (!this.current()) throw new Error('工作区已变化或服务已关闭')
      const result = await read()
      if (!this.current()) throw new Error('工作区已变化或服务已关闭')
      return result
    })
  }
  async revalidatePending(id: string): Promise<void> {
    return this.serial(async () => {
      const run = this.run(id)
      if (!this.current() || !run?.prepared || run.state !== 'pending') return
      try {
        const validation = await this.options.port.revalidate(run.prepared)
        if (!this.current() || this.run(id)?.approvalId !== run.approvalId) return
        if (validation.status === 'invalid')
          this.options.scheduler.invalidateOperation(id, validation.reason)
        else if (validation.status === 'unavailable')
          this.options.scheduler.blockOperation(id, validation.reason)
      } catch {
        this.options.scheduler.blockOperation(id, '平台复核暂不可用，请重新准备后再批准')
      }
    })
  }
  private validatePrepared(prepared: PreparedPlatformOperation) {
    const now = this.clock()
    if (
      prepared.preparedAt > now + 5000 ||
      prepared.expiresAt <= now ||
      prepared.evidence.some((e) => e.observedAt > now + 5000 || now - e.observedAt > 600000)
    )
      throw new Error('平台证据已过期或时间无效，请重新读取')
    if (prepared.action.kind === 'welcome-image' || prepared.action.kind === 'welcome-video') {
      const media = prepared.media
      const image = prepared.action.kind === 'welcome-image'
      const supported = image
        ? ['image/png', 'image/jpeg', 'image/webp', 'image/gif']
        : ['video/mp4', 'video/webm']
      if (
        !media ||
        !supported.includes(media.mimeType) ||
        media.sizeBytes > (image ? 10 : 100) * 1024 * 1024
      )
        throw new Error('媒体缺少可信类型、大小、哈希或超出平台操作安全范围')
    }
    if (prepared.action.kind === 'transfer' && !prepared.agentName?.trim())
      throw new Error('缺少真实目标客服姓名')
    if (prepared.action.kind === 'payment-reminder' && !prepared.orderLabel?.trim())
      throw new Error('缺少真实目标订单说明')
  }
  async prepare(id: string): Promise<void> {
    return this.serial(async () => {
      if (!this.current()) throw new Error('工作区已变化或服务已关闭')
      const run = this.run(id)
      if (!run || !['pending', 'blocked'].includes(run.state))
        throw new Error('事项状态已变化，结果未知须先核对')
      if (run.expiresAt <= this.clock()) {
        this.options.scheduler.tick()
        throw new Error('事项已过期')
      }
      try {
        const result = await this.options.port.prepare({
          workspaceId: this.options.workspaceId,
          runId: id,
          storeId: run.storeId,
          uid: run.uid,
          action: run.action,
        })
        const fresh = this.run(id)
        if (
          !this.current() ||
          !fresh ||
          !['pending', 'blocked'].includes(fresh.state) ||
          fresh.approvalId !== run.approvalId
        )
          return
        if (result.status === 'blocked') {
          this.options.scheduler.blockOperation(id, result.reason)
          return
        }
        const prepared = preparedPlatformOperationSchema.parse(result.prepared)
        this.validatePrepared(prepared)
        this.options.scheduler.prepareOperation(id, prepared, randomUUID())
      } catch (error) {
        const reason = error instanceof Error ? error.message : '平台准备失败'
        this.options.scheduler.blockOperation(id, reason)
      }
    })
  }
  async approve(input: { workspaceId: string; id: string; approvalId: string }): Promise<void> {
    if (input.workspaceId !== this.options.workspaceId || !this.current())
      throw new Error('工作区已变化，请刷新')
    // Persist consumption before any await; another window can never reuse this approval.
    const run = this.options.scheduler.beginOperation(input.id, input.approvalId)
    const prepared = run.prepared!
    const isCurrent = () =>
      this.current() && this.run(run.id)?.state === 'executing' && run.expiresAt > this.clock()
    return this.serial(async () => {
      if (!isCurrent()) {
        this.options.scheduler.finishOperation(run.id, 'invalidated', '批准在执行前已失效或过期')
        return
      }
      let validation
      try {
        validation = await this.options.port.revalidate(prepared)
      } catch {
        validation = {
          status: 'unavailable' as const,
          reason: '暂时无法复核平台目标，请重新读取后再批准',
        }
      }
      if (!isCurrent()) {
        this.options.scheduler.finishOperation(
          run.id,
          'invalidated',
          '复核期间目标或运行状态变化，未执行',
        )
        return
      }
      if (validation.status !== 'valid') {
        this.options.scheduler.finishOperation(
          run.id,
          validation.status === 'invalid' ? 'invalidated' : 'blocked',
          validation.reason,
        )
        return
      }
      let result: PlatformOperationResult
      try {
        result = await this.options.port.execute(structuredClone(prepared), { isCurrent })
        if (
          !['confirmed', 'failed', 'uncertain'].includes(result.status) ||
          typeof result.reason !== 'string'
        )
          throw new Error('平台结果格式无效')
        if (result.evidence) result.evidence = operationEvidenceSchema.parse(result.evidence)
        if (result.status === 'confirmed' && !result.evidence) throw new Error('缺少准确回显证据')
      } catch {
        result = { status: 'uncertain', reason: '执行结果无法确定，请只读核对平台，不得重新发送' }
      }
      this.options.scheduler.finishOperation(run.id, result.status, result.reason, result.evidence)
    })
  }
  cancel(id: string): void {
    if (!this.current()) throw new Error('工作区已变化')
    this.options.scheduler.execute({ type: 'cancel', workspaceId: this.options.workspaceId, id })
  }
  invalidateStore(storeId: string, reason: string): void {
    this.options.scheduler.invalidateOperations(storeId, reason)
  }
  async inspect(id: string): Promise<void> {
    return this.serial(async () => {
      if (!this.current()) throw new Error('工作区已变化')
      const run = this.run(id)
      if (!run || run.state !== 'uncertain' || !run.prepared)
        throw new Error('没有可核对的未知结果')
      if (!this.options.port.inspect)
        throw new Error('平台未提供只读结果核对，请打开原平台人工核对')
      let result: PlatformOperationResult
      try {
        result = await this.options.port.inspect(structuredClone(run.prepared))
      } catch {
        result = { status: 'uncertain', reason: '只读核对暂时失败，仍不可重新发送' }
      }
      if (!this.current()) return
      if (result.status === 'confirmed' && result.evidence) {
        const evidence = operationEvidenceSchema.parse(result.evidence)
        this.options.scheduler.finishOperation(id, 'confirmed', result.reason, evidence, true)
      } else this.options.scheduler.finishOperation(id, 'uncertain', result.reason, undefined, true)
    })
  }
  dispose() {
    this.closed = true
    this.options.scheduler.invalidateOperations(
      undefined,
      '账号退出或服务关闭，旧批准已作废；执行中的事项须核对',
    )
  }
}

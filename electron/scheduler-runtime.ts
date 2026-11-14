import { randomUUID, createHash } from 'node:crypto'
import {
  automationActionSchema,
  schedulerCommandSchema,
  schedulerStateSchema,
  type AutomationAction,
  type SchedulerState,
  type SchedulerSnapshot,
  type SchedulerTask,
  type SchedulerTaskInput,
  type SchedulerRun,
} from '../src/shared/contracts/scheduler'
import {
  preparedPlatformOperationSchema,
  type PreparedPlatformOperation,
  type OperationEvidence,
} from '../src/shared/contracts/platform-operations'

const retained = (run: SchedulerRun) => ['pending', 'executing', 'uncertain'].includes(run.state)

/** Real-instant iteration handles DST gaps; repeated local hours execute once per day. */
export function nextOccurrence(schedule: SchedulerTaskInput['schedule'], after: number): number {
  if (schedule.type === 'once') return schedule.at
  if (schedule.type === 'interval') return after + schedule.minutes * 60000
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: schedule.timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  })
  const parts = (at: number) => {
    const p = Object.fromEntries(formatter.formatToParts(at).map((p) => [p.type, p.value]))
    return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` }
  }
  const current = parts(after)
  for (let at = Math.floor(after / 60000) * 60000 + 60000; at < after + 4 * 86400000; at += 60000) {
    const candidate = parts(at)
    if (
      candidate.time === schedule.time &&
      !(current.time >= schedule.time && current.date === candidate.date)
    )
      return at
  }
  throw new Error('无法计算下次执行时间')
}
interface Options {
  workspaceId: string
  load(): unknown
  save(state: SchedulerState): void
  now?(): number
  capability?(task: SchedulerTask): string
  validateTask?(task: SchedulerTaskInput): void
}
/** Due tasks only create intents. The main-process executor consumes one prepared approval. */
export class ReceptionScheduler {
  private state: SchedulerState
  private timer?: ReturnType<typeof setInterval>
  private closed = false
  private clock: () => number
  lastError = ''
  constructor(private options: Options) {
    this.clock = options.now ?? Date.now
    const loaded = options.load()
    this.state =
      loaded === undefined
        ? { version: 1, tasks: [], runs: [], receipts: [] }
        : schedulerStateSchema.parse(loaded)
    if (
      new Set(this.state.tasks.map((t) => t.id)).size !== this.state.tasks.length ||
      new Set(this.state.runs.map((r) => r.id)).size !== this.state.runs.length
    )
      throw new Error('调度文件存在重复编号')
    if (this.state.runs.some((r) => ['pending', 'executing'].includes(r.state) || r.approvalId)) {
      const next = structuredClone(this.state)
      this.cancelPending(next, undefined, '应用已重启，请重新建立并逐条确认')
      for (const run of next.runs) {
        if (run.state === 'executing') {
          run.state = 'uncertain'
          run.reason = '应用在执行期间退出，必须只读核对平台，不可重新发送'
        }
        delete run.approvalId
      }
      this.commit(next)
    }
  }
  private commit(next: SchedulerState) {
    const validated = schedulerStateSchema.parse(next)
    this.options.save(validated)
    this.state = validated
  }
  snapshot(): SchedulerSnapshot {
    return structuredClone({
      ...this.state,
      workspaceId: this.options.workspaceId,
      running: !!this.timer,
      error: this.lastError,
    })
  }
  start() {
    if (this.closed) throw new Error('调度服务已关闭')
    if (this.timer) return
    this.tick()
    this.timer = setInterval(() => {
      try {
        this.tick()
        this.lastError = ''
      } catch {
        this.lastError = '调度存储失败，任务未推进，请检查磁盘后重试'
      }
    }, 1000)
    this.timer.unref?.()
  }
  pause() {
    if (this.timer) clearInterval(this.timer)
    this.timer = undefined
    if (
      this.closed ||
      !this.state.runs.some((run) => ['pending', 'blocked', 'executing'].includes(run.state))
    )
      return
    const next = structuredClone(this.state)
    this.cancelPending(next, undefined, '调度服务已暂停，未批准事项已取消')
    for (const run of next.runs)
      if (run.state === 'executing') {
        run.state = 'uncertain'
        run.reason = '执行期间服务暂停，请只读核对平台结果'
        delete run.approvalId
      }
    this.commit(next)
  }
  dispose() {
    try {
      this.pause()
    } finally {
      this.closed = true
    }
  }
  private cancelPending(next: SchedulerState, taskId: string | undefined, reason: string) {
    for (const run of next.runs)
      if (
        ['pending', 'blocked', 'executing'].includes(run.state) &&
        (!taskId || run.taskId === taskId)
      ) {
        const executing = run.state === 'executing'
        run.state = executing ? 'uncertain' : 'cancelled'
        run.reason = executing ? `${reason}；执行结果须核对，禁止重发` : reason
        delete run.approvalId
      }
  }
  /** Trusted main-process events only. Not exposed as an IPC command. */
  enqueueEvent(input: {
    key: string
    ruleId: string
    storeId: string
    uid: string
    actions: AutomationAction[]
  }): number {
    if (this.closed) throw new Error('调度服务已关闭')
    const at = this.clock()
    const actions = automationActionSchema.array().min(1).max(5).parse(input.actions)
    const key = createHash('sha256')
      .update(JSON.stringify([input.storeId, input.uid, input.ruleId, input.key]))
      .digest('hex')
    if (
      this.state.receipts.some((r) => r.key === key && r.expiresAt > at) ||
      this.state.runs.some(
        (run) => run.eventKey === key && ['uncertain', 'executing'].includes(run.state),
      )
    )
      return 0
    const next = structuredClone(this.state)
    next.receipts = next.receipts.filter((r) => r.expiresAt > at)
    if (next.receipts.length >= 10000) throw new Error('事件去重容量已满，停止生成，避免重复发送')
    if (next.runs.length + actions.length > 500) {
      const keep = next.runs.filter(retained)
      const capacity = 500 - keep.length - actions.length
      if (capacity < 0) throw new Error('待处理事项已满，请先取消或处理')
      const history = capacity ? next.runs.filter((r) => !retained(r)).slice(-capacity) : []
      next.runs = [...history, ...keep]
    }
    for (const raw of actions) {
      const action = automationActionSchema.parse(raw)
      const task: SchedulerTask = {
        id: `event:${input.ruleId}`,
        name: input.ruleId,
        storeId: input.storeId,
        uid: input.uid,
        action,
        enabled: true,
        schedule: { type: 'once', at },
        nextAt: at,
        revision: 1,
      }
      const reason = this.blockReason(task)
      next.runs.push({
        id: randomUUID(),
        taskId: task.id,
        storeId: input.storeId,
        uid: input.uid,
        action,
        occurrence: at,
        createdAt: at,
        expiresAt: at + 600000,
        eventKey: key,
        state: reason ? 'blocked' : 'pending',
        reason: reason || '待提交统一确认门，尚未发送',
      })
    }
    next.receipts.push({ key, expiresAt: at + 86400000 })
    this.commit(next)
    return input.actions.length
  }
  cancelRule(ruleId: string) {
    if (this.closed) throw new Error('调度服务已关闭')
    const next = structuredClone(this.state)
    this.cancelPending(next, `event:${ruleId}`, '接待规则已修改或停用')
    for (const run of next.runs)
      if (run.taskId === `event:${ruleId}` && run.state === 'executing') {
        run.state = 'uncertain'
        run.reason = '规则在执行中修改或停用，请只读核对'
      }
    this.commit(next)
  }
  /** Never exposed as a generic mutation bridge. All callers live in the main process. */
  prepareOperation(id: string, prepared: PreparedPlatformOperation, approvalId: string) {
    if (this.closed) throw new Error('调度服务已关闭')
    const next = structuredClone(this.state)
    const run = next.runs.find((r) => r.id === id)
    if (!run || !['pending', 'blocked'].includes(run.state))
      throw new Error('事项状态已变化，请核对记录')
    const value = preparedPlatformOperationSchema.parse(prepared)
    if (
      value.runId !== id ||
      value.target.storeId !== run.storeId ||
      value.target.uid !== run.uid ||
      value.target.accountId !== value.basis.accountId ||
      value.target.pageId !== value.basis.pageId ||
      JSON.stringify(value.action) !== JSON.stringify(run.action)
    )
      throw new Error('平台准备目标或最终内容不匹配')
    if (Math.min(run.expiresAt, value.expiresAt) <= this.clock()) throw new Error('事项已过期')
    run.state = 'pending'
    run.prepared = value
    run.approvalId = approvalId
    run.expiresAt = Math.min(run.expiresAt, value.expiresAt)
    run.reason = '平台目标与内容已准备，等待用户逐条批准'
    this.commit(next)
  }
  blockOperation(id: string, reason: string) {
    if (this.closed) return
    const next = structuredClone(this.state)
    const run = next.runs.find((r) => r.id === id)
    if (!run || !['pending', 'blocked'].includes(run.state)) return
    run.state = 'blocked'
    run.reason = reason.slice(0, 300)
    delete run.approvalId
    delete run.prepared
    this.commit(next)
  }
  beginOperation(id: string, approvalId: string): SchedulerRun {
    if (this.closed) throw new Error('调度服务已关闭')
    const next = structuredClone(this.state)
    const run = next.runs.find((r) => r.id === id)
    if (
      !run ||
      run.state !== 'pending' ||
      !run.prepared ||
      !approvalId ||
      run.approvalId !== approvalId
    )
      throw new Error('事项已处理、未准备或批准已消费，请刷新核对')
    if (run.expiresAt <= this.clock()) {
      run.state = 'expired'
      run.reason = '等待超过有效期，未执行'
      delete run.approvalId
      this.commit(next)
      throw new Error('事项已过期')
    }
    run.state = 'executing'
    run.reason = '用户已批准此项，正在串行复核并执行'
    delete run.approvalId
    this.commit(next)
    return structuredClone(run)
  }
  finishOperation(
    id: string,
    state: 'confirmed' | 'failed' | 'uncertain' | 'invalidated' | 'blocked',
    reason: string,
    evidence?: OperationEvidence,
    inspecting = false,
  ) {
    const next = structuredClone(this.state)
    const run = next.runs.find((r) => r.id === id)
    if (!run || (run.state !== 'executing' && !(inspecting && run.state === 'uncertain'))) return
    if (state === 'confirmed' && !evidence) throw new Error('平台确认缺少准确目标与内容证据')
    run.state = state
    run.reason = reason.slice(0, 300)
    run.completedAt = this.clock()
    if (evidence) run.evidence = evidence
    delete run.approvalId
    this.commit(next)
  }
  invalidateOperations(storeId: string | undefined, reason: string) {
    if (this.closed) return
    const next = structuredClone(this.state)
    let changed = false
    for (const run of next.runs) {
      if (storeId && run.storeId !== storeId) continue
      if (!['pending', 'blocked', 'executing'].includes(run.state)) continue
      run.state = run.state === 'executing' ? 'uncertain' : 'invalidated'
      run.reason = reason.slice(0, 300)
      delete run.approvalId
      changed = true
    }
    if (changed) this.commit(next)
  }
  invalidateOperation(id: string, reason: string) {
    if (this.closed) return
    const next = structuredClone(this.state)
    const run = next.runs.find((r) => r.id === id)
    if (!run || !['pending', 'blocked'].includes(run.state)) return
    run.state = 'invalidated'
    run.reason = reason.slice(0, 300)
    delete run.approvalId
    this.commit(next)
  }
  private blockReason(task: SchedulerTask): string {
    try {
      this.options.validateTask?.(task)
      return this.options.capability?.(task) ?? '平台事件来源与逐条确认接入尚未验证'
    } catch {
      return '店铺或会话不在当前工作区，任务已阻止'
    }
  }
  execute(input: unknown): SchedulerSnapshot {
    if (this.closed) throw new Error('调度服务已关闭')
    const command = schedulerCommandSchema.parse(input)
    if (command.workspaceId !== this.options.workspaceId) throw new Error('工作区已变化，请刷新')
    const next = structuredClone(this.state)
    const now = this.clock()
    if (command.type === 'cancel') {
      const run = next.runs.find((r) => r.id === command.id)
      if (!run || !['pending', 'blocked'].includes(run.state)) throw new Error('事项已取消或过期')
      run.state = 'cancelled'
      run.reason = '用户已取消，不发送'
      delete run.approvalId
    } else {
      const old = command.id ? next.tasks.find((t) => t.id === command.id) : undefined
      if (command.id && !old) throw new Error('任务不存在，请刷新')
      if (old && old.revision !== command.revision) throw new Error('任务已更新，请刷新后重试')
      if (old) this.cancelPending(next, old.id, '任务已修改或停用，旧事项取消')
      if (command.type === 'remove') next.tasks = next.tasks.filter((t) => t.id !== command.id)
      else {
        const value =
          command.type === 'enable' ? { ...old!, enabled: command.enabled } : command.task
        this.options.validateTask?.(value)
        if (value.enabled && value.schedule.type === 'once' && value.schedule.at <= now)
          throw new Error('一次性任务必须选择未来时间')
        const row: SchedulerTask = {
          ...value,
          id: old?.id ?? randomUUID(),
          revision: (old?.revision ?? 0) + 1,
          nextAt: nextOccurrence(value.schedule, now),
        }
        next.tasks = [...next.tasks.filter((t) => t.id !== row.id), row]
      }
    }
    this.commit(next)
    return this.snapshot()
  }
  tick(at = this.clock()) {
    if (this.closed) return
    const next = structuredClone(this.state)
    let changed = false
    for (const run of next.runs)
      if (['pending', 'blocked'].includes(run.state) && run.expiresAt <= at) {
        run.state = 'expired'
        run.reason = '等待超过十分钟，未批准不发送'
        delete run.approvalId
        changed = true
      }
    for (const task of next.tasks) {
      if (!task.enabled || task.nextAt > at) continue
      const occurrence = task.nextAt
      const reason = this.blockReason(task)
      next.runs.push({
        id: randomUUID(),
        taskId: task.id,
        storeId: task.storeId,
        uid: task.uid,
        action: task.action,
        occurrence,
        state: reason ? 'blocked' : 'pending',
        reason: reason || '待提交统一确认门，尚未发送',
        createdAt: at,
        expiresAt: at + 600000,
      })
      if (task.schedule.type === 'once') task.enabled = false
      else task.nextAt = nextOccurrence(task.schedule, at)
      changed = true
    }
    if (changed) {
      const pending = next.runs.filter(retained)
      if (pending.length > 500) throw new Error('待处理事项过多，请先取消或处理')
      const capacity = 500 - pending.length
      const history = capacity ? next.runs.filter((r) => !retained(r)).slice(-capacity) : []
      next.runs = [...history, ...pending].sort((a, b) => a.createdAt - b.createdAt)
      this.commit(next)
    }
  }
}

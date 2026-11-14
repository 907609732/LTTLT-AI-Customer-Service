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
} from '../src/shared/contracts/scheduler'

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
/** No sender or approve method: due tasks create intents for the existing confirmation gate. */
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
    if (this.state.runs.some((r) => r.state === 'pending')) {
      const next = structuredClone(this.state)
      this.cancelPending(next, undefined, '应用已重启，请重新建立并逐条确认')
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
    if (this.closed || !this.state.runs.some((run) => run.state === 'pending')) return
    const next = structuredClone(this.state)
    this.cancelPending(next, undefined, '调度服务已暂停，未批准事项已取消')
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
      if (run.state === 'pending' && (!taskId || run.taskId === taskId)) {
        run.state = 'cancelled'
        run.reason = reason
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
    if (this.state.receipts.some((r) => r.key === key && r.expiresAt > at)) return 0
    const next = structuredClone(this.state)
    next.receipts = next.receipts.filter((r) => r.expiresAt > at)
    if (next.receipts.length >= 10000) throw new Error('事件去重容量已满，停止生成，避免重复发送')
    if (next.runs.length + actions.length > 500) {
      const keep = next.runs.filter((r) => r.state === 'pending')
      const capacity = 500 - keep.length - actions.length
      if (capacity < 0) throw new Error('待处理事项已满，请先取消或处理')
      const history = capacity
        ? next.runs.filter((r) => r.state !== 'pending').slice(-capacity)
        : []
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
      if (!run || run.state !== 'pending') throw new Error('事项已取消或过期')
      run.state = 'cancelled'
      run.reason = '用户已取消，不发送'
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
      if (run.state === 'pending' && run.expiresAt <= at) {
        run.state = 'expired'
        run.reason = '等待超过十分钟，未批准不发送'
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
      const pending = next.runs.filter((r) => r.state === 'pending')
      if (pending.length > 500) throw new Error('待处理事项过多，请先取消或处理')
      const history = next.runs.filter((r) => r.state !== 'pending').slice(-(500 - pending.length))
      next.runs = [...history, ...pending].sort((a, b) => a.createdAt - b.createdAt)
      this.commit(next)
    }
  }
}

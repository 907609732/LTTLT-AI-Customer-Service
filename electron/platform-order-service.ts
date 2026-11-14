import fs from 'node:fs'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { z } from 'zod'
import {
  orderRangeSchema,
  orderReportSchema,
  orderRequestSchema,
  orderTaskSchema,
  type OrderRange,
  type PlatformOrder,
  type PlatformOrderReport,
  type PlatformOrderSnapshot,
  type PlatformOrderTask,
} from '../src/shared/contracts/platform-orders'
import { parsePddOrderPage, type PddOrderPage } from './platform-order-parser'

export interface PlatformOrderIdentity {
  accountId: string
  platformStoreId: string
}
export interface PlatformOrderPort {
  assertActive(): void
  identity(storeId: string): Promise<PlatformOrderIdentity>
  readPage(input: {
    storeId: string
    identity: PlatformOrderIdentity
    range: OrderRange
    page: number
    signal: AbortSignal
  }): Promise<PddOrderPage>
}
const storedSchema = z
  .object({
    version: z.literal(1),
    report: orderReportSchema.nullable(),
    task: orderTaskSchema.nullable(),
  })
  .strict()
type Stored = z.infer<typeof storedSchema>
const cleanError = (error: unknown) =>
  String(error instanceof Error ? error.message : '平台订单读取失败')
    .replace(/\bBearer\s+\S+|\bsk[-_]\S+/gi, '[已隐藏]')
    .slice(0, 500)
const sameRange = (a: OrderRange, b: OrderRange) =>
  a.from === b.from &&
  a.to === b.to &&
  a.timeField === b.timeField &&
  a.status === b.status &&
  a.timezone === b.timezone

/** One instance belongs to a verified account directory; partial reads never replace its last report. */
export class PlatformOrderService {
  private closed = false
  private states = new Map<string, Stored>()
  private controllers = new Map<string, AbortController>()
  private now: () => number
  constructor(
    private options: {
      directory: string
      workspaceId: string
      port: PlatformOrderPort
      now?: () => number
    },
  ) {
    this.now = options.now ?? Date.now
  }
  private assert(workspaceId: string) {
    if (this.closed || workspaceId !== this.options.workspaceId)
      throw Error('订单工作区已改变，请重新读取')
    this.options.port.assertActive()
  }
  private file(storeId: string) {
    if (!storeId || storeId.length > 128) throw Error('店铺无效')
    return path.join(
      this.options.directory,
      'platform-orders',
      createHash('sha256').update(storeId).digest('hex') + '.json',
    )
  }
  private load(storeId: string) {
    let state = this.states.get(storeId)
    if (state) return state
    const file = this.file(storeId)
    if (fs.existsSync(file)) {
      if (fs.statSync(file).size > 16 * 1024 * 1024)
        throw Error('订单存档超过容量，请保留原文件后排查')
      state = storedSchema.parse(JSON.parse(fs.readFileSync(file, 'utf8')))
      if (state.report?.storeId !== storeId && state.report) throw Error('订单存档店铺不符')
      if (state.task?.storeId !== storeId && state.task) throw Error('采集任务店铺不符')
      if (state.task?.state === 'reading') {
        state.task.state = 'paused'
        state.task.error = '应用已重启，重新读取所选范围后才能发布完整结果'
        this.commit(storeId, state)
      }
    } else state = { version: 1, report: null, task: null }
    this.states.set(storeId, state)
    return state
  }
  private commit(storeId: string, input: Stored) {
    const state = storedSchema.parse(input)
    const file = this.file(storeId)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    const temporary = file + '.' + randomUUID() + '.tmp'
    try {
      fs.writeFileSync(temporary, JSON.stringify(state), { flag: 'wx', mode: 0o600 })
      fs.renameSync(temporary, file)
    } finally {
      if (fs.existsSync(temporary)) fs.unlinkSync(temporary)
    }
    this.states.set(storeId, state)
  }
  snapshot(workspaceId: string, storeId: string): PlatformOrderSnapshot {
    this.assert(workspaceId)
    const state = this.load(storeId)
    return structuredClone({ workspaceId, storeId, report: state.report, task: state.task })
  }
  async execute(input: unknown): Promise<PlatformOrderSnapshot> {
    const request = orderRequestSchema.parse(input)
    this.assert(request.workspaceId)
    const state = this.load(request.storeId)
    if (request.type === 'snapshot') return this.snapshot(request.workspaceId, request.storeId)
    if (request.type === 'cancel') {
      if (state.task?.id !== request.taskId || state.task.state !== 'reading')
        throw Error('采集任务已结束或改变')
      this.controllers.get(request.storeId)?.abort()
      const next = structuredClone(state)
      next.task!.state = 'cancelled'
      next.task!.error = '已取消，未发布部分结果'
      next.task!.updatedAt = this.now()
      this.commit(request.storeId, next)
      return this.snapshot(request.workspaceId, request.storeId)
    }
    if (this.controllers.has(request.storeId)) throw Error('此店铺订单正在读取，请先取消或等待完成')
    if (request.type === 'import') {
      const identity = await this.options.port.identity(request.storeId)
      this.assert(request.workspaceId)
      const report = parseOrderCsv(
        request.csv,
        request.storeId,
        identity.platformStoreId,
        request.range,
        this.now(),
      )
      this.commit(request.storeId, { version: 1, report, task: null })
      return this.snapshot(request.workspaceId, request.storeId)
    }
    const at = this.now()
    const task: PlatformOrderTask = {
      id: randomUUID(),
      storeId: request.storeId,
      range: request.range,
      state: 'reading',
      pages: 0,
      records: 0,
      total: null,
      error: '',
      startedAt: at,
      updatedAt: at,
    }
    this.commit(request.storeId, { ...state, task })
    const controller = new AbortController()
    this.controllers.set(request.storeId, controller)
    void this.collect(task, controller)
    return this.snapshot(request.workspaceId, request.storeId)
  }
  private async collect(task: PlatformOrderTask, controller: AbortController) {
    const current = () => {
      this.assert(this.options.workspaceId)
      controller.signal.throwIfAborted()
      if (this.load(task.storeId).task?.id !== task.id) throw Error('采集任务已被替换')
    }
    try {
      const identity = await this.options.port.identity(task.storeId)
      current()
      const records = new Map<string, PlatformOrder>()
      const signatures = new Set<string>()
      let total: number | null | undefined
      for (let page = 1; page <= 200; page++) {
        if (this.now() - task.startedAt > 300000)
          throw Error('采集超过五分钟，请缩小日期范围或使用平台导出文件')
        const result = await this.options.port.readPage({
          storeId: task.storeId,
          identity,
          range: task.range,
          page,
          signal: controller.signal,
        })
        current()
        if (result.platformStoreId !== identity.platformStoreId)
          throw Error('平台店铺身份改变，已停止')
        if (result.page !== page || !sameRange(orderRangeSchema.parse(result.range), task.range))
          throw Error('平台页码或查询范围改变，已停止')
        if (total !== undefined && total !== result.total)
          throw Error('订单总数在采集中变化，请重新查询')
        total = result.total
        const signature = JSON.stringify(result.orders.map((row) => row.id))
        if (result.orders.length && signatures.has(signature))
          throw Error('平台返回重复整页，已停止')
        signatures.add(signature)
        for (const row of result.orders) {
          const previous = records.get(row.id)
          if (previous && JSON.stringify(previous) !== JSON.stringify(row))
            throw Error('同一订单在分页中发生变化，请重新读取')
          records.set(row.id, row)
        }
        if (records.size > 10000) throw Error('范围超过一万条订单，请分日期读取或导入平台文件')
        const next = structuredClone(this.load(task.storeId))
        next.task = {
          ...task,
          pages: page,
          records: records.size,
          total: total ?? null,
          updatedAt: this.now(),
        }
        if (!result.hasNext) {
          if (total === null || records.size !== total)
            throw Error('尚未核对平台订单总数，不能发布完整结果')
          next.report = {
            storeId: task.storeId,
            platformStoreId: identity.platformStoreId,
            range: task.range,
            capturedAt: this.now(),
            pages: page,
            total,
            complete: true,
            source: 'pdd-native-page',
            receivedLabel: '原平台实收金额',
            records: [...records.values()],
          }
          next.task.state = 'complete'
          this.commit(task.storeId, next)
          return
        }
        if (!result.orders.length) throw Error('分页尚未结束却返回空页，已停止')
        this.commit(task.storeId, next)
      }
      throw Error('超过200页采集上限，请缩小范围；未发布部分结果')
    } catch (error) {
      if (this.closed || controller.signal.aborted) return
      try {
        this.assert(this.options.workspaceId)
        const next = structuredClone(this.load(task.storeId))
        if (next.task?.id !== task.id || next.task.state !== 'reading') return
        next.task.state = 'failed'
        next.task.error = cleanError(error)
        next.task.updatedAt = this.now()
        this.commit(task.storeId, next)
      } catch {
        /* A closed account cannot publish or change its old records. */
      }
    } finally {
      if (this.controllers.get(task.storeId) === controller) this.controllers.delete(task.storeId)
    }
  }
  pause() {
    if (this.closed) return
    for (const [storeId, controller] of this.controllers) {
      controller.abort()
      const state = this.states.get(storeId)
      if (state?.task?.state === 'reading') {
        const next = structuredClone(state)
        next.task!.state = 'paused'
        next.task!.error = '工作区已暂停，重新读取所选范围后继续'
        this.commit(storeId, next)
      }
    }
    this.controllers.clear()
  }
  dispose() {
    if (this.closed) return
    this.pause()
    this.closed = true
  }
}

const csvParser = createRequire(path.join(__dirname, 'main.cjs'))('papaparse') as {
  parse(
    text: string,
    options: { header: true; skipEmptyLines: true; transformHeader(value: string): string },
  ): { data: Record<string, string>[]; errors: { message: string }[]; meta: { fields?: string[] } }
}
function parseOrderCsv(
  csv: string,
  storeId: string,
  platformStoreId: string,
  range: OrderRange,
  at: number,
): PlatformOrderReport {
  const parsed = csvParser.parse(csv.replace(/^\uFEFF/, ''), {
    header: true,
    skipEmptyLines: true,
    transformHeader: (value) => value.trim(),
  })
  if (parsed.errors.length || parsed.data.length > 10000) throw Error('订单CSV格式或容量不正确')
  const fields = parsed.meta.fields ?? []
  const field = (names: string[], required = false) => {
    const value = names.find((name) => fields.includes(name))
    if (!value && required) throw Error('订单CSV缺少字段：' + names[0])
    return value
  }
  const id = field(['订单号', '订单编号'], true)!,
    title = field(['商品名称', '商品信息'], true)!,
    status = field(['订单状态', '订单/售后状态'], true)!,
    quantity = field(['商品数量', '数量'], true)!,
    goods = field(['商品总价', '商品总价(元)', '商品金额'], true)!,
    received = field(['实收金额', '实收金额(元)', '实付金额'], true)!,
    created = field(['下单时间', '订单创建时间'], true)!,
    paid = field(['支付时间', '付款时间']),
    refund = field(['退款金额', '退款金额(元)'])
  const result = parsePddOrderPage({
    url: 'https://mms.pinduoduo.com/orders/list',
    platformStoreId,
    range,
    orderStatus: '全部',
    aftersaleStatus: '全部',
    page: 1,
    total: parsed.data.length,
    hasNext: false,
    emptyConfirmed: parsed.data.length === 0,
    captcha: false,
    headers: ['商品信息', '订单/售后状态', '数量', '商品总价(元)', '实收金额(元)', '买家'],
    blocks: parsed.data.map((row) => ({
      id: row[id]?.trim(),
      created: row[created],
      paid: paid ? row[paid] : undefined,
      refund: refund ? row[refund] : undefined,
      cells: [row[title], row[status], row[quantity], row[goods], row[received], ''],
    })),
  })
  const minimum = Date.parse(range.from + 'T00:00:00+08:00'),
    maximum = Date.parse(range.to + 'T23:59:59.999+08:00')
  for (const row of result.orders) {
    const time = range.timeField === 'paid' ? row.paidAt : row.createdAt
    if (time === null || time < minimum || time > maximum)
      throw Error('导入订单时间超出声明范围或无法核实')
  }
  return orderReportSchema.parse({
    storeId,
    platformStoreId,
    range,
    capturedAt: at,
    pages: 0,
    total: null,
    complete: false,
    source: 'csv-import',
    receivedLabel: received,
    records: result.orders.map((row) => ({ ...row, source: 'csv-import' })),
  })
}

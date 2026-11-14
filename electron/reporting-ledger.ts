import { createHash, randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { z } from 'zod'
import {
  emptyReportingCounts,
  reportingKinds,
  type ReportingKind,
  type ReportingReport,
} from '../src/shared/contracts/reporting'

const storedEventSchema = z
  .object({
    key: z.string().regex(/^[a-f0-9]{64}$/),
    kind: z.enum(reportingKinds),
    at: z.number().finite().positive(),
    simulated: z.boolean(),
  })
  .strict()
const ledgerSchema = z
  .object({
    version: z.literal(1),
    observedSince: z.number().finite().positive(),
    truncated: z.boolean(),
    events: z.array(storedEventSchema).max(200000),
  })
  .strict()
type Ledger = z.infer<typeof ledgerSchema>
export interface ReportingEvidence {
  id: string
  storeId: string
  platform: string
  kind: ReportingKind
  at: number
}

/** 只保留带来源的事件指纹，不落买家标识、正文或订单号；不推断离线期间数据。 */
export class ReportingLedger {
  private data: Ledger
  private failed = false
  private keys = new Set<string>()
  constructor(
    private file: string,
    private clock: () => number = Date.now,
  ) {
    this.data = { version: 1, observedSince: clock(), truncated: false, events: [] }
    try {
      this.data = ledgerSchema.parse(JSON.parse(fs.readFileSync(file, 'utf8')))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') this.failed = true
    }
    this.prune()
  }
  private cutoff() {
    const date = new Date(this.clock())
    date.setHours(0, 0, 0, 0)
    date.setDate(date.getDate() - 29)
    return date.getTime()
  }
  private prune() {
    this.data.events = this.data.events.filter((event) => event.at >= this.cutoff())
    this.keys = new Set(this.data.events.map((event) => event.key))
  }
  record(event: ReportingEvidence) {
    return this.recordMany([event]) > 0
  }
  recordMany(events: ReportingEvidence[]) {
    if (this.failed) return 0
    this.prune()
    const next: Ledger = { ...this.data, events: [...this.data.events] }
    const keys = new Set(this.keys)
    let count = 0
    for (const event of events) {
      if (
        !event.id ||
        !event.storeId ||
        !event.platform ||
        !reportingKinds.includes(event.kind) ||
        !Number.isFinite(event.at) ||
        event.at <= 0 ||
        event.at > this.clock() ||
        event.at < this.cutoff()
      )
        continue
      const key = createHash('sha256')
        .update(JSON.stringify([event.storeId, event.platform, event.kind, event.id]))
        .digest('hex')
      if (keys.has(key)) continue
      if (next.events.length >= 200000) {
        next.truncated = true
        continue
      }
      keys.add(key)
      next.events.push({
        key,
        kind: event.kind,
        at: event.at,
        simulated: event.platform === 'sim-local',
      })
      count++
    }
    if (!count && next.truncated === this.data.truncated) return 0
    const temporary = `${this.file}.${randomUUID()}.tmp`
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true })
      fs.writeFileSync(temporary, JSON.stringify(next), { mode: 0o600, flag: 'wx' })
      fs.renameSync(temporary, this.file)
      this.data = next
      this.keys = keys
      return count
    } catch {
      this.failed = true
      return 0
    } finally {
      fs.rmSync(temporary, { force: true })
    }
  }
  report(start: number, end: number): ReportingReport {
    this.prune()
    const real = emptyReportingCounts(),
      simulated = emptyReportingCounts()
    for (const event of this.data.events) {
      if (event.at >= start && event.at < end && event.at <= this.clock())
        (event.simulated ? simulated : real)[event.kind]++
    }
    return {
      start,
      end,
      observedSince: this.data.observedSince,
      persistence: this.failed ? 'error' : 'ready',
      truncated: this.data.truncated,
      source: 'local-observed-events',
      complete: false,
      real,
      simulated,
    }
  }
}

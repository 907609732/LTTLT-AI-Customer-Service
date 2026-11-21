import { createHash, randomUUID } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join } from 'node:path'

const STORE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/
const storeIdOf = (value: string) => {
  if (!STORE_ID.test(value)) throw new Error('店铺编号无效，未执行删除')
  return value
}
const hash = (value: string) => createHash('sha256').update(value).digest('hex')

/** Main-process gate: the renderer may request purge only together with explicit removal confirmation. */
export function parseRemoveStoreValues(values: Record<string, unknown>): { purge: boolean } {
  if (values.confirmed !== true) throw new Error('请先确认移除此店铺')
  if (values.purge !== undefined && typeof values.purge !== 'boolean')
    throw new Error('彻底删除选项无效')
  return { purge: values.purge === true }
}

export interface StorePurgeStep {
  status: 'pending' | 'running' | 'completed' | 'failed'
  error: string
}
export interface StorePurgeJournalRecord {
  version: 1
  storeId: string
  /** The vendor removal must have succeeded before any purge step may run. */
  removalConfirmed: boolean
  state: 'planned' | 'running' | 'failed' | 'completed'
  startedAt: number
  updatedAt: number
  error: string
  steps: Record<string, StorePurgeStep>
}
export interface StorePurgeReport {
  storeId: string
  steps: Record<string, StorePurgeStep>
  knowledge?: Record<string, unknown>
  removed: Record<string, number>
  retained: string[]
  warnings: string[]
}

const STEP_NAMES = [
  'knowledge',
  'platform-learning',
  'automation-rules',
  'scheduler',
  'operations',
  'orders',
  'size-rules',
  'send-mode',
  'ai-preferences',
  'custom-phrases',
  'browser-session',
  'vendor-files',
] as const
export type StorePurgeStepName = (typeof STEP_NAMES)[number]

const directory = (dataDir: string) => join(dataDir, 'store-purges')
const fileFor = (dataDir: string, storeId: string) =>
  join(directory(dataDir), `${hash(storeId)}.json`)

function writeAtomic(file: string, value: unknown): void {
  mkdirSync(dirname(file), { recursive: true })
  const temporary = `${file}.${randomUUID()}.tmp`
  try {
    writeFileSync(temporary, JSON.stringify(value), {
      encoding: 'utf8',
      mode: 0o600,
      flag: 'wx',
    })
    renameSync(temporary, file)
  } finally {
    rmSync(temporary, { force: true })
  }
}

export class StorePurgeJournal {
  readonly storeId: string
  readonly file: string
  private record: StorePurgeJournalRecord

  private constructor(file: string, record: StorePurgeJournalRecord) {
    this.file = file
    this.storeId = record.storeId
    this.record = record
  }

  static begin(dataDir: string, storeId: string, now = Date.now()): StorePurgeJournal {
    const id = storeIdOf(storeId)
    mkdirSync(directory(dataDir), { recursive: true })
    const file = fileFor(dataDir, id)
    if (existsSync(file)) {
      try {
        const saved = JSON.parse(readFileSync(file, 'utf8')) as StorePurgeJournalRecord
        if (saved.storeId === id && saved.version === 1) {
          const journal = new StorePurgeJournal(file, {
            ...saved,
            removalConfirmed: saved.removalConfirmed === true,
          })
          journal.record = {
            ...journal.record,
            state: 'running',
            updatedAt: now,
            error: '',
          }
          journal.persist()
          return journal
        }
      } catch {
        // A malformed old journal cannot authorize deleting anything.
      }
      throw new Error('该店铺的删除记录已损坏，未继续删除')
    }
    const record: StorePurgeJournalRecord = {
      version: 1,
      storeId: id,
      removalConfirmed: false,
      state: 'planned',
      startedAt: now,
      updatedAt: now,
      error: '',
      steps: Object.fromEntries(
        STEP_NAMES.map((name) => [name, { status: 'pending', error: '' } satisfies StorePurgeStep]),
      ),
    }
    writeAtomic(file, record)
    return new StorePurgeJournal(file, record)
  }

  static all(dataDir: string): StorePurgeJournal[] {
    const root = directory(dataDir)
    if (!existsSync(root)) return []
    const records: StorePurgeJournal[] = []
    for (const name of readdirSync(root)) {
      if (!/^[a-f0-9]{64}\.json$/.test(name)) continue
      const file = join(root, name)
      try {
        const record = JSON.parse(readFileSync(file, 'utf8')) as StorePurgeJournalRecord
        if (
          record.version === 1 &&
          STORE_ID.test(record.storeId) &&
          record.steps &&
          typeof record.steps === 'object'
        )
          records.push(new StorePurgeJournal(file, record))
      } catch {
        // Corrupt journals are not used to delete data.
      }
    }
    return records
  }

  get state() {
    return this.record.state
  }
  get removalConfirmed() {
    return this.record.removalConfirmed
  }
  get snapshot() {
    return structuredClone(this.record)
  }
  confirmRemoval(now = Date.now()) {
    this.record = { ...this.record, removalConfirmed: true, updatedAt: now }
    this.persist()
  }
  markRunning(now = Date.now()) {
    this.record = { ...this.record, state: 'running', updatedAt: now, error: '' }
    this.persist()
  }
  mark(step: StorePurgeStepName, status: StorePurgeStep['status'], error = '', now = Date.now()) {
    this.record = {
      ...this.record,
      updatedAt: now,
      steps: { ...this.record.steps, [step]: { status, error: error.slice(0, 500) } },
    }
    this.persist()
  }
  complete(now = Date.now()) {
    this.record = { ...this.record, state: 'completed', updatedAt: now, error: '' }
    this.persist()
  }
  fail(error: unknown, now = Date.now()) {
    this.record = {
      ...this.record,
      state: 'failed',
      updatedAt: now,
      error: (error instanceof Error ? error.message : String(error)).slice(0, 1000),
    }
    this.persist()
  }
  abort() {
    rmSync(this.file, { force: true })
  }
  private persist() {
    writeAtomic(this.file, this.record)
  }
}

export interface StorePurgePorts {
  dataDir: string
  knowledge: { purgeStore(storeId: string): Promise<Record<string, unknown>> }
  platformLearning?: { removeStore(storeId: string): void }
  scheduler?: { removeStore(storeId: string): void }
  automation?: { removeStore(storeId: string): void }
  operations?: { removeStore(storeId: string): void }
  orders?: { removeStore(storeId: string): void }
  sizeRules?: { removeStore(storeId: string): number }
  aiPreferences?: { disable(storeId: string): void }
  sendModes?: { remove(storeId: string): void }
  customPhrases?: { removeStore(storeId: string): void }
  clearBrowserSession?: (storeId: string) => Promise<void>
  now?: () => number
}

/**
 * Deletes only rows/files that carry this store's identity. The anonymous report
 * ledger, scheduler dedupe hashes, mixed-store sync journals, logs and all backups
 * are deliberately retained; they cannot be safely attributed to one store.
 */
export async function executeStorePurge(
  journal: StorePurgeJournal,
  ports: StorePurgePorts,
): Promise<StorePurgeReport> {
  const now = ports.now ?? Date.now
  const report: StorePurgeReport = {
    storeId: journal.storeId,
    steps: {},
    removed: {},
    retained: [
      '其他店铺与共享商品',
      '全局模型规则、关键词、禁用词与账号计费',
      '知识库历史备份与全库/跨店同步备份',
      '不可安全归属的匿名报表事件、调度去重指纹与混合日志',
    ],
    warnings: [],
  }
  const errors: unknown[] = []
  const run = async (name: StorePurgeStepName, action: () => unknown | Promise<unknown>) => {
    journal.mark(name, 'running', '', now())
    try {
      const value = await action()
      if (typeof value === 'number') report.removed[name] = value
      report.steps[name] = { status: 'completed', error: '' }
      journal.mark(name, 'completed', '', now())
      return value
    } catch (error) {
      report.steps[name] = {
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
      }
      journal.mark(name, 'failed', report.steps[name].error, now())
      errors.push(error)
      return undefined
    }
  }

  report.knowledge = (await run('knowledge', () => ports.knowledge.purgeStore(journal.storeId))) as
    | Record<string, unknown>
    | undefined
  await run('platform-learning', () => ports.platformLearning?.removeStore(journal.storeId))
  await run('automation-rules', () => ports.automation?.removeStore(journal.storeId))
  await run('scheduler', () => ports.scheduler?.removeStore(journal.storeId))
  await run('operations', () => ports.operations?.removeStore(journal.storeId))
  await run('orders', () => ports.orders?.removeStore(journal.storeId))
  await run('size-rules', () => ports.sizeRules?.removeStore(journal.storeId))
  await run('send-mode', () => ports.sendModes?.remove(journal.storeId))
  await run('ai-preferences', () => ports.aiPreferences?.disable(journal.storeId))
  await run('custom-phrases', () => ports.customPhrases?.removeStore(journal.storeId))
  await run('browser-session', () => ports.clearBrowserSession?.(journal.storeId))
  await run('vendor-files', () => sanitizeVendorStoreData(ports.dataDir, journal.storeId))

  if (errors.length) {
    const error = new Error(
      `店铺已从本机移除，但本店数据未全部删除：${errors
        .map((cause) => (cause instanceof Error ? cause.message : String(cause)))
        .join('；')}。删除记录已保留，重启应用会重试。`,
    )
    journal.fail(error, now())
    throw error
  }
  journal.complete(now())
  return report
}

/** The registry is the authority on whether the vendor removal actually committed. */
export function storeRegistered(dataDir: string, storeId: string): boolean {
  const file = join(dataDir, 'stores.json')
  if (!existsSync(file)) return false
  const raw = JSON.parse(readFileSync(file, 'utf8')) as unknown
  const root = object(raw)
  return array(root?.stores).some((row) => object(row)?.id === storeId)
}

/** A completed/failed journal may be retried before the next account operation. */
export async function resumeStorePurges(ports: StorePurgePorts): Promise<void> {
  for (const journal of StorePurgeJournal.all(ports.dataDir)) {
    try {
      // Re-imported/restored stores win over an old tombstone. Never sanitize or
      // purge a store that is present in the live registry.
      if (storeRegistered(ports.dataDir, journal.storeId)) {
        journal.abort()
        continue
      }
    } catch {
      continue
    }
    if (journal.state === 'completed') {
      try {
        sanitizeVendorStoreData(ports.dataDir, journal.storeId)
      } catch {
        // Keep the tombstone; the next full startup can retry without blocking UI.
      }
      continue
    }
    if (!journal.removalConfirmed)
      // The vendor registry no longer contains the store, so the removal committed
      // even if the process stopped before writing the confirmation.
      journal.confirmRemoval()
    try {
      await executeStorePurge(journal, ports)
    } catch {
      // Failed state is persisted; the store is already absent and other stores stay usable.
    }
  }
}

function object(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}
function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function updateFile(
  file: string,
  storeId: string,
  update: (value: unknown) => { changed: boolean; value?: unknown },
): boolean {
  if (!existsSync(file)) return false
  const raw = readFileSync(file, 'utf8')
  // Avoid parsing the potentially large welcome/quality files on every backend event
  // once the target store has already been removed.
  if (!raw.includes(storeId)) return false
  const next = update(JSON.parse(raw) as unknown)
  if (next.changed) writeAtomic(file, next.value)
  return next.changed
}

/** Remove one store from mixed vendor JSON without rewriting unrelated stores/global fields. */
export function sanitizeVendorStoreData(dataDir: string, storeId: string): void {
  const id = storeIdOf(storeId)
  const removeRow = (row: unknown) => {
    const item = object(row)
    return item?.storeId === id || item?.store_id === id
  }
  const removeScoped = (value: unknown) => {
    if (!Array.isArray(value)) return value
    return value.filter((row) => !removeRow(row))
  }

  updateFile(join(dataDir, 'stores.json'), id, (raw) => {
    const root = object(raw)
    const stores = array(root?.stores)
    const next = stores.filter((row) => object(row)?.id !== id)
    return {
      changed: next.length !== stores.length,
      value: root && Array.isArray(root.stores) ? { ...root, stores: next } : raw,
    }
  })
  updateFile(join(dataDir, 'conversations.json'), id, (raw) => ({
    changed: Array.isArray(raw) && raw.some(removeRow),
    value: removeScoped(raw),
  }))
  updateFile(join(dataDir, 'store-handoff.json'), id, (raw) => {
    const root = object(raw)
    if (!root || !object(root.stores)) return { changed: false }
    const stores = { ...(root.stores as Record<string, unknown>) }
    const changed = Object.hasOwn(stores, id)
    delete stores[id]
    return { changed, value: { ...root, stores } }
  })
  updateFile(join(dataDir, 'store-welcome.json'), id, (raw) => {
    const root = object(raw)
    if (!root) return { changed: false }
    const stores = object(root.stores) ? { ...(root.stores as Record<string, unknown>) } : undefined
    const seen = Array.isArray(root.seen) ? root.seen : undefined
    let changed = false
    if (stores && Object.hasOwn(stores, id)) {
      delete stores[id]
      changed = true
    }
    if (seen) {
      const next = seen.filter((row) => object(row)?.storeId !== id)
      if (next.length !== seen.length) changed = true
      return { changed, value: { ...root, ...(stores ? { stores } : {}), seen: next } }
    }
    return { changed, value: { ...root, ...(stores ? { stores } : {}) } }
  })
  updateFile(join(dataDir, 'store-vision.json'), id, (raw) => {
    const root = object(raw)
    if (!root || !object(root.stores)) return { changed: false }
    const stores = { ...(root.stores as Record<string, unknown>) }
    const changed = Object.hasOwn(stores, id)
    delete stores[id]
    return { changed, value: { ...root, stores } }
  })
  updateFile(join(dataDir, 'model-profiles.json'), id, (raw) => {
    const root = object(raw)
    if (!root || !object(root.bindings)) return { changed: false }
    const bindings = { ...(root.bindings as Record<string, unknown>) }
    const changed = Object.hasOwn(bindings, id)
    delete bindings[id]
    return { changed, value: { ...root, bindings } }
  })
  updateFile(join(dataDir, 'work-orders.json'), id, (raw) => {
    const root = object(raw)
    const orders = array(root?.orders)
    const next = orders.filter((row) => object(row)?.storeId !== id)
    return {
      changed: next.length !== orders.length,
      value: root ? { ...root, orders: next } : raw,
    }
  })
  updateFile(join(dataDir, 'conversation-quality.json'), id, (raw) => {
    const root = object(raw)
    const rows = array(root?.rows)
    const next = rows.filter((row) => object(row)?.storeId !== id)
    return { changed: next.length !== rows.length, value: root ? { ...root, rows: next } : raw }
  })
  const remainingWorkOrderIds = new Set<string>()
  try {
    const workOrders = object(readFileSync(join(dataDir, 'work-orders.json'), 'utf8'))
    for (const row of array(workOrders?.orders)) {
      const id = object(row)?.id
      if (typeof id === 'string') remainingWorkOrderIds.add(id)
    }
  } catch {
    // Missing/corrupt work-order storage keeps no valid selection; auxiliary state can
    // safely drop the pointer without touching unrelated rows.
  }
  updateFile(join(dataDir, 'auxiliary-state.json'), id, (raw) => {
    const root = object(raw)
    if (!root) return { changed: false }
    const selected = object(root.selected)
    const drafts = array(root.drafts)
    const hidden = array(root.hidden)
    const nextDrafts = drafts.filter((row) => object(row)?.storeId !== id)
    const nextHidden = hidden.filter((row) => object(row)?.storeId !== id)
    const nextSelected = selected?.storeId === id ? null : root.selected
    const filterStore = root.filterStore === id ? '' : root.filterStore
    const workOrderId =
      typeof root.workOrderId === 'string' && remainingWorkOrderIds.has(root.workOrderId)
        ? root.workOrderId
        : ''
    const changed =
      nextDrafts.length !== drafts.length ||
      nextHidden.length !== hidden.length ||
      nextSelected !== root.selected ||
      filterStore !== root.filterStore ||
      workOrderId !== root.workOrderId
    return {
      changed,
      value: {
        ...root,
        selected: nextSelected,
        drafts: nextDrafts,
        hidden: nextHidden,
        filterStore,
        workOrderId,
      },
    }
  })
  updateFile(join(dataDir, 'product-knowledge.json'), id, (raw) => {
    const root = object(raw)
    const items = array(root?.items)
    const next = items.filter((row) => object(row)?.storeId !== id)
    return { changed: next.length !== items.length, value: root ? { ...root, items: next } : raw }
  })
  updateFile(join(dataDir, 'intent-knowledge.json'), id, (raw) => {
    const root = object(raw)
    const packs = array(root?.packs)
    let changed = false
    const next = packs.flatMap((row) => {
      const pack = object(row)
      if (!pack) return [row]
      const stores = array(pack.storeIds)
      if (!stores.includes(id)) return [row]
      changed = true
      const storeIds = stores.filter((value) => value !== id)
      if (!storeIds.length) return []
      const source = object(pack.source)
      return [
        {
          ...pack,
          storeIds,
          ...(source?.storeId === id ? { source: undefined } : {}),
        },
      ]
    })
    return { changed, value: root ? { ...root, packs: next } : raw }
  })
  updateFile(join(dataDir, 'platform-learning.json'), id, (raw) => {
    const root = object(raw)
    const tasks = array(root?.tasks)
    const candidates = array(root?.candidates)
    const nextTasks = tasks.filter((row) => {
      const identity = object(object(row)?.identity)
      return identity?.storeId !== id
    })
    const nextCandidates = candidates.filter((row) => {
      const identity = object(object(row)?.identity)
      return identity?.storeId !== id
    })
    return {
      changed: nextTasks.length !== tasks.length || nextCandidates.length !== candidates.length,
      value: root ? { ...root, tasks: nextTasks, candidates: nextCandidates } : raw,
    }
  })
  updateFile(join(dataDir, 'simulator-stores.json'), id, (raw) => {
    const root = object(raw)
    if (!root || !object(root.stores)) return { changed: false }
    const stores = { ...(root.stores as Record<string, unknown>) }
    const changed = Object.hasOwn(stores, id)
    delete stores[id]
    return { changed, value: { ...root, stores } }
  })

  for (const file of [
    join(dataDir, 'removed-stores', `${encodeURIComponent(id)}.json`),
    join(dataDir, 'custom-phrases', `${hash(id)}.json`),
    join(dataDir, 'platform-orders', `${hash(id)}.json`),
    join(dataDir, 'platform-products', `${hash(id)}.json`),
  ]) {
    try {
      if (existsSync(file)) unlinkSync(file)
    } catch (error) {
      throw new Error(`本店文件未能删除：${error instanceof Error ? error.message : String(error)}`)
    }
  }
}

export { STEP_NAMES, storeIdOf }

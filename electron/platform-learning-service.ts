import { createHash, randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { IntentPack } from '../src/shared/contracts/backend'
import {
  platformLearningChatSchema,
  platformLearningIdentitySchema,
  platformLearningPageSchema,
  platformLearningProductSchema,
  platformLearningQaSchema,
  platformLearningReviewSchema,
  platformLearningSnapshotRequestSchema,
  platformLearningStartSchema,
  platformLearningStateSchema,
  platformLearningTaskRequestSchema,
  type PlatformLearningCandidate,
  type PlatformLearningCollectInput,
  type PlatformLearningIdentity,
  type PlatformLearningPage,
  type PlatformLearningProduct,
  type PlatformLearningChat,
  type PlatformLearningSnapshot,
  type PlatformLearningState,
  type PlatformLearningTask,
} from '../src/shared/contracts/platform-learning'

type PackDraft = Omit<IntentPack, 'id' | 'version' | 'source'>
/** Implemented only by the current main-process workspace; identity must come from the live platform. */
export interface PlatformLearningPort {
  assertActive(): void
  identity(storeId: string): Promise<PlatformLearningIdentity>
  collectProducts(
    input: PlatformLearningCollectInput,
  ): Promise<PlatformLearningPage<PlatformLearningProduct>>
  collectChats(
    input: PlatformLearningCollectInput,
  ): Promise<PlatformLearningPage<PlatformLearningChat>>
  listPacks(): Promise<IntentPack[]>
  savePack(pack: PackDraft): Promise<{ id: string }>
}
interface Options {
  directory: string
  workspaceId: string
  port: PlatformLearningPort
  now?(): number
}
const auditQuestion = '【学习来源审计，请保持停用】'
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const sameIdentity = (a: PlatformLearningIdentity, b: PlatformLearningIdentity) =>
  a.storeId === b.storeId &&
  a.platform === b.platform &&
  a.accountId === b.accountId &&
  a.platformStoreId === b.platformStoreId
const message = (cause: unknown) =>
  (cause instanceof Error ? cause.message : '平台采集失败，请检查登录及页面后重试').slice(0, 2000)

/** Durable read-only collection. Approval creates inactive knowledge and never enables reception. */
export function createPlatformLearningService({
  directory,
  workspaceId,
  port,
  now = Date.now,
}: Options) {
  const file = join(directory, 'platform-learning.json')
  let state: PlatformLearningState = { version: 1, tasks: [], candidates: [] }
  let closed = false
  let starting = false
  const running = new Map<string, AbortController>()
  const reviewing = new Set<string>()
  const listeners = new Set<() => void>()
  const check = (requested: string) => {
    if (closed) throw Error('平台学习服务已关闭')
    port.assertActive()
    if (requested !== workspaceId) throw Error('工作区已变化，请刷新后重试')
  }
  const notify = () => {
    for (const listener of listeners) {
      try {
        listener()
      } catch {
        /* A closed renderer must not interrupt durable progress. */
      }
    }
  }
  function commit(next: PlatformLearningState) {
    const valid = platformLearningStateSchema.parse(next)
    try {
      mkdirSync(directory, { recursive: true })
      writeFileSync(`${file}.tmp`, JSON.stringify(valid), {
        encoding: 'utf8',
        mode: 0o600,
        flush: true,
      })
      renameSync(`${file}.tmp`, file)
    } catch (cause) {
      throw Error('平台学习存储失败；本页未推进，请检查磁盘后重试', { cause })
    }
    state = valid
    notify()
  }
  if (existsSync(file)) {
    try {
      state = platformLearningStateSchema.parse(JSON.parse(readFileSync(file, 'utf8')))
      if (
        new Set(state.tasks.map((task) => task.id)).size !== state.tasks.length ||
        new Set(state.candidates.map((candidate) => candidate.id)).size !==
          state.candidates.length ||
        new Set(state.candidates.map((candidate) => candidate.fingerprint)).size !==
          state.candidates.length ||
        state.candidates.some(
          (candidate) =>
            !state.tasks.some(
              (task) =>
                task.id === candidate.taskId &&
                sameIdentity(task.identity, candidate.identity) &&
                task.source === candidate.source,
            ),
        )
      )
        throw Error('重复任务或候选编号')
    } catch {
      throw Error('平台学习记录损坏，原文件未改动，请恢复备份后重试')
    }
    if (
      state.tasks.some((task) => task.status === 'running') ||
      state.candidates.some((candidate) => candidate.status === 'saving')
    ) {
      const next = structuredClone(state)
      for (const task of next.tasks)
        if (task.status === 'running') {
          task.status = 'paused'
          task.reason = '应用已重启；保留进度，核对原账号店铺后手动继续'
          task.updatedAt = now()
        }
      for (const candidate of next.candidates)
        if (candidate.status === 'saving') {
          candidate.status = 'pending'
          candidate.error = '上次入库中断；重试时先核对已保存的来源审计，避免重复'
          append(candidate, { at: now(), event: 'recovered', reason: candidate.error })
        }
      commit(next)
    }
  }
  function snapshot(input: unknown): PlatformLearningSnapshot {
    const request = platformLearningSnapshotRequestSchema.parse(input)
    check(request.workspaceId)
    return structuredClone({
      version: 1 as const,
      workspaceId,
      tasks: state.tasks.filter(
        (task) => !request.storeId || task.identity.storeId === request.storeId,
      ),
      candidates: state.candidates.filter(
        (candidate) => !request.storeId || candidate.identity.storeId === request.storeId,
      ),
    })
  }
  async function identityFor(storeId: string, expected?: PlatformLearningIdentity) {
    check(workspaceId)
    const identity = platformLearningIdentitySchema.parse(await port.identity(storeId))
    check(workspaceId)
    if (identity.storeId !== storeId || (expected && !sameIdentity(identity, expected)))
      throw Error('平台账号或店铺身份已变化，请切回原账号店铺；旧任务未继续')
    return identity
  }
  function updateTask(
    id: string,
    change: (task: PlatformLearningTask, next: PlatformLearningState) => void,
  ) {
    const next = structuredClone(state)
    const task = next.tasks.find((task) => task.id === id)
    if (!task) throw Error('平台学习任务不存在')
    change(task, next)
    task.updatedAt = now()
    commit(next)
  }
  function append(
    candidate: PlatformLearningCandidate,
    entry: PlatformLearningCandidate['audit'][number],
  ) {
    if (candidate.audit.length >= 100) throw Error('候选审核记录已满，请先核对现有知识包')
    candidate.audit.push(entry)
  }
  function candidatesFor(
    task: PlatformLearningTask,
    page: ReturnType<typeof platformLearningPageSchema.parse>,
  ) {
    const result: Array<Omit<PlatformLearningCandidate, 'id' | 'status' | 'error' | 'audit'>> = []
    let skipped = 0
    const add = (
      question: string,
      answer: string,
      productIds: string[],
      evidence: PlatformLearningCandidate['evidence'],
    ) => {
      const qa = platformLearningQaSchema.safeParse({ question, answer })
      if (!qa.success) {
        skipped++
        return
      }
      const fingerprint = hash([
        task.identity,
        task.source,
        evidence.recordId,
        evidence.messageIds,
        qa.data,
        productIds,
      ])
      result.push({
        taskId: task.id,
        fingerprint,
        source: task.source,
        identity: task.identity,
        ...qa.data,
        original: qa.data,
        productIds,
        evidence,
      })
    }
    if (task.source === 'products') {
      for (const item of page.items) {
        const product = platformLearningProductSchema.parse(item)
        const answer = [`商品名称：${product.title}`, product.description, product.specifications]
          .filter((text) => text.trim())
          .join('\n')
        add(`${product.title}有哪些已采集资料？`, answer, [product.id], {
          recordId: product.id,
          scope: page.scope,
          messageIds: [],
          capturedAt: page.capturedAt,
          ...(product.sourceUrl ? { sourceUrl: product.sourceUrl } : {}),
          ...(product.updatedAt !== undefined ? { sourceUpdatedAt: product.updatedAt } : {}),
        })
      }
    } else {
      for (const item of page.items) {
        const chat = platformLearningChatSchema.parse(item)
        for (let i = 1; i < chat.messages.length; i++) {
          const question = chat.messages[i - 1]!,
            answer = chat.messages[i]!
          if (
            question.from !== 'buyer' ||
            answer.from !== 'seller' ||
            question.type !== 'text' ||
            answer.type !== 'text' ||
            answer.at < question.at
          )
            continue
          const from = task.range.from ? Date.parse(`${task.range.from}T00:00:00+08:00`) : 0
          const to = task.range.to
            ? Date.parse(`${task.range.to}T00:00:00+08:00`) + 86400000
            : Infinity
          if (question.at < from || answer.at >= to) {
            skipped++
            continue
          }
          add(question.text, answer.text, [], {
            recordId: chat.id,
            scope: page.scope,
            uid: chat.uid,
            messageIds: [question.id, answer.id],
            capturedAt: page.capturedAt,
          })
        }
      }
    }
    return { rows: result, skipped }
  }
  async function pump(id: string, controller: AbortController) {
    const visited = new Set<string | null>()
    const current = () =>
      !closed &&
      !controller.signal.aborted &&
      running.get(id) === controller &&
      state.tasks.find((task) => task.id === id)?.status === 'running'
    try {
      while (current()) {
        check(workspaceId)
        const task = state.tasks.find((task) => task.id === id)!
        const identity = await identityFor(task.identity.storeId, task.identity)
        if (!current()) return
        if (visited.has(task.cursor)) throw Error('平台分页游标重复，已停止；请核对采集范围后重试')
        visited.add(task.cursor)
        const input = {
          identity,
          range: structuredClone(task.range),
          cursor: task.cursor,
          signal: controller.signal,
        }
        const raw =
          task.source === 'products'
            ? await port.collectProducts(input)
            : await port.collectChats(input)
        if (!current()) return
        check(workspaceId)
        const page = platformLearningPageSchema.parse(raw)
        if (!sameIdentity(page.identity, task.identity))
          throw Error('采集页面的账号或店铺身份不符，未保存本页')
        await identityFor(task.identity.storeId, task.identity)
        if (!current()) return
        if (!page.exhausted && page.nextCursor === task.cursor)
          throw Error('平台分页未推进，已停止以避免重复采集')
        const remaining = task.range.maxRecords - task.records
        const clipped = page.items.length > remaining
        const normalized = candidatesFor(task, { ...page, items: page.items.slice(0, remaining) })
        updateTask(id, (nextTask, next) => {
          nextTask.pages++
          nextTask.records += Math.min(page.items.length, remaining)
          nextTask.cursor = clipped ? task.cursor : page.nextCursor
          nextTask.scope = page.scope
          nextTask.total = page.total
          nextTask.skipped += normalized.skipped
          nextTask.sourceLimited = nextTask.sourceLimited === true || page.rangeComplete === false
          for (const row of normalized.rows) {
            if (next.candidates.some((candidate) => candidate.fingerprint === row.fingerprint)) {
              nextTask.duplicates++
              continue
            }
            if (next.candidates.length >= 10000)
              throw Error('候选容量已满，本页未保存，请先审核现有候选')
            next.candidates.push({
              ...row,
              id: randomUUID(),
              status: 'pending',
              error: '',
              audit: [{ at: now(), event: 'collected' }],
            })
            nextTask.candidates++
          }
          const limited =
            clipped ||
            nextTask.pages >= task.range.maxPages ||
            nextTask.records >= task.range.maxRecords
          if (page.exhausted || limited) {
            nextTask.status = 'completed'
            const covered =
              !nextTask.sourceLimited &&
              !clipped &&
              page.exhausted &&
              (page.total === undefined || nextTask.records >= page.total)
            nextTask.coverage = covered ? 'range-complete' : 'partial'
            nextTask.reason = covered
              ? '已读完平台声明的可访问范围；不代表平台全部资料'
              : nextTask.sourceLimited
                ? '平台可访问范围受限；具体限制见来源范围，未声明所选范围完整'
                : limited
                  ? '已达到本次采集上限；仅保存部分范围，可调整范围新建任务'
                  : '已读页面未覆盖平台声明总数；仅保存部分范围'
          }
        })
        // Yield between pages so pause/cancel can stop a fast local provider too.
        if (current()) await new Promise<void>((resolve) => setTimeout(resolve, 0))
      }
    } catch (cause) {
      if (current()) {
        try {
          updateTask(id, (task) => {
            task.status = 'failed'
            task.error = message(cause)
            task.reason = '保留已保存页和游标；检查平台后可重试'
          })
        } catch (storageCause) {
          // Disk failure must stop visible execution too. Durable cursor remains at the previous page.
          const stopped = structuredClone(state)
          const task = stopped.tasks.find((task) => task.id === id)!
          task.status = 'failed'
          task.error = message(storageCause)
          task.reason = '存储未成功，采集已停止；修复后从上次成功游标重试'
          state = stopped
          controller.abort()
          notify()
        }
      }
    } finally {
      if (running.get(id) === controller) running.delete(id)
    }
  }
  function launch(id: string) {
    const controller = new AbortController()
    running.set(id, controller)
    void pump(id, controller)
  }
  async function start(input: unknown) {
    const request = platformLearningStartSchema.parse(input)
    check(request.workspaceId)
    if (starting) throw Error('正在核对平台身份，请稍候')
    if (
      state.tasks.some(
        (task) => task.identity.storeId === request.storeId && task.status === 'running',
      )
    )
      throw Error('本店已有正在运行的学习任务，请先暂停或取消')
    if (state.tasks.length >= 100) throw Error('平台学习任务记录已满，请先备份整理历史记录')
    starting = true
    try {
      const identity = await identityFor(request.storeId)
      const task: PlatformLearningTask = {
        id: randomUUID(),
        identity,
        source: request.source,
        range: request.range,
        status: 'running',
        cursor: null,
        pages: 0,
        records: 0,
        candidates: 0,
        duplicates: 0,
        skipped: 0,
        coverage: 'partial',
        scope: '',
        reason: '正在读取所选平台范围',
        error: '',
        createdAt: now(),
        updatedAt: now(),
      }
      commit({ ...state, tasks: [...state.tasks, task] })
      launch(task.id)
      return snapshot({ workspaceId })
    } finally {
      starting = false
    }
  }
  function taskRequest(input: unknown) {
    const request = platformLearningTaskRequestSchema.parse(input)
    check(request.workspaceId)
    const task = state.tasks.find((task) => task.id === request.taskId)
    if (!task) throw Error('平台学习任务不存在，请刷新')
    return task
  }
  function pause(input: unknown) {
    const task = taskRequest(input)
    if (task.status !== 'running') throw Error('任务已停止，无需暂停')
    updateTask(task.id, (task) => {
      task.status = 'paused'
      task.reason = '已暂停，保留上次成功页和游标'
    })
    running.get(task.id)?.abort()
    running.delete(task.id)
    return snapshot({ workspaceId })
  }
  async function resume(input: unknown) {
    const task = taskRequest(input)
    if (task.status !== 'paused' && task.status !== 'failed')
      throw Error('仅暂停或失败任务可以继续')
    await identityFor(task.identity.storeId, task.identity)
    const latest = taskRequest(input)
    if (latest.status !== 'paused' && latest.status !== 'failed')
      throw Error('任务状态已变化，请刷新')
    if (
      state.tasks.some(
        (other) =>
          other.id !== task.id &&
          other.identity.storeId === task.identity.storeId &&
          other.status === 'running',
      )
    )
      throw Error('本店已有正在运行的学习任务')
    updateTask(task.id, (task) => {
      task.status = 'running'
      task.error = ''
      task.reason = '从已保存游标继续读取'
    })
    launch(task.id)
    return snapshot({ workspaceId })
  }
  function cancel(input: unknown) {
    const task = taskRequest(input)
    if (task.status === 'completed' || task.status === 'cancelled') throw Error('任务已结束')
    updateTask(task.id, (task) => {
      task.status = 'cancelled'
      task.reason = '用户已取消；已采集候选保留供审核'
    })
    running.get(task.id)?.abort()
    running.delete(task.id)
    return snapshot({ workspaceId })
  }
  function packFor(candidate: PlatformLearningCandidate, reviewed: zQa): PackDraft {
    const task = state.tasks.find((task) => task.id === candidate.taskId)!
    const audit = JSON.stringify({
      schema: 'lingtu-platform-learning-v1',
      candidateId: candidate.id,
      fingerprint: candidate.fingerprint,
      taskId: candidate.taskId,
      identity: candidate.identity,
      source: candidate.source,
      evidence: candidate.evidence,
      original: candidate.original,
      reviewed,
      productIds: candidate.productIds,
      range: task.range,
      scope: candidate.evidence.scope,
    })
    if (audit.length > 4000)
      throw Error('原文与审核内容超过来源审计容量，请缩短答案或拆分候选；未截断原文')
    return {
      name: `待审核 · ${reviewed.question}`.slice(0, 100),
      enabled: false,
      storeIds: [candidate.identity.storeId],
      productIds: [...candidate.productIds],
      entries: [
        { ...reviewed, keywords: [], enabled: true },
        { question: auditQuestion, answer: audit, keywords: [], enabled: false },
      ],
    }
  }
  type zQa = { question: string; answer: string }
  async function review(input: unknown) {
    const request = platformLearningReviewSchema.parse(input)
    check(request.workspaceId)
    if (!request.confirmed) throw Error('请先预览来源并明确确认保存为停用知识包')
    const candidate = state.candidates.find((candidate) => candidate.id === request.candidateId)
    if (!candidate || candidate.status === 'rejected') throw Error('候选不存在或已排除')
    if (candidate.status === 'saved') throw Error('此候选已入库，请到意图知识页核对')
    if (candidate.audit.length > 97) throw Error('候选审核记录已满，请先核对现有知识包')
    if (reviewing.has(candidate.id)) throw Error('候选正在入库，请稍候')
    const reviewed = platformLearningQaSchema.parse({
      question: request.question,
      answer: request.answer,
    })
    const pack = packFor(candidate, reviewed)
    reviewing.add(candidate.id)
    const mark = (change: (row: PlatformLearningCandidate) => void) => {
      const next = structuredClone(state)
      change(next.candidates.find((row) => row.id === candidate.id)!)
      commit(next)
    }
    try {
      await identityFor(candidate.identity.storeId, candidate.identity)
      const packs = await port.listPacks()
      await identityFor(candidate.identity.storeId, candidate.identity)
      const previous = packs.find(
        (pack) =>
          pack.storeIds.length === 1 &&
          pack.storeIds[0] === candidate.identity.storeId &&
          pack.entries.some((entry) => {
            if (entry.question !== auditQuestion || entry.enabled) return false
            try {
              const audit: unknown = JSON.parse(entry.answer)
              if (typeof audit !== 'object' || audit === null) return false
              const value = audit as Record<string, unknown>
              return (
                value.schema === 'lingtu-platform-learning-v1' &&
                value.fingerprint === candidate.fingerprint &&
                sameIdentity(
                  platformLearningIdentitySchema.parse(value.identity),
                  candidate.identity,
                )
              )
            } catch {
              return false
            }
          }),
      )
      if (previous) {
        mark((row) => {
          row.status = 'saved'
          row.packId = previous.id
          row.error = ''
          append(row, {
            at: now(),
            event: 'recovered',
            packId: previous.id,
            reason: '核对来源审计，已存在知识包；未重复保存',
          })
        })
        return snapshot({ workspaceId })
      }
      mark((row) => {
        row.status = 'saving'
        row.reviewed = reviewed
        row.error = ''
        append(row, { at: now(), event: 'saving', reviewed })
      })
      await identityFor(candidate.identity.storeId, candidate.identity)
      const saved = await port.savePack(pack)
      await identityFor(candidate.identity.storeId, candidate.identity)
      mark((row) => {
        row.status = 'saved'
        row.packId = saved.id
        append(row, { at: now(), event: 'saved', packId: saved.id, reviewed })
      })
      return snapshot({ workspaceId })
    } catch (cause) {
      if (!closed)
        mark((row) => {
          row.status = 'pending'
          row.error = message(cause)
          append(row, { at: now(), event: 'failed', reason: row.error })
        })
      throw cause
    } finally {
      reviewing.delete(candidate.id)
    }
  }
  function dispose() {
    if (closed) return
    closed = true
    for (const controller of running.values()) controller.abort()
    running.clear()
    const next = structuredClone(state)
    for (const task of next.tasks)
      if (task.status === 'running') {
        task.status = 'paused'
        task.reason = '应用已关闭，采集已取消；保留进度供下次手动继续'
        task.updatedAt = now()
      }
    if (next.tasks.some((task, index) => task.status !== state.tasks[index]!.status)) commit(next)
    listeners.clear()
  }
  return {
    snapshot,
    start,
    pause,
    resume,
    cancel,
    review,
    dispose,
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}

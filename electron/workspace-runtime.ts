import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import {
  commandSchema,
  emptySnapshot,
  type BackendEvent,
  type BackendSnapshot,
} from '../src/shared/contracts/backend'
import type { LocalRuntime } from './local-runtime'
import { emptyManagedSession } from '../src/shared/contracts/managed'
import { restoreKnowledgeBackup } from './knowledge/backup'

const activationSchema = z.object({ mode: z.enum(['local', 'managed']) }).strict()

/** Owns one workspace at a time. The renderer can select only a mode, never a path or origin. */
export function createWorkspaceRuntime(options: {
  factory(): LocalRuntime
  /** Native owner only; invoked after confirmed clear cannot rebuild or roll back its services. */
  restartAfterKnowledgeClearFailure?(): void
}): LocalRuntime & {
  clearKnowledge(
    workspaceId: string,
    token: string,
    confirmation: string,
  ): Promise<{ workspaceId: string; recovered: boolean; message: string }>
  restoreKnowledge(
    workspaceId: string,
    token: string,
  ): Promise<{ workspaceId: string; recovered: boolean; message: string }>
} {
  let current = options.factory()
  let off = () => {}
  let tail: Promise<unknown> = Promise.resolve()
  let unavailable: BackendSnapshot | undefined
  let pendingDisposal: LocalRuntime | undefined
  let closed = false
  let assistActive = false
  const closedSnapshot = emptySnapshot()
  closedSnapshot.workspaceId = randomUUID()
  const listeners = new Set<(event: BackendEvent) => void>()
  const emit = (event: BackendEvent) => {
    if (closed) return
    for (const listener of listeners) {
      try {
        listener(event)
      } catch {
        /* A view subscriber cannot interrupt workspace teardown. */
      }
    }
  }
  const bind = () => {
    off = current.subscribe((event) => {
      if (!unavailable && !closed) emit(event)
    })
  }
  bind()
  const snapshot = () => (closed ? closedSnapshot : (unavailable ?? current.snapshot()))
  const assertWorkspace = (id: string) => {
    if (closed) throw new Error('本地服务已关闭')
    if (id !== snapshot().workspaceId) throw new Error('本地服务已重启，请刷新后重试')
  }
  const requireAvailable = () => {
    if (closed || unavailable) throw new Error('工作区暂时不可用，请重试登录切换或重启软件')
  }
  function enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = tail.then(operation)
    tail = result.catch(() => {})
    return result
  }
  async function disposePending() {
    if (!pendingDisposal) return
    await pendingDisposal.dispose()
    pendingDisposal = undefined
  }
  function replaceKnowledge(workspaceId: string, token: string, confirmation?: string) {
    return enqueue(async () => {
      assertWorkspace(workspaceId)
      requireAvailable()
      const plan =
        confirmation === undefined
          ? current.knowledge().prepareRestore(token)
          : current.knowledge().prepareClear(token, confirmation)
      const configured = JSON.stringify(current.snapshot().managed.configured)
      unavailable = emptySnapshot()
      unavailable.workspaceId = randomUUID()
      current.setAssistPlatformActive(false)
      off()
      pendingDisposal = current
      emit({ type: 'workspace:changed' })
      let recovered = false,
        failure: unknown
      const rebuild = async () => {
        if (closed) throw Error('应用已退出，恢复文件已保存；下次启动核对')
        const next = options.factory()
        pendingDisposal = next
        // Managed account access is restored asynchronously by start(). Check the configured
        // source first, then verify the authenticated directory after initialization.
        if (JSON.stringify(next.snapshot().managed.configured) !== configured)
          throw Error('恢复时账号配置已改变，请重新登录核对')
        await next.start()
        if (
          next.dataDirectory() !== plan.directory ||
          JSON.stringify(next.snapshot().managed.configured) !== configured
        )
          throw Error('恢复时账号配置已改变，请重新登录核对')
        current = next
        pendingDisposal = undefined
        unavailable = undefined
        bind()
        if (!closed) current.setAssistPlatformActive(assistActive)
      }
      try {
        await disposePending()
        restoreKnowledgeBackup({
          directory: plan.directory,
          backupDirectory: plan.backupDirectory,
        })
        await rebuild()
      } catch (cause) {
        failure = cause
        try {
          await disposePending()
          restoreKnowledgeBackup({
            directory: plan.directory,
            backupDirectory: plan.recoveryDirectory,
          })
          await rebuild()
          recovered = true
        } catch (recoveryCause) {
          try {
            await disposePending()
          } catch {
            /* retain unavailable state and recovery point */
          }
          emit({ type: 'workspace:changed' })
          if (confirmation !== undefined && !closed && options.restartAfterKnowledgeClearFailure) {
            try {
              // Do not await shutdown here: it drains this same command queue.
              options.restartAfterKnowledgeClearFailure()
            } catch (restartCause) {
              throw new AggregateError(
                [cause, recoveryCause, restartCause],
                '清除后的服务恢复未完成；自动重启未能启动，已保留恢复点，请手动重启核对',
              )
            }
            throw new AggregateError(
              [cause, recoveryCause],
              '清除后的服务恢复未完成；已保留恢复点，正在自动重启软件，请在启动后核对',
            )
          }
          throw new AggregateError([cause, recoveryCause], '恢复未完成；已保留恢复点，请重启后核对')
        }
      }
      emit({ type: 'workspace:changed' })
      return {
        workspaceId: snapshot().workspaceId,
        recovered,
        message: recovered
          ? `${confirmation === undefined ? '恢复' : '清除'}失败，已恢复操作前资料：${failure instanceof Error ? failure.message : '请核对备份'}`
          : confirmation === undefined
            ? '知识库已恢复；服务已重新装配，AI保持启动默认状态。'
            : `知识库已清除；自动备份：${plan.recoveryDirectory}。服务已重新装配，AI保持关闭。`,
      }
    })
  }
  return {
    restoreKnowledge: (workspaceId, token) => replaceKnowledge(workspaceId, token),
    clearKnowledge: (workspaceId, token, confirmation) =>
      replaceKnowledge(workspaceId, token, confirmation),
    start: () =>
      enqueue(async () => {
        requireAvailable()
        await current.start()
      }),
    snapshot: () => structuredClone(snapshot()),
    dataDirectory() {
      requireAvailable()
      return current.dataDirectory()
    },
    knowledge() {
      requireAvailable()
      return current.knowledge()
    },
    storeSync() {
      requireAvailable()
      return current.storeSync()
    },
    scheduler() {
      requireAvailable()
      return current.scheduler()
    },
    platformLearning() {
      requireAvailable()
      return current.platformLearning()
    },
    async openPlatformLearningSource(input) {
      requireAvailable()
      const id = snapshot().workspaceId
      await current.openPlatformLearningSource(input)
      assertWorkspace(id)
    },
    platformOrders() {
      requireAvailable()
      return current.platformOrders()
    },
    receptionOperations() {
      requireAvailable()
      return current.receptionOperations()
    },
    async serviceRequest(endpoint, input) {
      requireAvailable()
      const id = snapshot().workspaceId
      const result = await current.serviceRequest(endpoint, input)
      assertWorkspace(id)
      return result
    },
    execute(input) {
      // Validate before queueing and again when running: earlier queued activation may replace us.
      let command: ReturnType<typeof commandSchema.parse>
      try {
        command = commandSchema.parse(input)
        assertWorkspace(command.workspaceId)
      } catch (error) {
        return Promise.reject(error)
      }
      return enqueue(async () => {
        assertWorkspace(command.workspaceId)
        if (command.action !== 'activate-model-source') {
          requireAvailable()
          return current.execute(command)
        }
        const { mode } = activationSchema.parse(command.values)
        const before = snapshot()
        if (unavailable && mode !== before.managed.configured.mode)
          throw new Error('工作区暂时不可用，请先重试当前登录切换或重启软件')
        if (!unavailable) {
          const source = { ...before.managed.configured, mode }
          const active = before.managed.active
          if (
            !before.managed.restartRequired &&
            active.mode === mode &&
            active.apiOrigin === source.apiOrigin &&
            active.portalOrigin === source.portalOrigin
          )
            return { status: 'ok', message: '当前登录已生效；AI 保持原状态。', data: {} }
          await current.execute({ ...command, action: 'save-model-source', values: source })
          // Invalidate even on failure; no old credentials or business records remain visible.
          unavailable = emptySnapshot()
          unavailable.workspaceId = randomUUID()
          unavailable.managed = {
            ...current.snapshot().managed,
            session: { ...emptyManagedSession(), message: '工作区暂时不可用，请重试登录切换。' },
            restartRequired: true,
          }
          current.setAssistPlatformActive(false)
          off()
          pendingDisposal = current
        }
        try {
          await disposePending()
          const next = options.factory()
          pendingDisposal = next
          await next.start()
          current = next
          pendingDisposal = undefined
          unavailable = undefined
          bind()
          if (!closed) current.setAssistPlatformActive(assistActive)
          emit({ type: 'workspace:changed' })
          return { status: 'ok', message: '登录已生效；AI 保持关闭。', data: {} }
        } catch (error) {
          // A partially started host must be closed before retry creates another host.
          try {
            await disposePending()
          } catch {
            /* Keep it for another disposal attempt. */
          }
          emit({ type: 'workspace:changed' })
          throw error
        }
      })
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    setStoreZoom(input) {
      requireAvailable()
      return current.setStoreZoom(input)
    },
    presentStore(storeId, visible) {
      requireAvailable()
      current.presentStore(storeId, visible)
    },
    simulatorStatus() {
      requireAvailable()
      return current.simulatorStatus()
    },
    assistPlatformSnapshot() {
      requireAvailable()
      return current.assistPlatformSnapshot()
    },
    setAssistPlatformActive(active) {
      assistActive = active
      if (closed || unavailable) return
      current.setAssistPlatformActive(active)
    },
    refreshAssistPlatform(input) {
      assertWorkspace(input.workspaceId)
      requireAvailable()
      const instance = current
      return instance.refreshAssistPlatform(input).then((result) => {
        assertWorkspace(input.workspaceId)
        return result
      })
    },
    openAssistPlatformItem(input) {
      assertWorkspace(input.workspaceId)
      requireAvailable()
      return current.openAssistPlatformItem(input)
    },
    openSimulatorPage() {
      const id = snapshot().workspaceId
      return enqueue(async () => {
        assertWorkspace(id)
        requireAvailable()
        return current.openSimulatorPage()
      })
    },
    dispose() {
      // Stop accepting commands immediately, then drain in-flight work before stopping the host.
      closed = true
      assistActive = false
      current.setAssistPlatformActive(false)
      unavailable = emptySnapshot()
      unavailable.workspaceId = randomUUID()
      return enqueue(async () => {
        off()
        listeners.clear()
        await disposePending()
        await current.dispose()
      })
    },
  }
}

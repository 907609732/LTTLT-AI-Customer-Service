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

const activationSchema = z.object({ mode: z.enum(['local', 'managed']) }).strict()

/** Owns one workspace at a time. The renderer can select only a mode, never a path or origin. */
export function createWorkspaceRuntime(options: { factory(): LocalRuntime }): LocalRuntime {
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
  return {
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
    storeSync() {
      requireAvailable()
      return current.storeSync()
    },
    scheduler() {
      requireAvailable()
      return current.scheduler()
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

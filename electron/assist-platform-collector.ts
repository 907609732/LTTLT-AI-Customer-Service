import type {
  PlatformItem,
  PlatformItemKind,
  PlatformItemsSnapshot,
  PlatformItemsStore,
} from '../src/shared/contracts/platform-items'
import { platformItemSchema } from '../src/shared/contracts/platform-items'
export interface AssistStore {
  id: string
  storeName: string
  platform: string
  identityId?: string
}
export interface AssistPageResult {
  authenticated: boolean | null
  identityId: string
  identityName: string
  recognized: boolean
  items: PlatformItem[]
  total: number | null
  complete: boolean
  message?: string
  blocked?: 'verification' | 'login'
}

/** 只有识别登录、店铺身份及列表结构后才允许返回“0”；错误保留上次同步数据。 */
export function createAssistPlatformCollector(options: {
  workspaceId: string
  stores(): AssistStore[]
  read(store: AssistStore, kind: PlatformItemKind, signal: AbortSignal): Promise<AssistPageResult>
  changed?(): void
  timeoutMs?: number
  now?: () => number
}) {
  const cache = new Map<string, PlatformItemsStore>()
  const pausedStores = new Set<string>()
  const inflight = new Set<AbortController>()
  const now = options.now ?? Date.now
  let generation = 0,
    active = false,
    closed = false
  let timer: ReturnType<typeof setTimeout> | undefined
  let tail: Promise<unknown> = Promise.resolve()
  const key = (id: string, kind: PlatformItemKind) => `${id}:${kind}`
  const snapshot = (): PlatformItemsSnapshot => ({
    workspaceId: options.workspaceId,
    stores: options.stores().flatMap((store) =>
      (['ticket', 'aftersale'] as const).map((kind) => {
        const old = cache.get(key(store.id, kind))
        return (
          old ?? {
            storeId: store.id,
            storeName: store.storeName,
            platform: store.platform,
            kind,
            status: 'unavailable',
            message:
              store.platform === 'pdd-web'
                ? '尚未同步，请打开平台后台并核对登录店铺'
                : '此平台尚未接入',
            total: null,
            complete: false,
            items: [],
          }
        )
      }),
    ),
  })
  async function collect(storeId?: string, onlyKind?: PlatformItemKind) {
    const ticket = generation
    for (const store of options.stores().filter((s) => !storeId || s.id === storeId)) {
      if (store.platform !== 'pdd-web') continue
      if (pausedStores.has(store.id)) continue
      for (const kind of ['ticket', 'aftersale'] as const) {
        if (onlyKind && kind !== onlyKind) continue
        if (closed || ticket !== generation) return snapshot()
        const id = key(store.id, kind)
        const old = snapshot().stores.find((s) => s.storeId === store.id && s.kind === kind)!
        cache.set(id, { ...old, status: 'syncing', message: '正在读取平台后台' })
        options.changed?.()
        let deadline: ReturnType<typeof setTimeout> | undefined
        const controller = new AbortController()
        inflight.add(controller)
        try {
          const result = await Promise.race([
            options.read(store, kind, controller.signal),
            new Promise<never>((_, reject) => {
              deadline = setTimeout(() => {
                controller.abort()
                reject(new Error('平台读取超时，请重试'))
              }, options.timeoutMs ?? 15000)
            }),
          ])
          if (closed || ticket !== generation || !options.stores().some((s) => s.id === store.id))
            continue
          if (result.authenticated === false || result.blocked) {
            pausedStores.add(store.id)
            cache.set(id, {
              ...old,
              status: 'login_required',
              message:
                result.blocked === 'verification'
                  ? '平台需要人工验证；已暂停自动采集，请在后台完成验证后手动刷新'
                  : '平台登录已失效；已暂停自动采集，请重新登录后手动刷新',
              complete: false,
            })
            break
          } else {
            if (result.authenticated !== true || !result.recognized)
              throw new Error(result.message || '尚未识别平台列表，数量未知')
            if (
              store.identityId
                ? result.identityId !== store.identityId
                : !store.storeName || result.identityName !== store.storeName
            )
              throw new Error('后台店铺身份与当前店铺不一致，未读取数据')
            if (result.total !== null && (!Number.isSafeInteger(result.total) || result.total < 0))
              throw new Error('平台列表总数无效，数量未知')
            const items = [
              ...new Map(
                platformItemSchema
                  .array()
                  .max(5000)
                  .parse(result.items)
                  .map((item) => {
                    if (
                      item.storeId !== store.id ||
                      item.platform !== store.platform ||
                      item.kind !== kind
                    )
                      throw new Error('平台记录归属不一致')
                    return [item.id, item] as const
                  }),
              ).values(),
            ]
            if (result.total !== null && result.total < items.length)
              throw new Error('平台总数与实际记录矛盾，未采用本次结果')
            const complete = result.complete && result.total === items.length
            cache.set(id, {
              ...old,
              items,
              total: result.total,
              complete,
              lastSyncedAt: now(),
              status: 'success',
              message: result.message || (complete ? '同步完成' : '已读取部分记录，列表尚未完整'),
            })
          }
        } catch (cause) {
          if (!closed && ticket === generation)
            cache.set(id, {
              ...old,
              status: old.lastSyncedAt === undefined ? 'error' : 'stale',
              complete: false,
              message: cause instanceof Error ? cause.message : '平台读取失败',
            })
        } finally {
          inflight.delete(controller)
          clearTimeout(deadline)
          if (!closed && ticket === generation) options.changed?.()
        }
      }
    }
    return snapshot()
  }
  function enqueueRefresh(storeId?: string, kind?: PlatformItemKind, manual = false) {
    if (closed) return Promise.reject(new Error('平台采集已关闭'))
    const queuedGeneration = generation
    const result = tail.then(() => {
      if (queuedGeneration !== generation || closed) return snapshot()
      if (manual) {
        if (storeId) pausedStores.delete(storeId)
        else pausedStores.clear()
      }
      return collect(storeId, kind)
    })
    tail = result.catch(() => {})
    return result
  }
  const schedule = () => {
    clearTimeout(timer)
    if (!active || closed) return
    timer = setTimeout(() => {
      void enqueueRefresh().finally(schedule)
    }, 60000)
    timer.unref?.()
  }
  return {
    snapshot,
    invalidateStore(storeId: string, message: string) {
      pausedStores.add(storeId)
      for (const [id, state] of cache)
        if (state.storeId === storeId)
          cache.set(id, {
            ...state,
            status: state.lastSyncedAt === undefined ? 'error' : 'stale',
            complete: false,
            message,
          })
      options.changed?.()
    },
    refresh: (storeId?: string, kind?: PlatformItemKind) => enqueueRefresh(storeId, kind, true),
    setActive(value: boolean) {
      if (active === value || closed) return
      active = value
      if (!value) {
        generation++
        for (const request of inflight) request.abort()
        clearTimeout(timer)
        for (const [id, state] of cache) {
          if (state.status === 'syncing')
            cache.set(id, {
              ...state,
              status: state.lastSyncedAt === undefined ? 'unavailable' : 'stale',
              complete: false,
              message: '辅助窗口已关闭，同步已停止',
            })
        }
        options.changed?.()
      } else {
        void enqueueRefresh().finally(schedule)
      }
    },
    dispose() {
      closed = true
      active = false
      generation++
      for (const request of inflight) request.abort()
      inflight.clear()
      clearTimeout(timer)
      cache.clear()
      pausedStores.clear()
    },
  }
}

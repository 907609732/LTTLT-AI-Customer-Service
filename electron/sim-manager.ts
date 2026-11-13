import { SIM_PLATFORM_ID } from '../src/shared/contracts/simulation'
import type { SimHub } from './sim-hub'

/**
 * 店铺窗口管理器包装。
 *
 * 真实平台店铺需要真的打开一个 WebContents（拼多多页面 / 抖店客户端）并完成登录；
 * 本机模拟店铺没有任何外部页面，所以这里对 `sim-local` 店铺直接把“打开/关闭”落到 SimHub 上，
 * 其余平台原样交给厂商管理器。这样上游打开店铺、启动采集、发送回复的流程完全一致，
 * 而不会为了模拟数据去伪造平台窗口或登录态。
 */

interface VendorManager {
  stateOf?(storeId: string): Record<string, unknown> | undefined
  open?(storeId: string): Promise<unknown> | unknown
  close?(storeId: string): void
  closeAll?(): void
  restartClient?(storeId: string): Promise<unknown> | unknown
}

interface RegistryLike {
  get(storeId: string): { id: string; storeName?: string; platform?: string } | null
}

export interface SimManagerState {
  open: boolean
  online: boolean
  awaitingClient: boolean
  lastError: string
}

export class SimStoreManager {
  readonly #delegate: VendorManager
  readonly #hub: SimHub
  readonly #registry: RegistryLike

  constructor(delegate: VendorManager, hub: SimHub, registry: RegistryLike) {
    this.#delegate = delegate
    this.#hub = hub
    this.#registry = registry
  }

  #isSim(storeId: string): boolean {
    return this.#registry.get(storeId)?.platform === SIM_PLATFORM_ID
  }

  /**
   * 模拟店铺的 runtime 只说本机模拟通道是否打开，不冒充平台在线或已登录；
   * 因此不返回 authenticated 字段，界面据此显示“本机模拟”而不是“已登录”。
   */
  stateOf(storeId: string): Record<string, unknown> {
    if (!this.#isSim(storeId))
      return this.#delegate.stateOf?.(storeId) ?? { open: false, online: false }
    const open = this.#hub.isOpen(storeId)
    const state: SimManagerState & Record<string, unknown> = {
      open,
      online: open,
      awaitingClient: false,
      lastError: '',
    }
    return state
  }

  async open(storeId: string): Promise<unknown> {
    if (!this.#isSim(storeId)) {
      if (typeof this.#delegate.open !== 'function') throw new Error('平台窗口尚未就绪')
      return this.#delegate.open(storeId)
    }
    const store = this.#registry.get(storeId)
    if (!store) throw new Error('店铺不存在')
    this.#hub.attach(storeId, String(store.storeName || storeId))
    return undefined
  }

  close(storeId: string): void {
    if (this.#isSim(storeId)) {
      this.#hub.detach(storeId)
      return
    }
    this.#delegate.close?.(storeId)
  }

  closeAll(): void {
    for (const store of this.#hub.stores()) this.#hub.detach(store.storeId)
    this.#delegate.closeAll?.()
  }

  restartClient(storeId: string): Promise<unknown> | unknown {
    if (this.#isSim(storeId)) throw new Error('本机模拟店铺没有可重启的客户端')
    if (typeof this.#delegate.restartClient !== 'function')
      throw new Error('该平台不支持重启客户端')
    return this.#delegate.restartClient(storeId)
  }
}

/** 与厂商 managerFactory 同签名，便于直接注入 createBackend。 */
export function createSimManagerFactory(
  factory: (deps: Record<string, unknown>) => VendorManager,
  hub: SimHub,
): (deps: Record<string, unknown>) => SimStoreManager {
  return (deps) =>
    new SimStoreManager(
      factory(deps),
      hub,
      (deps.registry as RegistryLike | undefined) ?? { get: () => null },
    )
}

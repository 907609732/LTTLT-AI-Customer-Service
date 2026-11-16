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
  get(storeId: string): {
    id: string
    storeName?: string
    platform?: string
    mallId?: string
  } | null
  update?(storeId: string, patch: Record<string, unknown>): unknown
}

export interface SimManagerState {
  open: boolean
  online: boolean
  awaitingClient: boolean
  lastError: string
}

export interface SimManagerOptions {
  /**
   * 厂商管理器只给拼多多返回 authenticated；闲鱼等平台由适配器自己检查登录态。
   * 返回 null 表示尚未检查，不能当成未登录。
   */
  authenticatedFor?: (storeId: string) => boolean | null
  /**
   * 闲鱼等厂商管理器不跑身份识别的平台，在打开后由适配器读页面 cookie 回填店名。
   * 只在占位名、空名或登录账号变化时更新，商家自定义名称不覆盖。
   */
  identityFor?: (storeId: string) => Promise<{
    authenticated?: boolean | null
    storeName?: string
    mallId?: string
  } | null>
}

export class SimStoreManager {
  readonly #delegate: VendorManager
  readonly #hub: SimHub
  readonly #registry: RegistryLike
  readonly #authenticatedFor: ((storeId: string) => boolean | null) | undefined
  readonly #identityFor: SimManagerOptions['identityFor']

  constructor(
    delegate: VendorManager,
    hub: SimHub,
    registry: RegistryLike,
    options: SimManagerOptions = {},
  ) {
    this.#delegate = delegate
    this.#hub = hub
    this.#registry = registry
    this.#authenticatedFor = options.authenticatedFor
    this.#identityFor = options.identityFor
  }

  #isSim(storeId: string): boolean {
    return this.#registry.get(storeId)?.platform === SIM_PLATFORM_ID
  }

  /** 身份回填是打开店铺的附属动作；失败不阻断窗口，下一次打开会重试。 */
  async #syncIdentity(storeId: string): Promise<void> {
    if (!this.#identityFor) return
    try {
      const identity = await this.#identityFor(storeId)
      const store = this.#registry.get(storeId)
      if (!identity || !store) return
      const storeName = identity.storeName?.trim() ?? ''
      const mallId = identity.mallId?.trim() ?? ''
      const accountChanged = Boolean(store.mallId && mallId && store.mallId !== mallId)
      const patch: Record<string, unknown> = {}
      if (mallId && mallId !== store.mallId) patch.mallId = mallId
      if (storeName && (accountChanged || !store.storeName || store.storeName === '闲鱼店铺'))
        patch.storeName = storeName
      // 换登录账号后先停 AI，避免继续用旧店铺上下文回复。
      if (accountChanged) patch.aiEnabled = false
      if (Object.keys(patch).length) this.#registry.update?.(storeId, patch)
    } catch {
      // 页面尚未登录、cookie 暂不可读或注册表拒绝写入：保持原店名，等待下次打开。
    }
  }

  /**
   * 模拟店铺的 runtime 只说本机模拟通道是否打开，不冒充平台在线或已登录；
   * 因此不返回 authenticated 字段，界面据此显示“本机模拟”而不是“已登录”。
   */
  stateOf(storeId: string): Record<string, unknown> {
    if (!this.#isSim(storeId)) {
      const state = this.#delegate.stateOf?.(storeId) ?? { open: false, online: false }
      const authenticated = this.#authenticatedFor?.(storeId)
      // 拼多多已有自己的认证结果时保持原样；只补厂商管理器未提供的平台。
      if (typeof authenticated !== 'boolean' || state.authenticated !== undefined) return state
      return { ...state, authenticated }
    }
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
      const result = await this.#delegate.open(storeId)
      await this.#syncIdentity(storeId)
      return result
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
  options: SimManagerOptions = {},
): (deps: Record<string, unknown>) => SimStoreManager {
  return (deps) =>
    new SimStoreManager(
      factory(deps),
      hub,
      (deps.registry as RegistryLike | undefined) ?? { get: () => null },
      options,
    )
}

import { StoreAiPreferences, type StoreAiIdentity } from './store-ai-preferences'
export interface AiRestoreStore {
  id: string
  platform: string
  mallId?: string
  customerServiceId?: string
  aiEnabled: boolean
  runtime: {
    open: boolean
    online: boolean
    authenticated?: boolean | null
    identityError?: string
  }
}
export interface AiRestoreState {
  desiredEnabled: boolean
  status: 'waiting' | 'restoring' | 'restored' | 'failed'
  message: string
}
interface Command {
  action: string
  storeId?: string
  conversationId?: string
  values?: Record<string, unknown>
}
interface Session {
  generation: number
  loggedIn: boolean
  attempted: boolean
  starting: boolean
}
/** 恢复仅通过既有 set-ai 门；会话代数在异步打开/启动期间失效，旧批准不参与恢复。 */
export class AiStateRestore {
  private sessions = new Map<string, Session>()
  private states = new Map<string, AiRestoreState>()
  private autoStopping = new Set<string>()
  private autoStoppedConversations = new Map<string, Set<string>>()
  private closed = false
  private started = false
  private suppressed = false
  private denied = new Set<string>()
  private activated = false
  private accessible = false
  constructor(
    private ports: {
      preferences: StoreAiPreferences
      stores: () => AiRestoreStore[]
      verifyIdentity: (id: string) => Promise<StoreAiIdentity | undefined>
      allowed: () => boolean
      modelBlocked: () => boolean
      execute: (command: Command) => Promise<unknown>
      changed: () => void
    },
  ) {}
  state(id: string) {
    const state = this.states.get(id)
    if (
      state?.status === 'restored' &&
      !this.ports.stores().find((store) => store.id === id)?.aiEnabled
    )
      return { ...state, status: 'failed' as const, message: 'AI 已暂停，请手动核对后开启' }
    return state
  }
  private session(id: string) {
    let value = this.sessions.get(id)
    if (!value) {
      value = { generation: 0, loggedIn: false, attempted: false, starting: false }
      this.sessions.set(id, value)
    }
    return value
  }
  private identity(store: AiRestoreStore): StoreAiIdentity | undefined {
    return store.mallId?.trim() && store.customerServiceId?.trim()
      ? {
          platform: store.platform,
          mallId: store.mallId,
          customerServiceId: store.customerServiceId,
        }
      : undefined
  }
  private publish(id: string, status: AiRestoreState['status'], message: string) {
    this.states.set(id, {
      desiredEnabled: !this.denied.has(id) && Boolean(this.ports.preferences.read(id)),
      status,
      message,
    })
    this.ports.changed()
  }
  private cancel(id: string, clear = false) {
    const session = this.session(id)
    session.generation++
    session.loggedIn = false
    session.attempted = false
    if (session.starting) {
      session.starting = false
      void this.ports
        .execute({ action: 'set-ai', storeId: id, values: { enabled: false } })
        .catch(() => {})
    }
    if (clear) {
      this.denied.add(id)
      this.states.delete(id)
      this.ports.changed()
      this.ports.preferences.disable(id)
    } else if (this.ports.preferences.read(id)) this.publish(id, 'waiting', '等待登录后恢复 AI')
  }
  accessChanged() {
    const allowed = this.ports.allowed(),
      previous = this.accessible
    this.accessible = allowed
    if (!allowed) {
      this.started = false
      for (const store of this.ports.stores()) this.cancel(store.id)
    } else if (!previous && this.activated) void this.start()
  }
  suspend() {
    for (const store of this.ports.stores()) {
      this.cancel(store.id)
      const session = this.session(store.id)
      session.loggedIn = true
      session.attempted = true
      if (this.ports.preferences.read(store.id))
        this.publish(store.id, 'failed', 'AI 已暂停，请手动核对后开启')
    }
  }
  dispose() {
    this.closed = true
    for (const id of this.sessions.keys()) this.cancel(id)
  }
  async start(options: { restoreAi?: boolean } = {}) {
    this.activated = true
    this.accessible = this.ports.allowed()
    if (options.restoreAi === false) this.suppressed = true
    if (this.closed || this.suppressed || this.started || !this.ports.allowed()) return
    this.started = true
    await Promise.allSettled(
      this.ports.stores().map(async (store) => {
        if (
          this.closed ||
          !this.ports.allowed() ||
          this.denied.has(store.id) ||
          !this.ports.preferences.read(store.id)
        )
          return
        this.publish(store.id, 'waiting', '等待登录后恢复 AI')
        if (!store.runtime.open) {
          const session = this.session(store.id),
            generation = session.generation
          try {
            await this.ports.execute({ action: 'open-store', storeId: store.id })
          } catch {
            if (
              !this.closed &&
              session.generation === generation &&
              this.ports.preferences.read(store.id)
            )
              this.publish(store.id, 'failed', '店铺打开失败，请手动打开并登录')
          }
          // 只接受平台的新登录事件；旧打开操作晚完成不能重新授权启动。
          return
        }
        await this.ready(store.id)
      }),
    )
  }

  async event(event: unknown) {
    if (this.closed || !event || typeof event !== 'object') return
    const id: unknown = Reflect.get(event, 'storeId'),
      type: unknown = Reflect.get(event, 'type')
    if (
      type === 'reply:decision' &&
      Reflect.get(event, 'stage') === 'skipped' &&
      typeof Reflect.get(event, 'uid') === 'string' &&
      Reflect.get(event, 'uid')
    ) {
      const uid = Reflect.get(event, 'uid') as string
      if (typeof id !== 'string') return
      const store = this.ports.stores().find((row) => row.id === id)
      const conversations = this.autoStoppedConversations.get(id)
      if (conversations?.has(uid)) return
      if (this.autoStopping.has(id) || (conversations && !store?.aiEnabled)) {
        conversations?.add(uid)
        return
      }
      if (!store?.aiEnabled) return
      const stoppedConversations = new Set<string>([uid])
      this.autoStoppedConversations.set(id, stoppedConversations)
      this.autoStopping.add(id)
      try {
        await this.userExecute({ action: 'set-ai', storeId: id, values: { enabled: false } })
        if (!this.closed)
          this.publish(id, 'failed', '消息未交给 AI；本店 AI 已自动关闭，请核对后手动开启')
      } catch {
        if (!this.closed) {
          const stopped = !this.ports.stores().find((row) => row.id === id)?.aiEnabled
          if (!stopped) this.autoStoppedConversations.delete(id)
          this.publish(
            id,
            'failed',
            stopped
              ? '消息未交给 AI；本店 AI 已关闭，但关闭记忆保存失败，请检查后重启前核对'
              : '消息未交给 AI；自动关闭 AI 失败，请立即手动关闭并核对',
          )
        }
      } finally {
        this.autoStopping.delete(id)
      }
      return
    }
    if (typeof id !== 'string' || typeof type !== 'string') return
    if (
      [
        'shop:navigating',
        'shop:crash',
        'shop:open_failed',
        'shop:account_changed',
        'shop:closed',
      ].includes(type) ||
      (type === 'shop:login_state' &&
        (Reflect.get(event, 'authenticated') !== true || Reflect.get(event, 'online') !== true))
    ) {
      this.cancel(id)
      return
    }
    if (type === 'shop:login_state') await this.ready(id)
  }
  private async ready(id: string) {
    if (this.closed || !this.started || !this.ports.allowed()) return
    const desired = this.ports.preferences.read(id),
      store = this.ports.stores().find((s) => s.id === id),
      session = this.session(id)
    if (!desired || this.denied.has(id) || !store || session.loggedIn || session.attempted) return
    if (!store.runtime.open || !store.runtime.online || store.runtime.authenticated !== true) return
    session.loggedIn = true
    session.attempted = true
    const identity = this.identity(store)
    if (
      store.runtime.identityError ||
      !identity ||
      identity.platform !== desired.platform ||
      identity.mallId !== desired.mallId ||
      identity.customerServiceId !== desired.customerServiceId
    ) {
      this.publish(id, 'failed', '登录身份无法核实或已变化，请手动核对后开启 AI')
      return
    }
    if (this.ports.modelBlocked()) {
      this.publish(id, 'failed', 'AI 恢复失败，请先核对模型提示后手动开启')
      return
    }
    const generation = session.generation
    session.starting = true
    this.publish(id, 'restoring', '正在恢复 AI，可点击开关取消')
    try {
      const verified = await this.ports.verifyIdentity(id)
      const current = this.ports.stores().find((row) => row.id === id)
      if (
        this.closed ||
        session.generation !== generation ||
        !this.ports.allowed() ||
        this.denied.has(id)
      )
        return
      if (
        !verified ||
        verified.platform !== desired.platform ||
        verified.mallId !== desired.mallId ||
        verified.customerServiceId !== desired.customerServiceId ||
        !current?.runtime.open ||
        !current.runtime.online ||
        current.runtime.authenticated !== true ||
        current.runtime.identityError ||
        this.ports.modelBlocked() ||
        current.platform !== desired.platform ||
        current.mallId !== desired.mallId ||
        current.customerServiceId !== desired.customerServiceId
      ) {
        this.publish(id, 'failed', '登录身份未能核实，请手动核对后开启 AI')
        return
      }
      await this.ports.execute({ action: 'set-ai', storeId: id, values: { enabled: true } })
      if (this.closed || session.generation !== generation || !this.ports.allowed()) return
      const actual = this.ports.stores().find((s) => s.id === id)
      this.publish(
        id,
        actual?.aiEnabled ? 'restored' : 'failed',
        actual?.aiEnabled ? '已恢复上次 AI 设置' : 'AI 恢复失败，请手动核对后开启',
      )
    } catch {
      if (!this.closed && session.generation === generation)
        this.publish(id, 'failed', 'AI 恢复失败，请核对登录及模型配置后手动开启')
    } finally {
      if (session.generation === generation) session.starting = false
    }
  }
  async userExecute(command: Command): Promise<unknown> {
    const operation = command.values?.operation
    const ids =
      command.action === 'batch'
        ? this.ports.stores().map((s) => s.id)
        : command.storeId
          ? [command.storeId]
          : []
    const off =
      (command.action === 'set-ai' && command.values?.enabled === false) ||
      ['close-store', 'remove-store'].includes(command.action) ||
      (command.action === 'batch' && ['disable', 'close'].includes(String(operation)))
    let persistenceFailed = false
    if (off)
      for (const id of ids) {
        if (!this.autoStopping.has(id)) this.autoStoppedConversations.delete(id)
        try {
          this.cancel(id, true)
        } catch {
          persistenceFailed = true
        }
      }
    const enable =
      (command.action === 'set-ai' && command.values?.enabled === true) ||
      (command.action === 'batch' && operation === 'enable')
    if (enable)
      for (const id of ids) {
        this.cancel(id)
        const session = this.session(id)
        session.loggedIn = true
        session.attempted = true
      }
    const generations = new Map(ids.map((id) => [id, this.session(id).generation]))
    const result = await this.ports.execute(command)
    if (persistenceFailed)
      throw Error('AI 停止操作已完成，但关闭设置保存失败；下次启动前请检查磁盘并重新关闭')
    if (this.closed || !this.ports.allowed()) return result
    if (enable) {
      const results: unknown =
        result && typeof result === 'object' ? Reflect.get(result, 'data') : undefined
      const rows: unknown =
        results && typeof results === 'object' ? Reflect.get(results, 'results') : undefined
      for (const id of ids) {
        if (this.session(id).generation !== generations.get(id)) continue
        let identity: StoreAiIdentity | undefined
        try {
          identity = await this.ports.verifyIdentity(id)
        } catch {
          /* 身份不可核实时本次不记住开启。 */
        }
        if (
          this.closed ||
          !this.ports.allowed() ||
          this.session(id).generation !== generations.get(id)
        )
          continue
        const store = this.ports.stores().find((s) => s.id === id)
        if (
          !identity ||
          store?.platform !== identity.platform ||
          store.mallId !== identity.mallId ||
          store.customerServiceId !== identity.customerServiceId
        )
          continue
        const succeeded =
          command.action !== 'batch' ||
          (Array.isArray(rows) &&
            rows.some(
              (row: unknown) =>
                row &&
                typeof row === 'object' &&
                Reflect.get(row, 'id') === id &&
                Reflect.get(row, 'ok') === true,
            ))
        if (
          store?.aiEnabled &&
          store.runtime.open &&
          store.runtime.online &&
          store.runtime.authenticated === true &&
          !store.runtime.identityError &&
          identity &&
          succeeded
        ) {
          try {
            this.ports.preferences.enable(id, identity)
          } catch {
            this.denied.add(id)
            persistenceFailed = true
            await this.ports.execute({ action: 'set-ai', storeId: id, values: { enabled: false } })
            this.publish(id, 'failed', '开启设置保存失败，AI 已关闭，请检查磁盘后重试')
            continue
          }
          this.denied.delete(id)
          this.session(id).loggedIn = true
          this.session(id).attempted = true
          const conversations = this.autoStoppedConversations.get(id)
          let resumeFailed = false
          if (conversations) {
            for (const conversationId of conversations) {
              if (
                this.closed ||
                !this.ports.allowed() ||
                this.session(id).generation !== generations.get(id)
              )
                return result
              try {
                await this.ports.execute({
                  action: 'resume-conversation',
                  storeId: id,
                  conversationId,
                })
                conversations.delete(conversationId)
              } catch {
                resumeFailed = true
              }
            }
            if (!conversations.size) this.autoStoppedConversations.delete(id)
          }
          if (
            this.closed ||
            !this.ports.allowed() ||
            this.session(id).generation !== generations.get(id)
          )
            return result
          this.publish(
            id,
            resumeFailed ? 'failed' : 'restored',
            resumeFailed
              ? '本店 AI 已开启，但部分会话未恢复；请在日志中逐个核对并恢复'
              : conversations
                ? '已记住本店 AI 开启设置，并恢复关联会话'
                : '已记住本店 AI 开启设置',
          )
        }
      }
    }
    if (persistenceFailed) throw Error('开启设置保存失败，未保存的店铺 AI 已关闭，请检查磁盘后重试')
    return result
  }
}

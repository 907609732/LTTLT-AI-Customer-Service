import type { BrowserWindow } from 'electron'
import { openAssistConversationSchema } from '../src/shared/contracts/assist'
import type { BackendCommand, BackendSnapshot } from '../src/shared/contracts/backend'

/** Focus the already connected conversation, then hand the selected store to the main layout once. */
export function createAssistConversationNavigator(options: {
  runtime():
    | { snapshot(): BackendSnapshot; execute(command: BackendCommand): Promise<unknown> }
    | undefined
  primary(): BrowserWindow | undefined
  load(win: BrowserWindow, route: string): Promise<void>
}) {
  let sequence = 0
  return async (input: unknown) => {
    const value = openAssistConversationSchema.parse(input)
    const ticket = ++sequence
    const runtime = options.runtime()
    const primary = options.primary()
    if (!runtime || !primary || primary.isDestroyed()) throw new Error('主工作台尚未就绪')
    const check = () => {
      const snapshot = runtime.snapshot()
      if (snapshot.workspaceId !== value.workspaceId)
        throw new Error('工作区已切换，请重新选择会话')
      const store = snapshot.stores.find((row) => row.id === value.storeId)
      if (!store?.runtime.open || !store.runtime.online)
        throw new Error('店铺未连接，请先登录或重试')
      if (
        !snapshot.conversations.some(
          (row) => row.storeId === value.storeId && row.uid === value.conversationId,
        )
      )
        throw new Error('会话不存在或尚未采集')
      if (ticket !== sequence) throw new Error('定位已被新的会话选择替代')
    }
    check()
    await runtime.execute({
      action: 'focus-conversation',
      workspaceId: value.workspaceId,
      storeId: value.storeId,
      conversationId: value.conversationId,
      values: {},
    })
    check()
    // Only validated identifiers enter the hash; no buyer text or external URL is accepted.
    const query = new URLSearchParams({
      assistStore: value.storeId,
      assistWorkspace: value.workspaceId,
    })
    await options.load(primary, '/?' + query.toString())
    check()
    if (primary.isDestroyed()) throw new Error('主工作台已关闭')
    if (primary.isMinimized()) primary.restore()
    primary.show()
    primary.focus()
  }
}

import {
  BrowserWindow,
  clipboard,
  ipcMain,
  shell,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
} from 'electron'
import { genericPhrases } from '../src/shared/customer-service/library'
import { isExternalUrl, isScreenPoint } from './policy'
import { isTrustedRenderer, isAppWebContents } from './windows'
import { loadRenderer } from './windows'
import type { AssistWindowManager } from './assist-window'
import type { LocalRuntime } from './local-runtime'
import { z } from 'zod'
import { assistPreferencesPatchSchema } from '../src/shared/contracts/assist'
import { createAssistConversationNavigator } from './assist-conversation'
import {
  openAssistPlatformItemSchema,
  refreshAssistPlatformSchema,
} from '../src/shared/contracts/platform-items'

/** 每个窗口独立持有拖动状态；仅顶层可信渲染页可使用桌面能力。 */
export function registerDesktopIpc(
  options: {
    assist?: () => AssistWindowManager | undefined
    primary?: () => BrowserWindow | undefined
    runtime?: () => LocalRuntime | undefined
  } = {},
): () => void {
  const moves = new Map<number, { dx: number; dy: number }>()
  const openConversation = createAssistConversationNavigator({
    runtime: () => options.runtime?.(),
    primary: () => options.primary?.(),
    load: loadRenderer,
  })
  const observed = new Set<number>()
  const sourceWindow = (event: IpcMainEvent | IpcMainInvokeEvent) => {
    if (
      event.senderFrame !== event.sender.mainFrame ||
      !event.senderFrame ||
      !isAppWebContents(event.sender.id) ||
      !isTrustedRenderer(event.senderFrame.url)
    )
      throw new Error('不可信的桌面接口调用来源')
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win || win.isDestroyed()) throw new Error('窗口已关闭')
    if (!observed.has(win.id)) {
      observed.add(win.id)
      win.once('closed', () => {
        moves.delete(win.id)
        observed.delete(win.id)
      })
    }
    return win
  }
  const handlers = {
    'assist:open-conversation': (event: IpcMainInvokeEvent, input: unknown) => {
      sourceWindow(event)
      return openConversation(input)
    },
    'assist:open': async (event: IpcMainInvokeEvent) => {
      sourceWindow(event)
      const manager = options.assist?.()
      if (!manager) throw new Error('辅助中心尚未就绪')
      await manager.open()
    },
    'assist:state': (event: IpcMainInvokeEvent) => {
      const caller = sourceWindow(event)
      const manager = options.assist?.()
      if (!manager) throw new Error('辅助中心尚未就绪')
      return manager.state(caller)
    },
    'assist:update-preferences': (event: IpcMainInvokeEvent, input: unknown) => {
      const caller = sourceWindow(event)
      const value = z
        .object({ workspaceId: z.string(), patch: assistPreferencesPatchSchema })
        .strict()
        .parse(input)
      const manager = options.assist?.()
      if (!manager || manager.state().workspaceId !== value.workspaceId)
        throw new Error('工作区已切换，请重新打开辅助中心')
      return manager.update(caller, value.patch)
    },
    'assist:close': (event: IpcMainInvokeEvent) => {
      const caller = sourceWindow(event)
      const manager = options.assist?.()
      if (!manager) throw new Error('辅助中心尚未就绪')
      manager.close(caller)
    },
    'assist:open-main-section': async (event: IpcMainInvokeEvent, input: unknown) => {
      sourceWindow(event)
      const section = z.enum(['workorder', 'settings']).parse(input)
      const primary = options.primary?.()
      if (!primary || primary.isDestroyed()) throw new Error('主工作台尚未就绪')
      await loadRenderer(
        primary,
        section === 'workorder' ? '/shop/manage?panel=workorder' : '/settings',
      )
      if (primary.isMinimized()) primary.restore()
      primary.show()
      primary.focus()
    },
    'assist:platform-snapshot': (event: IpcMainInvokeEvent) => {
      sourceWindow(event)
      const runtime = options.runtime?.()
      if (!runtime) throw new Error('平台读取服务尚未就绪')
      return runtime.assistPlatformSnapshot()
    },
    'assist:platform-refresh': (event: IpcMainInvokeEvent, input: unknown) => {
      sourceWindow(event)
      const runtime = options.runtime?.()
      if (!runtime) throw new Error('平台读取服务尚未就绪')
      return runtime.refreshAssistPlatform(refreshAssistPlatformSchema.parse(input))
    },
    'assist:platform-open-item': (event: IpcMainInvokeEvent, input: unknown) => {
      sourceWindow(event)
      const runtime = options.runtime?.()
      if (!runtime) throw new Error('平台读取服务尚未就绪')
      return runtime.openAssistPlatformItem(openAssistPlatformItemSchema.parse(input))
    },
    'app:copy-generic-phrase': (event: IpcMainInvokeEvent, id: unknown) => {
      sourceWindow(event)
      const phrase =
        typeof id === 'string' && id.length <= 64
          ? genericPhrases.find((row) => row.id === id)
          : undefined
      if (!phrase) throw new Error('通用话术不存在，请刷新后重试')
      // Sandboxed renderers cannot read the clipboard or write arbitrary data through this IPC.
      clipboard.writeText(phrase.reply)
    },
    'win:minimize': (event: IpcMainInvokeEvent) => {
      sourceWindow(event).minimize()
    },
    'win:toggle-maximize': (event: IpcMainInvokeEvent) => {
      const win = sourceWindow(event)
      if (win.isMaximized()) win.unmaximize()
      else win.maximize()
      return win.isMaximized()
    },
    'win:close': (event: IpcMainInvokeEvent) => {
      sourceWindow(event).close()
    },
    'win:is-maximized': (event: IpcMainInvokeEvent) => sourceWindow(event).isMaximized(),
    'win:begin-move': (event: IpcMainInvokeEvent, point: unknown) => {
      const win = sourceWindow(event)
      if (!isScreenPoint(point) || win.isMaximized() || win.isFullScreen()) {
        moves.delete(win.id)
        return false
      }
      options.assist?.()?.detachForDrag(win)
      const [x, y] = win.getPosition()
      moves.set(win.id, { dx: point.screenX - x, dy: point.screenY - y })
      return true
    },
    'app:open-external': async (event: IpcMainInvokeEvent, url: unknown) => {
      sourceWindow(event)
      if (!isExternalUrl(url)) throw new Error('仅允许有效的 HTTP(S) 外部链接')
      await shell.openExternal(url)
    },
  }
  for (const [channel, handler] of Object.entries(handlers)) ipcMain.handle(channel, handler)
  const move = (event: IpcMainEvent, point: unknown) => {
    try {
      const win = sourceWindow(event),
        state = moves.get(win.id)
      if (!state || !isScreenPoint(point)) return
      win.setPosition(Math.round(point.screenX - state.dx), Math.round(point.screenY - state.dy))
    } catch {
      /* send 没有返回值；不可信来源不能使主进程退出。 */
    }
  }
  const end = (event: IpcMainEvent) => {
    try {
      moves.delete(sourceWindow(event).id)
    } catch {
      /* 同上。 */
    }
  }
  ipcMain.on('win:move', move)
  ipcMain.on('win:end-move', end)
  return () => {
    for (const channel of Object.keys(handlers)) ipcMain.removeHandler(channel)
    ipcMain.removeListener('win:move', move)
    ipcMain.removeListener('win:end-move', end)
    moves.clear()
  }
}

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

/** 每个窗口独立持有拖动状态；仅顶层可信渲染页可使用桌面能力。 */
export function registerDesktopIpc(): () => void {
  const moves = new Map<number, { dx: number; dy: number }>()
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

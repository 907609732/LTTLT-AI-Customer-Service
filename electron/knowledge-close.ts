import type { BrowserWindow } from 'electron'

/** 内嵌页仍保留原先“保存成功后才能关窗”的保护，不能只依赖路由守卫。 */
export function protectKnowledgeClose(win: BrowserWindow, isQuitting: () => boolean) {
  const contents = win.webContents
  let pending = false
  let allowed = false
  const inKnowledge = () => {
    try {
      return new URL(contents.getURL()).hash.split('?')[0] === '#/knowledge'
    } catch {
      return false
    }
  }
  const close = (event: Electron.Event) => {
    if (allowed) {
      allowed = false
      return
    }
    if (isQuitting() || !inKnowledge()) return
    event.preventDefault()
    pending = true
    contents.send('knowledge:close-request')
  }
  const navigate = () => {
    pending = false
    allowed = false
  }
  const dispose = () => {
    win.removeListener('close', close)
    contents.removeListener('did-navigate-in-page', navigate)
  }
  win.on('close', close)
  contents.on('did-navigate-in-page', navigate)
  win.once('closed', dispose)
  return {
    acknowledge() {
      if (!pending || win.isDestroyed() || !inKnowledge()) return false
      pending = false
      allowed = true
      // 原生 close 事件可以晚于 close() 返回；放行标记由该事件自身消耗。
      win.close()
      return true
    },
  }
}

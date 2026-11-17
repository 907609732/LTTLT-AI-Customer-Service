import type { BrowserWindow, WebContents, WindowOpenHandlerResponse } from 'electron'
import type { GmPopupStatus } from './gm'

type PopupMode = 'allow' | 'block'
interface PopupOptions {
  getStoreWebContents(storeId: string): WebContents | null
  getOwnerWebContents(): WebContents | null | undefined
  openExternal(url: string): Promise<unknown>
}

const isNormalWebUrl = (value: string) => {
  if (value === 'about:blank') return true
  try {
    const url = new URL(value)
    return (
      value.length <= 8192 &&
      ['http:', 'https:'].includes(url.protocol) &&
      !url.username &&
      !url.password
    )
  } catch {
    return false
  }
}
const isPddPage = (value: string) => {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && url.hostname === 'mms.pinduoduo.com'
  } catch {
    return false
  }
}
const diagnosticUrl = (value: string) => {
  try {
    const url = new URL(value)
    return `${url.origin}${url.pathname}`
  } catch {
    return ''
  }
}

/**
 * 不改厂商源码：allow 只替换当前店铺 WebContents 的新窗处理器；block 恢复
 * 厂商原有的 shell.openExternal + deny。Electron 的 WebContentsView 经
 * BrowserWindow.fromWebContents 会返回父窗口，不能据此判断是否为内嵌页；
 * 这里只接受厂家 manager 按 storeId 返回的实际 WebContents，并核对 PDD 域名。
 */
export function createPopupPolicy(options: PopupOptions) {
  const modes = new Map<string, PopupMode>()
  const secured = new Set<number>()
  const handlerFor =
    (mode: PopupMode) =>
    (details: { url: string }): WindowOpenHandlerResponse => {
      if (mode === 'block') {
        void options.openExternal(details.url).catch(() => {})
        return { action: 'deny' }
      }
      if (!isNormalWebUrl(details.url)) return { action: 'deny' }
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          webPreferences: {
            sandbox: true,
            contextIsolation: true,
            nodeIntegration: false,
            webviewTag: false,
          },
        },
      }
    }
  const secureChildren = (page: WebContents, storeId: string) => {
    if (secured.has(page.id)) return
    secured.add(page.id)
    page.on('did-create-window', (child: BrowserWindow) => {
      child.webContents.setWindowOpenHandler((details) =>
        handlerFor(modes.get(storeId) ?? 'block')(details),
      )
    })
  }
  const page = (storeId: string) => {
    const target = options.getStoreWebContents(storeId)
    if (!target || target.isDestroyed())
      throw new Error('所选拼多多店铺页面尚未打开，请先打开店铺再设置弹窗策略')
    const owner = options.getOwnerWebContents()
    if (owner && owner.id === target.id)
      throw new Error('监控窗口不是店铺页面，不能修改自身的新窗策略')
    if (!isPddPage(target.getURL()))
      throw new Error('所选店铺当前不是 mms.pinduoduo.com 拼多多内嵌页，未修改新窗策略')
    return target
  }
  return {
    status(storeId: string): GmPopupStatus {
      const mode = modes.get(storeId) ?? 'block'
      const target = options.getStoreWebContents(storeId)
      if (!target || target.isDestroyed())
        return { mode, applied: false, url: '', message: '店铺页面尚未打开；策略将在打开后沿用。' }
      if (!isPddPage(target.getURL()))
        return {
          mode,
          applied: false,
          url: diagnosticUrl(target.getURL()),
          message: '当前页面不是 mms.pinduoduo.com 拼多多内嵌页，未应用策略。',
        }
      return { mode, applied: true, url: diagnosticUrl(target.getURL()), message: '' }
    },
    set(storeId: string, mode: PopupMode): GmPopupStatus {
      const target = page(storeId)
      modes.set(storeId, mode)
      target.setWindowOpenHandler(handlerFor(mode))
      secureChildren(target, storeId)
      return {
        mode,
        applied: true,
        url: diagnosticUrl(target.getURL()),
        message: '策略只在本次源码运行内有效，正常重启恢复厂商默认。',
      }
    },
    /** 店铺页重新建立后同步本次运行已有的按店策略；没有策略时不触碰厂商处理器。 */
    sync(storeId: string) {
      const mode = modes.get(storeId)
      if (!mode) return
      try {
        const target = page(storeId)
        target.setWindowOpenHandler(handlerFor(mode))
        secureChildren(target, storeId)
      } catch {
        // 页面尚未打开或正处于导航；下一次 shop 事件或显式 status 会再同步。
      }
    },
    modes() {
      return new Map(modes)
    },
  }
}
export type PopupPolicy = ReturnType<typeof createPopupPolicy>

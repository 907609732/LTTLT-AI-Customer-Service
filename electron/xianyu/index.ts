import type { WebContents } from 'electron'
import { createXianyuPageBridge, type XianyuBridgeLogger } from './bridge-client'
import { createXianyuAdapter, type XianyuAdapter, type XianyuStore } from './adapter'

export { XIANYU_PLATFORM_ID, XIANYU_PLATFORM_NAME, XIANYU_SELECTORS } from './adapter'
export type {
  XianyuAdapter,
  XianyuFailure,
  XianyuLocalMessage,
  XianyuMessageEvent,
  XianyuResult,
} from './adapter'
export type { XianyuBridgeLogger } from './bridge-client'

/** 厂商 logger 与本地 logger 只有四个方法名相同；缺方法时静默，不因日志失败阻断业务。 */
export function bridgeLogger(source: unknown, prefix: string): XianyuBridgeLogger {
  const call = (name: 'debug' | 'info' | 'warn' | 'error', message: string) => {
    if (!source || typeof source !== 'object') return
    const fn = Reflect.get(source, name)
    if (typeof fn !== 'function') return
    try {
      fn.call(source, `[${prefix}] ${message}`)
    } catch {
      /* 日志永远不能影响平台调用 */
    }
  }
  return {
    debug: (message) => call('debug', message),
    info: (message) => call('info', message),
    warn: (message) => call('warn', message),
    error: (message) => call('error', message),
  }
}

/**
 * 创建闲鱼适配器：页面由厂商 ShopWindowManager 建好（EntryUrl 在 desk-v1 中已是
 * goofish.com/im），这里只按当前 WebContents 建桥。页面被替换或重新打开时，
 * 适配器会丢弃旧桥并重新注入，不把旧页面的消息当成新页面的事实。
 */
export function createXianyuPlatformAdapter(options: {
  store: XianyuStore
  getWebContents: () => WebContents | null
  logger?: unknown
  onAuthenticated?: () => void
}): XianyuAdapter {
  const logger = bridgeLogger(options.logger, 'xianyu')
  return createXianyuAdapter({
    store: options.store,
    getWebContents: options.getWebContents,
    createBridge: (webContents) => createXianyuPageBridge(webContents, logger),
    logger,
    onAuthenticated: options.onAuthenticated,
  })
}

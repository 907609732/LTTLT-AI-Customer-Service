import type { DesktopApi } from '../contracts/desktop'

/** 浏览器预览不模拟桌面操作成功，也不打开未经验证的外部链接。 */
const browserDesktop: DesktopApi = {
  isElectron: false,
  minimize: async () => {},
  toggleMaximize: async () => false,
  close: async () => {},
  isMaximized: async () => false,
  beginMove: async () => false,
  move: () => {},
  endMove: () => {},
  openExternal: async () => {},
}

export function getDesktop(): DesktopApi {
  return window.yunduoDesktop ?? browserDesktop
}

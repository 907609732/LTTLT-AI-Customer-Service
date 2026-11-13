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
  simulatorStatus: async () => ({
    running: false,
    port: 0,
    url: '',
    error: '此操作需要桌面版；浏览器仅提供界面预览',
  }),
  openSimulatorPage: async () => ({
    ok: false,
    message: '此操作需要桌面版；浏览器仅提供界面预览',
  }),
}

export function getDesktop(): DesktopApi {
  return window.yunduoDesktop ?? browserDesktop
}

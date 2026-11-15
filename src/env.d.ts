import type { DesktopApi, RenderError } from './shared/contracts/desktop'

declare global {
  const __APP_VERSION__: string
  interface Window {
    yunduoDesktop?: DesktopApi
    __vueErrors?: RenderError[]
  }
}

export {}

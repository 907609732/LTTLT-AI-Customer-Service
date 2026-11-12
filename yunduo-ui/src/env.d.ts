import type { DesktopApi, RenderError } from './shared/contracts/desktop'

declare global {
  interface Window {
    yunduoDesktop?: DesktopApi
    __vueErrors?: RenderError[]
  }
}

export {}

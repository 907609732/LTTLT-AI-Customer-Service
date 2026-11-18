import {
  knowledgeOpenSchema,
  type KnowledgeWindowContext,
} from '../src/shared/contracts/knowledge-client'
interface KnowledgeWindow {
  isDestroyed(): boolean
  setBounds(bounds: { x: number; y: number; width: number; height: number }): void
  show(): void
  focus(): void
  hide(): void
  destroy(): void
  on(event: 'close', listener: (event: { preventDefault(): void }) => void): unknown
  webContents: { send(channel: string, ...args: unknown[]): void }
}
/** Independent local selection. No backend selection command is ever issued by this controller. */
export function createKnowledgeWindow(options: {
  create(): KnowledgeWindow
  load(window: KnowledgeWindow): Promise<void>
  workArea(): { x: number; y: number; width: number; height: number }
  workspace(): string
  stores(): string[]
}) {
  let win: KnowledgeWindow | undefined
  let loading: Promise<void> | undefined
  let closed = false
  let context: KnowledgeWindowContext = {
    workspaceId: options.workspace(),
    storeId: '',
    tab: 'products',
    productId: '',
    revision: 0,
  }
  const assert = (workspaceId: string) => {
    if (closed || workspaceId !== options.workspace()) throw Error('知识库工作区已改变')
  }
  return {
    rebind(workspaceId: string, storeId: string) {
      assert(workspaceId)
      context = {
        workspaceId,
        storeId: options.stores().includes(storeId) ? storeId : '',
        tab: context.tab,
        // Restore/clear can change bindings, so never keep a stale product preset.
        productId: '',
        revision: context.revision + 1,
      }
      if (win && !win.isDestroyed()) win.webContents.send('knowledge:context', context)
    },
    async open(raw: unknown) {
      const input = knowledgeOpenSchema.parse(raw)
      assert(input.workspaceId)
      if (input.storeId && !options.stores().includes(input.storeId)) throw Error('店铺已移除')
      context = { ...input, revision: context.revision + 1 }
      if (!win || win.isDestroyed()) {
        win = options.create()
        const area = options.workArea(),
          width = Math.min(1280, area.width),
          height = Math.min(900, area.height)
        win.setBounds({
          x: area.x + Math.floor((area.width - width) / 2),
          y: area.y + Math.floor((area.height - height) / 2),
          width,
          height,
        })
        const window = win
        window.on('close', (event) => {
          if (closed) return
          event.preventDefault()
          window.webContents.send('knowledge:close-request')
        })
        loading = options.load(window).catch((error) => {
          window.destroy()
          throw error
        })
      }
      await loading
      assert(input.workspaceId)
      if (!win || win.isDestroyed()) throw Error('知识库窗口已关闭')
      win.webContents.send('knowledge:context', context)
      win.show()
      win.focus()
    },
    context() {
      return context.workspaceId === options.workspace()
        ? { ...context }
        : {
            workspaceId: options.workspace(),
            storeId: '',
            tab: 'products' as const,
            productId: '',
            revision: context.revision,
          }
    },
    hide(workspaceId: string) {
      assert(workspaceId)
      if (win && !win.isDestroyed()) win.hide()
    },
    dispose() {
      closed = true
      if (win && !win.isDestroyed()) win.destroy()
      win = undefined
    },
  }
}
export type KnowledgeWindowManager = ReturnType<typeof createKnowledgeWindow>

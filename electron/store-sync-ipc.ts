import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import type { createStoreSync } from './store-sync-service'
import { syncEnvelopeSchema } from '../src/shared/contracts/store-sync'

/** Public assembly injects requireAppFrame; platform frames must never pass this guard. */
export function registerStoreSyncIpc(options: {
  ipcMain: Pick<IpcMain, 'handle' | 'removeHandler'>
  authorize: (event: IpcMainInvokeEvent) => unknown
  resolveCurrent: () => { workspaceId: string; service: ReturnType<typeof createStoreSync> }
  changed?: () => void
}): () => void {
  const { ipcMain, authorize, resolveCurrent } = options
  const channels = [
    'store-sync:preview',
    'store-sync:apply',
    'store-sync:rollback',
    'store-sync:backups',
  ] as const
  for (const channel of channels)
    ipcMain.handle(channel, async (event, raw: unknown) => {
      authorize(event)
      const envelope = syncEnvelopeSchema.parse(raw),
        current = resolveCurrent()
      if (envelope.workspaceId !== current.workspaceId) throw Error('工作区已切换，请刷新后再操作')
      let result: unknown
      try {
        if (channel === 'store-sync:backups') {
          if (envelope.input !== undefined) throw Error('备份列表不接受额外参数')
          result = current.service.backups()
        } else if (channel === 'store-sync:preview')
          result = await current.service.preview(envelope.input)
        else if (channel === 'store-sync:apply')
          result = await current.service.apply(envelope.input)
        else result = await current.service.rollback(envelope.input)
        const latest = resolveCurrent()
        if (latest.workspaceId !== current.workspaceId || latest.service !== current.service)
          throw Error('工作区已切换，已丢弃旧同步结果')
        return result
      } finally {
        if (channel === 'store-sync:apply' || channel === 'store-sync:rollback') options.changed?.()
      }
    })
  return () => {
    for (const channel of channels) ipcMain.removeHandler(channel)
  }
}

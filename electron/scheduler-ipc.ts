import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import { z } from 'zod'
import type { ReceptionScheduler } from './scheduler-runtime'

/** Resolve on each request so account replacement never reuses a stale instance. */
export function registerSchedulerIpc(options: {
  requireAppFrame(event: IpcMainInvokeEvent): void
  resolveCurrent(): ReceptionScheduler
}): () => void {
  ipcMain.handle('scheduler:snapshot', (event, input: unknown) => {
    options.requireAppFrame(event)
    const workspaceId = z.string().min(1).max(128).parse(input)
    const snapshot = options.resolveCurrent().snapshot()
    if (snapshot.workspaceId !== workspaceId) throw new Error('工作区已变化，请刷新')
    return snapshot
  })
  ipcMain.handle('scheduler:execute', (event, command: unknown) => {
    options.requireAppFrame(event)
    const current = options.resolveCurrent()
    const snapshot = current.execute(command)
    if (options.resolveCurrent() !== current) throw new Error('工作区已变化，请刷新')
    return snapshot
  })
  return () => {
    ipcMain.removeHandler('scheduler:snapshot')
    ipcMain.removeHandler('scheduler:execute')
  }
}

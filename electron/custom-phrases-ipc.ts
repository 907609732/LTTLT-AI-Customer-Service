import { clipboard, ipcMain } from 'electron'
import { snapshotSchema } from '../src/shared/contracts/backend'
import { phraseScopeSchema, phraseCopySchema } from '../src/shared/customer-service/custom-phrases'
import { requireAppFrame, type LocalRuntime } from './local-runtime'
import { CustomPhraseStore } from './custom-phrases-store'

/** The root is supplied by the owner, never by a renderer. Workspace membership is checked on every call. */
export function registerCustomPhrasesIpc(
  runtime: Pick<LocalRuntime, 'snapshot'>,
  getRoot: () => string,
): () => void {
  const names = ['list', 'save', 'remove', 'import', 'copy'] as const
  for (const name of names)
    ipcMain.handle(`custom-phrases:${name}`, (event, rawScope, input: unknown) => {
      requireAppFrame(event)
      const scope = phraseScopeSchema.parse(rawScope)
      const snapshot = snapshotSchema.parse(runtime.snapshot())
      if (
        !snapshot.workspaceId ||
        snapshot.workspaceId !== scope.workspaceId ||
        !snapshot.stores.some((row) => row.id === scope.storeId)
      )
        throw new Error('当前工作区或店铺已变化，请重新选择')
      const store = new CustomPhraseStore(getRoot())
      if (name === 'list') return store.list(scope)
      if (name === 'copy') {
        const { id } = phraseCopySchema.parse(input)
        const row = store.list(scope).rows.find((row) => row.id === id)
        if (!row) throw new Error('话术不存在，请刷新后重试')
        clipboard.writeText(row.reply)
        return
      }
      // Store methods validate the complete unknown IPC payload before using it.
      if (name === 'save')
        return store.save(scope, input as Parameters<CustomPhraseStore['save']>[1])
      if (name === 'remove')
        return store.remove(scope, input as Parameters<CustomPhraseStore['remove']>[1])
      return store.import(scope, input as Parameters<CustomPhraseStore['import']>[1])
    })
  return () => names.forEach((name) => ipcMain.removeHandler(`custom-phrases:${name}`))
}

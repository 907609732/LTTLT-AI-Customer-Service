import { getBackendBridge } from '../platform/backend'
import { getDesktop } from '../platform/desktop'
import {
  phraseLibrarySchema,
  type CustomPhrasesBridge,
  type PhraseScope,
  type PhraseSave,
  type PhraseRemove,
  type PhraseImport,
} from './custom-phrases'

function bridge(): CustomPhrasesBridge {
  const desktop: ReturnType<typeof getDesktop> & { customPhrases?: CustomPhrasesBridge } =
    getDesktop()
  if (!desktop.isElectron || !desktop.customPhrases)
    throw new Error('自定义话术需要桌面版接入；当前未加载保存能力，请更新或重启软件')
  return desktop.customPhrases
}
export async function phraseStores() {
  const backend = getBackendBridge()
  if (!backend) throw new Error('浏览器仅预览；自定义话术需要桌面版与已添加店铺')
  const snapshot = await backend.snapshot()
  if (!snapshot.workspaceId) throw new Error('工作区尚未就绪，请稍后重试')
  return {
    workspaceId: snapshot.workspaceId,
    stores: snapshot.stores.map(({ id, storeName }) => ({ id, name: storeName })),
  }
}

/** Clear previously loaded account data as soon as runtime identity changes. */
export function observePhraseWorkspace(
  listener: (workspaceId: string, storeIds: string[]) => void,
): () => void {
  const backend = getBackendBridge()
  if (!backend) return () => {}
  let disposed = false,
    request = 0
  const off = backend.subscribe(() => {
    const current = ++request
    void backend
      .snapshot()
      .then((snapshot) => {
        if (!disposed && current === request)
          listener(
            snapshot.workspaceId,
            snapshot.stores.map((row) => row.id),
          )
      })
      .catch(() => {
        if (!disposed && current === request) listener('', [])
      })
  })
  return () => {
    disposed = true
    off()
  }
}
export const customPhrasePlatform = {
  list: async (scope: PhraseScope) => phraseLibrarySchema.parse(await bridge().list(scope)),
  save: async (scope: PhraseScope, input: PhraseSave) =>
    phraseLibrarySchema.parse(await bridge().save(scope, input)),
  remove: async (scope: PhraseScope, input: PhraseRemove) =>
    phraseLibrarySchema.parse(await bridge().remove(scope, input)),
  import: async (scope: PhraseScope, input: PhraseImport) =>
    phraseLibrarySchema.parse(await bridge().import(scope, input)),
  copy: (scope: PhraseScope, id: string) => bridge().copy(scope, { id }),
}

export async function readPhraseJsonFile(file: File): Promise<string> {
  if (file.size > 2_000_000) throw new Error('导入文件超过 2 MB 限制')
  return file.text()
}
/** Downloads only a locally generated JSON document; no arbitrary filesystem capability. */
export function downloadPhraseJson(text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = 'lingtu-custom-phrases.json'
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

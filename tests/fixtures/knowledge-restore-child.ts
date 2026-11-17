// This isolated child never loads Electron, a model, or a user's data directory.
import fs from 'node:fs'
import { join, basename } from 'node:path'
import { createKnowledgeRepository } from '../../electron/knowledge/repository'
import { restoreKnowledgeBackup } from '../../electron/knowledge/backup'
import { createWorkspaceRuntime } from '../../electron/workspace-runtime'
import { emptySnapshot } from '../../src/shared/contracts/backend'
import type { LocalRuntime } from '../../electron/local-runtime'

export async function run(mode: string, directory: string, backupDirectory: string) {
  if (mode === 'wal') {
    const repo = createKnowledgeRepository({ directory, workspaceId: 'wal-child' })
    repo.saveCanonical({ title: 'uncheckpointed old knowledge' })
    process.send?.({ phase: 'wal-ready' })
    setInterval(() => {}, 1000)
    return
  }
  if (mode.startsWith('restore:')) {
    const phase = mode.slice('restore:'.length)
    const rename = fs.renameSync
    fs.renameSync = (from, to) => {
      rename(from, to)
      const boundary =
        basename(String(to)) === 'knowledge.sqlite' &&
        String(to) === join(directory, 'knowledge.sqlite')
          ? 'installed'
          : basename(String(from))
      if (boundary === phase) {
        process.send?.({ phase })
        // Wait inside the actual filesystem phase; the parent forcibly kills us, so no catch/finally runs.
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0)
      }
    }
    restoreKnowledgeBackup({ directory, backupDirectory })
    throw Error('requested boundary was not reached')
  }
  const factory = (): LocalRuntime => {
    const repo = createKnowledgeRepository({ directory, workspaceId: 'fresh-owner' })
    const state = emptySnapshot()
    state.workspaceId = 'fresh-owner'
    const unavailable = () => {
      throw Error('isolated fixture: unrelated service unavailable')
    }
    return {
      dataDirectory: () => directory,
      knowledge: unavailable,
      storeSync: unavailable,
      scheduler: unavailable,
      platformLearning: unavailable,
      platformOrders: unavailable,
      receptionOperations: unavailable,
      developerDebug: () => undefined,
      openPlatformLearningSource: async () => unavailable(),
      serviceRequest: async () => unavailable(),
      start: async () => {},
      snapshot: () => state,
      execute: async () => unavailable(),
      subscribe: () => () => true,
      setStoreZoom: (input) => input.percent,
      presentStore: () => {},
      simulatorStatus: () => ({ running: false, port: 0, url: '', error: '' }),
      openSimulatorPage: async () => ({ ok: false, message: 'isolated fixture' }),
      assistPlatformSnapshot: () => ({ workspaceId: state.workspaceId, stores: [] }),
      refreshAssistPlatform: async () => ({ workspaceId: state.workspaceId, stores: [] }),
      openAssistPlatformItem: async () => {},
      setAssistPlatformActive: () => {},
      dispose: async () => {
        repo.dispose()
      },
    }
  }
  try {
    const owner = createWorkspaceRuntime({ factory })
    await owner.start()
    await owner.dispose()
    process.send?.({ opened: true })
  } catch (error) {
    process.send?.({
      opened: false,
      message: error instanceof Error ? error.message : String(error),
    })
  }
}

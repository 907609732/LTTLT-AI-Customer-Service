import {
  syncApplySchema,
  syncBackupListSchema,
  syncEnvelopeSchema,
  syncPreviewSchema,
  syncRequestSchema,
  syncResultSchema,
  syncRollbackSchema,
  type StoreSyncClient,
} from '../contracts/store-sync'

export type StoreSyncChannel =
  | 'store-sync:preview'
  | 'store-sync:apply'
  | 'store-sync:rollback'
  | 'store-sync:backups'
/** Narrow transport is supplied by app/preload integration, never exposed as arbitrary IPC. */
export function createStoreSyncClient(
  invoke: (channel: StoreSyncChannel, envelope: unknown) => Promise<unknown>,
  getWorkspaceId: () => string,
): StoreSyncClient {
  async function call(channel: StoreSyncChannel, input?: unknown) {
    const workspaceId = getWorkspaceId()
    const envelope = syncEnvelopeSchema.parse({
      workspaceId,
      ...(input === undefined ? {} : { input }),
    })
    const value = await invoke(channel, envelope)
    if (workspaceId !== getWorkspaceId()) throw Error('工作区已切换，已丢弃旧同步结果')
    return value
  }
  return {
    preview: async (input) =>
      syncPreviewSchema.parse(await call('store-sync:preview', syncRequestSchema.parse(input))),
    apply: async (input) =>
      syncResultSchema.parse(await call('store-sync:apply', syncApplySchema.parse(input))),
    rollback: async (input) =>
      syncResultSchema.parse(await call('store-sync:rollback', syncRollbackSchema.parse(input))),
    backups: async () => syncBackupListSchema.parse(await call('store-sync:backups')),
  }
}

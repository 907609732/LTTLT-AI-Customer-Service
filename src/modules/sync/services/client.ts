import type { StoreSyncClient } from '../contracts'

let client: StoreSyncClient | undefined
/** App installs the platform adapter; browser previews deliberately have no writable client. */
export function installStoreSyncClient(value: StoreSyncClient): () => void {
  client = value
  return () => {
    if (client === value) client = undefined
  }
}
export function getStoreSyncClient(): StoreSyncClient | undefined {
  return client
}

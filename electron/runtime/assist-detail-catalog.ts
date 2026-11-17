import type {
  PlatformItemKind,
  PlatformItemsSnapshot,
} from '../../src/shared/contracts/platform-items'
import { pddDetailId } from '../assist-platform-pdd'

const key = (storeId: string, kind: PlatformItemKind, id: string) => `${storeId}:${kind}:${id}`

/**
 * A detail URL is only usable after the same row appears in a successful collected snapshot.
 * Observed URLs are bounded until publication and never exposed to the renderer.
 */
export function createAssistDetailCatalog(maxObserved = 1000) {
  const published = new Map<string, string>()
  const observed = new Map<string, string>()
  return {
    remember(storeId: string, kind: PlatformItemKind, id: string, url: string) {
      observed.set(key(storeId, kind, id), url)
      if (observed.size > maxObserved) observed.delete(observed.keys().next().value!)
    },
    publish(snapshot: PlatformItemsSnapshot) {
      const visible = new Set(
        snapshot.stores.flatMap((store) =>
          store.items.map((item) => key(store.storeId, store.kind, item.id)),
        ),
      )
      for (const id of visible) {
        const target = observed.get(id)
        if (target) {
          published.set(id, target)
          observed.delete(id)
        }
      }
      for (const id of published.keys()) if (!visible.has(id)) published.delete(id)
      return snapshot
    },
    target(storeId: string, kind: PlatformItemKind, id: string, snapshot: PlatformItemsSnapshot) {
      const record = snapshot.stores.find((item) => item.storeId === storeId && item.kind === kind)
      const row = record?.items.find((item) => item.id === id)
      const target = published.get(key(storeId, kind, id))
      if (
        !row ||
        record?.status !== 'success' ||
        !target ||
        pddDetailId(kind, target) !== id ||
        (kind === 'aftersale' && new URL(target).searchParams.get('orderSn') !== row.orderNo)
      )
        return undefined
      return target
    },
    clear() {
      published.clear()
      observed.clear()
    },
  }
}

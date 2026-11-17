import type { BrowserWindow } from 'electron'
import {
  openAssistPlatformItemSchema,
  refreshAssistPlatformSchema,
  type OpenAssistPlatformItemInput,
  type RefreshAssistPlatformInput,
} from '../../src/shared/contracts/platform-items'
import {
  assistBackendUrl,
  assistCollectionUrl,
  createAssistPlatformHost,
  isAllowedAssistUrl,
  type AssistPlatform,
} from '../assist-platform-host'
import { createAssistPlatformCollector, type AssistStore } from '../assist-platform-collector'
import { createAssistPlatformReader } from '../assist-platform-reader'
import { createAssistDetailCatalog } from './assist-detail-catalog'

const isAssistPlatform = (value: string): value is AssistPlatform =>
  value === 'pdd-web' || value === 'doudian-client'

/**
 * Owns the auxiliary-center platform pages and their collected snapshots. The reader may
 * remember a detail URL, but only a successful published row can resolve it for opening.
 */
export function createAssistRuntime(options: {
  workspaceId: string
  namespace: string
  getParent(): BrowserWindow | undefined
  stores(): AssistStore[]
  isActive(): boolean
  changed(): void
  createWindow(partition: string): BrowserWindow
  identityScript(): string
}) {
  const detailCatalog = createAssistDetailCatalog()
  const host = createAssistPlatformHost({
    namespace: options.namespace,
    getParent: options.getParent,
    createWindow: options.createWindow,
  })
  const collector = createAssistPlatformCollector({
    timeoutMs: 60000,
    workspaceId: options.workspaceId,
    stores: options.stores,
    changed: options.changed,
    read: createAssistPlatformReader({
      page: host.page,
      collectionPage: host.collectionPage,
      refreshQuery: host.refreshQuery,
      turnPage: host.turnPage,
      observeAfterSaleDetail: host.observeAfterSaleDetail,
      observeTicketDetail: host.observeTicketDetail,
      rememberDetail: (storeId, kind, id, url) => detailCatalog.remember(storeId, kind, id, url),
      identityScript: options.identityScript,
    }),
  })
  const snapshot = () => detailCatalog.publish(collector.snapshot())
  const assertActive = (workspaceId: string) => {
    if (!options.isActive() || workspaceId !== options.workspaceId)
      throw new Error('店铺工作区已改变，请重新打开辅助中心')
  }
  return {
    snapshot,
    collectorSnapshot: () => collector.snapshot(),
    setActive(active: boolean) {
      collector.setActive(active)
      if (!active) host.stopCollecting()
    },
    async refresh(input: RefreshAssistPlatformInput) {
      const request = refreshAssistPlatformSchema.parse(input)
      assertActive(request.workspaceId)
      await collector.refresh(request.storeId, request.kind)
      return snapshot()
    },
    async openItem(input: OpenAssistPlatformItemInput) {
      const request = openAssistPlatformItemSchema.parse(input)
      assertActive(request.workspaceId)
      const store = options.stores().find((item) => item.id === request.storeId)
      if (!store || !isAssistPlatform(store.platform)) throw new Error('此店铺尚未接入平台后台')
      if (store.platform !== 'pdd-web') throw new Error('抖店平台工单和售后暂未接入')
      if (request.id) {
        const current = snapshot(),
          target = detailCatalog.target(request.storeId, request.kind, request.id, current)
        if (!target) throw new Error('此记录的详情页面不可用，请先刷新平台列表')
        const page = host.page(store.id) ?? host.collectionContents(store.id, request.kind)
        if (!page || !isAllowedAssistUrl('pdd-web', page.getURL()))
          throw new Error('平台后台已关闭，请先刷新同步后查看详情')
        const identity: unknown = await page.executeJavaScript(options.identityScript())
        const matches =
          identity &&
          typeof identity === 'object' &&
          Reflect.get(identity, 'authenticated') === true &&
          (store.identityId
            ? Reflect.get(identity, 'mallId') === store.identityId
            : Boolean(store.storeName) && Reflect.get(identity, 'storeName') === store.storeName)
        if (!matches) {
          collector.invalidateStore(store.id, '后台登录或店铺身份已改变，请核对店铺后手动刷新')
          throw new Error('后台登录或店铺身份已改变，未打开旧工单详情')
        }
        if (!options.isActive()) throw new Error('店铺工作区已改变，请重新打开辅助中心')
        await host.open({ id: store.id, platform: 'pdd-web' }, target)
        return
      }
      await host.open(
        { id: store.id, platform: store.platform },
        assistCollectionUrl(store.platform, request.kind),
        snapshot().stores.some(
          (row) =>
            row.storeId === store.id &&
            row.kind === request.kind &&
            row.status === 'login_required',
        )
          ? request.kind
          : undefined,
      )
    },
    closeStore(storeId: string) {
      host.closeStore(storeId)
    },
    async openBackend(store: { id: string; platform: string }) {
      if (!isAssistPlatform(store.platform)) throw new Error('此平台尚未接入平台后台')
      await host.open({ id: store.id, platform: store.platform }, assistBackendUrl(store.platform))
    },
    disposeCollection() {
      collector.dispose()
    },
    clearDetails() {
      detailCatalog.clear()
    },
    disposeHost() {
      host.dispose()
    },
  }
}

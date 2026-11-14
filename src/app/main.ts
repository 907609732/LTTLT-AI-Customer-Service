import { createApp } from 'vue'
import { createPinia } from 'pinia'
import ElementPlus from 'element-plus'
import zhCn from 'element-plus/es/locale/lang/zh-cn'
import App from './App.vue'
import router from './router'
import { installWindowDrag } from '@/shared/platform/window-drag'
import { installImageFallback } from '@/shared/platform/images'
import { provideServices } from './services'
import { useRuntimeStore } from '@/shared/state/runtime'
import { getDesktop } from '@/shared/platform/desktop'
import { createStoreSyncClient } from '@/shared/platform/store-sync'
import { installStoreSyncClient } from '@/modules/sync'
import { createTeamService, teamServiceKey } from '@/modules/account'
import { billingTransportKey } from '@/modules/billing'
import '../styles/index.css'

const disposeDrag = installWindowDrag()
const disposeImages = installImageFallback()
const app = createApp(App)
app.use(createPinia())
app.use(ElementPlus, { locale: zhCn })
app.use(router)
provideServices(app)
const runtime = useRuntimeStore()
const desktop = getDesktop()
if (desktop.isElectron && desktop.managedBusinessRequest) {
  const request = desktop.managedBusinessRequest
  app.provide(
    teamServiceKey,
    createTeamService(async ({ path, method, body }) => {
      const workspaceId = runtime.snapshot.workspaceId
      const result = await request({ workspaceId, request: { endpoint: path, method, body } })
      if (workspaceId !== runtime.snapshot.workspaceId) throw new Error('工作区已切换，请刷新')
      return result
    }),
  )
  app.provide(billingTransportKey, {
    async request(method, path, body) {
      const workspaceId = runtime.snapshot.workspaceId
      const result = await request({
        workspaceId,
        request: { endpoint: path.replace('/api/client', ''), method, body },
      })
      if (workspaceId !== runtime.snapshot.workspaceId) throw new Error('工作区已切换，请刷新')
      return result
    },
    async openCheckout(url) {
      if (!desktop.openManagedCheckout) throw new Error('支付页面入口未接入')
      await desktop.openManagedCheckout({ workspaceId: runtime.snapshot.workspaceId, url })
    },
  })
}
const disposeSync =
  desktop.isElectron &&
  desktop.storeSyncPreview &&
  desktop.storeSyncApply &&
  desktop.storeSyncRollback &&
  desktop.storeSyncBackups
    ? installStoreSyncClient(
        createStoreSyncClient(
          (channel, envelope) => {
            if (channel === 'store-sync:preview') return desktop.storeSyncPreview!(envelope)
            if (channel === 'store-sync:apply') return desktop.storeSyncApply!(envelope)
            if (channel === 'store-sync:rollback') return desktop.storeSyncRollback!(envelope)
            return desktop.storeSyncBackups!(envelope)
          },
          () => runtime.snapshot.workspaceId,
        ),
      )
    : () => {}
runtime.start()

// 有界错误缓冲供故障定位和冒烟断言使用，避免长时间运行无限增长。
app.config.errorHandler = (error, instance, info) => {
  const err = error instanceof Error ? error : new Error(String(error))
  const errors = (window.__vueErrors ??= [])
  errors.push({
    message: err.message,
    component: instance?.$options.name ?? 'unknown',
    info,
    stack: err.stack ?? '',
  })
  if (errors.length > 50) errors.shift()
  console.error(err)
}
app.mount('#app')

if (import.meta.hot)
  import.meta.hot.dispose(() => {
    disposeDrag()
    disposeSync()
    disposeImages()
    runtime.dispose()
    app.unmount()
  })

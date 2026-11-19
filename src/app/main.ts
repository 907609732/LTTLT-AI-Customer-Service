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
import { installKnowledgeNavigation } from './knowledge-navigation'
import { createTeamService, teamServiceKey } from '@/modules/account'
import { billingTransportKey } from '@/modules/billing'
import { platformLearningTransportKey } from '@/modules/knowledge'
import { platformOrderTransportKey } from '@/modules/shops'
import { unwrapManagedBusinessResponse } from '@/shared/platform/managed-business'
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
const disposeKnowledgeNavigation = installKnowledgeNavigation(
  desktop.knowledge,
  router,
  runtime,
  (message) => {
    runtime.error = message
  },
)
if (desktop.isElectron && desktop.platformLearning)
  app.provide(platformLearningTransportKey, desktop.platformLearning)
if (desktop.isElectron && desktop.platformOrderRequest)
  app.provide(platformOrderTransportKey, { request: desktop.platformOrderRequest })
if (desktop.isElectron && desktop.managedBusinessRequest) {
  const request = desktop.managedBusinessRequest
  app.provide(
    teamServiceKey,
    createTeamService(async ({ path, method, body }) => {
      const workspaceId = runtime.snapshot.workspaceId
      const result = await request({ workspaceId, request: { endpoint: path, method, body } })
      if (workspaceId !== runtime.snapshot.workspaceId) throw new Error('工作区已切换，请刷新')
      return unwrapManagedBusinessResponse(result)
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
      return unwrapManagedBusinessResponse(result)
    },
    async openCheckout(url) {
      if (!desktop.openManagedCheckout) throw new Error('支付页面入口未接入')
      await desktop.openManagedCheckout({ workspaceId: runtime.snapshot.workspaceId, url })
    },
  })
}
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
    disposeImages()
    runtime.dispose()
    disposeKnowledgeNavigation()
    app.unmount()
  })

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
import '../styles/index.css'

const disposeDrag = installWindowDrag()
const disposeImages = installImageFallback()
const app = createApp(App)
app.use(createPinia())
app.use(ElementPlus, { locale: zhCn })
app.use(router)
provideServices(app)
const runtime = useRuntimeStore()
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
    app.unmount()
  })

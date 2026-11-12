import type { App } from 'vue'
import { servicesKey, type AppServices, type Capability } from '@/shared/contracts/services'
import { useRuntimeStore } from '@/shared/state/runtime'

const unavailable = (): Capability => ({ status: 'unavailable', reason: '真实业务服务暂未接入' })

/** 创建新的演示服务实例，避免窗口、测试和应用实例共享可变数据。 */
export function createDemoServices(): AppServices {
  return {
    account: {
      getSummary: () => ({ displayName: '本地演示', authenticated: false }),
      login: unavailable(),
    },
    shops: { list: () => ({ rows: [], total: 0, page: 1, pageSize: 20 }), connect: unavailable() },
    workbench: {
      getWelcome: () => ({
        title: '添加店铺，开始 AI 接待',
        desc: '接入店铺后即可聚合消息、智能辅助值守',
        mode: 'empty',
        offline: 0,
      }),
    },
    reception: { save: unavailable() },
    knowledge: { train: unavailable() },
    quality: { submit: unavailable() },
    billing: { pay: unavailable() },
    settings: { sync: unavailable() },
    auxiliary: { reply: unavailable() },
  }
}

export function provideServices(app: App, services?: AppServices): void {
  if (services) {
    app.provide(servicesKey, services)
    return
  }
  const runtime = useRuntimeStore()
  const local = createDemoServices()
  local.account.getSummary = () => ({ displayName: '本机自带密钥模式', authenticated: false })
  local.shops.list = () => ({
    rows: runtime.snapshot.stores.map((shop) => ({
      id: shop.id,
      name: shop.storeName,
      platform: shop.platform,
    })),
    total: runtime.snapshot.stores.length,
    page: 1,
    pageSize: 100,
  })
  local.workbench.getWelcome = () => {
    const total = runtime.snapshot.stores.length,
      online = runtime.snapshot.stores.filter((shop) => shop.runtime.online).length
    return total
      ? {
          title: `本机已添加 ${total} 家店铺`,
          desc: `${online} 家已连接，AI 接待由你逐店开启`,
          mode: 'ready',
          offline: total - online,
        }
      : {
          title: '添加店铺，开始 AI 接待',
          desc: '先配置自己的模型密钥，再打开店铺完成平台登录',
          mode: 'empty',
          offline: 0,
        }
  }
  app.provide(servicesKey, local)
}

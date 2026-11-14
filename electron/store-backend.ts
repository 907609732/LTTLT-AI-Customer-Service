import type { BackendResult } from '../src/shared/contracts/backend'
import type { AssistPlatform } from './assist-platform-host'

/** 店铺后台入口只接受本工作区店铺标识，不接受渲染层提供的网址或登录分区。 */
export function createStoreBackendOpener(options: {
  assertActive(): void
  getStore(id: string): { id: string; platform: string } | undefined
  open(store: { id: string; platform: AssistPlatform }): Promise<void>
  close(storeId: string): void
}) {
  return async (storeId?: string): Promise<BackendResult> => {
    options.assertActive()
    const store = storeId ? options.getStore(storeId) : undefined
    if (!store) throw Error('店铺不存在或已移除')
    if (store.platform !== 'pdd-web' && store.platform !== 'doudian-client')
      throw Error('此平台尚未接入店铺后台')
    const platform = store.platform
    await options.open({ id: store.id, platform })
    try {
      options.assertActive()
      if (options.getStore(store.id)?.platform !== platform) throw Error('店铺已移除或平台已改变')
    } catch (error) {
      options.close(store.id)
      throw error
    }
    return {
      status: 'ok',
      message:
        platform === 'doudian-client'
          ? '抖店后台已打开；后台使用独立登录，请核对店铺身份。'
          : '店铺后台已打开，请核对店铺身份；如登录已过期，请重新登录。',
      data: {},
    }
  }
}

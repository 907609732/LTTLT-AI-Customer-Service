import { watch } from 'vue'
import type { RouteLocationNormalizedLoaded, Router } from 'vue-router'
import type { useRuntimeStore } from '@/shared/state/runtime'

/** A validated auxiliary handoff is consumed once after this window's initial snapshot arrives. */
export function useAssistLocation(
  route: RouteLocationNormalizedLoaded,
  router: Router,
  runtime: ReturnType<typeof useRuntimeStore>,
  report: (message: string) => void,
) {
  let consuming = false
  watch(
    [
      () => route.path,
      () => route.query.assistStore,
      () => route.query.assistWorkspace,
      () => runtime.snapshot.workspaceId,
      () => runtime.loading,
      () => runtime.snapshot.stores,
    ],
    async () => {
      if (consuming || route.path !== '/' || !('assistStore' in route.query)) return
      if (!runtime.snapshot.workspaceId || runtime.loading) return
      consuming = true
      const storeId = route.query.assistStore
      const workspaceId = route.query.assistWorkspace
      const query = { ...route.query }
      delete query.assistStore
      delete query.assistWorkspace
      try {
        if (typeof workspaceId !== 'string' || workspaceId !== runtime.snapshot.workspaceId) {
          report('工作区已切换，已取消旧会话定位')
        } else {
          const store =
            typeof storeId === 'string'
              ? runtime.snapshot.stores.find((row) => row.id === storeId)
              : undefined
          if (!store?.runtime.open || !store.runtime.online)
            report('定位店铺已离线，请重新登录或重试')
          else {
            runtime.selectedStoreId = store.id
            runtime.platformStoreId = store.id
          }
        }
        await router.replace({ path: route.path, query, hash: route.hash })
      } catch (cause) {
        report(cause instanceof Error ? cause.message : '无法显示平台会话')
      } finally {
        consuming = false
      }
    },
    { immediate: true },
  )
}

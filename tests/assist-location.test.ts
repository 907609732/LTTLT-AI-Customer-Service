import { afterEach, expect, it } from 'vitest'
import { defineComponent } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter, useRoute, useRouter } from 'vue-router'
import { useAssistLocation } from '../src/app/use-assist-location'
import { useRuntimeStore } from '../src/shared/state/runtime'

const wrappers: ReturnType<typeof mount>[] = []
afterEach(() => {
  for (const wrapper of wrappers.splice(0)) wrapper.unmount()
})
async function fixture(queryWorkspace = 'workspace-b') {
  setActivePinia(createPinia())
  const runtime = useRuntimeStore()
  const errors: string[] = []
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/', component: { template: '<div />' } }],
  })
  await router.push({
    path: '/',
    query: { assistStore: 'store-b', assistWorkspace: queryWorkspace, keep: 'preserved' },
  })
  const wrapper = mount(
    defineComponent({
      setup() {
        useAssistLocation(useRoute(), useRouter(), runtime, (message) => errors.push(message))
        return {}
      },
      template: '<div />',
    }),
    { global: { plugins: [router] } },
  )
  wrappers.push(wrapper)
  return { runtime, router, errors }
}
it('等待真实快照后选中正确平台，消费query一次，不覆盖后续用户切店', async () => {
  const { runtime, router, errors } = await fixture()
  await flushPromises()
  expect(runtime.platformStoreId).toBe('')
  runtime.loading = true
  runtime.snapshot.workspaceId = 'workspace-b'
  runtime.snapshot.stores = ['store-a', 'store-b'].map((id) => ({
    id,
    storeName: id,
    platform: 'pdd-web',
    group: '',
    aiEnabled: false,
    runtime: { open: true, online: true },
  }))
  await flushPromises()
  expect(runtime.platformStoreId).toBe('')
  runtime.loading = false
  await flushPromises()
  expect(runtime.platformStoreId).toBe('store-b')
  expect(runtime.selectedStoreId).toBe('store-b')
  expect(router.currentRoute.value.query).toEqual({ keep: 'preserved' })
  runtime.platformStoreId = 'store-a'
  runtime.snapshot.stores = [...runtime.snapshot.stores]
  await flushPromises()
  expect(runtime.platformStoreId).toBe('store-a')
  expect(errors).toEqual([])
})
it('旧workspace和离线店铺不能让平台视图重新显示', async () => {
  const { runtime, router, errors } = await fixture('old-workspace')
  runtime.snapshot.workspaceId = 'workspace-b'
  runtime.snapshot.stores = [
    {
      id: 'store-b',
      storeName: '测试店',
      platform: 'pdd-web',
      group: '',
      aiEnabled: false,
      runtime: { open: true, online: true },
    },
  ]
  await flushPromises()
  expect(runtime.platformStoreId).toBe('')
  expect(errors[0]).toContain('工作区已切换')
  runtime.snapshot.stores[0].runtime.online = false
  await router.push({
    path: '/',
    query: { assistStore: 'store-b', assistWorkspace: 'workspace-b' },
  })
  await flushPromises()
  expect(runtime.platformStoreId).toBe('')
  expect(errors.at(-1)).toContain('离线')
  expect(router.currentRoute.value.query).toEqual({})
})

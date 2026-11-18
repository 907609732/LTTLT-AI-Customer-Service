import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia, type Pinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import ElementPlus from 'element-plus'
import ShopManageView from '../src/app/layouts/ShopManageView.vue'
import { useRuntimeStore } from '../src/shared/state/runtime'

const knowledge = vi.hoisted(() => ({ open: vi.fn(async () => {}) }))
vi.mock('../src/modules/knowledge/manager-service', () => ({
  openKnowledgeManager: knowledge.open,
  createKnowledgeClient: vi.fn(),
}))

const wrappers: ReturnType<typeof mount>[] = []
let pinia: Pinia
beforeEach(() => {
  pinia = createPinia()
  setActivePinia(pinia)
  knowledge.open.mockClear()
  const runtime = useRuntimeStore()
  runtime.snapshot.workspaceId = 'w'
  runtime.snapshot.stores = [
    {
      id: 'shop-a',
      storeName: '店铺A',
      platform: 'pdd-web',
      group: '',
      aiEnabled: false,
      runtime: { open: false, online: false },
    },
  ]
  runtime.selectedStoreId = 'shop-a'
})
afterEach(() => {
  for (const wrapper of wrappers.splice(0)) wrapper.unmount()
  document.body.innerHTML = ''
})

async function openLegacy(panel: string) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: { template: '<div />' } },
      { path: '/shop/manage', component: { template: '<div />' } },
    ],
  })
  await router.push(`/shop/manage?panel=${panel}`)
  const wrapper = mount(ShopManageView, {
    global: {
      plugins: [pinia, router, ElementPlus],
      stubs: { ShopsListPanel: true },
    },
  })
  wrappers.push(wrapper)
  await flushPromises()
  return { wrapper, router }
}

describe('legacy training route compatibility', () => {
  it.each(['training', 'sim'])(
    'opens the knowledge training tab for ?panel=%s without keeping the old panel',
    async (panel) => {
      const { router } = await openLegacy(panel)
      expect(knowledge.open).toHaveBeenCalledWith('shop-a', { tab: 'training' })
      expect(router.currentRoute.value.query.panel).toBe('shops')
    },
  )
})

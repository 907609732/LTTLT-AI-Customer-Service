import { expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createRouter, createMemoryHistory } from 'vue-router'
import ShopsListPanel from '../src/modules/shops/components/ShopsListPanel.vue'
import { useRuntimeStore } from '../src/shared/state/runtime'
import { ElMessageBox } from 'element-plus'

async function fixture() {
  setActivePinia(createPinia())
  const runtime = useRuntimeStore()
  runtime.available = true
  runtime.snapshot.stores = Array.from({ length: 12 }, (_, n) => ({
    id: `s${n}`,
    storeName: `店铺${n}`,
    platform: n ? 'qianniu' : 'pdd-web',
    group: n ? '其他' : '服饰',
    aiEnabled: false,
    runtime: { open: true, online: n === 0, authenticated: n === 0 },
  }))
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/shop/manage', component: { template: '<div />' } },
      { path: '/', component: { template: '<div />' } },
    ],
  })
  await router.push('/shop/manage?panel=shops')
  const wrapper = mount(ShopsListPanel, {
    global: { plugins: [router], stubs: { AddShopDialog: true } },
  })
  return { runtime, router, wrapper }
}
it('真实店铺分页、筛选交集及空态；翻页后筛选回第一页', async () => {
  const { wrapper } = await fixture()
  expect(wrapper.findAll('.shop-card')).toHaveLength(10)
  await wrapper.get('[aria-label="下一页"]').trigger('click')
  expect(wrapper.findAll('.shop-card')).toHaveLength(2)
  await wrapper.get('[aria-label="搜索店铺"]').setValue('店铺0')
  expect(wrapper.findAll('.shop-card')).toHaveLength(1)
  await wrapper.get('[aria-label="平台筛选"]').setValue('qianniu')
  expect(wrapper.text()).toContain('没有符合筛选条件的店铺')
  wrapper.unmount()
})
it('单店配置和商品导航使用点击店铺，不沿用上一家', async () => {
  const { wrapper, router, runtime } = await fixture()
  await wrapper.get('[data-store="s1"] [data-panel="welcome"]').trigger('click')
  await flushPromises()
  expect(runtime.selectedStoreId).toBe('s1')
  expect(router.currentRoute.value.query.panel).toBe('welcome')
  await wrapper.get('[data-store="s0"] [data-panel="goods"]').trigger('click')
  await flushPromises()
  expect(runtime.selectedStoreId).toBe('s0')
  expect(router.currentRoute.value.query.panel).toBe('goods')
  wrapper.unmount()
})
it('分组保存失败显示错误，不伪造保存成功', async () => {
  const { wrapper, runtime } = await fixture()
  const run = vi.spyOn(runtime, 'run').mockRejectedValue(new Error('保存失败'))
  await wrapper.get('[data-store="s0"] input').setValue('新分组')
  await wrapper.get('[data-store="s0"] input').trigger('change')
  await flushPromises()
  expect(run).toHaveBeenCalledWith({
    action: 'set-store-group',
    storeId: 's0',
    values: { group: '新分组' },
  })
  expect(wrapper.text()).toContain('保存失败')
  expect(runtime.snapshot.stores[0]?.group).toBe('服饰')
  wrapper.unmount()
})

it('登录未知与未登录分开，状态筛选不以连接状态冒充认证', async () => {
  const { wrapper, runtime } = await fixture()
  runtime.snapshot.stores[1]!.runtime.authenticated = null
  runtime.snapshot.stores[1]!.runtime.online = true
  await wrapper.get('[aria-label="登录状态筛选"]').setValue('unknown')
  expect(wrapper.findAll('.shop-card')).toHaveLength(1)
  expect(wrapper.text()).toContain('登录待确认')
  await wrapper.get('[aria-label="登录状态筛选"]').setValue('yes')
  expect(wrapper.findAll('.shop-card')).toHaveLength(1)
  expect(wrapper.get('.shop-card').attributes('data-store')).toBe('s0')
  wrapper.unmount()
})

it('连接过程中工作区改变，不把旧店铺写入新工作区或跳走', async () => {
  const { wrapper, runtime, router } = await fixture()
  vi.spyOn(runtime, 'run').mockImplementation(async () => {
    runtime.snapshot.workspaceId = 'new-workspace'
    runtime.snapshot.stores = []
    return { status: 'ok', message: '', data: {} }
  })
  await wrapper.get('[data-store="s0"] .knowledge-col button:last-child').trigger('click')
  await flushPromises()
  expect(runtime.platformStoreId).toBe('')
  expect(router.currentRoute.value.query.panel).toBe('shops')
  wrapper.unmount()
})

it('取消移除不执行命令，刷新失败在页面可见', async () => {
  const { wrapper, runtime } = await fixture()
  const run = vi.spyOn(runtime, 'run')
  vi.spyOn(ElMessageBox, 'confirm').mockRejectedValue('cancel')
  await wrapper.get('.shop-card__del').trigger('click')
  await flushPromises()
  expect(run).not.toHaveBeenCalled()
  vi.spyOn(runtime, 'refresh').mockImplementation(async () => {
    runtime.error = '快照读取失败'
  })
  await wrapper.get('.btn--ghost').trigger('click')
  await flushPromises()
  expect(wrapper.get('[role="alert"]').text()).toContain('快照读取失败')
  wrapper.unmount()
})

it('同步他店进入真实同步面板并绑定当前店铺，不显示占位提示', async () => {
  const { wrapper, router, runtime } = await fixture()
  await wrapper.get('[data-store="s1"] button[title="预览并确认跨店同步"]').trigger('click')
  await flushPromises()
  expect(runtime.selectedStoreId).toBe('s1')
  expect(router.currentRoute.value.query.panel).toBe('sync')
  expect(wrapper.text()).not.toContain('平台自动学习、跨店同步未接入')
  wrapper.unmount()
})

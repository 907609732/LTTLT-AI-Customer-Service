import { afterEach, describe, expect, it } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import ElementPlus from 'element-plus'
import { useRuntimeStore } from '../src/shared/state/runtime'
import PlatformOrderPanel from '../src/modules/shops/components/PlatformOrderPanel.vue'
import { platformOrderTransportKey } from '../src/modules/shops/platform-orders'
import { emptySnapshot } from '../src/shared/contracts/backend'
const wrappers: ReturnType<typeof mount>[] = []
afterEach(() => {
  for (const wrapper of wrappers.splice(0)) wrapper.unmount()
})
function setup(request?: (input: unknown) => Promise<unknown>) {
  const pinia = createPinia()
  setActivePinia(pinia)
  const runtime = useRuntimeStore()
  runtime.snapshot = {
    ...emptySnapshot(),
    workspaceId: '299929d3-1fba-4907-bffa-1dfcd21217dc',
    stores: [
      {
        id: 'store-a',
        storeName: '测试店铺',
        platform: 'pdd-web',
        group: '',
        aiEnabled: false,
        runtime: { open: false, online: false },
      },
    ],
  }
  const wrapper = mount(PlatformOrderPanel, {
    global: {
      plugins: [pinia, ElementPlus],
      provide: request ? { [platformOrderTransportKey as symbol]: { request } } : {},
    },
  })
  wrappers.push(wrapper)
  return { wrapper, runtime }
}
describe('平台订单页真实状态', () => {
  it('保留明确返回动作，未连接不能显示完整零订单', async () => {
    const { wrapper } = setup()
    expect(wrapper.text()).toContain('尚未连接')
    expect(wrapper.text()).not.toContain('所选范围采集完整')
    await wrapper.get('[data-order-back]').trigger('click')
    expect(wrapper.emitted('back')).toHaveLength(1)
  })
  it('服务失败显示失败，不以0元或0订单冒充成功', async () => {
    const { wrapper } = setup(async () => {
      throw Error('平台登录失效')
    })
    await flushPromises()
    expect(wrapper.text()).toContain('平台登录失效')
    expect(wrapper.text()).toContain('尚未读取')
    expect(wrapper.text()).not.toContain('所选范围采集完整')
  })
})

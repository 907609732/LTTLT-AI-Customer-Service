import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import ElementPlus from 'element-plus'
import ShopOpsPanel from '../src/modules/reception/components/ShopOpsPanel.vue'
import { useRuntimeStore } from '../src/shared/state/runtime'
import { emptySnapshot } from '../src/shared/contracts/backend'

vi.mock('../src/shared/platform/desktop', () => ({ getDesktop: () => ({ isElectron: false }) }))
vi.mock('vue-router', () => ({ useRouter: () => ({ push: vi.fn() }) }))

describe('ShopOpsPanel', () => {
  it('preserves the draft and requires explicit reload after an external settings update', async () => {
    setActivePinia(createPinia())
    const runtime = useRuntimeStore()
    runtime.snapshot = {
      ...emptySnapshot(),
      workspaceId: 'workspace-a',
      stores: [
        {
          id: 'store-a',
          platform: 'sim-local',
          storeName: '测试店铺',
          group: '',
          aiEnabled: false,
          runtime: { open: false, online: false },
        },
      ],
      selection: { storeId: 'store-a', conversationId: '' },
      capabilities: {
        ...emptySnapshot().capabilities,
        vision: {
          supported: true,
          model: 'fixture-custom-multimodal',
          maxImages: 4,
          reason: '图片识别使用模型设置中当前配置的模型，不限制模型名称。',
        },
      },
      visionByStore: { 'store-a': { enabled: false, version: 0 } },
    }
    const wrapper = mount(ShopOpsPanel, {
      props: { viewKey: 'image' },
      global: { plugins: [ElementPlus] },
    })
    expect(wrapper.find('.el-switch').classes()).not.toContain('is-checked')

    runtime.snapshot = {
      ...runtime.snapshot,
      revision: runtime.snapshot.revision + 1,
      visionByStore: { 'store-a': { enabled: true, version: 1 } },
    }
    await nextTick()

    expect(wrapper.text()).toContain('识图配置已更新')
    expect(wrapper.find('.el-switch').classes()).not.toContain('is-checked')
    const reload = wrapper.findAll('button').find((button) => button.text() === '载入最新配置')!
    await reload.trigger('click')
    expect(wrapper.text()).not.toContain('识图配置已更新')
    expect(wrapper.find('.el-switch').classes()).toContain('is-checked')
    wrapper.unmount()
  })
})

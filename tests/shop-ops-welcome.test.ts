import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import ElementPlus, { ElInputNumber } from 'element-plus'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import ShopOpsPanel from '../src/modules/reception/components/ShopOpsPanel.vue'
import { useRuntimeStore } from '../src/shared/state/runtime'
import { emptySnapshot, type BackendSnapshot } from '../src/shared/contracts/backend'

const bridge = vi.hoisted(() => ({ snapshot: vi.fn(), execute: vi.fn(), subscribe: vi.fn() }))
vi.mock('../src/shared/platform/backend', () => ({ getBackendBridge: () => bridge }))
vi.mock('../src/shared/platform/desktop', () => ({ getDesktop: () => ({ isElectron: false }) }))
vi.mock('vue-router', () => ({ useRouter: () => ({ push: vi.fn() }) }))

let snapshot: BackendSnapshot
function baseSnapshot() {
  const value = emptySnapshot()
  value.workspaceId = 'workspace-welcome'
  value.stores = [
    {
      id: 'store-a',
      platform: 'sim-local',
      storeName: '欢迎测试店',
      group: '',
      aiEnabled: false,
      runtime: { open: true, online: true },
    },
  ]
  value.selection = { storeId: 'store-a', conversationId: '' }
  value.welcomeByStore = {
    'store-a': {
      text: '欢迎光临',
      enabled: true,
      version: 2,
      delayMinSeconds: 1,
      delayMaxSeconds: 3,
    },
  }
  return value
}
beforeEach(async () => {
  setActivePinia(createPinia())
  snapshot = baseSnapshot()
  bridge.snapshot.mockReset()
  bridge.execute.mockReset()
  bridge.snapshot.mockImplementation(async () => structuredClone(snapshot))
  bridge.execute.mockReset()
  bridge.execute.mockImplementation(
    async (command: { action: string; values: Record<string, unknown> }) => {
      if (command.action === 'save-welcome') {
        const old = snapshot.welcomeByStore['store-a']
        snapshot.welcomeByStore['store-a'] = {
          text: String(command.values.text),
          enabled: Boolean(command.values.enabled),
          version: (old?.version ?? 0) + 1,
          delayMinSeconds: Number(command.values.delayMinSeconds),
          delayMaxSeconds: Number(command.values.delayMaxSeconds),
        }
      }
      return { status: 'ok', message: '已保存', data: {} }
    },
  )
  await useRuntimeStore().refresh()
})
const options = { global: { plugins: [ElementPlus] }, props: { viewKey: 'welcome' } }

describe('进店欢迎设置界面', () => {
  it('标题右侧启用开关、无冗余说明，文字与延迟只有一个保存动作', async () => {
    const wrapper = mount(ShopOpsPanel, options)
    await flushPromises()
    expect(wrapper.get('h1').text()).toBe('进店欢迎')
    const toggle = wrapper.get('.welcome-toggle')
    expect(toggle.attributes('data-no-drag')).toBeDefined()
    expect(toggle.get('.el-switch').classes()).toContain('is-checked')
    expect(toggle.text()).toContain('启用')
    expect(toggle.find('input[aria-label="启用本店新会话欢迎"]').exists()).toBe(true)
    expect(wrapper.text()).not.toContain('此配置在新会话首次 AI')
    expect(wrapper.text()).not.toContain('配置独立保存')
    const range = wrapper.findAllComponents(ElInputNumber)
    expect(range).toHaveLength(2)
    expect(range[0]!.props('modelValue')).toBe(1)
    expect(range[1]!.props('modelValue')).toBe(3)
    expect(wrapper.text()).toContain('欢迎延迟')
    expect(wrapper.text()).toContain('秒随机')
    const submit = wrapper.get('button[type="submit"]')
    expect(submit.text()).toBe('保存配置')
    expect(wrapper.findAll('button').some((button) => button.text() === '载入最新配置')).toBe(false)
    wrapper.unmount()
  })

  it('默认缺失延迟字段的旧记录按 1～3 秒显示，保存不会带运行时 enabledAt', async () => {
    snapshot.welcomeByStore = {
      'store-a': { text: '旧欢迎', enabled: true, version: 2 },
    }
    await useRuntimeStore().refresh()
    const wrapper = mount(ShopOpsPanel, options)
    await flushPromises()
    const range = wrapper.findAllComponents(ElInputNumber)
    expect(range[0]!.props('modelValue')).toBe(1)
    expect(range[1]!.props('modelValue')).toBe(3)
    await wrapper.get('textarea').setValue('新的欢迎语')
    await wrapper.findAllComponents(ElInputNumber)[1]!.vm.$emit('update:modelValue', 9)
    await nextTick()
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(bridge.execute).toHaveBeenCalledTimes(1)
    expect(bridge.execute.mock.calls[0]?.[0]).toMatchObject({
      action: 'save-welcome',
      storeId: 'store-a',
      values: {
        text: '新的欢迎语',
        enabled: true,
        version: 2,
        delayMinSeconds: 1,
        delayMaxSeconds: 9,
      },
    })
    expect(bridge.execute.mock.calls[0]?.[0].values).not.toHaveProperty('enabledAt')
    wrapper.unmount()
  })

  it('回车提交时下限大于上限不保存，修正后保存同一份文字、开关和范围', async () => {
    const wrapper = mount(ShopOpsPanel, options)
    await flushPromises()
    await wrapper.get('textarea').setValue('合并保存的欢迎语')
    await wrapper.findAllComponents(ElInputNumber)[0]!.vm.$emit('update:modelValue', 9)
    await wrapper.findAllComponents(ElInputNumber)[1]!.vm.$emit('update:modelValue', 2)
    await nextTick()
    expect(wrapper.get('button[type="submit"]').attributes('disabled')).toBeDefined()
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(bridge.execute).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('下限')
    await wrapper.findAllComponents(ElInputNumber)[0]!.vm.$emit('update:modelValue', 5)
    await wrapper.findAllComponents(ElInputNumber)[1]!.vm.$emit('update:modelValue', 9)
    await nextTick()
    expect(wrapper.get('button[type="submit"]').attributes('disabled')).toBeUndefined()
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(bridge.execute).toHaveBeenCalledTimes(1)
    expect(bridge.execute.mock.calls[0]?.[0].values).toMatchObject({
      text: '合并保存的欢迎语',
      enabled: true,
      delayMinSeconds: 5,
      delayMaxSeconds: 9,
    })
    wrapper.unmount()
  })

  it('外部更新时保留草稿并只显示重新载入，点击后才覆盖草稿', async () => {
    const wrapper = mount(ShopOpsPanel, options)
    await flushPromises()
    await wrapper.get('textarea').setValue('尚未保存的草稿')
    snapshot.welcomeByStore['store-a'] = {
      text: '外部修改后的欢迎',
      enabled: false,
      version: 3,
      delayMinSeconds: 4,
      delayMaxSeconds: 8,
    }
    await useRuntimeStore().refresh()
    await nextTick()
    expect(wrapper.text()).toContain('配置已更新')
    expect(wrapper.get('textarea').element.value).toBe('尚未保存的草稿')
    expect(wrapper.get('button[type="submit"]').attributes('disabled')).toBeDefined()
    const reload = wrapper.findAll('button').find((button) => button.text() === '重新载入')!
    expect(reload).toBeTruthy()
    expect(wrapper.findAll('button').some((button) => button.text() === '载入最新配置')).toBe(false)
    await reload.trigger('click')
    await nextTick()
    expect(wrapper.get('textarea').element.value).toBe('外部修改后的欢迎')
    expect(wrapper.text()).not.toContain('配置已更新')
    wrapper.unmount()
  })
})

import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import ElementPlus from 'element-plus'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { emptySnapshot } from '../src/shared/contracts/backend'
import { useRuntimeStore } from '../src/shared/state/runtime'
import LearningReview from '../src/modules/knowledge/components/LearningReview.vue'
import ShopKbPanel from '../src/modules/knowledge/components/ShopKbPanel.vue'
import ShopIntentLearnPanel from '../src/modules/knowledge/components/ShopIntentLearnPanel.vue'
import ShopIntentPanel from '../src/modules/knowledge/components/ShopIntentPanel.vue'
import { candidatePack } from '../src/modules/knowledge/learning'
import type { LearningCandidate } from '../src/modules/knowledge/learning'
const bridge = vi.hoisted(() => ({ snapshot: vi.fn(), execute: vi.fn(), subscribe: vi.fn() }))
vi.mock('../src/shared/platform/backend', () => ({ getBackendBridge: () => bridge }))
const row: LearningCandidate = {
  question: '发货？',
  answer: '48小时',
  productIds: [],
  source: { kind: 'document', storeId: 's', label: '发货政策', line: 1 },
}
beforeEach(async () => {
  setActivePinia(createPinia())
  const snapshot = emptySnapshot()
  snapshot.workspaceId = '00000000-0000-4000-8000-000000000001'
  snapshot.stores = [
    {
      id: 's',
      storeName: '测试店',
      platform: 'sim-local',
      group: '',
      aiEnabled: false,
      runtime: { open: false, online: false },
    },
  ]
  bridge.snapshot.mockResolvedValue(snapshot)
  bridge.execute.mockResolvedValue({ data: { packs: [], revision: 0 }, message: '' })
  bridge.execute.mockClear()
  await useRuntimeStore().refresh()
})
const options = { global: { plugins: [ElementPlus] } }
describe('knowledge learning review UI', () => {
  it('requires preview and checkbox, invalidates confirmation after editing, and saves once', async () => {
    const wrapper = mount(LearningReview, { ...options, props: { candidates: [row] } })
    await wrapper.get('.runtime-entry').trigger('click')
    expect(wrapper.get('button[type="submit"]').attributes('disabled')).toBeDefined()
    await wrapper.get('input[type="checkbox"]').setValue(true)
    expect(wrapper.get('button[type="submit"]').attributes('disabled')).toBeUndefined()
    await wrapper.findAll('textarea')[1]!.setValue('审核后的答案')
    expect(wrapper.get('button[type="submit"]').attributes('disabled')).toBeDefined()
    await wrapper.get('input[type="checkbox"]').setValue(true)
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    const saved = bridge.execute.mock.calls.find(
      ([command]) => command.action === 'save-intent-pack',
    )?.[0]
    expect(saved.values.enabled).toBe(false)
    expect(saved.values.entries[0].answer).toBe('审核后的答案')
    expect(JSON.parse(saved.values.entries[1].answer).original.answer).toBe('48小时')
    expect(wrapper.text()).toContain('已保存为停用知识包')
    expect(wrapper.find('form').exists()).toBe(false)
    wrapper.unmount()
  })
  it('clears selected candidate when account workspace changes', async () => {
    const wrapper = mount(LearningReview, { ...options, props: { candidates: [row] } })
    await wrapper.get('.runtime-entry').trigger('click')
    useRuntimeStore().snapshot.workspaceId = 'different'
    await flushPromises()
    expect(wrapper.find('form').exists()).toBe(false)
    expect(bridge.execute).not.toHaveBeenCalled()
    wrapper.unmount()
  })
  it('preserves review across fresh same-workspace snapshots from real command refreshes', async () => {
    const wrapper = mount(LearningReview, { ...options, props: { candidates: [row] } })
    await wrapper.get('.runtime-entry').trigger('click')
    bridge.snapshot.mockImplementation(async () =>
      JSON.parse(JSON.stringify(useRuntimeStore().snapshot)),
    )
    await useRuntimeStore().refresh()
    await flushPromises()
    expect(wrapper.find('form').exists()).toBe(true)
    await wrapper.get('input[type="checkbox"]').setValue(true)
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(
      bridge.execute.mock.calls.some(([command]) => command.action === 'save-intent-pack'),
    ).toBe(true)
    expect(wrapper.text()).toContain('已保存为停用知识包')
    wrapper.unmount()
  })
  it('renders size and learning entry points without background commands', () => {
    for (const component of [ShopKbPanel, ShopIntentLearnPanel]) {
      const wrapper = mount(component, options)
      expect(wrapper.text()).toContain('预览')
      expect(bridge.execute).not.toHaveBeenCalled()
      wrapper.unmount()
    }
  })
  it('keeps source audit read-only and disabled while enabling a knowledge pack', async () => {
    const pack = { ...candidatePack(row), id: 'pack', version: 1 }
    bridge.execute.mockResolvedValue({ data: { packs: [pack], revision: 1 }, message: '' })
    const wrapper = mount(ShopIntentPanel, options)
    await flushPromises()
    await wrapper.get('.runtime-entry').trigger('click')
    expect(wrapper.get('pre').text()).toContain('lingtu-learning-v1')
    expect(wrapper.findAll('textarea')).toHaveLength(5)
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    const saved = bridge.execute.mock.calls.find(
      ([command]) => command.action === 'save-intent-pack',
    )?.[0]
    expect(saved.values.entries[1].enabled).toBe(false)
    expect(saved.values.entries[1].answer).toBe(pack.entries[1]!.answer)
    wrapper.unmount()
  })
})

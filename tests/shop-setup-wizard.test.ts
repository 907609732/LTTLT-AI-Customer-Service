import { afterEach, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { createPinia, setActivePinia } from 'pinia'
import ElementPlus from 'element-plus'
import ShopSetupGuide from '../src/modules/shops/components/ShopSetupGuide.vue'
import { useRuntimeStore } from '../src/shared/state/runtime'
import { useShopSetupStore } from '../src/modules/shops/setup-store'
import { profileSchema, type ModelProfile } from '../src/shared/contracts/backend'
const wrappers: ReturnType<typeof mount>[] = []
it('客服风格编辑并保存全局间隔，最少1秒且保留并发版本校验', async () => {
  const { wrapper, runtime } = await fixture()
  runtime.available = true
  const run = vi
    .spyOn(runtime, 'run')
    .mockResolvedValue({ status: 'ok', message: '已保存', data: {} })
  await wrapper.find('[data-start]').trigger('click')
  const pacing = wrapper.find('.reply-pacing')
  expect(pacing.exists()).toBe(true)
  const input = pacing.findComponent({ name: 'ElInputNumber' })
  expect(input.props('min')).toBe(1)
  expect(input.props('modelValue')).toBe(1)
  input.vm.$emit('update:modelValue', 2)
  input.vm.$emit('change', 2)
  await pacing.trigger('submit')
  await flushPromises()
  expect(run).toHaveBeenCalledWith({
    action: 'save-config',
    screenId: 'REPLY_PACING',
    values: { seconds: 2, expectedMs: 1000 },
  })
  expect(wrapper.text()).toContain('全局生效')
})
it('客服风格统一编辑自定义回复要求和字数上限，不触发真实请求', async () => {
  const { wrapper, setup, runtime } = await fixture()
  const run = vi.spyOn(runtime, 'run')
  await wrapper.find('[data-start]').trigger('click')
  await wrapper.get('textarea[aria-label="客服回复要求"]').setValue('请简洁回答，先说明兼容型号')
  expect(setup.draft.customPrompt).toBe('请简洁回答，先说明兼容型号')
  expect(wrapper.find('[aria-label="回复字数上限"]').exists()).toBe(true)
  expect(run).not.toHaveBeenCalled()
})

it('点击步骤直接修改并保留草稿，保存和载入期间禁止跳转', async () => {
  const { wrapper, setup, runtime } = await fixture()
  const run = vi.spyOn(runtime, 'run')
  const steps = wrapper.findAll('button.wizard-step')
  expect(steps).toHaveLength(6)
  expect(steps[5]!.attributes('disabled')).toBeDefined()
  await steps[2]!.trigger('click')
  expect(setup.step).toBe(2)
  setup.draft.origins = ['浙江']
  await steps[4]!.trigger('click')
  expect(setup.step).toBe(4)
  await steps[2]!.trigger('click')
  expect(setup.draft.origins).toEqual(['浙江'])
  for (const state of ['loading', 'saving'] as const) {
    setup[state] = true
    await flushPromises()
    await steps[1]!.trigger('click')
    expect(setup.step).toBe(2)
    setup[state] = false
  }
  setup.saved = true
  setup.step = 5
  await flushPromises()
  await steps[3]!.trigger('click')
  expect(setup.step).toBe(3)
  expect(setup.saved).toBe(false)
  expect(run).not.toHaveBeenCalled()
})
afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount())
  document.body.innerHTML = ''
})
async function fixture() {
  setActivePinia(createPinia())
  const runtime = useRuntimeStore()
  runtime.snapshot.workspaceId = 'wizard-workspace'
  runtime.snapshot.stores = [
    {
      id: 'shop-a',
      storeName: '测试店',
      platform: 'pdd-web',
      group: '',
      aiEnabled: false,
      runtime: { open: true, online: true },
    },
  ]
  runtime.snapshot.products.byStore['shop-a'] = 3
  const setup = useShopSetupStore()
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/', component: { template: '<div />' } }],
  })
  await router.push('/')
  setup.open('shop-a')
  const wrapper = mount(ShopSetupGuide, { global: { plugins: [ElementPlus, router] } })
  wrappers.push(wrapper)
  await flushPromises()
  return { wrapper, runtime, setup }
}
it('按参考图展示整页六步引导和真实商品数量，不伪造学习进度', async () => {
  const { wrapper, runtime } = await fixture()
  const run = vi.spyOn(runtime, 'run')
  expect(wrapper.find('.shop-setup-page').exists()).toBe(true)
  expect(wrapper.findAll('.wizard-step')).toHaveLength(6)
  expect(wrapper.find('[data-product-count]').text()).toBe('3')
  expect(wrapper.text()).not.toContain('正在后台学习')
  await wrapper.find('[data-start]').trigger('click')
  expect(wrapper.find('[data-style="practical"]').attributes('aria-checked')).toBe('true')
  await wrapper.find('[data-style="professional"]').trigger('click')
  expect(wrapper.find('.conversation-preview').text()).toContain('示例')
  expect(run).not.toHaveBeenCalled()
})
it('物流至少填发货地、快递和指定快递选择；前后步骤保留填写值', async () => {
  const { wrapper, setup } = await fixture()
  await wrapper.find('[data-start]').trigger('click')
  await wrapper.find('[data-next]').trigger('click')
  expect(setup.step).toBe(2)
  await wrapper.find('[data-next]').trigger('click')
  expect(setup.step).toBe(2)
  expect(wrapper.text()).toContain('请至少选择一个发货地')
  setup.draft.origins = ['浙江']
  setup.draft.carriers = ['圆通快递', '申通快递']
  setup.draft.designatedCourier = false
  await wrapper.find('[data-next]').trigger('click')
  expect(setup.step).toBe(3)
  await wrapper.find('[data-back]').trigger('click')
  expect(setup.draft.carriers).toEqual(['圆通快递', '申通快递'])
})
it('保存失败不显示完成，不开启AI', async () => {
  const { wrapper, setup, runtime } = await fixture()
  setup.step = 4
  vi.spyOn(setup, 'saveRules').mockImplementation(async () => {
    setup.error = '保存失败'
    return false
  })
  await flushPromises()
  await wrapper.find('[data-save]').trigger('click')
  await flushPromises()
  expect(setup.step).toBe(4)
  expect(wrapper.text()).toContain('保存失败')
  expect(runtime.snapshot.stores[0]?.aiEnabled).toBe(false)
})
it('载入期间工作区变化时，不回填旧店规则或保留旧加载状态', async () => {
  const { setup, runtime } = await fixture()
  let done!: (value: { status: 'ok'; message: string; data: Record<string, unknown> }) => void
  vi.spyOn(runtime, 'run').mockImplementation(
    () =>
      new Promise((resolve) => {
        done = resolve
      }),
  )
  const job = setup.loadRules()
  runtime.snapshot.workspaceId = 'new-workspace'
  done({
    status: 'ok',
    message: '',
    data: { revision: 0, profiles: [], bindings: {}, globalPrompt: '', globalMaxReplyChars: 200 },
  })
  await job
  expect(setup.storeId).toBe('')
  expect(setup.loading).toBe(false)
  expect(setup.loaded).toBe(false)
})
it('保存期间表单禁用，成功后摘要使用实际填写内容', async () => {
  const { wrapper, setup } = await fixture()
  setup.step = 4
  setup.saving = true
  await flushPromises()
  expect(wrapper.find('fieldset.wizard-fields').attributes('disabled')).toBeDefined()
  setup.saving = false
  setup.draft.origins = ['浙江']
  setup.draft.carriers = ['圆通快递']
  setup.draft.dispatchTime = '48小时内'
  vi.spyOn(setup, 'saveRules').mockImplementation(async () => {
    setup.saved = true
    return true
  })
  await flushPromises()
  await wrapper.find('[data-save]').trigger('click')
  await flushPromises()
  expect(setup.step).toBe(5)
  expect(wrapper.text()).toContain('48小时内')
  expect(wrapper.text()).toContain('圆通快递')
  await wrapper
    .findAll('button')
    .find((button) => button.text() === '重新修改')!
    .trigger('click')
  expect(setup.saved).toBe(false)
  setup.draft.style = 'gentle'
  setup.dismiss()
  setup.open('shop-a')
  expect(setup.draft.style).toBe('gentle')
})
it('稍后配置保留当前工作区临时草稿，工作区切换后清除', async () => {
  const { setup, runtime } = await fixture()
  setup.step = 2
  setup.draft.origins = ['浙江']
  setup.dismiss()
  setup.open('shop-a')
  expect(setup.step).toBe(2)
  expect(setup.draft.origins).toEqual(['浙江'])
  setup.dismiss()
  runtime.snapshot.workspaceId = 'new-workspace'
  setup.open('shop-a')
  expect(setup.draft.origins).toEqual([])
})
it('恢复草稿后保存成功，再次打开以已保存规则为准', async () => {
  const { setup, runtime } = await fixture()
  let revision = 0
  const profiles: ModelProfile[] = [],
    bindings: Record<string, string> = {}
  vi.spyOn(runtime, 'run').mockImplementation(async (command) => {
    if (command.action === 'list-model-profiles')
      return {
        status: 'ok',
        message: '',
        data: {
          revision,
          profiles: profiles.map((p) => ({ ...p })),
          bindings: { ...bindings },
          globalPrompt: '',
          globalMaxReplyChars: 200,
        },
      }
    if (command.action === 'save-model-profile') {
      const profile = profileSchema.parse({ id: 'profile-a', version: 1, ...command.values })
      profiles.push(profile)
      revision++
      return { status: 'ok', message: '', data: { ...profile } }
    }
    if (command.action === 'bind-model-profile') {
      bindings[command.storeId!] = String(command.values?.profileId)
      revision++
      return { status: 'ok', message: '', data: {} }
    }
    throw Error('非预期业务命令')
  })
  Object.assign(setup.draft, {
    origins: ['浙江'],
    carriers: ['圆通快递'],
    designatedCourier: false,
    dispatchTime: '24小时内',
    freightInsurance: false,
    exchangeSupported: false,
    returnSupported: false,
    cashbackSupported: false,
    compensationSupported: false,
  })
  setup.dismiss()
  setup.open('shop-a')
  await setup.loadRules()
  setup.draft.style = 'cool'
  expect(await setup.saveRules()).toBe(true)
  setup.dismiss()
  setup.open('shop-a')
  await setup.loadRules()
  expect(setup.draft.style).toBe('cool')
  expect(setup.step).toBe(0)
})

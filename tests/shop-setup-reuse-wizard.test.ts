import { afterEach, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { createPinia, setActivePinia } from 'pinia'
import ElementPlus from 'element-plus'
import ShopSetupGuide from '../src/modules/shops/components/ShopSetupGuide.vue'
import { useRuntimeStore } from '../src/shared/state/runtime'
import { useShopSetupStore } from '../src/modules/shops/setup-store'
import {
  createBlankSetupDraft,
  createSetupRules,
  type SetupDraft,
} from '../src/modules/shops/setup-rules'
import {
  profileSchema,
  type CommandInput,
  type ModelProfile,
} from '../src/shared/contracts/backend'

const wrappers: ReturnType<typeof mount>[] = []
interface ProfilesState {
  revision: number
  profiles: ModelProfile[]
  bindings: Record<string, string>
  globalPrompt: string
  globalMaxReplyChars: number
}
function profileCommand(state: ProfilesState, command: CommandInput): unknown {
  if (command.action === 'list-model-profiles') return structuredClone(state)
  if (command.action === 'save-model-profile') {
    const saved = profileSchema.parse({
      id: `profile-${state.profiles.length + 1}`,
      version: 1,
      ...command.values,
    })
    state.profiles.push(saved)
    state.revision++
    return { ...saved }
  }
  if (command.action === 'bind-model-profile') {
    state.bindings[command.storeId!] = String(command.values?.profileId)
    state.revision++
    return {}
  }
  throw Error('非预期模型规则命令')
}
function sourceValues(): SetupDraft {
  return Object.assign(createBlankSetupDraft(), {
    style: 'cool',
    length: 'short',
    maxReplyChars: 321,
    origins: ['广东'],
    carriers: ['顺丰速运'],
    designatedCourier: false,
    dispatchTime: '48小时内',
    freightInsurance: true,
    insuranceExcessPayer: 'buyer',
    exchangeSupported: false,
    returnSupported: false,
    cashbackSupported: false,
    compensationSupported: false,
    warrantyPolicy: '来源保修',
  })
}
async function seedSource(state: ProfilesState, storeId: string) {
  const service = createSetupRules({
    execute: async (command) => ({ data: profileCommand(state, command) }),
    assertCurrent: () => {},
  })
  const draft = await service.load(storeId)
  Object.assign(draft, sourceValues())
  await service.save(storeId, draft)
}
function shop(id: string, storeName: string, platform: string) {
  return {
    id,
    storeName,
    platform,
    group: '',
    aiEnabled: false,
    runtime: { open: true, online: true },
  }
}
async function fixture(
  options: { withSource?: boolean; failWelcome?: boolean; sourceConfigured?: boolean } = {},
) {
  setActivePinia(createPinia())
  const runtime = useRuntimeStore()
  runtime.snapshot.workspaceId = 'reuse-workspace'
  runtime.snapshot.stores = [shop('shop-a', '当前店铺', 'pdd-web')]
  if (options.withSource !== false)
    runtime.snapshot.stores.push(shop('shop-b', '来源店铺', 'doudian-client'))
  runtime.snapshot.welcomeByStore = {
    'shop-a': { text: '本店欢迎', enabled: false, version: 3 },
  }
  runtime.snapshot.handoffByStore = { 'shop-a': { keywords: ['本店人工'] } }
  const state: ProfilesState = {
    revision: 0,
    profiles: [],
    bindings: {},
    globalPrompt: '',
    globalMaxReplyChars: 200,
  }
  if (options.withSource !== false && options.sourceConfigured !== false) {
    await seedSource(state, 'shop-b')
    runtime.snapshot.welcomeByStore['shop-b'] = {
      text: '来源欢迎',
      enabled: true,
      version: 9,
    }
    runtime.snapshot.handoffByStore['shop-b'] = { keywords: ['退款', '转人工'] }
  }
  let failWelcome = Boolean(options.failWelcome)
  const run = vi.spyOn(runtime, 'run')
  run.mockImplementation(async (command) => {
    if (
      command.action === 'list-model-profiles' ||
      command.action === 'save-model-profile' ||
      command.action === 'bind-model-profile'
    )
      return {
        status: 'ok',
        message: '',
        data: profileCommand(state, command) as Record<string, unknown>,
      }
    if (command.action === 'save-welcome') {
      if (failWelcome) throw Error('欢迎语写入失败')
      const storeId = command.storeId!
      const old = runtime.snapshot.welcomeByStore[storeId] ?? {
        text: '',
        enabled: false,
        version: 0,
      }
      if (Number(command.values?.version) !== old.version) throw Error('欢迎配置已更新，请重新载入')
      runtime.snapshot.welcomeByStore = {
        ...runtime.snapshot.welcomeByStore,
        [storeId]: {
          text: String(command.values?.text ?? '').trim(),
          enabled: Boolean(command.values?.enabled),
          version: old.version + 1,
        },
      }
      return { status: 'ok', message: '已保存', data: {} }
    }
    if (command.action === 'save-store-handoff') {
      const storeId = command.storeId!
      const values = command.values as { mode: 'inherit' | 'custom'; keywords?: string[] }
      const stores = { ...runtime.snapshot.handoffByStore }
      if (values.mode === 'inherit') delete stores[storeId]
      else stores[storeId] = { keywords: [...(values.keywords ?? [])] }
      runtime.snapshot.handoffByStore = stores
      return { status: 'ok', message: '已保存', data: {} }
    }
    if (command.action === 'save-config' && command.screenId === 'UX08') {
      runtime.snapshot.config.safety.handoffKeywords = [
        ...((command.values?.handoffKeywords as string[]) ?? []),
      ]
      return { status: 'ok', message: '全局关键词已保存', data: {} }
    }
    if (command.action === 'save-config' && command.screenId === 'RECEPTION_KEYWORDS') {
      if (command.values?.kind === 'handoff' && command.values.mode === 'keywords') {
        runtime.snapshot.config.safety.handoffKeywords = [
          ...((command.values.keywords as string[]) ?? []),
        ]
      } else if (command.values?.kind === 'handoff') {
        runtime.snapshot.config.safety.handoffKeywordsEnabled = Boolean(command.values?.enabled)
      } else if (command.values?.mode === 'keywords') {
        runtime.snapshot.config.safety.manualReplyKeywords = [
          ...((command.values?.keywords as string[]) ?? []),
        ]
      } else {
        runtime.snapshot.config.safety.manualReplyKeywordsEnabled = Boolean(command.values?.enabled)
      }
      return { status: 'ok', message: '已保存', data: {} }
    }
    throw Error('非预期业务命令：' + command.action)
  })
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
  return {
    wrapper,
    setup,
    runtime,
    state,
    run,
    restoreWelcome: () => {
      failWelcome = false
    },
  }
}
async function importAll(
  setup: ReturnType<typeof useShopSetupStore>,
  sourceId = 'shop-b',
  confirm = true,
) {
  if (!setup.loaded) await setup.loadRules()
  setup.openReuse()
  await setup.selectReuseSource(sourceId)
  if (confirm) setup.reuse.replaceConfirm = true
  return setup.applyReuse()
}
afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount())
  document.body.innerHTML = ''
})

it('仅在其他店铺存在时显示复用入口，对话框默认四类全选', async () => {
  const single = await fixture({ withSource: false })
  expect(single.wrapper.find('[data-reuse-open]').exists()).toBe(false)
  single.wrapper.unmount()
  wrappers.splice(0)

  const { wrapper, setup } = await fixture()
  expect(wrapper.find('[data-reuse-open]').exists()).toBe(true)
  await wrapper.find('[data-reuse-open]').trigger('click')
  expect(setup.reuse.dialog).toBe(true)
  expect(wrapper.find('.reuse-dialog').exists()).toBe(true)
  expect(wrapper.findAllComponents({ name: 'ElCheckbox' })).toHaveLength(4)
  expect(setup.reuse.selection).toEqual({
    style: true,
    logistics: true,
    reception: true,
    afterSales: true,
  })
  expect(wrapper.find('[data-reuse-apply]').attributes('disabled')).toBeDefined()
})

it('读取来源使用独立实例，显示跨平台提醒与四类预览，且不覆盖目标保存基线', async () => {
  const { wrapper, setup, runtime, state, run } = await fixture()
  const sourceProfileId = state.bindings['shop-b']!
  const sourcePrompt = state.profiles.find((item) => item.id === sourceProfileId)!.prompt
  await setup.loadRules()
  expect(setup.loaded).toBe(true)
  setup.openReuse()
  await setup.selectReuseSource('shop-b')
  expect(setup.reuse.loaded).toMatchObject({
    storeId: 'shop-b',
    storeName: '来源店铺',
    platform: 'doudian-client',
  })
  await flushPromises()
  expect(wrapper.find('.reuse-dialog').text()).toContain('来源店铺')
  expect(wrapper.find('.reuse-dialog').text()).toContain('抖店')
  expect(wrapper.find('.reuse-dialog').text()).toContain('平台不同')
  expect(setup.reusePreview?.policy.draft).toMatchObject({
    style: 'cool',
    origins: ['广东'],
    warrantyPolicy: '来源保修',
  })
  expect(setup.reusePreview?.reception.draft.welcome.text).toBe('来源欢迎')
  expect(setup.applyReuse()).toBe(true)
  expect(setup.step).toBe(1)
  expect(setup.draft.style).toBe('cool')
  expect(setup.draft.customPrompt).toBe('')
  expect(setup.reuseApplied?.reception.handoff).toEqual({
    inherited: false,
    keywords: ['退款', '转人工'],
  })
  expect(await setup.saveRules()).toBe(true)
  expect(setup.saved).toBe(true)
  expect(state.bindings['shop-b']).toBe(sourceProfileId)
  expect(state.profiles.find((item) => item.id === sourceProfileId)!.prompt).toBe(sourcePrompt)
  expect(state.globalPrompt).toBe('')
  expect(runtime.snapshot.welcomeByStore['shop-b']).toEqual({
    text: '来源欢迎',
    enabled: true,
    version: 9,
  })
  const welcomeCalls = run.mock.calls.filter(([command]) => command.action === 'save-welcome')
  expect(welcomeCalls).toHaveLength(1)
  expect(welcomeCalls[0]![0].values).toMatchObject({
    text: '来源欢迎',
    enabled: true,
    version: 3,
  })
  expect(runtime.snapshot.welcomeByStore['shop-a']).toEqual({
    text: '来源欢迎',
    enabled: true,
    version: 4,
  })
})

it('取消不改草稿；已有草稿需明确确认替换', async () => {
  const { setup } = await fixture()
  setup.draft.style = 'gentle'
  setup.openReuse()
  await setup.selectReuseSource('shop-b')
  expect(setup.applyReuse()).toBe(false)
  expect(setup.reuse.error).toContain('确认替换')
  expect(setup.draft.style).toBe('gentle')
  expect(setup.reuse.dialog).toBe(true)
  setup.reuse.replaceConfirm = true
  expect(setup.applyReuse()).toBe(true)
  expect(setup.draft.style).toBe('cool')
  expect(setup.reuse.dialog).toBe(false)

  setup.dismiss()
  setup.open('shop-a')
  setup.openReuse()
  await setup.selectReuseSource('shop-b')
  setup.closeReuse()
  expect(setup.reuse.dialog).toBe(false)
  expect(setup.draft.style).toBe('cool')
  expect(setup.reuseApplied).not.toBeNull()
})

it('来源未配置的类别保留本店值并提示，显式关闭欢迎仍可复用', async () => {
  const { setup } = await fixture({ sourceConfigured: false })
  setup.draft.style = 'gentle'
  setup.draft.origins = ['浙江']
  setup.openReuse()
  await setup.selectReuseSource('shop-b')
  expect(setup.reusePreview?.policy.missing).toEqual(['style', 'logistics', 'afterSales'])
  expect(setup.reusePreview?.hints.join('；')).toContain('未配置')
  expect(setup.reusePreview?.reception.missing).toEqual(['welcome'])
  setup.reuse.replaceConfirm = true
  expect(setup.applyReuse()).toBe(true)
  expect(setup.draft.style).toBe('gentle')
  expect(setup.draft.origins).toEqual(['浙江'])
  expect(setup.reuseApplied?.reception.welcome).toEqual({
    text: '本店欢迎',
    enabled: false,
    delayMinSeconds: 1,
    delayMaxSeconds: 3,
  })
  expect(setup.reuseApplied?.reception.handoff).toEqual({ inherited: true, keywords: [] })
})

it('来源读取乱序、切工作区或来源移除时不落入其他店铺', async () => {
  const { setup, runtime, run } = await fixture()
  setup.openReuse()
  let finish!: () => void
  run.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = () =>
          resolve({
            status: 'ok',
            message: '',
            data: {
              revision: 0,
              profiles: [],
              bindings: {},
              globalPrompt: '',
              globalMaxReplyChars: 200,
            },
          })
      }),
  )
  const job = setup.selectReuseSource('shop-b')
  runtime.snapshot.workspaceId = 'another-workspace'
  await flushPromises()
  finish()
  await job
  expect(setup.storeId).toBe('')
  expect(setup.reuse.loaded).toBeNull()
  expect(setup.reuse.loading).toBe(false)
  expect(setup.reuseApplied).toBeNull()

  const second = await fixture()
  second.setup.openReuse()
  await second.setup.selectReuseSource('shop-b')
  expect(second.setup.reuse.loaded).not.toBeNull()
  second.runtime.snapshot.stores = [shop('shop-a', '当前店铺', 'pdd-web')]
  await flushPromises()
  expect(second.setup.reuse.loaded).toBeNull()
  expect(second.setup.reuse.error).toContain('来源店铺')

  // 切店铺（包括把来源店切成目标店）后，迟到的来源读取不得落入新会话。
  const third = await fixture()
  third.setup.openReuse()
  let finishThird!: () => void
  third.run.mockImplementation(
    () =>
      new Promise((resolve) => {
        finishThird = () =>
          resolve({
            status: 'ok',
            message: '',
            data: {
              revision: 0,
              profiles: [],
              bindings: {},
              globalPrompt: '',
              globalMaxReplyChars: 200,
            },
          })
      }),
  )
  const pending = third.setup.selectReuseSource('shop-b')
  third.setup.dismiss()
  third.setup.open('shop-b')
  finishThird()
  await pending
  expect(third.setup.storeId).toBe('shop-b')
  expect(third.setup.reuse.dialog).toBe(false)
  expect(third.setup.reuse.loaded).toBeNull()
})

it('导入草稿关闭重开保留，工作区切换清空', async () => {
  const { wrapper, setup, runtime } = await fixture()
  expect(await importAll(setup)).toBe(true)
  setup.step = 3
  await flushPromises()
  await wrapper.get('textarea[aria-label="文字欢迎语"]').setValue('导入后修改')
  expect(setup.reuseApplied?.reception.welcome.text).toBe('导入后修改')
  setup.dismiss()
  await flushPromises()
  setup.open('shop-a')
  setup.step = 3
  await flushPromises()
  expect(
    (wrapper.get('textarea[aria-label="文字欢迎语"]').element as HTMLTextAreaElement).value,
  ).toBe('导入后修改')
  expect(setup.reuseApplied?.source.storeName).toBe('来源店铺')

  setup.dismiss()
  await flushPromises()
  runtime.snapshot.workspaceId = 'another-workspace'
  setup.open('shop-a')
  setup.step = 3
  await flushPromises()
  expect(setup.reuseApplied).toBeNull()
  // 工作区切换清空导入草稿，回到该工作区已保存的接待配置。
  expect(
    (wrapper.get('textarea[aria-label="文字欢迎语"]').element as HTMLTextAreaElement).value,
  ).toBe('本店欢迎')
})

it('统一保存：政策、欢迎、转人工逐项成功；部分失败只重试未完成项', async () => {
  const { setup, run, restoreWelcome } = await fixture({ failWelcome: true })
  expect(await importAll(setup)).toBe(true)
  expect(await setup.saveRules()).toBe(false)
  expect(setup.reuseApplied?.parts).toEqual({
    policy: 'saved',
    welcome: 'pending',
    handoff: 'saved',
  })
  expect(setup.saved).toBe(false)
  expect(setup.error).toContain('欢迎语写入失败')
  const modelSaves = () =>
    run.mock.calls.filter(([command]) => command.action === 'save-model-profile').length
  const handoffSaves = () =>
    run.mock.calls.filter(([command]) => command.action === 'save-store-handoff').length
  const welcomeSaves = () =>
    run.mock.calls.filter(([command]) => command.action === 'save-welcome').length
  expect(modelSaves()).toBe(1)
  expect(handoffSaves()).toBe(1)
  expect(welcomeSaves()).toBe(1)
  restoreWelcome()
  expect(await setup.saveRules()).toBe(true)
  expect(setup.saved).toBe(true)
  expect(modelSaves()).toBe(1)
  expect(handoffSaves()).toBe(1)
  expect(welcomeSaves()).toBe(2)
  expect(setup.reuseApplied?.parts).toEqual({
    policy: 'saved',
    welcome: 'saved',
    handoff: 'saved',
  })
})

it('同平台不提示核对；未勾选接待时仍保留独立保存且只写入政策', async () => {
  const { setup, runtime, run } = await fixture()
  runtime.snapshot.stores[0]!.platform = 'doudian-client'
  await setup.loadRules()
  setup.openReuse()
  await setup.selectReuseSource('shop-b')
  expect(setup.reuseCrossPlatform).toBe(false)
  expect(run).toHaveBeenCalledWith({ action: 'list-model-profiles' })
  setup.reuse.selection.reception = false
  expect(setup.applyReuse()).toBe(true)
  expect(setup.reuseApplied?.parts).toEqual({
    policy: 'pending',
    welcome: 'saved',
    handoff: 'saved',
  })
  expect(setup.receptionDeferred).toBe(false)
  expect(await setup.saveRules()).toBe(true)
  expect(run).not.toHaveBeenCalledWith(expect.objectContaining({ action: 'save-welcome' }))
  expect(run).not.toHaveBeenCalledWith(expect.objectContaining({ action: 'save-store-handoff' }))
  expect(setup.reuseParts.map((part) => part.key)).toEqual(['policy'])
})

it('重复导入需再次确认且不累积来源值', async () => {
  const { setup } = await fixture()
  expect(await importAll(setup)).toBe(true)
  const first = JSON.stringify(setup.draft)
  setup.openReuse()
  await setup.selectReuseSource('shop-b')
  expect(setup.applyReuse()).toBe(false)
  expect(setup.reuse.error).toContain('确认替换')
  setup.reuse.replaceConfirm = true
  expect(setup.applyReuse()).toBe(true)
  expect(JSON.stringify(setup.draft)).toBe(first)
  expect(setup.reuseApplied?.parts.policy).toBe('pending')
  expect(setup.step).toBe(1)
})

it('目标欢迎语被其他操作更新时保存前预检失败，不写入任何部分', async () => {
  const { setup, runtime, run } = await fixture()
  expect(await importAll(setup)).toBe(true)
  runtime.snapshot.welcomeByStore = {
    ...runtime.snapshot.welcomeByStore,
    'shop-a': { text: '他人修改', enabled: true, version: 4 },
  }
  expect(await setup.saveRules()).toBe(false)
  expect(setup.error).toContain('欢迎语')
  expect(runtime.run).not.toHaveBeenCalledWith(
    expect.objectContaining({ action: 'save-model-profile' }),
  )
  expect(runtime.run).not.toHaveBeenCalledWith(expect.objectContaining({ action: 'save-welcome' }))
  expect(setup.reuseApplied?.parts.policy).toBe('pending')
  // 用户显式确认以最新目标为基线后，按目标当前版本补写，不把来源版本带过去。
  expect(setup.adoptReceptionBaseline()).toBe(true)
  expect(await setup.saveRules()).toBe(true)
  const welcomeCalls = run.mock.calls.filter(([command]) => command.action === 'save-welcome')
  expect(welcomeCalls.at(-1)![0].values).toMatchObject({ version: 4 })
})

it('统一保存模式隐藏接待独立保存并显示待保存提示，全局配置仍独立保存', async () => {
  const { wrapper, setup, runtime } = await fixture()
  runtime.available = true
  setup.step = 3
  await flushPromises()
  expect(wrapper.findAll('button').filter((button) => button.text() === '保存配置')).toHaveLength(1)

  expect(await importAll(setup)).toBe(true)
  setup.step = 3
  await flushPromises()
  const panels = wrapper.findAllComponents({ name: 'ShopOpsPanel' })
  const welcomePanel = panels[1]!
  expect(welcomePanel.text()).toContain('最后统一保存')
  expect(
    welcomePanel.findAll('button').filter((button) => button.text() === '保存配置'),
  ).toHaveLength(0)
  await welcomePanel.get('textarea[aria-label="文字欢迎语"]').setValue('导入后修改')
  expect(setup.reuseApplied?.reception.welcome.text).toBe('导入后修改')
  expect(runtime.run).not.toHaveBeenCalledWith(expect.objectContaining({ action: 'save-welcome' }))
  const transfer = panels[0]!
  const globalKeywords = transfer.get('textarea[aria-label="全局人工处理关键词"]')
  await globalKeywords.setValue('全局草稿')
  await globalKeywords.trigger('blur')
  await flushPromises()
  expect(runtime.run).toHaveBeenCalledWith(
    expect.objectContaining({ action: 'save-config', screenId: 'RECEPTION_KEYWORDS' }),
  )
})

it('保存成功后再次编辑政策或接待内容会取消对应成功标记', async () => {
  const { setup } = await fixture()
  const { nextTick } = await import('vue')
  expect(await importAll(setup)).toBe(true)
  expect(await setup.saveRules()).toBe(true)
  expect(setup.saved).toBe(true)
  setup.step = 1
  setup.saved = false
  setup.draft.style = 'warm'
  await nextTick()
  expect(setup.reuseApplied?.parts.policy).toBe('pending')
  expect(setup.saved).toBe(false)
  setup.updateReceptionPart('welcome', { text: '再次修改', enabled: true })
  expect(setup.reuseApplied?.parts.welcome).toBe('pending')
  expect(setup.saved).toBe(false)
})

it('目标店铺移除后结束引导并清空复用状态', async () => {
  const { setup, runtime } = await fixture()
  expect(await importAll(setup)).toBe(true)
  runtime.snapshot.stores = [shop('shop-b', '来源店铺', 'doudian-client')]
  await flushPromises()
  expect(setup.storeId).toBe('')
  expect(setup.reuseApplied).toBeNull()
  expect(setup.reuse.loaded).toBeNull()
})

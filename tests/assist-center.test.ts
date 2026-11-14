import { afterEach, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import ElementPlus from 'element-plus'
import AiAssistCenterView from '../src/modules/auxiliary/components/AiAssistCenterView.vue'
import { useRuntimeStore } from '../src/shared/state/runtime'
import { defaultAssistPreferences, type AssistWindowState } from '../src/shared/contracts/assist'
import type { PlatformItemsSnapshot } from '../src/shared/contracts/platform-items'

const mockDesktop = vi.hoisted(() => ({
  isElectron: true,
  close: vi.fn(async () => {}),
  closeAssist: vi.fn(async () => {}),
  minimize: vi.fn(async () => {}),
  assistState: vi.fn<() => Promise<AssistWindowState>>(),
  onAssistState: vi.fn((_listener: (state: AssistWindowState) => void) => () => {}),
  onAssistCloseRequest: vi.fn((_listener: () => void) => () => {}),
  updateAssistPreferences: vi.fn(),
  assistPlatformSnapshot: vi.fn<() => Promise<PlatformItemsSnapshot>>(),
  refreshAssistPlatform: vi.fn<() => Promise<PlatformItemsSnapshot>>(),
  openAssistPlatformItem: vi.fn(async () => {}),
  openAssistConversation: vi.fn(async () => {}),
}))
const sound = vi.hoisted(() => vi.fn(async () => {}))
vi.mock('../src/shared/platform/desktop', () => ({ getDesktop: () => mockDesktop }))
vi.mock('../src/modules/auxiliary/services/assist-sound', () => ({ playAssistSound: sound }))

afterEach(() => {
  document.body.innerHTML = ''
})
async function fixture(
  options: { native?: boolean; sound?: boolean; platform?: PlatformItemsSnapshot } = {},
) {
  vi.clearAllMocks()
  mockDesktop.assistState.mockResolvedValue({
    ...defaultAssistPreferences(),
    workspaceId: 'workspace-one',
    open: true,
    isAssistWindow: options.native ?? false,
    soundEnabled: options.sound ?? false,
  })
  mockDesktop.assistPlatformSnapshot.mockResolvedValue(
    options.platform ?? { workspaceId: 'workspace-one', stores: [] },
  )
  mockDesktop.refreshAssistPlatform.mockResolvedValue(
    options.platform ?? { workspaceId: 'workspace-one', stores: [] },
  )
  setActivePinia(createPinia())
  const runtime = useRuntimeStore()
  runtime.available = true
  runtime.snapshot.workspaceId = 'workspace-one'
  runtime.snapshot.stores = [
    {
      id: 's1',
      storeName: '本机测试店',
      platform: 'sim-local',
      group: '',
      aiEnabled: false,
      runtime: { open: true, online: true },
    },
  ]
  runtime.snapshot.conversations = [
    {
      storeId: 's1',
      uid: 'a',
      name: '甲顾客',
      status: 'pending',
      updatedAt: 100,
      messages: [{ from: 'buyer', content: '甲的问题', ts: 100 }],
    },
    {
      storeId: 's1',
      uid: 'b',
      name: '乙顾客',
      status: 'replied',
      updatedAt: 200,
      messages: [
        { from: 'buyer', content: '乙的问题', ts: 150 },
        { from: 'seller', content: '乙的回复', ts: 200 },
      ],
    },
    {
      storeId: 's1',
      uid: 'c',
      name: '丙顾客',
      status: 'handoff',
      updatedAt: 300,
      messages: [{ from: 'buyer', content: '丙需人工', ts: 300 }],
    },
  ]
  const run = vi
    .spyOn(runtime, 'run')
    .mockResolvedValue({ status: 'ok', message: '完成', data: { confirmed: true } })
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/', component: { template: '<div />' } }],
  })
  await router.push('/')
  const wrapper = mount(AiAssistCenterView, {
    global: {
      plugins: [ElementPlus, router],
      stubs: {
        ElDialog: {
          template: '<div v-if="modelValue"><slot /><slot name="footer" /></div>',
          props: ['modelValue'],
        },
      },
    },
  })
  await flushPromises()
  return { runtime, run, wrapper }
}
it('四标签使用真实状态分流，平台事项没有数据时不伪装已同步', async () => {
  const { wrapper } = await fixture()
  expect(wrapper.findAll('[data-assist-tab]')).toHaveLength(4)
  expect(wrapper.findAll('[data-conversation]')).toHaveLength(1)
  expect(wrapper.find('[data-conversation]').text()).toContain('甲顾客')
  await wrapper.find('[data-assist-tab="handoff"]').trigger('click')
  expect(wrapper.find('[data-conversation]').text()).toContain('丙顾客')
  await wrapper.find('[data-assist-tab="aftersale"]').trigger('click')
  expect(wrapper.text()).toContain('同步')
  wrapper.unmount()
})
it('已回复清除只影响显示，更新后重新出现', async () => {
  const { wrapper, runtime, run } = await fixture()
  await wrapper.find('[data-consult-status="replied"]').trigger('click')
  expect(wrapper.findAll('[data-conversation]')).toHaveLength(1)
  await wrapper.find('[aria-label="清除已回复显示"]').trigger('click')
  expect(wrapper.findAll('[data-conversation]')).toHaveLength(0)
  expect(runtime.snapshot.conversations).toHaveLength(3)
  expect(run).not.toHaveBeenCalled()
  runtime.snapshot.conversations[1]!.updatedAt = 250
  await flushPromises()
  expect(wrapper.findAll('[data-conversation]')).toHaveLength(1)
  wrapper.unmount()
})
it('发送未确认保留当前草稿，切会话不混用', async () => {
  const { wrapper, run } = await fixture()
  await wrapper.find('[data-conversation]').trigger('click')
  await flushPromises()
  await wrapper.find('textarea[aria-label="人工回复内容"]').setValue('保留甲草稿')
  run.mockResolvedValue({ status: 'ok', message: '', data: { confirmed: false } })
  await wrapper.find('[aria-label="发送给当前顾客"]').trigger('click')
  await flushPromises()
  expect(wrapper.text()).toContain('发送未确认')
  expect((wrapper.find('textarea').element as HTMLTextAreaElement).value).toBe('保留甲草稿')
  await wrapper.find('[data-consult-status="replied"]').trigger('click')
  await wrapper.find('[data-conversation]').trigger('click')
  await flushPromises()
  expect((wrapper.find('textarea').element as HTMLTextAreaElement).value).toBe('')
  await wrapper.find('[data-consult-status="pending"]').trigger('click')
  await wrapper.find('[data-conversation]').trigger('click')
  await flushPromises()
  expect((wrapper.find('textarea').element as HTMLTextAreaElement).value).toBe('保留甲草稿')
  wrapper.unmount()
})
it('输入法与Shift Enter不发送，切换工作区清空选择和草稿', async () => {
  const { wrapper, runtime, run } = await fixture()
  await wrapper.find('[data-conversation]').trigger('click')
  await flushPromises()
  await wrapper.find('textarea').setValue('未发送草稿')
  run.mockClear()
  await wrapper.find('textarea').trigger('keydown', { key: 'Enter', shiftKey: true })
  await wrapper.find('textarea').trigger('keydown', { key: 'Enter', isComposing: true })
  expect(run).not.toHaveBeenCalled()
  runtime.snapshot.workspaceId = 'workspace-two'
  await flushPromises()
  expect((wrapper.find('textarea').element as HTMLTextAreaElement).value).toBe('')
  expect(wrapper.find('textarea').attributes('disabled')).toBeDefined()
  wrapper.unmount()
})

it('关闭需确认，只关闭辅助浮窗而不调用应用关闭或改变AI', async () => {
  const { wrapper, run } = await fixture({ native: true })
  await wrapper.find('[aria-label="关闭辅助中心"]').trigger('click')
  expect(mockDesktop.closeAssist).not.toHaveBeenCalled()
  const close = wrapper.findAll('button').find((button) => button.text() === '关闭')!
  await close.trigger('click')
  await flushPromises()
  expect(mockDesktop.closeAssist).toHaveBeenCalledTimes(1)
  expect(mockDesktop.close).not.toHaveBeenCalled()
  expect(run).not.toHaveBeenCalled()
  wrapper.unmount()
})
it('主路由预览确认关闭不会退出主应用', async () => {
  const { wrapper } = await fixture()
  await wrapper.find('[aria-label="关闭辅助中心"]').trigger('click')
  await wrapper
    .findAll('button')
    .find((button) => button.text() === '关闭')!
    .trigger('click')
  await flushPromises()
  expect(mockDesktop.closeAssist).not.toHaveBeenCalled()
  expect(mockDesktop.close).not.toHaveBeenCalled()
  wrapper.unmount()
})
it('定位使用受限主窗口API，离线店铺不能借其他在线店发送', async () => {
  const { wrapper, runtime, run } = await fixture({ native: true })
  await wrapper.find('[data-conversation]').trigger('click')
  await flushPromises()
  await wrapper
    .findAll('button')
    .find((button) => button.text() === '定位')!
    .trigger('click')
  await flushPromises()
  expect(mockDesktop.openAssistConversation).toHaveBeenCalledWith({
    workspaceId: 'workspace-one',
    storeId: 's1',
    conversationId: 'a',
  })
  runtime.snapshot.stores[0]!.runtime.online = false
  runtime.snapshot.stores.push({
    id: 's2',
    storeName: '另一家在线店',
    platform: 'sim-local',
    group: '',
    aiEnabled: false,
    runtime: { open: true, online: true },
  })
  runtime.selectedStoreId = 's2'
  await wrapper.find('textarea').setValue('不应发送')
  run.mockClear()
  await wrapper.find('[aria-label="发送给当前顾客"]').trigger('click')
  expect(run).not.toHaveBeenCalled()
  wrapper.unmount()
})
it('有质检记录的纠错绑定原问题版本，只保存知识不发送', async () => {
  const { wrapper, runtime, run } = await fixture()
  runtime.snapshot.quality.push({
    id: 'quality-1',
    storeId: 's1',
    uid: 'a',
    name: '甲顾客',
    storeName: '本机测试店',
    platform: 'sim-local',
    status: 'pending',
    note: '',
    version: 3,
    updatedAt: 100,
    reviewedAt: 0,
    events: [],
  })
  await wrapper.find('[data-conversation]').trigger('click')
  await flushPromises()
  await wrapper
    .findAll('button')
    .find((button) => button.text() === '纠错')!
    .trigger('click')
  await wrapper.find('[aria-label="纠错标准答案"]').setValue('正确的本店答案')
  await wrapper.find('input[type="checkbox"]').setValue(true)
  run.mockClear()
  await wrapper
    .findAll('button')
    .find((button) => button.text() === '保存')!
    .trigger('click')
  await flushPromises()
  expect(run).toHaveBeenCalledWith({
    action: 'learn-conversation-correction',
    storeId: 's1',
    conversationId: 'a',
    values: {
      recordId: 'quality-1',
      version: 3,
      question: '甲的问题',
      messageTs: 100,
      answer: '正确的本店答案',
      confirmed: true,
    },
  })
  expect(run.mock.calls.some(([command]) => command.action === 'send-reply')).toBe(false)
  wrapper.unmount()
})
it('平台首次成功同步的历史不响，后续新事项提醒，切换提醒设置不重播', async () => {
  const snapshot: PlatformItemsSnapshot = {
    workspaceId: 'workspace-one',
    stores: [
      {
        storeId: 's1',
        storeName: '测试店',
        platform: 'pdd-web',
        kind: 'aftersale',
        status: 'success',
        message: '已同步',
        total: 1,
        complete: true,
        items: [
          {
            id: 'old',
            storeId: 's1',
            platform: 'pdd-web',
            kind: 'aftersale',
            title: '已有售后',
            status: '待处理',
            detailKey: 'old',
          },
        ],
      },
    ],
  }
  const { wrapper } = await fixture({ native: true, sound: true, platform: snapshot })
  expect(sound).not.toHaveBeenCalled()
  await wrapper.find('[data-assist-tab="aftersale"]').trigger('click')
  mockDesktop.refreshAssistPlatform.mockResolvedValue({
    workspaceId: 'workspace-one',
    stores: [
      {
        ...snapshot.stores[0]!,
        total: 2,
        items: [
          ...snapshot.stores[0]!.items,
          { ...snapshot.stores[0]!.items[0]!, id: 'new', detailKey: 'new' },
        ],
      },
    ],
  })
  await wrapper
    .findAll('button')
    .find((button) => button.text() === '刷新')!
    .trigger('click')
  await flushPromises()
  expect(sound).toHaveBeenCalledTimes(1)
  const listener = mockDesktop.onAssistState.mock.calls[0]![0]
  listener({
    ...defaultAssistPreferences(),
    workspaceId: 'workspace-one',
    open: true,
    isAssistWindow: true,
    soundEnabled: true,
    alertKinds: ['consult'],
  })
  await flushPromises()
  listener({
    ...defaultAssistPreferences(),
    workspaceId: 'workspace-one',
    open: true,
    isAssistWindow: true,
    soundEnabled: true,
  })
  await flushPromises()
  await wrapper
    .findAll('button')
    .find((button) => button.text() === '刷新')!
    .trigger('click')
  await flushPromises()
  expect(sound).toHaveBeenCalledTimes(1)
  wrapper.unmount()
})
it('发送等待期间不重复提交，工作区变更后不继续发送旧草稿', async () => {
  const { wrapper, runtime, run } = await fixture()
  await wrapper.find('[data-conversation]').trigger('click')
  await flushPromises()
  await wrapper.find('textarea').setValue('旧工作区草稿')
  let finish!: (result: { status: 'ok'; message: string; data: Record<string, unknown> }) => void
  run.mockClear().mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve
      }),
  )
  await wrapper.find('[aria-label="发送给当前顾客"]').trigger('click')
  await wrapper.find('[aria-label="发送给当前顾客"]').trigger('click')
  expect(run).toHaveBeenCalledTimes(1)
  runtime.snapshot.workspaceId = 'new-account-workspace'
  await flushPromises()
  finish({ status: 'ok', message: '草稿已保存', data: {} })
  await flushPromises()
  expect(run).toHaveBeenCalledTimes(1)
  expect((wrapper.find('textarea').element as HTMLTextAreaElement).value).toBe('')
  expect(wrapper.text()).not.toContain('草稿已保存')
  wrapper.unmount()
})
it('Ctrl Tab只在面板按键事件中切换当前列表，Enter显式发送当前顾客', async () => {
  const { wrapper, runtime, run } = await fixture()
  runtime.snapshot.conversations.push({
    storeId: 's1',
    uid: 'd',
    name: '丁顾客',
    status: 'pending',
    updatedAt: 500,
    messages: [{ from: 'buyer', content: '丁的问题', ts: 500 }],
  })
  await flushPromises()
  await wrapper.find('section').trigger('keydown', { key: 'Tab', ctrlKey: true })
  await flushPromises()
  expect(run).toHaveBeenLastCalledWith({
    action: 'select-conversation',
    storeId: 's1',
    conversationId: 'd',
  })
  await wrapper.find('textarea').setValue('给丁顾客的回复')
  await wrapper.find('textarea').trigger('keydown', { key: 'Enter' })
  await flushPromises()
  expect(run).toHaveBeenLastCalledWith({
    action: 'send-reply',
    storeId: 's1',
    conversationId: 'd',
    values: { reply: '给丁顾客的回复' },
  })
  expect((wrapper.find('textarea').element as HTMLTextAreaElement).value).toBe('')
  wrapper.unmount()
})
it('确认关闭保存多个已编辑顾客草稿；保存失败留窗，不发送或关闭', async () => {
  const { wrapper, run } = await fixture({ native: true })
  await wrapper.find('[data-conversation]').trigger('click')
  await flushPromises()
  await wrapper.find('textarea').setValue('甲的未发送草稿')
  await wrapper.find('[data-consult-status="replied"]').trigger('click')
  await wrapper.find('[data-conversation]').trigger('click')
  await flushPromises()
  await wrapper.find('textarea').setValue('乙的未发送草稿')
  run
    .mockClear()
    .mockResolvedValueOnce({ status: 'ok', message: '', data: {} })
    .mockRejectedValueOnce(new Error('本机保存失败'))
  await wrapper.find('[aria-label="关闭辅助中心"]').trigger('click')
  await wrapper
    .findAll('button')
    .find((button) => button.text() === '关闭')!
    .trigger('click')
  await flushPromises()
  expect(run.mock.calls.map(([command]) => command)).toEqual([
    {
      action: 'save-auxiliary-draft',
      storeId: 's1',
      conversationId: 'a',
      values: { text: '甲的未发送草稿' },
    },
    {
      action: 'save-auxiliary-draft',
      storeId: 's1',
      conversationId: 'b',
      values: { text: '乙的未发送草稿' },
    },
  ])
  expect(mockDesktop.closeAssist).not.toHaveBeenCalled()
  expect(wrapper.text()).toContain('本机保存失败')
  expect((wrapper.find('textarea').element as HTMLTextAreaElement).value).toBe('乙的未发送草稿')
  wrapper.unmount()
})
it('工单A的延迟备注响应不会切回A或清空工单B的新备注', async () => {
  const { wrapper, runtime, run } = await fixture()
  const base = {
    storeId: 's1',
    storeName: '测试店',
    type: '退款跟进',
    orderNo: '',
    buyer: '',
    priority: 'normal' as const,
    status: 'pending' as const,
    createdAt: 1,
    updatedAt: 1,
    notes: [],
  }
  runtime.snapshot.workOrders = [
    { ...base, id: 'order-a', description: '工单甲' },
    { ...base, id: 'order-b', description: '工单乙' },
  ]
  await wrapper.find('[data-assist-tab="ticket"]').trigger('click')
  await wrapper.findAll('.assist-ticket-modes button')[1]!.trigger('click')
  await wrapper.findAll('.assist-workorder')[0]!.trigger('click')
  await wrapper.find('[aria-label="工单跟进备注"]').setValue('甲备注')
  let finish!: (result: { status: 'ok'; message: string; data: Record<string, unknown> }) => void
  run.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve
      }),
  )
  await wrapper
    .findAll('button')
    .find((button) => button.text() === '保存跟进')!
    .trigger('click')
  await wrapper.findAll('.assist-workorder')[1]!.trigger('click')
  await wrapper.find('[aria-label="工单跟进备注"]').setValue('乙的新备注')
  finish({ status: 'ok', message: '', data: {} })
  await flushPromises()
  expect((wrapper.find('[aria-label="工单跟进备注"]').element as HTMLTextAreaElement).value).toBe(
    '乙的新备注',
  )
  expect(wrapper.findAll('.assist-settings').at(-1)!.text()).toContain('工单乙')
  wrapper.unmount()
})
it('切工作区清空店铺筛选、纠错输入与工单备注，旧工单失败不写新错误', async () => {
  const { wrapper, runtime, run } = await fixture()
  await wrapper.find('[aria-label="辅助中心设置"]').trigger('click')
  await wrapper.find('[aria-label="辅助中心店铺筛选"]').setValue('s1')
  await wrapper
    .findAll('button')
    .find((button) => button.text() === '完成')!
    .trigger('click')
  const base = {
    id: 'order-a',
    storeId: 's1',
    storeName: '测试店',
    type: '退款跟进',
    orderNo: '',
    buyer: '',
    priority: 'normal' as const,
    status: 'pending' as const,
    createdAt: 1,
    updatedAt: 1,
    description: '工单甲',
    notes: [],
  }
  runtime.snapshot.workOrders = [base]
  await wrapper.find('[data-assist-tab="ticket"]').trigger('click')
  await wrapper.findAll('.assist-ticket-modes button')[1]!.trigger('click')
  await wrapper.find('.assist-workorder').trigger('click')
  await wrapper.find('[aria-label="工单跟进备注"]').setValue('旧账号备注')
  let fail!: (error: Error) => void
  run.mockImplementationOnce(
    () =>
      new Promise((_resolve, reject) => {
        fail = reject
      }),
  )
  await wrapper
    .findAll('button')
    .find((button) => button.text() === '保存跟进')!
    .trigger('click')
  runtime.snapshot.workspaceId = 'new-account'
  await flushPromises()
  await wrapper.find('[aria-label="辅助中心设置"]').trigger('click')
  expect((wrapper.find('[aria-label="辅助中心店铺筛选"]').element as HTMLSelectElement).value).toBe(
    '',
  )
  await wrapper
    .findAll('button')
    .find((button) => button.text() === '完成')!
    .trigger('click')
  expect(wrapper.find('[aria-label="工单跟进备注"]').exists()).toBe(false)
  fail(new Error('旧账号特有错误'))
  await flushPromises()
  expect(wrapper.text()).not.toContain('旧账号特有错误')
  await wrapper.find('.assist-workorder').trigger('click')
  expect((wrapper.find('[aria-label="工单跟进备注"]').element as HTMLTextAreaElement).value).toBe(
    '',
  )
  wrapper.unmount()
})
it('纠错草稿与确认勾选不会跨工作区保留，离线状态不显示接待', async () => {
  const { wrapper, runtime } = await fixture()
  runtime.snapshot.stores[0]!.runtime.online = false
  await flushPromises()
  expect(wrapper.find('[data-conversation]').text()).toContain('离线')
  expect(wrapper.find('[data-conversation]').text()).not.toContain('接待')
  await wrapper.find('[data-conversation]').trigger('click')
  await flushPromises()
  await wrapper
    .findAll('button')
    .find((button) => button.text() === '纠错')!
    .trigger('click')
  await wrapper.find('[aria-label="纠错标准答案"]').setValue('旧账号标准答案')
  await wrapper.find('input[type="checkbox"]').setValue(true)
  runtime.snapshot.workspaceId = 'new-account'
  await flushPromises()
  expect(wrapper.find('[aria-label="纠错标准答案"]').exists()).toBe(false)
  await wrapper.find('[data-conversation]').trigger('click')
  await flushPromises()
  await wrapper
    .findAll('button')
    .find((button) => button.text() === '纠错')!
    .trigger('click')
  expect((wrapper.find('[aria-label="纠错标准答案"]').element as HTMLTextAreaElement).value).toBe(
    '',
  )
  expect((wrapper.find('input[type="checkbox"]').element as HTMLInputElement).checked).toBe(false)
  wrapper.unmount()
})
it('工单A的延迟状态响应不会重新打开或覆盖工单B', async () => {
  const { wrapper, runtime, run } = await fixture()
  const base = {
    storeId: 's1',
    storeName: '测试店',
    type: '退款跟进',
    orderNo: '',
    buyer: '',
    priority: 'normal' as const,
    status: 'pending' as const,
    createdAt: 1,
    updatedAt: 1,
    notes: [],
  }
  runtime.snapshot.workOrders = [
    { ...base, id: 'order-a', description: '工单甲' },
    { ...base, id: 'order-b', description: '工单乙' },
  ]
  await wrapper.find('[data-assist-tab="ticket"]').trigger('click')
  await wrapper.findAll('.assist-ticket-modes button')[1]!.trigger('click')
  await wrapper.findAll('.assist-workorder')[0]!.trigger('click')
  let finish!: (result: { status: 'ok'; message: string; data: Record<string, unknown> }) => void
  run.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve
      }),
  )
  await wrapper.find('.assist-settings select').setValue('working')
  await wrapper.findAll('.assist-workorder')[1]!.trigger('click')
  finish({ status: 'ok', message: '', data: {} })
  await flushPromises()
  expect(wrapper.find('.assist-settings').text()).toContain('工单乙')
  wrapper.unmount()
})
it('切换预警标签清空当前收件人，不能沿用咨询顾客发送', async () => {
  const { wrapper, run } = await fixture()
  await wrapper.find('[data-conversation]').trigger('click')
  await flushPromises()
  await wrapper.find('textarea').setValue('咨询草稿')
  await wrapper.find('[data-assist-tab="handoff"]').trigger('click')
  expect((wrapper.find('textarea').element as HTMLTextAreaElement).value).toBe('')
  expect(wrapper.find('[aria-label="发送给当前顾客"]').attributes('disabled')).toBeDefined()
  run.mockClear()
  await wrapper.find('[aria-label="发送给当前顾客"]').trigger('click')
  expect(run).not.toHaveBeenCalled()
  await wrapper.find('[data-assist-tab="consult"]').trigger('click')
  await wrapper.find('[data-conversation]').trigger('click')
  await flushPromises()
  expect((wrapper.find('textarea').element as HTMLTextAreaElement).value).toBe('咨询草稿')
  wrapper.unmount()
})

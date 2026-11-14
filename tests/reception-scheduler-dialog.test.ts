import { describe, it, expect, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import ScheduledTasksDialog from '../src/modules/workbench/components/ScheduledTasksDialog.vue'
import type { SchedulerBridge, SchedulerSnapshot } from '../src/shared/contracts/scheduler'
import type { ReceptionBridge } from '../src/shared/contracts/platform-operations'
const empty = (workspaceId = 'w'): SchedulerSnapshot => ({
  workspaceId,
  running: true,
  version: 1,
  tasks: [],
  runs: [],
  receipts: [],
})
const global = {
  stubs: {
    ElDialog: { props: ['modelValue'], template: '<section v-if="modelValue"><slot /></section>' },
  },
}
const receptionService: ReceptionBridge = {
  receptionSnapshot: async () => ({
    workspaceId: 'w',
    rules: [],
    runs: [],
    facts: [
      {
        storeId: 's',
        storeName: '真实店铺',
        accountId: 'account',
        observedAt: Date.now(),
        capabilities: [{ kind: 'welcome-text', available: true, reason: '当前网页输入与回显' }],
        buyers: [{ uid: 'u', name: '真实买家' }],
        orders: [],
        agents: [],
      },
    ],
  }),
  receptionExecute: async () => ({ workspaceId: 'w', rules: [], runs: [], facts: [] }),
}
describe('任务弹窗真实服务边界', () => {
  it('未接线明确不可保存', () => {
    const wrapper = mount(ScheduledTasksDialog, { props: { modelValue: true }, global })
    expect(wrapper.text()).toContain('定时服务尚未接入')
    expect(wrapper.find('button').attributes('disabled')).toBeDefined()
    wrapper.unmount()
  })
  it('新任务默认停用，保存只调用受控调度命令', async () => {
    const service: SchedulerBridge = {
      schedulerSnapshot: vi.fn(async () => empty()),
      schedulerExecute: vi.fn(async () => empty()),
    }
    const wrapper = mount(ScheduledTasksDialog, {
      props: { modelValue: true, service, receptionService, workspaceId: 'w' },
      global,
    })
    await flushPromises()
    await wrapper.find('button').trigger('click')
    const inputs = wrapper.findAll('input')
    await inputs[0].setValue('欢迎任务')
    const selects = wrapper.findAll('select')
    await selects[0].setValue('s')
    await selects[1].setValue('u')
    await wrapper.find('textarea').setValue('您好')
    await wrapper.find('form').trigger('submit')
    await flushPromises()
    expect(service.schedulerSnapshot).toHaveBeenCalledWith('w')
    expect(service.schedulerExecute).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'save',
        workspaceId: 'w',
        task: expect.objectContaining({
          enabled: false,
          action: { kind: 'welcome-text', text: '您好' },
        }),
      }),
    )
    wrapper.unmount()
  })
  it('没有可信平台选择时不能手填店铺、买家、订单或客服事实', async () => {
    const service: SchedulerBridge = {
      schedulerSnapshot: async () => empty(),
      schedulerExecute: vi.fn(async () => empty()),
    }
    const wrapper = mount(ScheduledTasksDialog, {
      props: { modelValue: true, service, workspaceId: 'w' },
      global,
    })
    await flushPromises()
    await wrapper.find('button').trigger('click')
    expect(wrapper.find('input[name="storeId"]').exists()).toBe(false)
    expect(wrapper.find('input[name="uid"]').exists()).toBe(false)
    expect(wrapper.findAll('select')[0].attributes('disabled')).toBeDefined()
    expect(wrapper.find('button[type="submit"]').attributes('disabled')).toBeDefined()
    wrapper.unmount()
  })
  it('切换工作区清除旧数据并丢弃迟到结果', async () => {
    let resolveOld: ((value: SchedulerSnapshot) => void) | undefined
    const service: SchedulerBridge = {
      schedulerSnapshot: vi.fn((id: string) =>
        id === 'w'
          ? new Promise<SchedulerSnapshot>((resolve) => {
              resolveOld = resolve
            })
          : Promise.resolve(empty('new')),
      ),
      schedulerExecute: vi.fn(async () => empty()),
    }
    const wrapper = mount(ScheduledTasksDialog, {
      props: { modelValue: true, service, workspaceId: 'w' },
      global,
    })
    await wrapper.setProps({ workspaceId: 'new' })
    await flushPromises()
    const old = empty()
    old.tasks.push({
      id: 'old',
      name: '旧账号任务',
      storeId: 's',
      uid: 'u',
      enabled: false,
      revision: 1,
      nextAt: 0,
      schedule: { type: 'interval', minutes: 1 },
      action: { kind: 'welcome-text', text: '旧' },
    })
    resolveOld?.(old)
    await flushPromises()
    expect(wrapper.text()).not.toContain('旧账号任务')
    expect(service.schedulerSnapshot).toHaveBeenCalledWith('new')
    wrapper.unmount()
  })
})

describe('任务操作与轮询时序', () => {
  it('停用成功后丢弃更早发起的刷新响应', async () => {
    const initial = empty()
    initial.tasks.push({
      id: 'task',
      name: '欢迎',
      storeId: 's',
      uid: 'u',
      enabled: true,
      revision: 1,
      nextAt: 1000,
      schedule: { type: 'interval', minutes: 1 },
      action: { kind: 'welcome-text', text: '您好' },
    })
    const updated = structuredClone(initial)
    updated.tasks[0].enabled = false
    updated.tasks[0].revision = 2
    let reads = 0
    let resolveStale: ((value: SchedulerSnapshot) => void) | undefined
    const service: SchedulerBridge = {
      schedulerSnapshot: vi.fn(() =>
        ++reads === 1
          ? Promise.resolve(initial)
          : new Promise<SchedulerSnapshot>((resolve) => {
              resolveStale = resolve
            }),
      ),
      schedulerExecute: vi.fn(async () => updated),
    }
    const wrapper = mount(ScheduledTasksDialog, {
      props: { modelValue: true, service, workspaceId: 'w' },
      global,
    })
    await flushPromises()
    await wrapper
      .findAll('button')
      .find((b) => b.text() === '刷新')!
      .trigger('click')
    await wrapper
      .findAll('button')
      .find((b) => b.text() === '停用')!
      .trigger('click')
    await flushPromises()
    resolveStale?.(initial)
    await flushPromises()
    expect(wrapper.findAll('button').some((b) => b.text() === '启用')).toBe(true)
    expect(wrapper.findAll('button').some((b) => b.text() === '停用')).toBe(false)
    wrapper.unmount()
  })
})

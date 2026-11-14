import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import ElementPlus, { ElSelect } from 'element-plus'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { emptySnapshot } from '../src/shared/contracts/backend'
import type {
  PlatformLearningSnapshot,
  PlatformLearningTransport,
} from '../src/shared/contracts/platform-learning'
import { useRuntimeStore } from '../src/shared/state/runtime'
import ShopIntentLearnPanel from '../src/modules/knowledge/components/ShopIntentLearnPanel.vue'
import { platformLearningTransportKey } from '../src/modules/knowledge'

const backend = vi.hoisted(() => ({ snapshot: vi.fn(), execute: vi.fn(), subscribe: vi.fn() }))
vi.mock('../src/shared/platform/backend', () => ({ getBackendBridge: () => backend }))
const workspaceId = '00000000-0000-4000-8000-000000000001'
const taskId = '00000000-0000-4000-8000-000000000002'
const candidateId = '00000000-0000-4000-8000-000000000003'
const identity = {
  storeId: 'shop',
  platform: 'pdd',
  accountId: 'seller-1',
  platformStoreId: 'mall-1',
}
function snapshot(): PlatformLearningSnapshot {
  return {
    version: 1,
    workspaceId,
    tasks: [
      {
        id: taskId,
        identity,
        source: 'products',
        range: { maxPages: 5, maxRecords: 100, productStatus: 'all' },
        status: 'paused',
        cursor: 'page-2',
        pages: 1,
        records: 1,
        candidates: 1,
        duplicates: 0,
        skipped: 0,
        coverage: 'partial',
        scope: '当前平台商品可访问列表',
        reason: '应用重启后已暂停',
        error: '',
        createdAt: 1,
        updatedAt: 2,
      },
    ],
    candidates: [
      {
        id: candidateId,
        taskId,
        fingerprint: 'a'.repeat(64),
        identity,
        source: 'products',
        question: '商品规格',
        answer: 'M码',
        original: { question: '商品规格', answer: 'M码' },
        productIds: ['goods-1'],
        evidence: { recordId: 'goods-1', messageIds: [], capturedAt: 1 },
        status: 'pending',
        error: '',
        audit: [{ at: 1, event: 'collected' }],
      },
    ],
  }
}
beforeEach(async () => {
  setActivePinia(createPinia())
  const snap = emptySnapshot()
  snap.workspaceId = workspaceId
  snap.stores = [
    {
      id: 'shop',
      storeName: '测试店铺',
      platform: 'pdd',
      group: '',
      aiEnabled: false,
      runtime: { open: true, online: true, authenticated: true },
    },
  ]
  backend.snapshot.mockResolvedValue(snap)
  backend.execute.mockResolvedValue({ status: 'ok', data: {}, message: '' })
  backend.execute.mockClear()
  await useRuntimeStore().refresh()
})
function fixture() {
  let state = snapshot()
  const transport: PlatformLearningTransport = {
    snapshot: vi.fn(async () => structuredClone(state)),
    start: vi.fn(async () => structuredClone(state)),
    pause: vi.fn(async () => structuredClone(state)),
    resume: vi.fn(async () => {
      state.tasks[0]!.status = 'running'
      return structuredClone(state)
    }),
    cancel: vi.fn(async () => {
      state.tasks[0]!.status = 'cancelled'
      return structuredClone(state)
    }),
    review: vi.fn(async (input) => {
      state.candidates[0]!.status = 'saved'
      state.candidates[0]!.reviewed = { question: input.question, answer: input.answer }
      return structuredClone(state)
    }),
  }
  const options = {
    global: {
      plugins: [ElementPlus],
      provide: { [platformLearningTransportKey as symbol]: transport },
    },
  }
  return {
    transport,
    options,
    replace: (next: PlatformLearningSnapshot) => {
      state = next
    },
  }
}
function button(wrapper: ReturnType<typeof mount>, label: string) {
  return wrapper.findAll('button').find((node) => node.text() === label)!
}
async function chooseProducts(wrapper: ReturnType<typeof mount>) {
  const source = wrapper
    .findAllComponents(ElSelect)
    .find((select) => select.props('ariaLabel') === '学习来源')!
  source.vm.$emit('update:modelValue', 'products')
  await flushPromises()
}

describe('platform learning task UI', () => {
  it('restores paused tasks without auto-resuming and exposes progress plus manual continue', async () => {
    const f = fixture()
    const wrapper = mount(ShopIntentLearnPanel, f.options)
    await chooseProducts(wrapper)
    expect(wrapper.text()).toContain('应用重启后已暂停')
    expect(wrapper.text()).toContain('部分范围')
    expect(wrapper.text()).toContain('1 页')
    expect(f.transport.resume).not.toHaveBeenCalled()
    await button(wrapper, '继续').trigger('click')
    await flushPromises()
    expect(f.transport.resume).toHaveBeenCalledWith({ workspaceId, taskId })
    expect(button(wrapper, '暂停')).toBeDefined()
    wrapper.unmount()
  })
  it('requires explicit review, persists edited QA through transport, and keeps saved state after remount', async () => {
    const f = fixture()
    const wrapper = mount(ShopIntentLearnPanel, f.options)
    await chooseProducts(wrapper)
    await wrapper.get('.runtime-entry').trigger('click')
    await wrapper.findAll('textarea')[1]!.setValue('人工审核后的答案')
    expect(wrapper.get('button[type="submit"]').attributes('disabled')).toBeDefined()
    await wrapper.get('input[type="checkbox"]').setValue(true)
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(f.transport.review).toHaveBeenCalledWith({
      workspaceId,
      candidateId,
      question: '商品规格',
      answer: '人工审核后的答案',
      confirmed: true,
    })
    expect(backend.execute).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('已保存为停用知识包')
    wrapper.unmount()
    const reopened = mount(ShopIntentLearnPanel, f.options)
    await chooseProducts(reopened)
    expect(reopened.get('.runtime-entry').attributes('disabled')).toBeDefined()
    expect(reopened.text()).toContain('已入库')
    reopened.unmount()
  })
  it('keeps an edited review across ordinary progress refreshes and clears it on workspace change', async () => {
    const f = fixture()
    const wrapper = mount(ShopIntentLearnPanel, f.options)
    await chooseProducts(wrapper)
    await wrapper.get('.runtime-entry').trigger('click')
    await wrapper.findAll('textarea')[1]!.setValue('保留的草稿')
    await button(wrapper, '刷新任务').trigger('click')
    await flushPromises()
    expect(wrapper.findAll('textarea')[1]!.element.value).toBe('保留的草稿')
    useRuntimeStore().snapshot.workspaceId = '00000000-0000-4000-8000-000000000009'
    await flushPromises()
    expect(wrapper.find('form').exists()).toBe(false)
    expect(wrapper.findAll('.runtime-entry')).toHaveLength(0)
    wrapper.unmount()
  })
  it('starts the selected platform range explicitly and displays retryable provider errors', async () => {
    const f = fixture()
    const failed = snapshot()
    failed.tasks[0]!.status = 'failed'
    failed.tasks[0]!.error = '平台登录失效，请登录后重试'
    f.replace(failed)
    const wrapper = mount(ShopIntentLearnPanel, f.options)
    await chooseProducts(wrapper)
    expect(wrapper.text()).toContain('平台登录失效')
    await button(wrapper, '开始采集').trigger('click')
    await flushPromises()
    expect(f.transport.start).toHaveBeenCalledWith({
      workspaceId,
      storeId: 'shop',
      source: 'products',
      range: { maxPages: 5, maxRecords: 100, productStatus: 'all' },
    })
    await button(wrapper, '重试').trigger('click')
    await flushPromises()
    expect(f.transport.resume).toHaveBeenCalledWith({ workspaceId, taskId })
    wrapper.unmount()
  })
  it('keeps an in-flight review visible when durable saving progress arrives before the response', async () => {
    const f = fixture()
    let resolveReview!: (value: PlatformLearningSnapshot) => void
    f.transport.review = vi.fn(async () => {
      const saving = snapshot()
      saving.candidates[0]!.status = 'saving'
      f.replace(saving)
      return new Promise<PlatformLearningSnapshot>((resolve) => {
        resolveReview = resolve
      })
    })
    const wrapper = mount(ShopIntentLearnPanel, f.options)
    try {
      await chooseProducts(wrapper)
      await wrapper.get('.runtime-entry').trigger('click')
      await wrapper.get('input[type="checkbox"]').setValue(true)
      await wrapper.get('form').trigger('submit')
      await flushPromises()
      await button(wrapper, '刷新任务').trigger('click')
      await flushPromises()
      expect(wrapper.find('form').exists()).toBe(true)
      const saved = snapshot()
      saved.candidates[0]!.status = 'saved'
      f.replace(saved)
      resolveReview(saved)
      await flushPromises()
      expect(wrapper.text()).toContain('已保存为停用知识包')
      expect(wrapper.get('.runtime-entry').attributes('disabled')).toBeDefined()
    } finally {
      wrapper.unmount()
    }
  })
  it('opens only the selected store and platform source through the injected transport', async () => {
    const f = fixture()
    f.transport.openSource = vi.fn(async () => {})
    const wrapper = mount(ShopIntentLearnPanel, f.options)
    await chooseProducts(wrapper)
    await button(wrapper, '打开平台原页').trigger('click')
    await flushPromises()
    expect(f.transport.openSource).toHaveBeenCalledWith({
      workspaceId,
      storeId: 'shop',
      source: 'products',
    })
    wrapper.unmount()
  })
})

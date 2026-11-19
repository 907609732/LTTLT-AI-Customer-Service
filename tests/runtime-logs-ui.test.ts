import { afterEach, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import ElementPlus from 'element-plus'
import { emptySnapshot } from '../src/shared/contracts/backend'
import { useRuntimeStore } from '../src/shared/state/runtime'
import RuntimeLogsView from '../src/modules/auxiliary/components/RuntimeLogsView.vue'
const desktop = vi.hoisted(() => ({
  isElectron: true,
  isAlwaysOnTop: vi.fn(),
  setAlwaysOnTop: vi.fn(),
  minimize: vi.fn(),
  close: vi.fn(),
}))
vi.mock('../src/shared/platform/desktop', () => ({ getDesktop: () => desktop }))
afterEach(() => vi.clearAllMocks())
async function setup() {
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    value: vi.fn(),
  })
  setActivePinia(createPinia())
  const runtime = useRuntimeStore()
  runtime.available = true
  runtime.snapshot = emptySnapshot()
  runtime.snapshot.review.replies = [
    {
      id: 'pending',
      at: 1,
      storeId: 's',
      storeName: 'fixture',
      uid: 'u',
      buyerName: 'buyer',
      text: '等待核对',
      traceId: '',
      status: 'pending',
      reason: '',
    },
  ]
  runtime.snapshot.review.logs = [
    {
      id: 'log',
      at: 1,
      storeId: 's',
      storeName: 'fixture',
      uid: 'u',
      buyerName: 'buyer',
      kind: 'test',
      text: 'fixture log',
    },
  ]
  desktop.isAlwaysOnTop.mockResolvedValue(true)
  desktop.setAlwaysOnTop.mockImplementation(async (value) => value)
  const run = vi.spyOn(runtime, 'run').mockImplementation(async () => {
    runtime.snapshot.review.logs = []
    return { status: 'ok', message: '已清除日志；待确认保留', data: {} }
  })
  const view = mount(RuntimeLogsView, { global: { plugins: [ElementPlus] } })
  await flushPromises()
  return { view, runtime, run }
}
it('toggles the actual pin state and keeps the clear action separate from reply approval', async () => {
  const { view, runtime, run } = await setup()
  let pin = view.findAll('button').find((b) => b.text() === '取消置顶')!
  expect(pin.attributes('aria-pressed')).toBe('true')
  await pin.trigger('click')
  await flushPromises()
  expect(desktop.setAlwaysOnTop).toHaveBeenLastCalledWith(false)
  pin = view.findAll('button').find((b) => b.text() === '置顶')!
  expect(pin.attributes('aria-pressed')).toBe('false')
  await pin.trigger('click')
  await flushPromises()
  expect(desktop.setAlwaysOnTop).toHaveBeenLastCalledWith(true)
  await view
    .findAll('button')
    .find((b) => b.text() === '清除日志')!
    .trigger('click')
  await flushPromises()
  expect(run).toHaveBeenCalledWith({ action: 'clear-runtime-logs' })
  expect(runtime.snapshot.review.replies[0]?.status).toBe('pending')
  expect(view.text()).toContain('待确认保留')
  expect(run.mock.calls.some(([input]) => input.action === 'review-reply')).toBe(false)
  view.unmount()
})
it('shows pre-submission model failures in AI context debugging', async () => {
  const { view, runtime } = await setup()
  runtime.snapshot.review.traces = [
    {
      id: 'trace',
      at: 1,
      startedAt: 1,
      purpose: 'reply',
      storeId: 's',
      storeName: 'fixture',
      uid: 'u',
      buyerName: 'buyer',
      model: 'fixture-vision',
      messages: '尚未构造正式模型 messages。',
      thread: '[{"from":"buyer","type":"image","content":"[图片]"}]',
      reply: '',
      error: 'vision_unavailable',
    },
  ]
  await flushPromises()
  await view.get('.el-tabs__item:nth-child(3)').trigger('click')
  await flushPromises()
  expect(view.text()).toContain('模型请求未提交')
  expect(view.text()).toContain('vision_unavailable')
  expect(view.text()).toContain('尚未构造正式模型 messages。')
  view.unmount()
})
it('shows pin failures without claiming the native state changed', async () => {
  const { view } = await setup()
  desktop.setAlwaysOnTop.mockRejectedValueOnce(Error('设置失败'))
  await view
    .findAll('button')
    .find((b) => b.text() === '取消置顶')!
    .trigger('click')
  await flushPromises()
  expect(view.text()).toContain('设置失败')
  expect(
    view
      .findAll('button')
      .find((b) => b.text() === '取消置顶')
      ?.attributes('aria-pressed'),
  ).toBe('true')
  view.unmount()
})

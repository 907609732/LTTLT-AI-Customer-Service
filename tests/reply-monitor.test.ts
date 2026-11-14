import { afterEach, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import ReplyMonitorView from '../src/modules/auxiliary/components/ReplyMonitorView.vue'
import { useRuntimeStore } from '../src/shared/state/runtime'

const wrappers: ReturnType<typeof mount>[] = []
afterEach(() => wrappers.splice(0).forEach((wrapper) => wrapper.unmount()))
function fixture(mode: 'review' | 'auto' = 'review') {
  const pinia = createPinia()
  setActivePinia(pinia)
  const runtime = useRuntimeStore()
  runtime.snapshot.stores = [
    {
      id: 'shop',
      storeName: '测试店',
      platform: 'sim-local',
      group: '',
      aiEnabled: true,
      sendMode: mode,
      runtime: { open: true, online: true },
    },
  ]
  runtime.snapshot.review.replies = [
    {
      id: 'reply',
      at: 1,
      storeId: 'shop',
      storeName: '测试店',
      uid: 'buyer',
      buyerName: '测试顾客',
      text: '这是待确认的回复',
      traceId: '',
      status: 'pending',
      reason: '等待用户确认',
    },
  ]
  const run = vi.spyOn(runtime, 'run').mockResolvedValue({ status: 'ok', message: '', data: {} })
  const wrapper = mount(ReplyMonitorView, { global: { plugins: [pinia] } })
  wrappers.push(wrapper)
  return { wrapper, runtime, run }
}
it('审核候选只在显式点击时提交决定，关闭和查看日志不构成批准', async () => {
  const { wrapper, run } = fixture()
  expect(wrapper.text()).toContain('测试店')
  expect(wrapper.text()).toContain('测试顾客')
  expect(wrapper.text()).toContain('审核发送')
  expect(run).not.toHaveBeenCalled()
  await wrapper.get('[data-action="approve"]').trigger('click')
  await flushPromises()
  expect(run).toHaveBeenLastCalledWith({
    action: 'review-reply',
    values: { id: 'reply', approve: true },
  })
  await wrapper.get('[data-action="cancel"]').trigger('click')
  await flushPromises()
  expect(run).toHaveBeenLastCalledWith({
    action: 'review-reply',
    values: { id: 'reply', approve: false },
  })
  await wrapper.get('[data-action="logs"]').trigger('click')
  await flushPromises()
  expect(run).toHaveBeenLastCalledWith({ action: 'open-runtime-logs' })
})
it('自动模式保留原候选的人工重试，失效后移除动作并展示原因', async () => {
  const { wrapper, runtime, run } = fixture('auto')
  expect(wrapper.text()).toContain('自动发送')
  expect(wrapper.find('[data-action="approve"]').exists()).toBe(true)
  runtime.snapshot.review.replies[0]!.status = 'failed'
  runtime.snapshot.review.replies[0]!.reason = '发送结果不确定，请核对'
  await flushPromises()
  expect(wrapper.text()).toContain('发送结果不确定，请核对')
  expect(wrapper.find('[data-action="cancel"]').exists()).toBe(false)
  expect(run).not.toHaveBeenCalled()
})
it('执行失败展示错误，处理中禁止重复批准，候选失效后移除批准', async () => {
  const { wrapper, runtime, run } = fixture()
  let reject!: (error: Error) => void
  run.mockImplementationOnce(
    () =>
      new Promise((_, fail) => {
        reject = fail
      }),
  )
  await wrapper.get('[data-action="approve"]').trigger('click')
  expect(wrapper.get('[data-action="approve"]').attributes('disabled')).toBeDefined()
  reject(new Error('候选已失效'))
  await flushPromises()
  expect(wrapper.text()).toContain('候选已失效')
  runtime.snapshot.review.replies[0]!.status = 'expired'
  await flushPromises()
  expect(wrapper.find('[data-action="approve"]').exists()).toBe(false)
})

it('审核候选生成后切到自动模式仍可显式取消，不自行批准旧候选', async () => {
  const { wrapper, runtime, run } = fixture()
  runtime.snapshot.stores[0]!.sendMode = 'auto'
  await flushPromises()
  expect(wrapper.text()).toContain('自动发送')
  expect(run).not.toHaveBeenCalled()
  await wrapper.get('[data-action="cancel"]').trigger('click')
  await flushPromises()
  expect(run).toHaveBeenLastCalledWith({
    action: 'review-reply',
    values: { id: 'reply', approve: false },
  })
})

it('自动候选因暂时不可读留待确认时可显式重试，最新日志更新展示', async () => {
  const { wrapper, runtime, run } = fixture('auto')
  runtime.snapshot.review.replies[0]!.reason = '页面暂时不可读，请稍后重试'
  await flushPromises()
  expect(wrapper.text()).toContain('页面暂时不可读')
  await wrapper.get('[data-action="approve"]').trigger('click')
  await flushPromises()
  expect(run).toHaveBeenLastCalledWith({
    action: 'review-reply',
    values: { id: 'reply', approve: true },
  })
  runtime.snapshot.review.replies[0]!.status = 'sent'
  runtime.snapshot.review.logs.push({
    id: 'new-log',
    at: 2,
    storeId: 'shop',
    storeName: '测试店',
    uid: 'new-buyer',
    buyerName: '新顾客',
    kind: 'error',
    text: '最新页面连接失败',
  })
  await flushPromises()
  expect(wrapper.text()).toContain('新顾客')
  expect(wrapper.text()).toContain('最新页面连接失败')
  expect(wrapper.find('[data-action="approve"]').exists()).toBe(false)
})

it.each(['sent', 'failed'] as const)(
  '发送生命周期的新日志不会遮住候选 %s 状态',
  async (finalStatus) => {
    const { wrapper, runtime } = fixture()
    const candidate = runtime.snapshot.review.replies[0]!
    candidate.status = 'sending'
    candidate.reason = '正在等待平台发送结果'
    runtime.snapshot.review.logs.push({
      id: 'approval-log',
      at: 2,
      storeId: 'shop',
      storeName: '测试店',
      uid: 'buyer',
      buyerName: '测试顾客',
      kind: '确认发送',
      text: candidate.text,
    })
    await flushPromises()
    expect(wrapper.get('.state').text()).toContain('发送中')
    expect(wrapper.text()).toContain('正在等待平台发送结果')
    candidate.status = finalStatus
    candidate.reason =
      finalStatus === 'sent' ? '平台已确认发送' : '发送失败或结果不确定，请在平台核对'
    runtime.snapshot.review.logs.push({
      id: 'result-log',
      at: 3,
      storeId: 'shop',
      storeName: '测试店',
      uid: 'buyer',
      buyerName: '测试顾客',
      kind: finalStatus === 'sent' ? 'reply:sent' : 'reply:error',
      text: finalStatus,
    })
    await flushPromises()
    expect(wrapper.get('.state').text()).toContain(finalStatus === 'sent' ? '已发送' : '需核对发送')
    expect(wrapper.text()).toContain(candidate.reason)
    runtime.snapshot.review.logs.push({
      id: 'buyer-log',
      at: 4,
      storeId: 'shop',
      storeName: '测试店',
      uid: 'buyer',
      buyerName: '测试顾客',
      kind: '买家消息',
      text: '同一买家新的问题',
    })
    await flushPromises()
    expect(wrapper.text()).toContain('同一买家新的问题')
    expect(wrapper.get('.state').text()).not.toContain(
      finalStatus === 'sent' ? '已发送' : '需核对发送',
    )
  },
)

it('发送中候选不会因其他会话最新日志而消失', async () => {
  const { wrapper, runtime } = fixture()
  runtime.snapshot.review.replies[0]!.status = 'sending'
  runtime.snapshot.review.logs.push({
    id: 'other-log',
    at: 3,
    storeId: 'other-shop',
    storeName: '另一店',
    uid: 'buyer',
    buyerName: '另一买家',
    kind: 'reply:sent',
    text: '其他发送结果',
  })
  await flushPromises()
  expect(wrapper.get('.state').text()).toContain('发送中')
  expect(wrapper.text()).toContain('测试店')
  expect(wrapper.text()).not.toContain('另一店')
})

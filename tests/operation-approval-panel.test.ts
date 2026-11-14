import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import OperationApprovalPanel from '../src/modules/reception/components/OperationApprovalPanel.vue'
import type { SchedulerRun } from '../src/shared/contracts/scheduler'
function run(id: string): SchedulerRun {
  const now = Date.now()
  return {
    id,
    taskId: 'rule',
    storeId: 's',
    uid: 'u',
    occurrence: now,
    createdAt: now,
    expiresAt: now + 600000,
    state: 'pending',
    reason: '已核对准确目标',
    action: { kind: 'welcome-text', text: `最终内容-${id}` },
    approvalId: `approval-${id}`,
    prepared: {
      runId: id,
      action: { kind: 'welcome-text', text: `最终内容-${id}` },
      target: {
        storeId: 's',
        storeName: '真实店铺',
        uid: 'u',
        buyerName: '真实买家',
        accountId: 'account',
        pageId: 'page',
      },
      basis: {
        accountId: 'account',
        pageId: 'page',
        conversationRevision: 'messages',
        storeRevision: 'open',
      },
      preparedAt: now,
      expiresAt: now + 600000,
      evidence: [{ id: 'baseline', observedAt: now, description: '真实页面消息基线' }],
    },
  }
}
describe('单项批准组件', () => {
  it('催支付最终执行展示原生条款，规则文字明确作为不发送备注', () => {
    const payment = run('payment')
    payment.action = { kind: 'payment-reminder', orderId: 'real-order', text: '自定义规则备注' }
    payment.prepared!.action = payment.action
    payment.prepared!.operationLabel = '承诺24小时发货及揽收'
    const wrapper = mount(OperationApprovalPanel, { props: { workspaceId: 'w', runs: [payment] } })
    const content = wrapper.find('[aria-label="最终执行内容"]')
    expect(content.text()).toContain('承诺24小时发货及揽收')
    expect(content.text()).toContain('备注：自定义规则备注')
    expect(content.text()).toContain('备注不会另发聊天消息')
    wrapper.unmount()
  })
  it('先展示准确目标与最终内容，点击只批准当前一项', async () => {
    const wrapper = mount(OperationApprovalPanel, {
      props: { workspaceId: 'w', runs: [run('first'), run('second')] },
    })
    expect(wrapper.text()).toContain('真实店铺')
    expect(wrapper.text()).toContain('真实买家')
    expect(wrapper.text()).toContain('最终内容-first')
    expect(wrapper.emitted('command')).toBeUndefined()
    const approve = wrapper
      .findAll('button')
      .find((button) => button.text().includes('批准并执行这一项'))!
    await approve.trigger('click')
    await approve.trigger('click')
    expect(wrapper.emitted('command')).toEqual([
      [{ type: 'approve', workspaceId: 'w', id: 'first', approvalId: 'approval-first' }],
    ])
    wrapper.unmount()
  })
  it('取消只发取消命令，未知结果只提供只读核对入口', async () => {
    const pending = run('pending'),
      unknown = run('unknown')
    unknown.state = 'uncertain'
    delete unknown.approvalId
    const wrapper = mount(OperationApprovalPanel, { props: { workspaceId: 'w', runs: [pending] } })
    await wrapper
      .findAll('button')
      .find((button) => button.text().includes('取消，不执行'))!
      .trigger('click')
    expect(wrapper.emitted('command')).toEqual([
      [{ type: 'cancel', workspaceId: 'w', id: 'pending' }],
    ])
    await wrapper.setProps({ runs: [unknown] })
    expect(wrapper.findAll('button').some((button) => button.text().includes('批准并执行'))).toBe(
      false,
    )
    await wrapper
      .findAll('button')
      .find((button) => button.text().includes('只读核对'))!
      .trigger('click')
    expect(wrapper.emitted('command')?.at(-1)).toEqual([
      { type: 'inspect', workspaceId: 'w', id: 'unknown' },
    ])
    wrapper.unmount()
  })
  it('媒体批准显示实际预览、大小与类型，不能将图片当文字', () => {
    const image = run('image')
    image.action = { kind: 'welcome-image', url: 'https://example.com/verified.png' }
    image.prepared!.action = image.action
    image.prepared!.media = { mimeType: 'image/png', sizeBytes: 1024, sha256: 'a'.repeat(64) }
    const wrapper = mount(OperationApprovalPanel, { props: { workspaceId: 'w', runs: [image] } })
    expect(wrapper.find('img').attributes('src')).toBe('https://example.com/verified.png')
    expect(wrapper.text()).toContain('image/png')
    expect(wrapper.text()).toContain('1.0 KB')
    wrapper.unmount()
  })
  it('换工作区清除所选旧批准，过期项不能执行', async () => {
    const first = run('first')
    const wrapper = mount(OperationApprovalPanel, { props: { workspaceId: 'w', runs: [first] } })
    await wrapper.setProps({ workspaceId: 'new', runs: [] })
    expect(wrapper.text()).not.toContain('最终内容-first')
    const expired = run('expired')
    expired.expiresAt = Date.now() - 1
    await wrapper.setProps({ runs: [expired] })
    const approve = wrapper
      .findAll('button')
      .find((button) => button.text().includes('批准并执行'))!
    expect(approve.attributes('disabled')).toBeDefined()
    wrapper.unmount()
  })
})

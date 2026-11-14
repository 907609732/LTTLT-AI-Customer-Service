import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import ReceptionRulesPanel from '../src/modules/reception/components/ReceptionRulesPanel.vue'
import type { ReceptionSnapshot } from '../src/shared/contracts/platform-operations'
const snapshot: ReceptionSnapshot = {
  workspaceId: 'w',
  rules: [],
  runs: [],
  facts: [
    {
      storeId: 's',
      storeName: '本店',
      accountId: 'account',
      observedAt: Date.now(),
      capabilities: [
        { kind: 'welcome-image', available: false, reason: '媒体回显能力未验证' },
        { kind: 'payment-reminder', available: true, reason: '实际订单与平台催支付按钮' },
        { kind: 'transfer', available: true, reason: '当前平台客服名单' },
      ],
      buyers: [],
      orders: [{ orderId: 'real-order', uid: 'u', label: '真实待付订单', status: 'unpaid' }],
      agents: [
        { agentId: 'real-agent', name: '真实客服', online: true },
        { agentId: 'offline-agent', name: '离线客服', online: false },
      ],
    },
  ],
}
describe('接待规则配置使用平台事实', () => {
  it('视频从平台已审核素材下拉选择并预览，不使用通用文件输入框', async () => {
    const value = structuredClone(snapshot)
    Object.assign(value.facts[0], {
      mediaAssets: [
        {
          id: 'video1',
          name: '原生素材视频',
          kind: 'video',
          url: 'https://example.com/library.mp4',
          sizeBytes: 1024,
        },
      ],
    })
    const wrapper = mount(ReceptionRulesPanel, {
      props: { workspaceId: 'w', storeId: 's', trigger: 'visitor', snapshot: value },
    })
    await wrapper
      .findAll('button')
      .find((b) => b.text() === '添加媒体')!
      .trigger('click')
    await wrapper.find('select').setValue('welcome-video')
    const library = wrapper.find('select[aria-label="平台已审核视频素材"]')
    expect(library.exists()).toBe(true)
    await library.setValue('https://example.com/library.mp4')
    expect(wrapper.find('video').attributes('src')).toBe('https://example.com/library.mp4')
    await wrapper.find('form').trigger('submit')
    expect(wrapper.emitted('command')?.[0]?.[0]).toMatchObject({
      rule: { actions: [{ kind: 'welcome-video', url: 'https://example.com/library.mp4' }] },
    })
    wrapper.unmount()
  })
  it('平台事件采集失败保持可见，不把读取失败显示为没有事项', () => {
    const wrapper = mount(ReceptionRulesPanel, {
      props: {
        workspaceId: 'w',
        storeId: 's',
        trigger: 'visitor',
        snapshot: { ...snapshot, error: '平台事件读取失败，不能确认访客范围' },
      },
    })
    expect(wrapper.text()).toContain('平台事件读取失败，不能确认访客范围')
    wrapper.unmount()
  })
  it('首次保存成功后继续编辑沿用同一规则ID和最新版本', async () => {
    const wrapper = mount(ReceptionRulesPanel, {
      props: { workspaceId: 'w', storeId: 's', trigger: 'unpaid-order', snapshot },
    })
    await wrapper.find('textarea').setValue('首次内容')
    await wrapper.find('form').trigger('submit')
    const first = wrapper.emitted('command')?.[0]?.[0] as {
      rule: import('../src/shared/contracts/platform-operations').ReceptionRule
    }
    await wrapper.setProps({ snapshot: { ...snapshot, rules: [{ ...first.rule, revision: 1 }] } })
    await wrapper.find('textarea').setValue('修改内容')
    await wrapper.find('form').trigger('submit')
    expect(wrapper.emitted('command')?.[1]?.[0]).toMatchObject({
      rule: {
        id: first.rule.id,
        revision: 1,
        actions: [{ kind: 'payment-reminder', text: '修改内容' }],
      },
    })
    wrapper.unmount()
  })
  it('催付模板不接受手填订单号，保存后由可信事件绑定当前订单', async () => {
    const wrapper = mount(ReceptionRulesPanel, {
      props: { workspaceId: 'w', storeId: 's', trigger: 'unpaid-order', snapshot },
    })
    expect(wrapper.text()).toContain('真实待付订单')
    expect(wrapper.find('input[name="orderId"]').exists()).toBe(false)
    await wrapper.find('textarea').setValue('请核对当前订单')
    await wrapper.find('form').trigger('submit')
    const command = wrapper.emitted('command')?.[0]?.[0]
    expect(command).toMatchObject({
      type: 'save-rule',
      workspaceId: 'w',
      rule: {
        storeId: 's',
        enabled: false,
        trigger: 'unpaid-order',
        actions: [{ kind: 'payment-reminder', text: '请核对当前订单' }],
      },
    })
    expect(JSON.stringify(command)).not.toContain('orderId')
    wrapper.unmount()
  })
  it('平台客服来自真实名单，离线客服不可选', async () => {
    const wrapper = mount(ReceptionRulesPanel, {
      props: { workspaceId: 'w', storeId: 's', trigger: 'transfer-request', snapshot },
    })
    expect(wrapper.findAll('option').some((option) => option.text().includes('真实客服'))).toBe(
      true,
    )
    const offline = wrapper.findAll('option').find((option) => option.text().includes('离线客服'))!
    expect(offline.attributes('disabled')).toBeDefined()
    await wrapper.find('select').setValue('real-agent')
    await wrapper.find('form').trigger('submit')
    expect(wrapper.emitted('command')?.[0]?.[0]).toMatchObject({
      rule: { actions: [{ kind: 'transfer', agentId: 'real-agent' }] },
    })
    wrapper.unmount()
  })
  it('欢迎媒体最多四项，每项有预览且未验证状态可见', async () => {
    const wrapper = mount(ReceptionRulesPanel, {
      props: { workspaceId: 'w', storeId: 's', trigger: 'visitor', snapshot },
    })
    const add = () => wrapper.findAll('button').find((button) => button.text() === '添加媒体')!
    for (let index = 0; index < 4; index++) await add().trigger('click')
    expect(add().attributes('disabled')).toBeDefined()
    expect(wrapper.findAll('input[type="url"]')).toHaveLength(4)
    await wrapper.find('input[type="url"]').setValue('https://example.com/preview.png')
    expect(wrapper.find('img').attributes('src')).toBe('https://example.com/preview.png')
    expect(wrapper.text()).toContain('媒体回显能力未验证')
    wrapper.unmount()
  })
})

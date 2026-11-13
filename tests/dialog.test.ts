import { afterEach, describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import ElementPlus from 'element-plus'
import ContactQrTrigger from '../src/shared/ui/ContactQrTrigger.vue'

describe('本地二维码交互', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })
  it('默认关闭，点击打开，关闭时不触发业务占位提示', async () => {
    const wrapper = mount(ContactQrTrigger, {
      attachTo: document.body,
      global: { plugins: [ElementPlus] },
    })
    expect(document.body.querySelector('.el-dialog')).toBeNull()
    await wrapper.find('button').trigger('click')
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(document.body.querySelector('.el-dialog')).not.toBeNull()
    expect(document.body.textContent).toContain('灵兔 AI · 联系方式')
    expect(document.body.textContent).toContain('灵兔 AI 联系方式暂未配置。')
    expect(document.body.querySelector('img[alt="客服二维码"]')).toBeNull()
    expect(document.body.querySelector('.el-message')).toBeNull()
    wrapper.unmount()
  })
})

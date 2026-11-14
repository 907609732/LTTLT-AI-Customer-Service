import { afterEach, describe, expect, it, vi } from 'vitest'
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import ElementPlus from 'element-plus'
import QuickReplyCustomLibrary from '../src/modules/workbench/components/QuickReplyCustomLibrary.vue'
import * as service from '../src/modules/workbench/services/custom-phrases'

let wrapper: VueWrapper | undefined
afterEach(() => {
  wrapper?.unmount()
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})
const row = {
  id: '0fe3f83e-a41a-4b39-98e7-15eae67d0673',
  title: '核对物流',
  scene: '物流',
  reply: '请稍候，我先核实。',
}
function setup() {
  vi.spyOn(service, 'phraseStores').mockResolvedValue({
    workspaceId: 'w1',
    stores: [{ id: 's1', name: '测试店铺' }],
  })
  vi.spyOn(service.customPhrases, 'list').mockResolvedValue({ revision: 1, rows: [row] })
  wrapper = mount(QuickReplyCustomLibrary, {
    global: { plugins: [ElementPlus] },
    attachTo: document.body,
  })
  return wrapper
}
async function button(label: string) {
  const found = wrapper!.findAll('button').find((item) => item.text() === label)
  expect(found, label).toBeTruthy()
  await found!.trigger('click')
  await flushPromises()
}
describe('自定义话术界面', () => {
  it('选择JSON文件后先预览，不自动保存或发送', async () => {
    const view = setup()
    await flushPromises()
    const text = JSON.stringify({
      version: 1,
      phrases: [{ title: row.title, scene: row.scene, reply: row.reply }],
    })
    const read = vi.spyOn(service, 'readPhraseJsonFile').mockResolvedValue(text)
    const imported = vi.spyOn(service.customPhrases, 'import')
    await button('导入 JSON')
    const input = view.get('[aria-label="选择话术JSON文件"]')
    const file = new File([text], 'phrases.json', { type: 'application/json' })
    Object.defineProperty(input.element, 'files', { value: [file], configurable: true })
    await input.trigger('change')
    await flushPromises()
    expect(read).toHaveBeenCalledWith(file)
    expect(view.text()).toContain('待导入 1 条')
    expect(imported).not.toHaveBeenCalled()
  })
  it('账号工作区变化时立即隐藏旧话术并取消草稿', async () => {
    let changed: ((workspaceId: string, stores: string[]) => void) | undefined
    const stop = vi.fn()
    vi.spyOn(service, 'observePhraseWorkspace').mockImplementation((listener) => {
      changed = listener
      return stop
    })
    const view = setup()
    await flushPromises()
    await button('编辑')
    expect(view.text()).toContain(row.reply)
    changed!('another-account', ['s1'])
    await flushPromises()
    expect(view.findAll('.custom-row')).toHaveLength(0)
    expect(view.find('[aria-label="话术正文"]').exists()).toBe(false)
    expect(view.text()).toContain('旧话术已隐藏')
    view.unmount()
    wrapper = undefined
    expect(stop).toHaveBeenCalledOnce()
  })
  it('失败时明确提示且不能创建或导出', async () => {
    vi.spyOn(service, 'phraseStores').mockRejectedValue(new Error('浏览器仅预览'))
    wrapper = mount(QuickReplyCustomLibrary, { global: { plugins: [ElementPlus] } })
    await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toContain('浏览器仅预览')
    expect(
      wrapper
        .findAll('button')
        .find((item) => item.text() === '新建话术')!
        .attributes('disabled'),
    ).toBeDefined()
  })
  it('创建必须保存成功才更新列表，保存内容携带工作区店铺及修订号', async () => {
    const view = setup()
    await flushPromises()
    const save = vi.spyOn(service.customPhrases, 'save').mockResolvedValue({
      revision: 2,
      rows: [row, { ...row, title: '新话术', id: 'ce5c4c43-c541-47c4-90ee-e1662c441643' }],
    })
    await button('新建话术')
    await view.get('[aria-label="话术标题"]').setValue('新话术')
    await view.get('[aria-label="话术场景"]').setValue('物流')
    await view.get('[aria-label="话术正文"]').setValue('请稍候，我先核实。')
    await button('保存话术')
    expect(save).toHaveBeenCalledWith(
      { workspaceId: 'w1', storeId: 's1' },
      { revision: 1, id: undefined, draft: { title: '新话术', scene: '物流', reply: row.reply } },
    )
    expect(view.findAll('.custom-row')).toHaveLength(2)
  })
  it('复制只提交已保存的 ID；删除必须显式确认', async () => {
    setup()
    await flushPromises()
    const copy = vi.spyOn(service.customPhrases, 'copy').mockResolvedValue()
    const remove = vi
      .spyOn(service.customPhrases, 'remove')
      .mockResolvedValue({ revision: 2, rows: [] })
    await button('复制话术')
    expect(copy).toHaveBeenCalledWith({ workspaceId: 'w1', storeId: 's1' }, row.id)
    await button('删除')
    expect(remove).not.toHaveBeenCalled()
    await button('取消删除')
    expect(remove).not.toHaveBeenCalled()
    await button('删除')
    await button('确认删除')
    expect(remove).toHaveBeenCalledWith(
      { workspaceId: 'w1', storeId: 's1' },
      { revision: 1, id: row.id },
    )
  })
  it('导入先展示校验错误；失败后保留现有列表与草稿', async () => {
    const view = setup()
    await flushPromises()
    const imported = vi
      .spyOn(service.customPhrases, 'import')
      .mockRejectedValue(new Error('话术已变化，请刷新'))
    await button('导入 JSON')
    await view.get('[aria-label="导入话术 JSON"]').setValue('{bad')
    expect(view.text()).toContain('格式错误')
    const text = JSON.stringify({
      version: 1,
      phrases: [{ title: row.title, scene: row.scene, reply: row.reply }],
    })
    await view.get('[aria-label="导入话术 JSON"]').setValue(text)
    expect(view.text()).toContain('待导入 1 条')
    await button('确认追加导入')
    expect(imported).toHaveBeenCalledOnce()
    expect(view.text()).toContain('话术已变化')
    expect(view.findAll('.custom-row')).toHaveLength(1)
    expect((view.get('[aria-label="导入话术 JSON"]').element as HTMLTextAreaElement).value).toBe(
      text,
    )
  })
})

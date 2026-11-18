import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { ElMessage } from 'element-plus'
import ReceptionRulesPanel from '../src/modules/reception/components/ReceptionRulesPanel.vue'
import type {
  ReceptionCommand,
  ReceptionRule,
  ReceptionSnapshot,
} from '../src/shared/contracts/platform-operations'

const wrappers: ReturnType<typeof mount>[] = []
afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount())
  vi.restoreAllMocks()
})
beforeEach(() => {
  vi.spyOn(ElMessage, 'success').mockReturnValue({} as never)
})

const image = { kind: 'welcome-image' as const, url: 'https://example.com/a.png' }
const asset = {
  id: 'video1',
  name: '审核视频',
  kind: 'video' as const,
  url: 'https://example.com/v.mp4',
  sizeBytes: 1024,
}
function snapshot(rules: ReceptionRule[] = []): ReceptionSnapshot {
  return {
    workspaceId: 'w',
    rules,
    runs: [],
    facts: [
      {
        storeId: 's',
        storeName: '本店',
        accountId: 'account',
        observedAt: Date.now(),
        capabilities: [
          { kind: 'welcome-image', available: true, reason: '媒体入口可用' },
          { kind: 'welcome-video', available: true, reason: '审核视频可用' },
        ],
        buyers: [],
        orders: [],
        agents: [],
        mediaAssets: [asset],
      },
    ],
  }
}
function rule(actions: ReceptionRule['actions'], revision = 1): ReceptionRule {
  return { id: 'r1', storeId: 's', enabled: true, trigger: 'visitor', actions, revision }
}
function mounted(
  value: ReceptionSnapshot,
  save: (command: ReceptionCommand) => Promise<ReceptionSnapshot | undefined>,
  busy = false,
) {
  const wrapper = mount(ReceptionRulesPanel, {
    props: {
      workspaceId: 'w',
      storeId: 's',
      trigger: 'visitor',
      snapshot: value,
      mediaOnly: true,
      mediaAutosave: true,
      saveMediaRule: save,
      busy,
    },
  })
  wrappers.push(wrapper)
  return wrapper
}
function confirmed(next: ReceptionRule): ReceptionSnapshot {
  return snapshot([next])
}

it('空白新行只保留草稿，不调用保存也不提示成功；有效 URL 失焦后才保存', async () => {
  const save = vi.fn(async (command: ReceptionCommand) =>
    command.type === 'save-rule' ? confirmed({ ...command.rule, revision: 1 }) : snapshot(),
  )
  const wrapper = mounted(snapshot(), save)
  await wrapper
    .findAll('button')
    .find((button) => button.text() === '添加媒体')!
    .trigger('click')
  await flushPromises()
  expect(save).not.toHaveBeenCalled()
  expect(ElMessage.success).not.toHaveBeenCalled()
  expect(wrapper.find('button.primary').exists()).toBe(false)
  expect(wrapper.text()).not.toContain('保存接待规则')

  const url = wrapper.get('input[type="url"]')
  await url.setValue(image.url)
  await url.trigger('blur')
  await flushPromises()
  expect(save).toHaveBeenCalledTimes(1)
  expect(save.mock.calls[0]![0]).toMatchObject({
    type: 'save-rule',
    rule: { storeId: 's', trigger: 'visitor', actions: [image] },
  })
  expect(ElMessage.success).toHaveBeenCalledTimes(1)
})

it('移除最后一项已存媒体且没有隐藏文字时删除整条规则', async () => {
  const save = vi.fn<(command: ReceptionCommand) => Promise<ReceptionSnapshot>>(async () =>
    snapshot(),
  )
  const wrapper = mounted(snapshot([rule([image], 2)]), save)
  await wrapper
    .findAll('button')
    .find((button) => button.text() === '移除此媒体')!
    .trigger('click')
  await flushPromises()
  expect(save).toHaveBeenCalledTimes(1)
  expect(save.mock.calls[0]![0]).toEqual({
    type: 'remove-rule',
    workspaceId: 'w',
    id: 'r1',
    revision: 2,
  })
  expect(wrapper.findAll('article.media-row')).toHaveLength(0)
  expect(ElMessage.success).toHaveBeenCalledTimes(1)
})

it('移除最后一项媒体但仍有隐藏欢迎文字时保留文字动作', async () => {
  const textAction = { kind: 'welcome-text' as const, text: '欢迎光临' }
  const save = vi.fn(async (command: ReceptionCommand) =>
    command.type === 'save-rule' ? confirmed({ ...command.rule, revision: 2 }) : snapshot(),
  )
  const wrapper = mounted(snapshot([rule([textAction, image], 1)]), save)
  await wrapper
    .findAll('button')
    .find((button) => button.text() === '移除此媒体')!
    .trigger('click')
  await flushPromises()
  expect(save).toHaveBeenCalledTimes(1)
  expect(save.mock.calls[0]![0]).toMatchObject({
    type: 'save-rule',
    rule: { id: 'r1', actions: [textAction] },
  })
  expect(ElMessage.success).toHaveBeenCalledTimes(1)
})

it('媒体类型切换与平台审核视频选择立即保存，视频只能来自审核素材', async () => {
  const save = vi.fn(async (command: ReceptionCommand) =>
    command.type === 'save-rule' ? confirmed({ ...command.rule, revision: 1 }) : snapshot(),
  )
  const wrapper = mounted(snapshot(), save)
  await wrapper
    .findAll('button')
    .find((button) => button.text() === '添加媒体')!
    .trigger('click')
  const kind = wrapper.findAll('select')[0]!
  await kind.setValue('welcome-video')
  await flushPromises()
  expect(save).not.toHaveBeenCalled()

  const library = wrapper.get('select[aria-label="平台已审核视频素材"]')
  await library.setValue(asset.url)
  await flushPromises()
  expect(save).toHaveBeenCalledTimes(1)
  expect(save.mock.calls[0]![0]).toMatchObject({
    type: 'save-rule',
    rule: { actions: [{ kind: 'welcome-video', url: asset.url }] },
  })
})

it('保存失败或未确认快照时显示错误、不提示成功', async () => {
  const save = vi.fn(async () => undefined)
  const wrapper = mounted(snapshot(), save)
  await wrapper
    .findAll('button')
    .find((button) => button.text() === '添加媒体')!
    .trigger('click')
  const url = wrapper.get('input[type="url"]')
  await url.setValue(image.url)
  await url.trigger('blur')
  await flushPromises()
  expect(save).toHaveBeenCalledTimes(1)
  expect(wrapper.text()).toContain('无法确认媒体保存结果')
  expect(ElMessage.success).not.toHaveBeenCalled()
})

it('operations busy 时仍提交媒体自动保存，不丢编辑', async () => {
  const save = vi.fn(async (command: ReceptionCommand) =>
    command.type === 'save-rule' ? confirmed({ ...command.rule, revision: 1 }) : snapshot(),
  )
  const wrapper = mounted(snapshot(), save, true)
  await wrapper
    .findAll('button')
    .find((button) => button.text() === '添加媒体')!
    .trigger('click')
  const url = wrapper.get('input[type="url"]')
  await url.setValue(image.url)
  await url.trigger('blur')
  await flushPromises()
  expect(save).toHaveBeenCalledTimes(1)
  expect(ElMessage.success).toHaveBeenCalledTimes(1)
})

it('保存期间继续编辑的媒体草稿在确认回执后保留，并用推进后的 revision 再保存', async () => {
  const resolvers: ((value: ReceptionSnapshot | undefined) => void)[] = []
  const save = vi.fn<(command: ReceptionCommand) => Promise<ReceptionSnapshot | undefined>>(
    () =>
      new Promise<ReceptionSnapshot | undefined>((resolve) => {
        resolvers.push(resolve)
      }),
  )
  const wrapper = mounted(snapshot(), save)
  await wrapper
    .findAll('button')
    .find((button) => button.text() === '添加媒体')!
    .trigger('click')
  const url = wrapper.get('input[type="url"]')
  await url.setValue(image.url)
  await url.trigger('blur')
  await flushPromises()
  expect(save).toHaveBeenCalledTimes(1)

  await url.setValue('https://example.com/b.png')
  const first = save.mock.calls[0]![0] as Extract<ReceptionCommand, { type: 'save-rule' }>
  resolvers.shift()!(
    confirmed({ ...first.rule, actions: [{ kind: 'welcome-image', url: image.url }], revision: 1 }),
  )
  await flushPromises()
  expect(wrapper.get<HTMLInputElement>('input[type="url"]').element.value).toBe(
    'https://example.com/b.png',
  )

  await wrapper.get('input[type="url"]').trigger('blur')
  await flushPromises()
  expect(save).toHaveBeenCalledTimes(2)
  expect(save.mock.calls[1]![0]).toMatchObject({
    type: 'save-rule',
    rule: { revision: 1, actions: [{ kind: 'welcome-image', url: 'https://example.com/b.png' }] },
  })
})

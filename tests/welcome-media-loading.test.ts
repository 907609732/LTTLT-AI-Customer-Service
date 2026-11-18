import { mount, flushPromises } from '@vue/test-utils'
import { afterEach, expect, it, vi } from 'vitest'
import ReceptionRulesPanel from '../src/modules/reception/components/ReceptionRulesPanel.vue'
import type {
  ReceptionCommand,
  ReceptionSnapshot,
} from '../src/shared/contracts/platform-operations'

const wrappers: ReturnType<typeof mount>[] = []
afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount())
  vi.restoreAllMocks()
})
const saved: ReceptionSnapshot = {
  workspaceId: 'w',
  facts: [],
  runs: [],
  rules: [
    {
      id: 'existing-visitor',
      storeId: 's',
      trigger: 'visitor',
      enabled: true,
      revision: 4,
      actions: [{ kind: 'welcome-text', text: '原有隐藏欢迎语' }],
    },
  ],
}
it('waits for the authoritative initial media rule and preserves its hidden text', async () => {
  const save = vi.fn(async (command: ReceptionCommand): Promise<ReceptionSnapshot | undefined> => {
    if (command.type !== 'save-rule') return undefined
    return { ...saved, rules: [{ ...command.rule, revision: 5 }] }
  })
  const wrapper = mount(ReceptionRulesPanel, {
    props: {
      workspaceId: 'w',
      storeId: 's',
      trigger: 'visitor',
      mediaOnly: true,
      mediaAutosave: true,
      saveMediaRule: save,
    },
  })
  wrappers.push(wrapper)
  const add = () => wrapper.findAll('button').find((button) => button.text() === '添加媒体')!
  expect(add().attributes('disabled')).toBeDefined()
  await wrapper.get('form').trigger('submit')
  await flushPromises()
  expect(save).not.toHaveBeenCalled()
  await wrapper.setProps({ snapshot: structuredClone(saved) })
  await add().trigger('click')
  await wrapper.get('input[type="url"]').setValue('https://example.invalid/media.png')
  await wrapper.get('input[type="url"]').trigger('blur')
  await flushPromises()
  expect(save).toHaveBeenCalledOnce()
  expect(save.mock.calls[0]![0]).toMatchObject({
    type: 'save-rule',
    rule: {
      id: 'existing-visitor',
      revision: 4,
      enabled: true,
      actions: [
        { kind: 'welcome-text', text: '原有隐藏欢迎语' },
        { kind: 'welcome-image', url: 'https://example.invalid/media.png' },
      ],
    },
  })
})
it('blocks a stale new-rule draft if another window creates the visitor rule first', async () => {
  const save = vi.fn(async (): Promise<ReceptionSnapshot | undefined> => undefined)
  const wrapper = mount(ReceptionRulesPanel, {
    props: {
      workspaceId: 'w',
      storeId: 's',
      trigger: 'visitor',
      mediaOnly: true,
      mediaAutosave: true,
      saveMediaRule: save,
      snapshot: { ...saved, rules: [] },
    },
  })
  wrappers.push(wrapper)
  await wrapper
    .findAll('button')
    .find((button) => button.text() === '添加媒体')!
    .trigger('click')
  await wrapper.get('input[type="url"]').setValue('https://example.invalid/draft.png')
  await wrapper.setProps({ snapshot: structuredClone(saved) })
  await wrapper.get('input[type="url"]').trigger('blur')
  await flushPromises()
  expect(save).not.toHaveBeenCalled()
  expect(wrapper.text()).toContain('其他窗口更新')
})

it('preserves enabled intent when new media replaces a pending last-media deletion', async () => {
  const initial: ReceptionSnapshot = {
    ...saved,
    rules: [
      {
        id: 'enabled-media',
        storeId: 's',
        trigger: 'visitor',
        enabled: true,
        revision: 3,
        actions: [{ kind: 'welcome-image', url: 'https://example.invalid/a.png' }],
      },
    ],
  }
  let complete!: (value: ReceptionSnapshot) => void
  const removal = new Promise<ReceptionSnapshot>((resolve) => {
    complete = resolve
  })
  const save = vi.fn(async (command: ReceptionCommand): Promise<ReceptionSnapshot | undefined> => {
    if (command.type === 'remove-rule') return removal
    if (command.type === 'save-rule')
      return { ...initial, rules: [{ ...command.rule, revision: 1 }] }
    return undefined
  })
  const wrapper = mount(ReceptionRulesPanel, {
    props: {
      workspaceId: 'w',
      storeId: 's',
      trigger: 'visitor',
      mediaOnly: true,
      mediaAutosave: true,
      saveMediaRule: save,
      snapshot: initial,
    },
  })
  wrappers.push(wrapper)
  await wrapper
    .findAll('button')
    .find((button) => button.text() === '移除此媒体')!
    .trigger('click')
  await wrapper
    .findAll('button')
    .find((button) => button.text() === '添加媒体')!
    .trigger('click')
  await wrapper.get('input[type="url"]').setValue('https://example.invalid/b.png')
  await wrapper.get('input[type="url"]').trigger('blur')
  complete({ ...initial, rules: [] })
  await flushPromises()
  expect(save).toHaveBeenCalledTimes(2)
  expect(save.mock.calls[1]![0]).toMatchObject({
    type: 'save-rule',
    rule: {
      enabled: true,
      actions: [{ kind: 'welcome-image', url: 'https://example.invalid/b.png' }],
    },
  })
})

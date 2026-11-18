import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import ElementPlus from 'element-plus'
import { expect, it, vi } from 'vitest'
import ShopOpsPanel from '../src/modules/reception/components/ShopOpsPanel.vue'
import ReceptionRulesPanel from '../src/modules/reception/components/ReceptionRulesPanel.vue'
import { getDesktop } from '../src/shared/platform/desktop'
import { useRuntimeStore } from '../src/shared/state/runtime'
import type {
  ReceptionSnapshot,
  ReceptionCommand,
} from '../src/shared/contracts/platform-operations'
vi.mock('vue-router', () => ({ useRouter: () => ({ push: vi.fn() }) }))
it('autosaves media independently while imported welcome text remains deferred', async () => {
  const previous = window.yunduoDesktop
  const snapshot: ReceptionSnapshot = {
    workspaceId: 'deferred-media',
    rules: [],
    facts: [],
    runs: [],
  }
  const save = vi.fn(
    async (command: ReceptionCommand): Promise<ReceptionSnapshot> => ({
      ...snapshot,
      rules: command.type === 'save-rule' ? [{ ...command.rule, revision: 1 }] : [],
    }),
  )
  window.yunduoDesktop = {
    ...getDesktop(),
    isElectron: true,
    receptionSnapshot: async () => snapshot,
    receptionExecute: save,
  }
  setActivePinia(createPinia())
  const runtime = useRuntimeStore()
  runtime.snapshot.workspaceId = snapshot.workspaceId
  const run = vi.spyOn(runtime, 'run')
  const wrapper = mount(ShopOpsPanel, {
    props: {
      viewKey: 'welcome',
      storeId: 's',
      embedded: true,
      deferredSave: true,
      setupDraft: {
        welcome: { text: '导入欢迎', enabled: true, delayMinSeconds: 1, delayMaxSeconds: 3 },
        handoff: { inherited: true, keywords: [] },
      },
    },
    global: { plugins: [ElementPlus] },
  })
  try {
    await flushPromises()
    expect(wrapper.findComponent(ReceptionRulesPanel).props('mediaAutosave')).toBe(true)
    const text = wrapper.get('textarea[aria-label="文字欢迎语"]')
    await text.setValue('仍在草稿里的欢迎语')
    await text.trigger('blur')
    expect(run).not.toHaveBeenCalled()
    await wrapper
      .findAll('button')
      .find((button) => button.text() === '添加媒体')!
      .trigger('click')
    await wrapper.get('input[type="url"]').setValue('https://example.invalid/deferred.png')
    await wrapper.get('input[type="url"]').trigger('blur')
    await flushPromises()
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'save-rule',
        rule: expect.objectContaining({
          actions: [{ kind: 'welcome-image', url: 'https://example.invalid/deferred.png' }],
        }),
      }),
    )
  } finally {
    wrapper.unmount()
    if (previous) window.yunduoDesktop = previous
    else delete window.yunduoDesktop
    vi.restoreAllMocks()
  }
})

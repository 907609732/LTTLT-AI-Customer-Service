import { mount } from '@vue/test-utils'
import { expect, it } from 'vitest'
import KnowledgeUncertainCall from '../src/modules/knowledge/components/KnowledgeUncertainCall.vue'
import type { KnowledgeJob } from '../src/shared/contracts/knowledge'
function uncertainJob(status: KnowledgeJob['status']): KnowledgeJob {
  return {
    id: 'j',
    kind: 'learn',
    storeId: 's',
    revision: 1,
    status,
    payload: {},
    checkpoint: { state: 'submitted' },
    progress: { completed: 0, total: 2 },
    error: '',
    createdAt: 1,
    updatedAt: 1,
  }
}
it.each(['cancelled', 'succeeded', 'running', 'paused'] as const)(
  'hides uncertain recovery actions for %s jobs even with a submitted checkpoint',
  (status) => {
    const job = uncertainJob(status)
    const view = mount(KnowledgeUncertainCall, { props: { job, pending: false } })
    expect(view.findAll('button')).toHaveLength(0)
    view.unmount()
  },
)
it('shows separate explicit retry and skip only while awaiting uncertain recovery', () => {
  const view = mount(KnowledgeUncertainCall, {
    props: {
      job: uncertainJob('needs-confirmation'),
      pending: false,
    },
  })
  expect(view.findAll('button')).toHaveLength(2)
  view.unmount()
})
import { flushPromises } from '@vue/test-utils'
import KnowledgeDraftEditor from '../src/modules/knowledge/components/KnowledgeDraftEditor.vue'
it('shows persisted diagram evidence and opens its exact image from the review editor', async () => {
  const loaded: string[] = []
  const view = mount(KnowledgeDraftEditor, {
    props: {
      draft: {
        scope: { kind: 'store', storeId: 's' },
        question: '连接',
        answer: '圆形指向方框',
        modelEvidence: {
          kind: 'visual-relationship',
          imageAssetId: 'owned-image',
          locator: { page: 2, tile: 3 },
          relation: 'arrow-to',
          from: '圆形',
          to: '方框',
          observation: '圆形指向方框',
        },
      },
      bindings: [],
      stores: [],
      hasCanonical: false,
      loadAsset: async (id) => {
        loaded.push(id)
        return 'data:image/png;base64,AA=='
      },
    },
  })
  expect(view.text()).toContain('图示关系依据 · 待人工复核')
  expect(view.text()).toContain('第2页')
  expect(view.text()).toContain('分块3')
  const button = view.findAll('button').find((b) => b.text().includes('图片'))!
  expect(button.attributes('type')).toBe('button')
  await button.trigger('click')
  await flushPromises()
  expect(loaded).toEqual(['owned-image'])
  expect(view.find('img').attributes('src')).toBe('data:image/png;base64,AA==')
  view.unmount()
})
import KnowledgeJobProgress from '../src/modules/knowledge/components/KnowledgeJobProgress.vue'
it('does not offer a no-op continuation when all learning fragments have already been processed', () => {
  const job = {
    ...uncertainJob('failed'),
    checkpoint: { state: 'ready' },
    progress: { completed: 2, total: 2 },
  }
  const view = mount(KnowledgeJobProgress, { props: { job, pending: false } })
  expect(view.findAll('button').some((b) => b.text() === '继续')).toBe(false)
  expect(view.text()).toContain('重新点击')
  view.unmount()
})

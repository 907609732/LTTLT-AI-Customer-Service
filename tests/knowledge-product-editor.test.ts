import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import { expect, it } from 'vitest'
import KnowledgeProductProfileDialog from '../src/modules/knowledge/components/KnowledgeProductProfileDialog.vue'
import type { KnowledgeProductProfile } from '../src/shared/contracts/knowledge-product-profile'

const profile: KnowledgeProductProfile = {
  canonical: { id: 'c', title: '共享标题', code: 'CODE', revision: 2, updatedAt: 1 },
  binding: {
    id: 'b',
    canonicalId: 'c',
    storeId: 'a',
    productId: 'product-1',
    skuId: '',
    title: '本店标题',
    revision: 3,
    active: true,
    updatedAt: 1,
  },
  title: '本店标题',
  productId: 'product-1',
  storeId: 'a',
  copy: '商品文案',
  copySource: 'platform',
  manualPrice: '',
  notes: '',
  manualSourceId: null,
  manualSourceRevision: null,
  images: [],
  knowledge: { approved: 2, drafts: 1 },
  platformPrice: {
    prices: ['39.90'],
    capturedAt: 1_000,
    expiresAt: 2_000,
    expired: true,
  },
  sources: { count: 1, kinds: ['platform'] },
}

it('renders the dark product editor with empty manual price, separate expired platform price, counts and char count', async () => {
  const wrapper = mount(KnowledgeProductProfileDialog, {
    props: {
      profile,
      staged: [],
      saving: false,
      staging: false,
      error: '',
      loadAsset: async () => 'data:image/png;base64,cG5n',
    },
    attachTo: document.body,
  })
  await nextTick()
  await nextTick()
  expect(wrapper.get('[role="dialog"]').classes()).toContain('knowledge-product-profile')
  expect(wrapper.text()).toContain('本店标题')
  expect(wrapper.text()).toContain('product-1')
  expect(wrapper.get('[aria-label="商品标题"]').element).toBe(document.activeElement)
  expect(wrapper.get('[data-testid="product-manual-price"]').attributes('placeholder')).toBe(
    '未填写',
  )
  expect(wrapper.text()).toContain('39.90')
  expect(wrapper.text()).toContain('已过期')
  expect(wrapper.text()).toContain('2 条已审核')
  expect(wrapper.text()).toContain('1 条草稿')
  expect(wrapper.get('[data-testid="product-copy-count"]').text()).toContain('4 字')
  expect(wrapper.find('.knowledge-product-profile-grid').exists()).toBe(true)
  expect(wrapper.get('footer').text()).toContain('取消')
  expect(wrapper.get('footer').text()).toContain('保存')
  wrapper.unmount()
})

it('keeps staged images removable and returns an opaque token, not a file path', async () => {
  const wrapper = mount(KnowledgeProductProfileDialog, {
    props: {
      profile,
      staged: [
        {
          token: 'opaque-token',
          name: 'add.png',
          mimeType: 'image/png',
          size: 10,
          preview: 'data:image/png;base64,cG5n',
        },
      ],
      saving: false,
      staging: false,
      error: '',
      loadAsset: async () => '',
    },
  })
  await nextTick()
  await nextTick()
  expect(wrapper.findAll('img').some((image) => image.attributes('alt')?.includes('add.png'))).toBe(
    true,
  )
  expect(wrapper.text()).not.toContain('C:\\')
  await wrapper.get('[data-testid="remove-staged-image"]').trigger('click')
  expect(wrapper.emitted('remove-staged')?.[0]).toEqual(['opaque-token'])
  await wrapper.get('[data-testid="add-product-images"]').trigger('click')
  expect(wrapper.emitted('add-images')).toHaveLength(1)
  wrapper.unmount()
})

it('supports Escape and restores focus to the actual edit trigger after close', async () => {
  const trigger = document.createElement('button')
  trigger.textContent = '编辑'
  document.body.append(trigger)
  trigger.focus()
  const wrapper = mount(KnowledgeProductProfileDialog, {
    props: {
      profile,
      staged: [],
      saving: false,
      staging: false,
      error: '',
      loadAsset: async () => '',
      returnFocus: trigger,
    },
    attachTo: document.body,
  })
  await nextTick()
  await nextTick()
  expect(document.activeElement).not.toBe(trigger)
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  expect(wrapper.emitted('cancel')).toHaveLength(1)
  wrapper.unmount()
  expect(document.activeElement).toBe(trigger)
  trigger.remove()
})

it('shows a real save error and does not pretend success while preserving editable fields', async () => {
  const wrapper = mount(KnowledgeProductProfileDialog, {
    props: {
      profile,
      staged: [],
      saving: false,
      staging: false,
      error: '商品资料已变化，请刷新后重试',
      loadAsset: async () => '',
    },
  })
  expect(wrapper.get('[role="alert"]').text()).toContain('商品资料已变化')
  await wrapper.get('[aria-label="商品标题"]').setValue('保留的标题')
  expect((wrapper.get('[aria-label="商品标题"]').element as HTMLInputElement).value).toBe(
    '保留的标题',
  )
  wrapper.unmount()
})

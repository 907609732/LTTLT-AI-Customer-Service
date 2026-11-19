import { mount } from '@vue/test-utils'
import { nextTick, ref } from 'vue'
import { expect, it, vi } from 'vitest'
import KnowledgeProductProfileDialog from '../src/modules/knowledge/components/KnowledgeProductProfileDialog.vue'
import { useKnowledgeProductProfile } from '../src/modules/knowledge/product-profile-controller'
import type { createKnowledgeClient } from '../src/modules/knowledge/manager-service'
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
  expect((wrapper.get('[aria-label="商品 ID"]').element as HTMLInputElement).value).toBe(
    'product-1',
  )
  expect(wrapper.get('.knowledge-product-profile-header').text()).toContain('平台采集')
  expect(wrapper.get('.knowledge-product-profile-header').text()).not.toContain('product-1')
  expect(wrapper.find('.knowledge-product-profile-head-thumb').exists()).toBe(true)
  expect(wrapper.get('.knowledge-product-profile-source').text()).toContain('平台采集')
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

it('opens each existing knowledge panel and creates a knowledge point from inside the dialog', async () => {
  const wrapper = mount(KnowledgeProductProfileDialog, {
    props: {
      profile,
      staged: [],
      saving: false,
      staging: false,
      error: '',
      loadAsset: async () => '',
    },
  })
  const click = async (text: string) => {
    const button = wrapper.findAll('button').find((row) => row.text() === text)
    expect(button).toBeDefined()
    await button!.trigger('click')
  }
  await click('知识点')
  await click('原始资料')
  await click('试问')
  await click('共享与SKU')
  await click('＋ 增加一个知识点')
  expect(wrapper.emitted('open-panel')).toEqual([
    ['qa'],
    ['sources'],
    ['trial'],
    ['bindings'],
    ['qa', true],
  ])
  wrapper.unmount()
})

it('locks close, switching, image choice and every field while the save is in progress', async () => {
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
      saving: true,
      staging: false,
      error: '',
      loadAsset: async () => '',
    },
  })
  for (const selector of [
    '[aria-label="关闭商品编辑"]',
    '[data-testid="add-product-images"]',
    '[data-testid="remove-staged-image"]',
    'footer button',
    'footer button.primary',
  ])
    expect(wrapper.get(selector).attributes('disabled')).toBeDefined()
  for (const selector of [
    '[aria-label="商品标题"]',
    '[data-testid="product-manual-price"]',
    '[aria-label="备注"]',
    '[aria-label="商品文案"]',
  ])
    expect(wrapper.get(selector).attributes('disabled')).toBeDefined()
  for (const button of wrapper.findAll('.knowledge-product-profile-panels button'))
    expect(button.attributes('disabled')).toBeDefined()
  for (const button of wrapper.findAll('.knowledge-product-profile-thumbs button'))
    expect(button.attributes('disabled')).toBeDefined()
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  expect(wrapper.emitted('cancel')).toBeUndefined()
  wrapper.unmount()
})

it('keeps a committed save successful and closes the form even when the follow-up refresh fails', async () => {
  const storeId = ref('a'),
    notice = ref(''),
    pageError = ref('')
  const savedProfile: KnowledgeProductProfile = {
    ...profile,
    title: '已保存标题',
    manualPrice: '18.00',
  }
  const client = {
    productProfile: vi.fn(async () => profile),
    stageProductImages: vi.fn(async () => []),
    discardProductImages: vi.fn(async () => ({ discarded: 0 })),
    discardStagedProductImages: vi.fn(async () => ({ discarded: 0 })),
    saveProductProfile: vi.fn(async () => savedProfile),
  } as unknown as ReturnType<typeof createKnowledgeClient>
  const refresh = vi.fn(async () => {
    throw Error('列表读取失败')
  })
  const controller = useKnowledgeProductProfile({
    client: () => client,
    storeId,
    refresh,
    notice,
    error: pageError,
  })
  await controller.open({
    canonical: profile.canonical,
    binding: profile.binding,
    sources: 0,
    approved: 0,
    drafts: 0,
    sourceSummary: { count: 0, kinds: [], thumbnailAssetId: null },
  })
  controller.updateForm({
    title: '已保存标题',
    manualPrice: '18.00',
    notes: '',
    copy: '',
  })
  expect(await controller.save()).toBe(true)
  expect(controller.profile.value).toBeUndefined()
  expect(controller.form.value).toBeUndefined()
  expect(notice.value).toContain('已保存')
  expect(pageError.value).toContain('列表刷新失败')
  expect(client.saveProductProfile).toHaveBeenCalledTimes(1)
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

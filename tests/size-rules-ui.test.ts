import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import ElementPlus from 'element-plus'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { emptySnapshot } from '../src/shared/contracts/backend'
import { useRuntimeStore } from '../src/shared/state/runtime'
import SizeRulesPanel from '../src/modules/knowledge/components/SizeRulesPanel.vue'

const bridge = vi.hoisted(() => ({ snapshot: vi.fn(), execute: vi.fn(), subscribe: vi.fn() }))
vi.mock('../src/shared/platform/backend', () => ({ getBackendBridge: () => bridge }))
vi.mock('../src/shared/platform/files', () => ({ downloadText: vi.fn() }))
import { downloadText } from '../src/shared/platform/files'

const record = {
  id: '9f7f45ea-896e-4b9a-a78f-2ec39e62fa81',
  version: 1,
  updatedAt: 1,
  name: '本店上衣尺码',
  enabled: true,
  columns: [
    { id: 'c1', name: '胸围', kind: 'number' as const, unit: 'cm' as const },
    { id: 'c2', name: '衣长', kind: 'number' as const, unit: 'cm' as const },
  ],
  rows: [
    { label: 'M', values: { c1: '92~96', c2: '64' } },
    { label: 'L', values: { c1: '96~100', c2: '66' } },
  ],
  advice: '版型偏宽',
  measurements: [{ name: '胸围', unit: 'cm' as const }],
  bindings: [],
}

function listResult(revision = 1) {
  return {
    status: 'ok',
    message: '',
    data: {
      revision,
      total: 1,
      boundProducts: 0,
      units: [{ value: 'cm', label: 'cm', group: 'length' }],
      rules: [record],
    },
  }
}

beforeEach(async () => {
  setActivePinia(createPinia())
  const snapshot = emptySnapshot()
  snapshot.workspaceId = '00000000-0000-4000-8000-000000000001'
  snapshot.stores = [
    {
      id: 's1',
      storeName: '甲店',
      platform: 'sim-local',
      group: '',
      aiEnabled: false,
      runtime: { open: false, online: false },
    },
    {
      id: 's2',
      storeName: '乙店',
      platform: 'sim-local',
      group: '',
      aiEnabled: false,
      runtime: { open: false, online: false },
    },
  ]
  bridge.snapshot.mockResolvedValue(snapshot)
  bridge.execute.mockReset()
  bridge.execute.mockImplementation(async (command: { action: string }) => {
    if (command.action === 'list-size-rules') return listResult()
    if (command.action === 'list-products')
      return {
        status: 'ok',
        message: '',
        data: {
          revision: 1,
          codesRevision: 0,
          total: 1,
          items: [
            {
              id: 'p1',
              version: 1,
              updatedAt: 1,
              storeId: 's1',
              productId: 'A-1',
              title: '测试上衣',
              description: '',
              specifications: '',
              price: '',
              enabled: true,
              merchantCode: '',
              platformDetail: null,
            },
          ],
        },
      }
    if (command.action === 'save-size-rule')
      return {
        status: 'ok',
        message: '',
        data: { rule: { ...record, name: '本店上衣尺码（改）', version: 2 }, revision: 2 },
      }
    if (command.action === 'size-rule-template')
      return {
        status: 'ok',
        message: '',
        data: {
          name: '女装尺码草稿',
          enabled: false,
          columns: [{ id: 'c1', name: '胸围', kind: 'number', unit: 'cm' }],
          rows: [{ label: 'S', values: { c1: '' } }],
          advice: '',
          measurements: [],
          bindings: [],
        },
      }
    return { status: 'ok', message: '', data: {} }
  })
  await useRuntimeStore().refresh()
})

const options = { global: { plugins: [ElementPlus] } }
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((ok, fail) => {
    resolve = ok
    reject = fail
  })
  return { promise, resolve, reject }
}

async function mountPanel() {
  const wrapper = mount(SizeRulesPanel, options)
  await flushPromises()
  return wrapper
}

describe('structured size rules UI', () => {
  it('loads saved rules, edits the table and sends expected revision with the draft', async () => {
    const wrapper = await mountPanel()
    expect(wrapper.text()).toContain('本店上衣尺码')
    await wrapper.get('[aria-label="选择尺码规则 本店上衣尺码"]').trigger('click')
    await wrapper.get('[aria-label="尺码规则名称"]').setValue('本店上衣尺码（改）')
    await wrapper.get('[aria-label="规格名称 1"]').setValue('S')
    await wrapper.get('[aria-label="胸围 S"]').setValue('88~92')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    const call = bridge.execute.mock.calls.find(
      ([command]) => command.action === 'save-size-rule',
    )?.[0]
    expect(call.values).toMatchObject({
      id: record.id,
      version: 1,
      expectedRevision: 1,
      name: '本店上衣尺码（改）',
      rows: [
        { label: 'S', values: { c1: '88~92', c2: '64' } },
        expect.objectContaining({ label: 'L' }),
      ],
    })
    expect(wrapper.text()).toContain('已保存')
  })

  it('keeps the current draft and shows the backend error when saving fails', async () => {
    bridge.execute.mockImplementation(async (command: { action: string }) => {
      if (command.action === 'list-size-rules') return listResult()
      if (command.action === 'list-products')
        return {
          status: 'ok',
          message: '',
          data: { revision: 1, codesRevision: 0, total: 0, items: [] },
        }
      if (command.action === 'save-size-rule') throw new Error('尺码规格规则已更新，请重新载入')
      return { status: 'ok', message: '', data: {} }
    })
    const wrapper = await mountPanel()
    await wrapper.get('[aria-label="选择尺码规则 本店上衣尺码"]').trigger('click')
    await wrapper.get('[aria-label="尺码规则名称"]').setValue('保留的草稿')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toContain('请重新载入')
    expect((wrapper.get('[aria-label="尺码规则名称"]').element as HTMLInputElement).value).toBe(
      '保留的草稿',
    )
  })

  it('drops a late product catalog result after the binding store changes', async () => {
    let resolveOld: ((value: unknown) => void) | undefined
    bridge.execute.mockImplementation(async (command: { action: string; storeId?: string }) => {
      if (command.action === 'list-size-rules') return listResult()
      if (command.action === 'list-products' && command.storeId === 's1')
        return new Promise((resolve) => {
          resolveOld = resolve
        })
      if (command.action === 'list-products')
        return {
          status: 'ok',
          message: '',
          data: {
            revision: 1,
            codesRevision: 0,
            total: 1,
            items: [
              {
                id: 'p2',
                version: 1,
                updatedAt: 1,
                storeId: 's2',
                productId: 'B-2',
                title: '乙店商品',
                description: '',
                specifications: '',
                price: '',
                enabled: true,
                merchantCode: '',
                platformDetail: null,
              },
            ],
          },
        }
      return { status: 'ok', message: '', data: {} }
    })
    const wrapper = await mountPanel()
    await wrapper.get('[aria-label="选择尺码规则 本店上衣尺码"]').trigger('click')
    await wrapper.get('[aria-label="绑定店铺"]').setValue('s2')
    await flushPromises()
    expect(wrapper.text()).toContain('乙店商品')
    resolveOld?.({
      status: 'ok',
      message: '',
      data: {
        revision: 1,
        codesRevision: 0,
        total: 1,
        items: [
          {
            id: 'p1',
            version: 1,
            updatedAt: 1,
            storeId: 's1',
            productId: 'A-1',
            title: '迟到的甲店商品',
            description: '',
            specifications: '',
            price: '',
            enabled: true,
            merchantCode: '',
            platformDetail: null,
          },
        ],
      },
    })
    await flushPromises()
    expect(wrapper.text()).not.toContain('迟到的甲店商品')
  })

  it('drops a late template result after a workspace switch or user draft edit', async () => {
    const pending = deferred<unknown>()
    bridge.execute.mockImplementation(async (command: { action: string }) => {
      if (command.action === 'list-size-rules')
        return { status: 'ok', message: '', data: { ...listResult().data, rules: [] } }
      if (command.action === 'list-products')
        return {
          status: 'ok',
          message: '',
          data: { revision: 1, codesRevision: 0, total: 0, items: [] },
        }
      if (command.action === 'size-rule-template') return pending.promise
      return { status: 'ok', message: '', data: {} }
    })
    const wrapper = await mountPanel()
    await wrapper.get('button[aria-label="女装草稿"]').trigger('click')
    await flushPromises()
    useRuntimeStore().snapshot.workspaceId = '00000000-0000-4000-8000-000000000099'
    await flushPromises()
    pending.resolve({
      status: 'ok',
      message: '',
      data: {
        name: '迟到模板',
        enabled: false,
        columns: [{ id: 'c1', name: '胸围', kind: 'number', unit: 'cm' }],
        rows: [{ label: 'S', values: { c1: '' } }],
        advice: '',
        measurements: [],
        bindings: [],
      },
    })
    await flushPromises()
    expect((wrapper.get('[aria-label="尺码规则名称"]').element as HTMLInputElement).value).not.toBe(
      '迟到模板',
    )
  })

  it('does not overwrite edits made while a template request is pending', async () => {
    const pending = deferred<unknown>()
    bridge.execute.mockImplementation(async (command: { action: string }) => {
      if (command.action === 'list-size-rules')
        return { status: 'ok', message: '', data: { ...listResult().data, rules: [] } }
      if (command.action === 'list-products')
        return {
          status: 'ok',
          message: '',
          data: { revision: 1, codesRevision: 0, total: 0, items: [] },
        }
      if (command.action === 'size-rule-template') return pending.promise
      return { status: 'ok', message: '', data: {} }
    })
    const wrapper = await mountPanel()
    await wrapper.get('button[aria-label="女装草稿"]').trigger('click')
    await flushPromises()
    await wrapper.get('[aria-label="尺码规则名称"]').setValue('用户正在编辑')
    pending.resolve({
      status: 'ok',
      message: '',
      data: {
        name: '迟到模板',
        enabled: false,
        columns: [{ id: 'c1', name: '胸围', kind: 'number', unit: 'cm' }],
        rows: [{ label: 'S', values: { c1: '' } }],
        advice: '',
        measurements: [],
        bindings: [],
      },
    })
    await flushPromises()
    expect((wrapper.get('[aria-label="尺码规则名称"]').element as HTMLInputElement).value).toBe(
      '用户正在编辑',
    )
  })

  it('drops late CSV preview and export results after leaving their owner', async () => {
    const previewPending = deferred<unknown>()
    bridge.execute.mockImplementation(async (command: { action: string }) => {
      if (command.action === 'list-size-rules') return listResult()
      if (command.action === 'list-products')
        return {
          status: 'ok',
          message: '',
          data: { revision: 1, codesRevision: 0, total: 0, items: [] },
        }
      if (command.action === 'preview-size-table') return previewPending.promise
      return { status: 'ok', message: '', data: {} }
    })
    const wrapper = await mountPanel()
    await wrapper.get('[aria-label="尺码表格文本"]').setValue('规格,长度(cm)\n小号,20')
    await wrapper
      .findAll('button')
      .find((button) => button.text() === '预览表格')!
      .trigger('click')
    await flushPromises()
    useRuntimeStore().snapshot.workspaceId = '00000000-0000-4000-8000-000000000098'
    await flushPromises()
    previewPending.resolve({
      status: 'ok',
      message: '',
      data: {
        columns: [{ id: 'c1', name: '长度', kind: 'number', unit: 'cm' }],
        rows: [{ label: '小号', values: { c1: '20' } }],
        count: 1,
      },
    })
    await flushPromises()
    expect(wrapper.text()).not.toContain('预览：1 行')
  })

  it('exports saved CSV through the shared download helper', async () => {
    bridge.execute.mockImplementation(async (command: { action: string }) => {
      if (command.action === 'list-size-rules') return listResult()
      if (command.action === 'list-products')
        return {
          status: 'ok',
          message: '',
          data: { revision: 1, codesRevision: 0, total: 0, items: [] },
        }
      if (command.action === 'export-size-table')
        return { status: 'ok', message: '', data: { csv: '规格,长度(cm)' } }
      return { status: 'ok', message: '', data: {} }
    })
    const wrapper = await mountPanel()
    await wrapper.get('[aria-label="选择尺码规则 本店上衣尺码"]').trigger('click')
    await wrapper
      .findAll('button')
      .find((button) => button.text() === '导出已保存 CSV')!
      .trigger('click')
    await flushPromises()
    expect(downloadText).toHaveBeenCalledWith(
      '尺码规格表.csv',
      '\uFEFF规格,长度(cm)',
      'text/csv;charset=utf-8',
    )
  })

  it('does not download an export that completes after the panel was left', async () => {
    const exportPending = deferred<unknown>()
    bridge.execute.mockImplementation(async (command: { action: string }) => {
      if (command.action === 'list-size-rules') return listResult()
      if (command.action === 'list-products')
        return {
          status: 'ok',
          message: '',
          data: { revision: 1, codesRevision: 0, total: 0, items: [] },
        }
      if (command.action === 'export-size-table') return exportPending.promise
      return { status: 'ok', message: '', data: {} }
    })
    const wrapper = await mountPanel()
    await wrapper.get('[aria-label="选择尺码规则 本店上衣尺码"]').trigger('click')
    await wrapper
      .findAll('button')
      .find((button) => button.text() === '导出已保存 CSV')!
      .trigger('click')
    await flushPromises()
    useRuntimeStore().snapshot.workspaceId = '00000000-0000-4000-8000-000000000097'
    await flushPromises()
    exportPending.resolve({ status: 'ok', message: '', data: { csv: '规格,长度(cm)' } })
    await flushPromises()
    expect(downloadText).not.toHaveBeenCalled()
  })

  it('does not download an export after the component unmounts', async () => {
    const exportPending = deferred<unknown>()
    bridge.execute.mockImplementation(async (command: { action: string }) => {
      if (command.action === 'list-size-rules') return listResult()
      if (command.action === 'list-products')
        return {
          status: 'ok',
          message: '',
          data: { revision: 1, codesRevision: 0, total: 0, items: [] },
        }
      if (command.action === 'export-size-table') return exportPending.promise
      return { status: 'ok', message: '', data: {} }
    })
    const wrapper = await mountPanel()
    await wrapper.get('[aria-label="选择尺码规则 本店上衣尺码"]').trigger('click')
    await wrapper
      .findAll('button')
      .find((button) => button.text() === '导出已保存 CSV')!
      .trigger('click')
    await flushPromises()
    wrapper.unmount()
    exportPending.resolve({ status: 'ok', message: '', data: { csv: '规格,长度(cm)' } })
    await flushPromises()
    expect(downloadText).not.toHaveBeenCalled()
  })

  it('does not show a late template error in the new workspace', async () => {
    const pending = deferred<unknown>()
    bridge.execute.mockImplementation(async (command: { action: string }) => {
      if (command.action === 'list-size-rules')
        return { status: 'ok', message: '', data: { ...listResult().data, rules: [] } }
      if (command.action === 'list-products')
        return {
          status: 'ok',
          message: '',
          data: { revision: 1, codesRevision: 0, total: 0, items: [] },
        }
      if (command.action === 'size-rule-template') return pending.promise
      return { status: 'ok', message: '', data: {} }
    })
    const wrapper = await mountPanel()
    await wrapper.get('button[aria-label="女装草稿"]').trigger('click')
    await flushPromises()
    useRuntimeStore().snapshot.workspaceId = '00000000-0000-4000-8000-000000000096'
    await flushPromises()
    pending.reject(new Error('旧工作区模板失败'))
    await flushPromises()
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
  })

  it('creates templates without enabling or binding and toggles a real catalog product', async () => {
    bridge.execute.mockImplementation(async (command: { action: string }) => {
      if (command.action === 'list-size-rules')
        return { status: 'ok', message: '', data: { ...listResult().data, rules: [] } }
      if (command.action === 'size-rule-template')
        return {
          status: 'ok',
          message: '',
          data: {
            name: '女装尺码草稿',
            enabled: false,
            columns: [{ id: 'c1', name: '胸围', kind: 'number', unit: 'cm' }],
            rows: [{ label: 'S', values: { c1: '' } }],
            advice: '',
            measurements: [],
            bindings: [],
          },
        }
      if (command.action === 'list-products')
        return {
          status: 'ok',
          message: '',
          data: {
            revision: 1,
            codesRevision: 0,
            total: 1,
            items: [
              {
                id: 'p1',
                version: 1,
                updatedAt: 1,
                storeId: 's1',
                productId: 'A-1',
                title: '测试上衣',
                description: '',
                specifications: '',
                price: '',
                enabled: true,
                merchantCode: '',
                platformDetail: null,
              },
            ],
          },
        }
      if (command.action === 'save-size-rule')
        return {
          status: 'ok',
          message: '',
          data: {
            rule: {
              ...record,
              id: record.id,
              version: 1,
              updatedAt: 1,
              name: '女装尺码草稿',
              enabled: false,
              columns: [{ id: 'c1', name: '胸围', kind: 'number', unit: 'cm' }],
              rows: [{ label: 'S', values: { c1: '' } }],
              advice: '',
              measurements: [],
              bindings: [{ storeId: 's1', productId: 'A-1' }],
            },
            revision: 2,
          },
        }
      return { status: 'ok', message: '', data: {} }
    })
    const wrapper = await mountPanel()
    await wrapper.get('button[aria-label="女装草稿"]').trigger('click')
    await flushPromises()
    expect((wrapper.get('[aria-label="尺码规则名称"]').element as HTMLInputElement).value).toBe(
      '女装尺码草稿',
    )
    await wrapper.get('input[aria-label="绑定商品 A-1"]').setValue(true)
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    const saved = bridge.execute.mock.calls.find(
      ([command]) => command.action === 'save-size-rule',
    )?.[0]
    expect(saved.values.bindings).toEqual([{ storeId: 's1', productId: 'A-1' }])
    expect(saved.values.enabled).toBe(false)
  })
})

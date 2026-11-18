import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import ElementPlus, { ElInput } from 'element-plus'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ShopOpsPanel from '../src/modules/reception/components/ShopOpsPanel.vue'
import { useRuntimeStore } from '../src/shared/state/runtime'
import { emptySnapshot, type BackendSnapshot } from '../src/shared/contracts/backend'

const bridge = vi.hoisted(() => ({ snapshot: vi.fn(), execute: vi.fn(), subscribe: vi.fn() }))
vi.mock('../src/shared/platform/backend', () => ({ getBackendBridge: () => bridge }))
vi.mock('../src/shared/platform/desktop', () => ({ getDesktop: () => ({ isElectron: false }) }))
vi.mock('vue-router', () => ({ useRouter: () => ({ push: vi.fn() }) }))

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function baseSnapshot(): BackendSnapshot {
  const value = emptySnapshot()
  value.workspaceId = 'workspace-welcome-receipt'
  value.stores = [
    {
      id: 'store-a',
      platform: 'sim-local',
      storeName: '欢迎回执测试店',
      group: '',
      aiEnabled: false,
      runtime: { open: true, online: true },
    },
  ]
  value.selection = { storeId: 'store-a', conversationId: '' }
  value.welcomeByStore = {}
  return value
}

function saved(text: string, version: number): Record<string, unknown> {
  return {
    text,
    enabled: true,
    version,
    enabledAt: 1,
    delayMinSeconds: 1,
    delayMaxSeconds: 3,
  }
}

let snapshot: BackendSnapshot
let emit: (() => void) | undefined
function mountPanel(props: Record<string, unknown> = {}) {
  return mount(ShopOpsPanel, {
    global: { plugins: [ElementPlus] },
    props: { viewKey: 'welcome', ...props },
  })
}
async function flush(wrapper: VueWrapper) {
  await flushPromises()
  await wrapper.vm.$nextTick()
}

beforeEach(async () => {
  setActivePinia(createPinia())
  snapshot = baseSnapshot()
  emit = undefined
  bridge.snapshot.mockReset()
  bridge.execute.mockReset()
  bridge.subscribe.mockReset()
  bridge.snapshot.mockImplementation(async () => structuredClone(snapshot))
  bridge.subscribe.mockImplementation((listener: () => void) => {
    emit = listener
    return () => {}
  })
  await useRuntimeStore().start()
})

describe('ShopOpsPanel welcome save receipt', () => {
  it('keeps the saved text when the run refresh loses its ticket, then conflicts on a truly newer snapshot', async () => {
    vi.useFakeTimers()
    const wrapper = mountPanel()
    try {
      await flush(wrapper)
      await wrapper.get('textarea').setValue('欢迎延迟夹具')

      const execute = deferred<{ status: string; message: string; data: unknown }>()
      bridge.execute.mockReturnValueOnce(execute.promise)
      const requested = deferred<BackendSnapshot>()
      const superseding = deferred<BackendSnapshot>()
      let requestedStarted!: () => void
      const started = new Promise<void>((resolve) => {
        requestedStarted = resolve
      })
      bridge.snapshot
        .mockImplementationOnce(() => {
          requestedStarted()
          return requested.promise
        })
        .mockImplementationOnce(() => superseding.promise)

      await wrapper.get('form').trigger('submit')
      execute.resolve({ status: 'ok', message: '已保存', data: saved('欢迎延迟夹具', 1) })
      await started
      emit?.()
      await vi.advanceTimersByTimeAsync(80)

      requested.resolve(structuredClone(snapshot))
      await flush(wrapper)
      expect(wrapper.get('textarea').element.value).toBe('欢迎延迟夹具')
      expect(wrapper.text()).not.toContain('配置已更新')

      const external = structuredClone(snapshot)
      external.welcomeByStore['store-a'] = {
        text: '更高版本的外部欢迎',
        enabled: true,
        version: 2,
        delayMinSeconds: 5,
        delayMaxSeconds: 9,
      }
      superseding.resolve(external)
      await flush(wrapper)
      expect(wrapper.get('textarea').element.value).toBe('欢迎延迟夹具')
      expect(wrapper.text()).toContain('配置已更新')
      expect(wrapper.get('button[type="submit"]').attributes('disabled')).toBeDefined()

      const reload = wrapper.findAll('button').find((button) => button.text() === '重新载入')!
      await reload.trigger('click')
      await flush(wrapper)
      expect(wrapper.get('textarea').element.value).toBe('更高版本的外部欢迎')
      expect(wrapper.text()).not.toContain('配置已更新')
    } finally {
      wrapper.unmount()
      vi.useRealTimers()
    }
  })

  it('preserves input typed during save while advancing the baseline and CAS version to the receipt', async () => {
    const wrapper = mountPanel()
    try {
      await flush(wrapper)
      await wrapper.get('textarea').setValue('欢迎延迟夹具')

      const execute = deferred<{ status: string; message: string; data: unknown }>()
      bridge.execute.mockReturnValueOnce(execute.promise)
      const requested = deferred<BackendSnapshot>()
      let requestedStarted!: () => void
      const started = new Promise<void>((resolve) => {
        requestedStarted = resolve
      })
      bridge.snapshot.mockImplementationOnce(() => {
        requestedStarted()
        return requested.promise
      })

      await wrapper.get('form').trigger('submit')
      execute.resolve({ status: 'ok', message: '已保存', data: saved('欢迎延迟夹具', 1) })
      await started
      // Use the real v-model channel: the visible input is disabled while pending,
      // but a model update must still survive the late receipt.
      wrapper.findComponent(ElInput).vm.$emit('update:modelValue', '保存期间的新草稿')
      await flush(wrapper)
      expect(wrapper.get('textarea').element.value).toBe('保存期间的新草稿')

      requested.resolve(structuredClone(snapshot))
      await flush(wrapper)
      expect(wrapper.get('textarea').element.value).toBe('保存期间的新草稿')
      expect(wrapper.text()).not.toContain('配置已更新')

      bridge.execute.mockResolvedValueOnce({
        status: 'ok',
        message: '已保存',
        data: saved('保存期间的新草稿', 2),
      })
      await wrapper.get('form').trigger('submit')
      await flush(wrapper)
      expect(bridge.execute.mock.calls.at(-1)?.[0]).toMatchObject({
        action: 'save-welcome',
        values: { text: '保存期间的新草稿', version: 1 },
      })
    } finally {
      wrapper.unmount()
    }
  })

  it('keeps the draft and reports an unconfirmed receipt when result.data is malformed', async () => {
    const wrapper = mountPanel()
    try {
      await flush(wrapper)
      await wrapper.get('textarea').setValue('欢迎延迟夹具')
      bridge.execute
        .mockResolvedValueOnce({ status: 'ok', message: '已保存', data: { text: 42 } })
        .mockResolvedValueOnce({ status: 'ok', message: '已保存', data: saved('欢迎延迟夹具', 1) })

      await wrapper.get('form').trigger('submit')
      await flush(wrapper)
      expect(wrapper.get('textarea').element.value).toBe('欢迎延迟夹具')
      expect(wrapper.text()).toContain('无法确认')
      expect(wrapper.text()).not.toContain('已保存')

      await wrapper.get('form').trigger('submit')
      await flush(wrapper)
      expect(bridge.execute.mock.calls.at(-1)?.[0]).toMatchObject({
        action: 'save-welcome',
        values: { text: '欢迎延迟夹具', version: 0 },
      })
    } finally {
      wrapper.unmount()
    }
  })

  it('ignores a late success after the view lease changed', async () => {
    const wrapper = mountPanel()
    try {
      await flush(wrapper)
      await wrapper.get('textarea').setValue('欢迎延迟夹具')
      const execute = deferred<{ status: string; message: string; data: unknown }>()
      bridge.execute.mockReturnValueOnce(execute.promise)
      const requested = deferred<BackendSnapshot>()
      let requestedStarted!: () => void
      const started = new Promise<void>((resolve) => {
        requestedStarted = resolve
      })
      bridge.snapshot.mockImplementationOnce(() => {
        requestedStarted()
        return requested.promise
      })

      await wrapper.get('form').trigger('submit')
      execute.resolve({ status: 'ok', message: '已保存', data: saved('欢迎延迟夹具', 1) })
      await started
      await wrapper.setProps({ viewKey: 'transfer' })
      requested.resolve(structuredClone(snapshot))
      await flush(wrapper)
      expect(wrapper.text()).not.toContain('已保存')

      await wrapper.setProps({ viewKey: 'welcome' })
      await flush(wrapper)
      expect(wrapper.get('textarea').element.value).toBe('欢迎延迟夹具')
      bridge.execute.mockResolvedValueOnce({
        status: 'ok',
        message: '已保存',
        data: saved('欢迎延迟夹具', 1),
      })
      await wrapper.get('form').trigger('submit')
      await flush(wrapper)
      expect(bridge.execute.mock.calls.at(-1)?.[0]).toMatchObject({
        action: 'save-welcome',
        values: { text: '欢迎延迟夹具', version: 0 },
      })
    } finally {
      wrapper.unmount()
    }
  })

  it('keeps a cached draft and conflicts when a newer snapshot is loaded on view re-entry', async () => {
    const initial = baseSnapshot()
    initial.welcomeByStore['store-a'] = {
      text: '初始欢迎',
      enabled: true,
      version: 1,
      delayMinSeconds: 1,
      delayMaxSeconds: 3,
    }
    snapshot = initial
    const wrapper = mountPanel()
    try {
      await flush(wrapper)
      await wrapper.get('textarea').setValue('缓存中的旧草稿')
      const external = structuredClone(snapshot)
      external.welcomeByStore['store-a'] = {
        text: '外部新欢迎',
        enabled: true,
        version: 2,
        delayMinSeconds: 5,
        delayMaxSeconds: 9,
      }
      snapshot = external
      await useRuntimeStore().refresh()
      await flush(wrapper)
      expect(wrapper.get('textarea').element.value).toBe('缓存中的旧草稿')
      expect(wrapper.text()).toContain('配置已更新')

      await wrapper.setProps({ viewKey: 'transfer' })
      await flush(wrapper)
      await wrapper.setProps({ viewKey: 'welcome' })
      await flush(wrapper)
      expect(wrapper.get('textarea').element.value).toBe('缓存中的旧草稿')
      expect(wrapper.text()).toContain('配置已更新')

      const reload = wrapper.findAll('button').find((button) => button.text() === '重新载入')!
      await reload.trigger('click')
      await flush(wrapper)
      expect(wrapper.get('textarea').element.value).toBe('外部新欢迎')
      expect(wrapper.text()).not.toContain('配置已更新')
    } finally {
      wrapper.unmount()
    }
  })

  it('does not reuse a cached welcome draft across workspaces with the same store id', async () => {
    const w1 = baseSnapshot()
    w1.workspaceId = 'workspace-w1'
    w1.welcomeByStore['store-a'] = {
      text: 'W1欢迎',
      enabled: true,
      version: 10,
      delayMinSeconds: 1,
      delayMaxSeconds: 3,
    }
    snapshot = w1
    const wrapper = mountPanel()
    try {
      await flush(wrapper)
      await wrapper.get('textarea').setValue('W1旧稿')
      const w2 = baseSnapshot()
      w2.workspaceId = 'workspace-w2'
      w2.welcomeByStore['store-a'] = {
        text: 'W2真实欢迎',
        enabled: true,
        version: 1,
        delayMinSeconds: 1,
        delayMaxSeconds: 3,
      }
      snapshot = w2
      await useRuntimeStore().refresh()
      await flush(wrapper)
      expect(wrapper.get('textarea').element.value).toBe('W2真实欢迎')
      expect(wrapper.text()).not.toContain('配置已更新')

      bridge.execute.mockResolvedValueOnce({
        status: 'ok',
        message: '已保存',
        data: saved('W2真实欢迎', 2),
      })
      await wrapper.get('form').trigger('submit')
      await flush(wrapper)
      expect(bridge.execute.mock.calls.at(-1)?.[0]).toMatchObject({
        action: 'save-welcome',
        values: { text: 'W2真实欢迎', version: 1 },
      })
    } finally {
      wrapper.unmount()
    }
  })

  it('keeps the confirmed welcome receipt across embedded unmount and remount while R2 is pending', async () => {
    vi.useFakeTimers()
    const wrapper = mountPanel({ embedded: true })
    let mounted = true
    let remounted: ReturnType<typeof mountPanel> | undefined
    const execute = deferred<{ status: string; message: string; data: unknown }>()
    const requested = deferred<BackendSnapshot>()
    const superseding = deferred<BackendSnapshot>()
    let requestedStarted!: () => void
    const started = new Promise<void>((resolve) => {
      requestedStarted = resolve
    })
    try {
      await flush(wrapper)
      await wrapper.get('textarea').setValue('欢迎延迟夹具')
      bridge.execute.mockReturnValueOnce(execute.promise)
      bridge.snapshot
        .mockImplementationOnce(() => {
          requestedStarted()
          return requested.promise
        })
        .mockImplementationOnce(() => superseding.promise)

      await wrapper.get('form').trigger('submit')
      execute.resolve({ status: 'ok', message: '已保存', data: saved('欢迎延迟夹具', 1) })
      await started
      emit?.()
      await vi.advanceTimersByTimeAsync(80)
      requested.resolve(structuredClone(snapshot))
      await flush(wrapper)
      expect(wrapper.get('textarea').element.value).toBe('欢迎延迟夹具')

      wrapper.unmount()
      mounted = false
      remounted = mountPanel({ embedded: true })
      await flush(remounted)
      expect(remounted.get('textarea').element.value).toBe('欢迎延迟夹具')

      superseding.resolve(structuredClone(snapshot))
      await flush(remounted)
      expect(remounted.get('textarea').element.value).toBe('欢迎延迟夹具')
    } finally {
      superseding.resolve(structuredClone(snapshot))
      if (mounted) wrapper.unmount()
      remounted?.unmount()
      vi.useRealTimers()
    }
  })
})

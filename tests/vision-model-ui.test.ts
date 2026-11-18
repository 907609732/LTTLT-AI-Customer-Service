import { flushPromises, mount } from '@vue/test-utils'
import ElementPlus from 'element-plus'
import { describe, expect, it, vi } from 'vitest'
import VisionModelSettings from '../src/modules/settings/components/VisionModelSettings.vue'
import {
  toVisionExpected,
  visionModelPresets,
  type VisionModelService,
} from '../src/modules/settings/vision-model-service'
import type {
  VisionModelProbeResult,
  VisionModelSettingsView,
  VisionModelSnapshot,
  VisionModelVerifyResult,
} from '../src/shared/contracts/vision'

function snapshot(overrides: Partial<VisionModelSnapshot> = {}): VisionModelSnapshot {
  return {
    mode: 'inherit',
    baseUrl: '',
    model: '',
    apiKeyConfigured: false,
    status: 'inherit',
    reason: '沿用文字模型；旧图片能力保持可用但未独立验证。',
    ...overrides,
  }
}

const configured = snapshot({
  mode: 'custom',
  baseUrl: 'https://api.deepseek.com',
  model: 'deepseek-flash',
  apiKeyConfigured: true,
  status: 'unverified',
  reason: '已保存独立配置，尚未执行固定合成图验证。',
})

function view(snapshotValue: VisionModelSnapshot, revision = 1): VisionModelSettingsView {
  return { snapshot: snapshotValue, revision }
}

function mockedService(initial: VisionModelSnapshot = snapshot(), initialRevision = 1) {
  const load = vi.fn(async () => view(initial, initialRevision))
  const save = vi.fn(async () => view(initial, initialRevision))
  const probe = vi.fn(
    async (): Promise<VisionModelProbeResult> => ({ ok: true, message: '连接成功' }),
  )
  const verify = vi.fn(
    async (): Promise<VisionModelVerifyResult> => ({
      ok: true,
      status: 'verified',
      revision: initialRevision + 1,
      message: '图片验证通过',
    }),
  )
  const clearKey = vi.fn(async () =>
    view(snapshot({ ...initial, apiKeyConfigured: false }), initialRevision + 1),
  )
  const service: VisionModelService = { load, save, probe, verify, clearKey }
  return { service, load, save, probe, verify, clearKey }
}

function mountComponent(service?: VisionModelService) {
  return mount(VisionModelSettings, {
    props: service ? { service } : {},
    global: { plugins: [ElementPlus] },
  })
}

async function chooseCustom(wrapper: ReturnType<typeof mountComponent>) {
  wrapper.findComponent({ name: 'ElRadioGroup' }).vm.$emit('update:modelValue', 'custom')
  await flushPromises()
}

function button(wrapper: ReturnType<typeof mountComponent>, label: string) {
  const found = wrapper.findAll('button').find((item) => item.attributes('aria-label') === label)
  if (!found) throw new Error(`button not found: ${label}`)
  return found
}

async function fillCustom(
  wrapper: ReturnType<typeof mountComponent>,
  values: { baseUrl?: string; model?: string; apiKey?: string } = {},
) {
  await wrapper
    .get('[aria-label="图片模型 API 地址"]')
    .setValue(values.baseUrl ?? 'https://api.deepseek.com')
  await wrapper.get('[aria-label="图片模型名称"]').setValue(values.model ?? 'deepseek-flash')
  if (values.apiKey !== undefined)
    await wrapper.get('[aria-label="图片模型 API Key"]').setValue(values.apiKey)
  await flushPromises()
}

describe('图片模型设置组件', () => {
  it('未注入模块服务时明确不可用，不触发网络或自动动作', async () => {
    const wrapper = mountComponent()
    await flushPromises()
    expect(wrapper.text()).toContain('未提供图片模型配置服务')
    expect(button(wrapper, '保存图片模型设置').attributes('disabled')).toBeDefined()
    expect(button(wrapper, '测试图片模型连接').attributes('disabled')).toBeDefined()
    expect(button(wrapper, '验证图片识别能力').attributes('disabled')).toBeDefined()
    wrapper.unmount()
  })

  it('默认沿用文字模型，载入只读快照且不自动连接或验证', async () => {
    const fixture = mockedService()
    const wrapper = mountComponent(fixture.service)
    await flushPromises()
    expect(fixture.load).toHaveBeenCalledTimes(1)
    expect(wrapper.text()).toContain('沿用文字模型')
    expect(wrapper.text()).toContain('未独立验证')
    expect(fixture.probe).not.toHaveBeenCalled()
    expect(fixture.verify).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('保存、连接测试和图片验证都需要手动点击')
    expect(wrapper.text()).toContain('连接成功只表示服务可访问')
    wrapper.unmount()
  })

  it('保存只提交配置，不自动连接或图片验证，成功后清空 Key 输入', async () => {
    const fixture = mockedService()
    const saved = snapshot({
      ...configured,
      status: 'unverified',
      reason: '已保存独立配置，尚未执行固定合成图验证。',
    })
    fixture.save.mockResolvedValueOnce(view(saved, 2))
    const wrapper = mountComponent(fixture.service)
    await flushPromises()
    await chooseCustom(wrapper)
    expect(wrapper.text()).toContain('DeepSeek 视觉')
    expect(visionModelPresets[0]).toMatchObject({
      baseUrl: 'https://api.deepseek.com',
      model: 'deepseek-flash',
    })
    await fillCustom(wrapper, { apiKey: 'draft-secret' })
    await button(wrapper, '保存图片模型设置').trigger('click')
    await flushPromises()
    expect(fixture.save).toHaveBeenCalledTimes(1)
    expect(fixture.save).toHaveBeenCalledWith({
      mode: 'custom',
      baseUrl: 'https://api.deepseek.com',
      model: 'deepseek-flash',
      apiKey: 'draft-secret',
      expected: toVisionExpected(view(snapshot())),
    })
    expect(fixture.probe).not.toHaveBeenCalled()
    expect(fixture.verify).not.toHaveBeenCalled()
    expect((wrapper.get('[aria-label="图片模型 API Key"]').element as HTMLInputElement).value).toBe(
      '',
    )
    expect(wrapper.text()).toContain('已配置')
    expect(wrapper.text()).toContain('未验证')
    wrapper.unmount()
  })

  it('普通连接和图片验证是独立显式动作，连接成功不改变图片验证状态', async () => {
    const fixture = mockedService(configured)
    const wrapper = mountComponent(fixture.service)
    await flushPromises()
    await button(wrapper, '测试图片模型连接').trigger('click')
    await flushPromises()
    expect(fixture.probe).toHaveBeenCalledTimes(1)
    expect(fixture.verify).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('连接成功')
    expect(wrapper.text()).toContain('未验证')

    await button(wrapper, '验证图片识别能力').trigger('click')
    await flushPromises()
    expect(fixture.verify).toHaveBeenCalledTimes(1)
    expect(fixture.save).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('已验证')
    expect(wrapper.text()).toContain('图片验证通过')
    wrapper.unmount()
  })

  it('保存或验证失败保留端点、模型和 Key 草稿，失败不清空输入', async () => {
    const fixture = mockedService(configured)
    fixture.save.mockRejectedValueOnce(new Error('保存失败，系统加密不可用'))
    const wrapper = mountComponent(fixture.service)
    await flushPromises()
    await wrapper.get('[aria-label="图片模型 API 地址"]').setValue('https://vision.example.com/v1')
    await wrapper.get('[aria-label="图片模型名称"]').setValue('vision-draft')
    await wrapper.get('[aria-label="图片模型 API Key"]').setValue('draft-key')
    await button(wrapper, '保存图片模型设置').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('保存失败')
    expect(
      (wrapper.get('[aria-label="图片模型 API 地址"]').element as HTMLInputElement).value,
    ).toBe('https://vision.example.com/v1')
    expect((wrapper.get('[aria-label="图片模型名称"]').element as HTMLInputElement).value).toBe(
      'vision-draft',
    )
    expect((wrapper.get('[aria-label="图片模型 API Key"]').element as HTMLInputElement).value).toBe(
      'draft-key',
    )

    fixture.save.mockResolvedValueOnce(
      view(
        snapshot({
          ...configured,
          baseUrl: 'https://vision.example.com/v1',
          model: 'vision-draft',
          apiKeyConfigured: true,
        }),
        2,
      ),
    )
    await button(wrapper, '保存图片模型设置').trigger('click')
    await flushPromises()
    fixture.probe.mockRejectedValueOnce(new Error('连接网络失败'))
    await button(wrapper, '测试图片模型连接').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('连接网络失败')
    expect(
      (wrapper.get('[aria-label="图片模型 API 地址"]').element as HTMLInputElement).value,
    ).toBe('https://vision.example.com/v1')
    fixture.verify.mockRejectedValueOnce(new Error('图片验证网络失败'))
    await button(wrapper, '验证图片识别能力').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('图片验证网络失败')
    expect((wrapper.get('[aria-label="图片模型名称"]').element as HTMLInputElement).value).toBe(
      'vision-draft',
    )
    wrapper.unmount()
  })

  it('清除 Key 需要二次确认，取消不调用服务，确认后才清除', async () => {
    const fixture = mockedService(
      snapshot({ ...configured, status: 'verified', reason: '固定合成图验证通过。' }),
    )
    fixture.clearKey.mockResolvedValueOnce(
      view(
        snapshot({
          ...configured,
          apiKeyConfigured: false,
          status: 'unverified',
          reason: '独立图片模型 Key 已清除。',
        }),
        2,
      ),
    )
    const wrapper = mountComponent(fixture.service)
    await flushPromises()
    await button(wrapper, '清除图片模型 Key').trigger('click')
    expect(fixture.clearKey).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('确认清除已保存的图片模型 Key')
    await button(wrapper, '取消清除图片模型 Key').trigger('click')
    expect(fixture.clearKey).not.toHaveBeenCalled()

    await button(wrapper, '清除图片模型 Key').trigger('click')
    await button(wrapper, '确认清除图片模型 Key').trigger('click')
    await flushPromises()
    expect(fixture.clearKey).toHaveBeenCalledWith(
      toVisionExpected(view({ ...configured, status: 'verified' })),
      { signal: expect.any(AbortSignal) },
    )
    expect(wrapper.text()).toContain('未配置')
    expect((wrapper.get('[aria-label="图片模型 API Key"]').element as HTMLInputElement).value).toBe(
      '',
    )
    wrapper.unmount()
  })

  it('无效地址在服务调用前阻止保存并保留草稿', async () => {
    const fixture = mockedService()
    const wrapper = mountComponent(fixture.service)
    await flushPromises()
    await chooseCustom(wrapper)
    await fillCustom(wrapper, { baseUrl: 'not-a-url', apiKey: 'draft-secret' })
    await button(wrapper, '保存图片模型设置').trigger('click')
    await flushPromises()
    expect(fixture.save).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('API 地址格式无效')
    expect(
      (wrapper.get('[aria-label="图片模型 API 地址"]').element as HTMLInputElement).value,
    ).toBe('not-a-url')
    wrapper.unmount()
  })

  it('旧套件 stale 状态显示明确原因，不把旧验证显示为已验证', async () => {
    const fixture = mockedService(
      snapshot({
        ...configured,
        status: 'stale',
        reason: '图片识别验证方式已更新，请重新验证。',
      }),
    )
    const wrapper = mountComponent(fixture.service)
    await flushPromises()
    expect(wrapper.text()).toContain('配置已变更，需重新验证')
    expect(wrapper.text()).toContain('验证方式已更新')
    expect(wrapper.text()).not.toContain('已验证')
    expect(fixture.probe).not.toHaveBeenCalled()
    expect(fixture.verify).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('旧 Key 来源未知时显示 stale 原因，不显示已验证', async () => {
    const fixture = mockedService(
      snapshot({
        ...configured,
        status: 'stale',
        reason:
          '旧图片模型 Key 的来源未知，不能继续用于当前服务地址；请重新输入 API Key 后再测试或验证。',
      }),
    )
    const wrapper = mountComponent(fixture.service)
    await flushPromises()
    expect(wrapper.text()).toContain('配置已变更，需重新验证')
    expect(wrapper.text()).toContain('来源未知')
    expect(wrapper.text()).not.toContain('已验证')
    wrapper.unmount()
  })

  it('跨 origin 换地址但未重输 Key 时阻止保存，错误保留草稿', async () => {
    const fixture = mockedService(configured)
    const wrapper = mountComponent(fixture.service)
    await flushPromises()
    await wrapper
      .get('[aria-label="图片模型 API 地址"]')
      .setValue('https://vision-b.example.com/v1')
    await flushPromises()
    await button(wrapper, '保存图片模型设置').trigger('click')
    await flushPromises()
    expect(fixture.save).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('重新输入 API Key')
    expect(
      (wrapper.get('[aria-label="图片模型 API 地址"]').element as HTMLInputElement).value,
    ).toBe('https://vision-b.example.com/v1')
    expect((wrapper.get('[aria-label="图片模型 API Key"]').element as HTMLInputElement).value).toBe(
      '',
    )
    wrapper.unmount()
  })

  it('切换注入服务会取消旧验证请求，迟到结果不能覆盖新状态', async () => {
    const fixture = mockedService(configured)
    let release: ((result: VisionModelVerifyResult) => void) | undefined
    let observedSignal: AbortSignal | undefined
    fixture.verify.mockImplementationOnce(
      (options?: { signal?: AbortSignal }) =>
        new Promise<VisionModelVerifyResult>((resolve) => {
          observedSignal = options?.signal
          release = resolve
        }),
    )
    const wrapper = mountComponent(fixture.service)
    await flushPromises()
    await button(wrapper, '验证图片识别能力').trigger('click')
    await flushPromises()
    expect(observedSignal).toBeTruthy()

    const replacement = mockedService()
    await wrapper.setProps({ service: replacement.service })
    await flushPromises()
    expect(observedSignal?.aborted).toBe(true)
    release?.({ ok: true, status: 'verified', revision: 2, message: '迟到的验证成功' })
    await flushPromises()
    expect(wrapper.text()).toContain('沿用文字模型')
    expect(wrapper.text()).not.toContain('迟到的验证成功')
    wrapper.unmount()
  })
})

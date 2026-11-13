import { describe, expect, it } from 'vitest'
import { localVisionCapability } from '../electron/model-capabilities'

describe('本机多模态配置', () => {
  it('任意自定义模型名称使用同一视觉策略，不绑定 Qwen', () => {
    const result = localVisionCapability(
      { provider: 'openai', baseUrl: 'https://model.example.com/v1', model: 'my-multimodal' },
      true,
    )
    expect(result.supported).toBe(true)
    expect(result.model).toBe('my-multimodal')
  })
  it('未配置接口或凭证时仍拒绝开启，本机无密钥模型可用', () => {
    const ai = { provider: 'openai', baseUrl: '', model: 'my-multimodal' }
    expect(localVisionCapability(ai, true).supported).toBe(false)
    expect(
      localVisionCapability({ ...ai, baseUrl: 'https://model.example.com/v1' }, false).supported,
    ).toBe(false)
    expect(
      localVisionCapability({ ...ai, baseUrl: 'http://127.0.0.1:11434/v1' }, false).supported,
    ).toBe(true)
  })
})

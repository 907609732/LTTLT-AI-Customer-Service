interface LocalModelConfig {
  provider: string
  baseUrl: string
  model: string
}

/** 模型名称由用户配置，不用名称白名单推断视觉能力；实际能力在训练场验证。 */
export function localVisionCapability(ai: LocalModelConfig, apiKeyConfigured: boolean) {
  let endpointReady = false
  try {
    const url = new URL(ai.baseUrl)
    const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
    endpointReady =
      !url.username &&
      !url.password &&
      (url.protocol === 'https:' || (url.protocol === 'http:' && loopback)) &&
      (apiKeyConfigured || loopback)
  } catch {
    // 尚未配置地址时返回明确的未就绪状态，不把默认模型名称当作已接通。
  }
  const supported = ai.provider === 'openai' && !!ai.model.trim() && endpointReady
  return {
    supported,
    model: ai.model,
    maxImages: 4,
    reason: supported
      ? '图片识别使用模型设置中当前配置的模型，不限制模型名称。请在训练场确认图片输入可用。'
      : '请先在模型设置中配置模型接口和密钥；图片识别将使用同一个模型。',
  }
}

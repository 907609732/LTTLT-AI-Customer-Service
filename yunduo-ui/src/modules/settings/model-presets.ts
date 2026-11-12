/** 与固定上游 shared/model-providers.mjs 保持一致；只填写表单，不自动连接服务商。 */
export const modelPresets = {
  deepseek: { label: 'DeepSeek', baseUrl: 'https://api.deepseek.com', model: 'deepseek-flash' },
  qwen: {
    label: '通义千问 · 百炼（北京）',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model: 'qwen-plus',
  },
  qwenVision: {
    label: '通义千问 · Qwen3-VL 识图',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model: 'qwen3-vl-plus',
  },
} as const

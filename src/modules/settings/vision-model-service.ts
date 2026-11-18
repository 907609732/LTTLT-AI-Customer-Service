import {
  defaultVisionModelSnapshot,
  toVisionExpected,
  validateVisionModelText,
  type VisionModelService,
  type VisionModelSnapshot,
  type VisionMode,
} from '../../shared/contracts/vision'

export { toVisionExpected }
export type { VisionModelService }

/**
 * 预置只填表单，不会自动连接、验证或保存。该 DeepSeek 条目属于图片模型域，
 * 不复用也不改写现有文字模型预设。
 */
export const visionModelPresets = [
  {
    value: 'deepseek',
    label: 'DeepSeek 视觉',
    baseUrl: 'https://api.deepseek.com',
    model: 'deepseek-flash',
  },
] as const

export type VisionModelPresetId = (typeof visionModelPresets)[number]['value']

export interface VisionModelDraft {
  mode: VisionMode
  baseUrl: string
  model: string
  apiKey: string
}

export function defaultVisionModelDraft(): VisionModelDraft {
  const snapshot = defaultVisionModelSnapshot()
  return {
    mode: snapshot.mode,
    baseUrl: snapshot.baseUrl,
    model: snapshot.model,
    apiKey: '',
  }
}

export function draftFromSnapshot(snapshot: VisionModelSnapshot): VisionModelDraft {
  return {
    mode: snapshot.mode,
    baseUrl: snapshot.baseUrl,
    model: snapshot.model,
    apiKey: '',
  }
}

export function validateVisionModelDraft(
  draft: VisionModelDraft,
  apiKeyConfigured: boolean,
  savedBaseUrl = '',
): string {
  return validateVisionModelText({
    mode: draft.mode,
    baseUrl: draft.baseUrl,
    savedBaseUrl,
    model: draft.model,
    apiKey: draft.apiKey,
    apiKeyConfigured,
  })
}

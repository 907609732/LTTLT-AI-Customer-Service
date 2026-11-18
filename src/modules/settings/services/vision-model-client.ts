import type { CommandInput } from '@/shared/contracts/backend'
import {
  visionModelExpectedSchema,
  visionModelProbeResultSchema,
  visionModelSaveInputSchema,
  visionModelSettingsViewSchema,
  visionModelVerifyResultSchema,
  type VisionModelExpected,
  type VisionModelProbeResult,
  type VisionModelSaveInput,
  type VisionModelService,
  type VisionModelSettingsView,
  type VisionModelVerifyResult,
} from '@/shared/contracts/vision'

type Execute = (command: CommandInput) => Promise<{ data: Record<string, unknown> }>
const record = (value: object): Record<string, unknown> => Object.fromEntries(Object.entries(value))

/** Renderer adapter for the fixed local-runtime vision commands. */
export function createVisionModelService(execute: Execute): VisionModelService {
  return {
    async load(): Promise<VisionModelSettingsView> {
      return visionModelSettingsViewSchema.parse(
        (await execute({ action: 'get-vision-model-settings', values: {} })).data,
      )
    },
    async save(input: VisionModelSaveInput): Promise<VisionModelSettingsView> {
      return visionModelSettingsViewSchema.parse(
        (
          await execute({
            action: 'save-vision-model-settings',
            values: record(visionModelSaveInputSchema.parse(input)),
          })
        ).data,
      )
    },
    async probe(options = {}): Promise<VisionModelProbeResult> {
      if (!options.expected) throw new Error('请先载入图片模型配置再测试连接')
      return visionModelProbeResultSchema.parse(
        (
          await execute({
            action: 'probe-vision-model',
            values: record(visionModelExpectedSchema.parse(options.expected)),
          })
        ).data,
      )
    },
    async verify(options = {}): Promise<VisionModelVerifyResult> {
      if (!options.expected) throw new Error('请先载入图片模型配置再验证图片')
      return visionModelVerifyResultSchema.parse(
        (
          await execute({
            action: 'verify-vision-model',
            values: record(visionModelExpectedSchema.parse(options.expected)),
          })
        ).data,
      )
    },
    async clearKey(expected: VisionModelExpected): Promise<VisionModelSettingsView> {
      return visionModelSettingsViewSchema.parse(
        (
          await execute({
            action: 'clear-vision-key',
            values: record(visionModelExpectedSchema.parse(expected)),
          })
        ).data,
      )
    },
  }
}

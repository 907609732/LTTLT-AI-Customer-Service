import { z } from 'zod'

/**
 * 进店欢迎文字附加在首次 AI 正文里，批准后才等待这段随机延迟再实际发送。
 * 延迟以整数秒保存，1～3600，下限不大于上限（等于表示固定值）；
 * 旧记录没有这两个字段时按 1～3 秒随机解释，不能因缺字段把等待缩短到 0。
 */
export const welcomeDelayLimits = { minSeconds: 1, maxSeconds: 3600 } as const
export const defaultWelcomeDelay = { delayMinSeconds: 1, delayMaxSeconds: 3 } as const

const delaySeconds = z
  .number()
  .int()
  .min(welcomeDelayLimits.minSeconds)
  .max(welcomeDelayLimits.maxSeconds)

export const welcomeDelaySchema = z
  .object({
    delayMinSeconds: delaySeconds.default(defaultWelcomeDelay.delayMinSeconds),
    delayMaxSeconds: delaySeconds.default(defaultWelcomeDelay.delayMaxSeconds),
  })
  .superRefine((value, context) => {
    // 反序范围不隐式排序：界面、快照和保存都必须显式报错。
    if (value.delayMinSeconds > value.delayMaxSeconds)
      context.addIssue({ code: 'custom', message: '欢迎延迟下限不能大于上限' })
  })
export type WelcomeDelay = z.infer<typeof welcomeDelaySchema>

/** 快照里的欢迎记录；旧厂商数据或旧夹具可能还没有延迟字段。 */
export type WelcomeSetting = {
  text: string
  enabled: boolean
  version: number
  delayMinSeconds?: number
  delayMaxSeconds?: number
}
/** 界面与本地业务统一使用的已归一化记录。 */
export type NormalizedWelcomeSetting = WelcomeSetting & {
  delayMinSeconds: number
  delayMaxSeconds: number
}
const rawWelcomeSettingSchema = z
  .object({
    text: z.string(),
    enabled: z.boolean(),
    version: z.number(),
    delayMinSeconds: delaySeconds.default(defaultWelcomeDelay.delayMinSeconds),
    delayMaxSeconds: delaySeconds.default(defaultWelcomeDelay.delayMaxSeconds),
  })
  .superRefine((value, context) => {
    if (value.delayMinSeconds > value.delayMaxSeconds)
      context.addIssue({ code: 'custom', message: '欢迎延迟下限不能大于上限' })
  })

/**
 * 解析结果在运行时一定会补齐延迟字段；对外类型仍允许旧夹具省略，
 * 因此快照合约按 WelcomeSetting 的兼容形状暴露，界面与存储边界负责归一化。
 */
export const welcomeSettingSchema = rawWelcomeSettingSchema as z.ZodType<WelcomeSetting>

export function normalizeWelcomeSetting(
  value?: Partial<WelcomeSetting> | null,
): NormalizedWelcomeSetting {
  return {
    text: value?.text ?? '',
    enabled: value?.enabled === true,
    version: typeof value?.version === 'number' ? value.version : 0,
    delayMinSeconds: value?.delayMinSeconds ?? defaultWelcomeDelay.delayMinSeconds,
    delayMaxSeconds: value?.delayMaxSeconds ?? defaultWelcomeDelay.delayMaxSeconds,
  }
}

/** 界面提交前的可读校验；空值、非整数、越界和反序都不允许保存。 */
export function welcomeDelayIssue(
  min: number | null | undefined,
  max: number | null | undefined,
): string {
  if (
    typeof min !== 'number' ||
    typeof max !== 'number' ||
    !Number.isInteger(min) ||
    !Number.isInteger(max)
  )
    return '欢迎延迟请填写 1～3600 的整数秒'
  if (
    min < welcomeDelayLimits.minSeconds ||
    min > welcomeDelayLimits.maxSeconds ||
    max < welcomeDelayLimits.minSeconds ||
    max > welcomeDelayLimits.maxSeconds
  )
    return '欢迎延迟请填写 1～3600 的整数秒'
  if (min > max) return '欢迎延迟下限不能大于上限'
  return ''
}

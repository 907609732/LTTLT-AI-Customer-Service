import { z } from 'zod'

/**
 * 尺码规则的公共契约同时供 Electron 主进程与 Vue 编辑器使用。
 * 单位表只描述可核对的量纲，不包含任何商品或买家数据。
 */
export const sizeUnitKeys = [
  'mm',
  'cm',
  'm',
  'g',
  'kg',
  '斤',
  'mL',
  'L',
  '件',
  '岁',
  '°C',
  'none',
] as const

export type SizeUnitKey = (typeof sizeUnitKeys)[number]
export type SizeUnitGroup =
  | 'length'
  | 'mass'
  | 'volume'
  | 'count'
  | 'age'
  | 'temperature'
  | 'number'

export interface SizeUnitMeta {
  label: string
  group: SizeUnitGroup
  factor: number
  aliases: string[]
}

export const sizeUnitMeta: Record<SizeUnitKey, SizeUnitMeta> = {
  mm: { label: 'mm', group: 'length', factor: 0.1, aliases: ['mm', '毫米'] },
  cm: { label: 'cm', group: 'length', factor: 1, aliases: ['cm', '厘米', '公分'] },
  m: { label: 'm', group: 'length', factor: 100, aliases: ['m', '米'] },
  g: { label: 'g', group: 'mass', factor: 0.001, aliases: ['g', '克'] },
  kg: { label: 'kg', group: 'mass', factor: 1, aliases: ['kg', '千克', '公斤'] },
  斤: { label: '斤', group: 'mass', factor: 0.5, aliases: ['斤'] },
  mL: { label: 'mL', group: 'volume', factor: 0.001, aliases: ['ml', '毫升'] },
  L: { label: 'L', group: 'volume', factor: 1, aliases: ['l', '升'] },
  件: { label: '件', group: 'count', factor: 1, aliases: ['件'] },
  岁: { label: '岁', group: 'age', factor: 1, aliases: ['岁'] },
  '°C': { label: '°C', group: 'temperature', factor: 1, aliases: ['°c', '℃', '摄氏度'] },
  none: { label: '无单位', group: 'number', factor: 1, aliases: [] },
}

const unitAliasEntries = Object.entries(sizeUnitMeta)
  .flatMap(([value, meta]) => meta.aliases.map((alias) => ({ value: value as SizeUnitKey, alias })))
  .sort((left, right) => right.alias.length - left.alias.length)

/** Header parsing accepts the documented aliases but always stores one canonical key. */
export function normalizeSizeUnit(value: unknown): SizeUnitKey | undefined {
  const token = String(value ?? '').trim()
  if (!token) return undefined
  const direct = sizeUnitKeys.find((key) => key.toLocaleLowerCase() === token.toLocaleLowerCase())
  if (direct) return direct
  return unitAliasEntries.find(
    (entry) => entry.alias.toLocaleLowerCase() === token.toLocaleLowerCase(),
  )?.value
}

export const sizeUnitSchema = z.enum(sizeUnitKeys)
export const sizeUnitOptionSchema = z
  .object({
    value: sizeUnitSchema,
    label: z.string().min(1).max(20),
    group: z.enum(['length', 'mass', 'volume', 'count', 'age', 'temperature', 'number']),
  })
  .strict()
export type SizeUnitOption = z.infer<typeof sizeUnitOptionSchema>

const text = (max: number) => z.string().trim().min(1).max(max)
export const sizeRuleColumnSchema = z
  .object({
    id: z.string().regex(/^[a-z][a-z0-9_]{0,29}$/, '参数编号只能使用小写字母、数字和下划线'),
    name: text(40),
    kind: z.enum(['number', 'text']),
    unit: sizeUnitSchema,
  })
  .strict()
export type SizeRuleColumn = z.infer<typeof sizeRuleColumnSchema>

export const sizeRuleRowSchema = z
  .object({
    label: text(60),
    values: z.record(z.string(), z.string().trim().max(200)),
  })
  .strict()
export type SizeRuleRow = z.infer<typeof sizeRuleRowSchema>

export const sizeRuleMeasurementSchema = z
  .object({
    name: text(20),
    unit: sizeUnitSchema.refine((unit) => unit !== 'none', '测量参数需要明确单位'),
  })
  .strict()
export type SizeRuleMeasurement = z.infer<typeof sizeRuleMeasurementSchema>

export const sizeRuleBindingSchema = z.object({ storeId: text(64), productId: text(100) }).strict()
export type SizeRuleBinding = z.infer<typeof sizeRuleBindingSchema>

const sizeRuleShape = {
  name: text(100),
  enabled: z.boolean().default(false),
  columns: z.array(sizeRuleColumnSchema).min(1, '至少需要一个参数列').max(12, '最多 12 个参数列'),
  rows: z.array(sizeRuleRowSchema).min(1, '至少需要一个规格行').max(100, '最多 100 个规格行'),
  advice: z.string().trim().max(3000).default(''),
  measurements: z.array(sizeRuleMeasurementSchema).max(6, '最多 6 个选码参数').default([]),
  bindings: z.array(sizeRuleBindingSchema).max(500, '最多绑定 500 个商品').default([]),
} as const

/** A measurement name may carry a display prefix; range matching compares the semantic name. */
export function measurementName(value: string): string {
  return value.replace(/^(适用|建议|参考|推荐)/, '')
}

export interface NumericRange {
  min: number
  max: number
}

/** Parse one closed numeric interval. Non-temperature values cannot be negative. */
export function parseNumericRange(value: unknown, unit: SizeUnitKey): NumericRange {
  const match = String(value ?? '')
    .trim()
    .match(/^(-?\d+(?:\.\d+)?)(?:\s*(?:~|～|至|—|–|-)\s*(-?\d+(?:\.\d+)?))?$/)
  if (!match) throw new Error('数值只能填写数字或闭区间，如 92、92~96')
  const min = Number(match[1])
  const max = match[2] === undefined ? min : Number(match[2])
  if (!Number.isFinite(min) || !Number.isFinite(max) || Math.abs(min) > 1e9 || Math.abs(max) > 1e9)
    throw new Error('数值必须是有限数，且绝对值不超过 1e9')
  if (min > max) throw new Error('数值区间起点不能大于终点')
  if (unit !== '°C' && min < 0) throw new Error('非温度参数不能为负数')
  return { min, max }
}

export function convertSizeValue(value: number, from: SizeUnitKey, to: SizeUnitKey): number {
  const source = sizeUnitMeta[from]
  const target = sizeUnitMeta[to]
  if (source.group !== target.group) throw new Error('单位量纲不一致，不能换算')
  return (value * source.factor) / target.factor
}

interface IssueContext {
  addIssue(issue: { code: 'custom'; message: string }): void
}

const unique = (values: string[]) => new Set(values).size === values.length

function validateRuleFields(
  value: {
    enabled: boolean
    columns: SizeRuleColumn[]
    rows: SizeRuleRow[]
    measurements: SizeRuleMeasurement[]
    bindings: SizeRuleBinding[]
  },
  context: IssueContext,
): void {
  const fail = (message: string) => context.addIssue({ code: 'custom', message })
  if (!unique(value.columns.map((column) => column.id))) fail('参数编号不能重复')
  if (!unique(value.columns.map((column) => column.name))) fail('参数名称不能重复')
  if (!unique(value.rows.map((row) => row.label))) fail('尺码或规格名称不能重复')
  if (!unique(value.measurements.map((measurement) => measurement.name))) fail('测量参数不能重复')
  if (
    !unique(value.bindings.map((binding) => JSON.stringify([binding.storeId, binding.productId])))
  )
    fail('店铺商品绑定不能重复')
  for (const column of value.columns) {
    if (column.kind === 'text' && column.unit !== 'none')
      fail(`${column.name}：文本列不能带数值单位`)
  }
  for (const measurement of value.measurements)
    for (const column of value.columns)
      if (
        column.kind === 'number' &&
        measurementName(column.name) === measurement.name &&
        sizeUnitMeta[column.unit].group !== sizeUnitMeta[measurement.unit].group
      )
        fail(`${measurement.name}：测量参数与同名列的单位量纲不一致`)
  if (value.enabled)
    for (const measurement of value.measurements)
      if (
        !value.columns.some(
          (column) => column.kind === 'number' && measurementName(column.name) === measurement.name,
        )
      )
        fail(`${measurement.name}：启用前需要同名数字参数列，否则无法用数据约束推荐`)
  for (const row of value.rows) {
    const keys = Object.keys(row.values)
    if (
      keys.length !== value.columns.length ||
      value.columns.some((column) => !Object.hasOwn(row.values, column.id))
    )
      fail(`${row.label}：每行必须与参数列一一对应，不能包含未知列`)
    for (const column of value.columns) {
      const cell = row.values[column.id]
      if (cell === undefined) continue
      if (!cell) {
        if (value.enabled) fail(`${row.label} / ${column.name}：启用前请填写数值或说明`)
        continue
      }
      if (column.kind === 'number') {
        try {
          parseNumericRange(cell, column.unit)
        } catch (error) {
          fail(
            `${row.label} / ${column.name}：${error instanceof Error ? error.message : String(error)}`,
          )
        }
      }
    }
  }
}

export const sizeRuleFieldsSchema = z.object(sizeRuleShape).strict().superRefine(validateRuleFields)
export type SizeRuleFields = z.infer<typeof sizeRuleFieldsSchema>

export const sizeRuleSchema = z
  .object({
    ...sizeRuleShape,
    id: z.string().uuid(),
    version: z.number().int().positive(),
    updatedAt: z.number().int().nonnegative(),
  })
  .strict()
  .superRefine(validateRuleFields)
export type SizeRuleRecord = z.infer<typeof sizeRuleSchema>

export const sizeRuleFileSchema = z
  .object({
    version: z.literal(1),
    revision: z.number().int().nonnegative(),
    rules: z.array(sizeRuleSchema).max(100, '最多保存 100 条尺码规则'),
  })
  .strict()
export type SizeRuleFile = z.infer<typeof sizeRuleFileSchema>

export const sizeRuleSavePayloadSchema = z
  .object({
    ...sizeRuleShape,
    id: z.string().uuid().optional(),
    version: z.number().int().positive().optional(),
    expectedRevision: z.number().int().nonnegative(),
  })
  .strict()
  .superRefine((value, context) => {
    validateRuleFields(value, context)
    if (value.id && value.version === undefined)
      context.addIssue({ code: 'custom', message: '修改规则时必须携带已载入的版本号' })
    if (!value.id && value.version !== undefined)
      context.addIssue({ code: 'custom', message: '新规则不能携带版本号' })
  })
export type SizeRuleSavePayload = z.infer<typeof sizeRuleSavePayloadSchema>

export const sizeRuleRemovePayloadSchema = z
  .object({
    id: z.string().uuid(),
    version: z.number().int().positive(),
    expectedRevision: z.number().int().nonnegative(),
    confirmed: z.literal(true),
  })
  .strict()
export type SizeRuleRemovePayload = z.infer<typeof sizeRuleRemovePayloadSchema>

export const sizeRulePreviewPayloadSchema = z
  .object({ table: z.string().max(1_048_576, '粘贴表格最大 1 MB') })
  .strict()
export const sizeRuleExportPayloadSchema = z.object({ id: z.string().uuid() }).strict()
export const sizeRuleTemplateKindSchema = z.enum(['blank', 'women', 'men', 'shoes', 'storage'])
export type SizeRuleTemplateKind = z.infer<typeof sizeRuleTemplateKindSchema>
export const sizeRuleTemplatePayloadSchema = z.object({ kind: sizeRuleTemplateKindSchema }).strict()

export const sizeRulePreviewSchema = z
  .object({
    columns: z.array(sizeRuleColumnSchema).min(1).max(12),
    rows: z.array(sizeRuleRowSchema).min(1).max(100),
    count: z.number().int().min(1).max(100),
  })
  .strict()
export type SizeRulePreview = z.infer<typeof sizeRulePreviewSchema>

export const sizeRuleListResultSchema = z
  .object({
    revision: z.number().int().nonnegative(),
    total: z.number().int().min(0).max(100),
    boundProducts: z.number().int().min(0).max(50000),
    units: z.array(sizeUnitOptionSchema).min(1),
    rules: z.array(sizeRuleSchema).max(100),
  })
  .strict()
export type SizeRuleListResult = z.infer<typeof sizeRuleListResultSchema>

export const sizeRuleSaveResultSchema = z
  .object({
    rule: sizeRuleSchema,
    revision: z.number().int().nonnegative(),
  })
  .strict()
export type SizeRuleSaveResult = z.infer<typeof sizeRuleSaveResultSchema>

export const sizeRuleRemoveResultSchema = z
  .object({ revision: z.number().int().nonnegative() })
  .strict()
export type SizeRuleRemoveResult = z.infer<typeof sizeRuleRemoveResultSchema>

export const sizeRuleExportResultSchema = z.object({ csv: z.string().max(2_000_000) }).strict()
export type SizeRuleExportResult = z.infer<typeof sizeRuleExportResultSchema>

export const sizeRuleContextSchema = z
  .object({
    source: z.literal('size-rule'),
    ruleId: z.string().uuid(),
    ruleVersion: z.number().int().positive(),
    name: z.string().min(1).max(100),
    columns: z.array(sizeRuleColumnSchema).min(1).max(12),
    rows: z.array(sizeRuleRowSchema).max(100),
    totalRows: z.number().int().min(1).max(100),
    complete: z.boolean(),
    filteredByLabels: z.boolean(),
    advice: z.string().max(3000),
    requiredMeasurements: z.array(sizeRuleMeasurementSchema).max(6),
    providedMeasurements: z
      .array(
        z
          .object({
            name: z.string().min(1).max(20),
            value: z.number().finite(),
            unit: sizeUnitSchema,
          })
          .strict(),
      )
      .max(6),
    selectionRequested: z.boolean(),
    eligibleLabels: z.array(z.string().min(1).max(60)).max(100),
    clarification: z.string().max(600),
    rowLabels: z.array(z.string().min(1).max(60)).max(100).optional(),
  })
  .strict()
export type SizeRuleContext = z.infer<typeof sizeRuleContextSchema>

export const sizeRuleActions = [
  'list-size-rules',
  'save-size-rule',
  'remove-size-rule',
  'preview-size-table',
  'export-size-table',
  'size-rule-template',
] as const
export const sizeRuleActionSchema = z.enum(sizeRuleActions)
export type SizeRuleAction = z.infer<typeof sizeRuleActionSchema>

/** Templates are data-entry drafts only: never enabled, bound, published or AI-enabled. */
export function blankSizeRuleDraft(): SizeRuleFields {
  return {
    name: '',
    enabled: false,
    columns: [{ id: 'c1', name: '参数', kind: 'number', unit: 'cm' }],
    rows: [{ label: '规格1', values: { c1: '' } }],
    advice: '',
    measurements: [],
    bindings: [],
  }
}

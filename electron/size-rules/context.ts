import { z } from 'zod'
import {
  convertSizeValue,
  measurementName,
  parseNumericRange,
  sizeRuleContextSchema,
  sizeUnitMeta,
  type SizeRuleColumn,
  type SizeRuleContext,
  type SizeRuleFile,
  type SizeRuleMeasurement,
  type SizeRuleRecord,
} from '../../src/shared/contracts/size-rules'

const threadSchema = z.array(
  z.object({
    from: z.string(),
    type: z.string().optional(),
    content: z.string(),
  }),
)
const questionRule =
  /(?:^|[^a-z0-9-])size(?:$|[^a-z0-9-])|穿.{0,12}(?:多大|几|哪|什么|码|号)|[选买].{0,10}(?:码|号)|推荐.{0,12}(?:我|码|号)|适合.{0,8}(?:我|他|她|码|号)|(?:身高|体重|脚长)|我.{0,12}(?:穿|合适)|该.{0,6}多大/iu
const personChange =
  /给.{0,4}(?:妈妈|爸爸|妈|爸|孩子|女儿|儿子|朋友|老婆|老公)|我(?:妈妈|爸爸|妈|爸|孩子|朋友)|换个人|别人穿/u
const providerAliases: Record<string, string[]> = {
  身高: ['身高', '个子'],
  体重: ['体重', '重'],
  脚长: ['脚长'],
}
const unitAliases = Object.entries(sizeUnitMeta)
  .flatMap(([key, meta]) =>
    meta.aliases.map((alias) => ({ key: key as keyof typeof sizeUnitMeta, alias })),
  )
  .sort((left, right) => right.alias.length - left.alias.length)
const escaped = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

function namedIn(name: string, question: string): boolean {
  if (!name) return false
  return new RegExp(`(^|[^a-z0-9_-])${escaped(name)}($|[^a-z0-9_-])`, 'i').test(question)
}

function measurementFacts(requirements: SizeRuleMeasurement[], thread: unknown, question: string) {
  const parsed = threadSchema.parse(thread)
  const texts = parsed
    .filter((message) => message.from === 'buyer' && (!message.type || message.type === 'text'))
    .map((message) => message.content.slice(0, 4000))
    .slice(-8)
  if (texts.at(-1) !== question) texts.push(question.slice(0, 2000))
  let start = 0
  for (let index = 0; index < texts.length; index += 1)
    if (personChange.test(texts[index]!)) start = index
  const content = texts.slice(start).join('\n')
  const unitPattern = unitAliases.map((entry) => escaped(entry.alias)).join('|')
  const facts: { name: string; value: number; unit: SizeRuleMeasurement['unit'] }[] = []
  for (const requirement of requirements) {
    const names = (providerAliases[requirement.name] ?? [requirement.name])
      .map((value) => escaped(value))
      .join('|')
    const pattern = new RegExp(
      `(?:${names})[\\s：:是约为]*(-?\\d+(?:\\.\\d+)?)\\s*(${unitPattern})(?![a-z])`,
      'gi',
    )
    const matches = [...content.matchAll(pattern)]
    for (const match of matches.reverse()) {
      const source = unitAliases.find(
        (entry) => entry.alias.toLocaleLowerCase() === match[2]!.toLocaleLowerCase(),
      )
      if (!source) continue
      const sourceMeta = sizeUnitMeta[source.key]
      const targetMeta = sizeUnitMeta[requirement.unit]
      if (sourceMeta.group !== targetMeta.group) continue
      const value = (Number(match[1]) * sourceMeta.factor) / targetMeta.factor
      if (
        !Number.isFinite(value) ||
        Math.abs(value) > 1e9 ||
        (sourceMeta.group !== 'temperature' && value < 0)
      )
        continue
      facts.push({
        name: requirement.name,
        value: Math.round(value * 1e6) / 1e6,
        unit: requirement.unit,
      })
      break
    }
  }
  return facts
}

function matchingColumn(column: SizeRuleColumn, measurement: SizeRuleMeasurement): boolean {
  return (
    column.kind === 'number' &&
    measurementName(column.name) === measurement.name &&
    sizeUnitMeta[column.unit].group === sizeUnitMeta[measurement.unit].group
  )
}

export interface SizeEvidenceResolver {
  resolve(
    storeId: string,
    productId: string,
    question: string,
    thread: unknown,
  ): Promise<SizeRuleContext | null>
}

export interface SizeEvidenceOptions {
  read(): SizeRuleFile
  isBindingValid(binding: { storeId: string; productId: string }): Promise<boolean>
  assertActive?(): void
}

/**
 * The single evidence resolver used by training, reception and the final reply guard.
 * A stale/missing/disabled binding returns null, so no stale rule can enter model input.
 */
export function createSizeEvidenceResolver(options: SizeEvidenceOptions): SizeEvidenceResolver {
  function ruleFor(storeId: string, productId: string): SizeRuleRecord | undefined {
    return options
      .read()
      .rules.find(
        (rule) =>
          rule.enabled &&
          rule.bindings.some(
            (binding) => binding.storeId === storeId && binding.productId === productId,
          ),
      )
  }
  function build(rule: SizeRuleRecord, question: string, thread: unknown): SizeRuleContext {
    const selectionRequested = questionRule.test(question)
    const selected = rule.rows.filter((row) => namedIn(row.label, question))
    const rows = selected.length ? selected : rule.rows
    const providedMeasurements = measurementFacts(rule.measurements, thread, question)
    let clarification = ''
    let eligibleLabels: string[] = []
    if (selectionRequested) {
      if (!rule.measurements.length) {
        clarification =
          '本规则未配置可核对的选码参数，请提供具体尺码或规格名称；如需推荐，请先在本店规则中配置可核对的测量参数列。'
      } else {
        const missing = rule.measurements.filter(
          (measurement) => !providedMeasurements.some((fact) => fact.name === measurement.name),
        )
        if (missing.length)
          clarification =
            '为核对是否合适，麻烦补充或确认' +
            missing
              .map(
                (measurement) => `${measurement.name}（${sizeUnitMeta[measurement.unit].label}）`,
              )
              .join('、') +
            '；有了这些信息再按本商品尺码表核对。'
        else {
          const checks = providedMeasurements.flatMap((fact) => {
            const measurement = rule.measurements.find((item) => item.name === fact.name)
            if (!measurement) return []
            return rule.columns
              .filter((column) => matchingColumn(column, measurement))
              .map((column) => ({
                column,
                value: convertSizeValue(fact.value, fact.unit, column.unit),
              }))
          })
          const constrained = new Set(
            providedMeasurements
              .filter((fact) =>
                rule.columns.some((column) => {
                  const measurement = rule.measurements.find((item) => item.name === fact.name)
                  return measurement ? matchingColumn(column, measurement) : false
                }),
              )
              .map((fact) => fact.name),
          )
          if (!checks.length || constrained.size !== providedMeasurements.length) {
            clarification =
              '本规则没有可核对的同名数字参数列，不能仅凭表格文字推荐尺码；请提供具体尺码，或先核对规则参数。'
          } else {
            eligibleLabels = rows
              .filter((row) =>
                checks.every(({ column, value }) => {
                  try {
                    const range = parseNumericRange(row.values[column.id], column.unit)
                    const epsilon = Math.max(1, Math.abs(value)) * 1e-9
                    return value >= range.min - epsilon && value <= range.max + epsilon
                  } catch {
                    return false
                  }
                }),
              )
              .map((row) => row.label)
            if (!eligibleLabels.length)
              clarification =
                '按本商品尺码表的区间，当前提供的测量值暂未匹配到可选规格；请核对测量值或提供具体尺码，我再按表核对。'
          }
        }
      }
    }
    const result: SizeRuleContext = {
      source: 'size-rule',
      ruleId: rule.id,
      ruleVersion: rule.version,
      name: rule.name,
      columns: rule.columns,
      rows,
      totalRows: rule.rows.length,
      complete: selected.length === 0 || selected.length === rule.rows.length,
      filteredByLabels: selected.length > 0,
      advice: rule.advice,
      requiredMeasurements: rule.measurements,
      providedMeasurements,
      selectionRequested,
      eligibleLabels,
      clarification,
    }
    if (Buffer.byteLength(JSON.stringify(result), 'utf8') <= 9000)
      return sizeRuleContextSchema.parse(result)
    const related =
      selectionRequested ||
      selected.length > 0 ||
      /规格|尺寸|尺码|参数|长度|宽|高|容量/u.test(question) ||
      rule.columns.some((column) => question.includes(column.name))
    const specific = '这张规格表较大，请告诉我想查询的具体尺码或规格名称，我再按对应记录核对。'
    return sizeRuleContextSchema.parse({
      ...result,
      rows: [],
      eligibleLabels: [],
      complete: false,
      filteredByLabels: false,
      advice: '表格超过单次模型参考范围；需按明确尺码或规格名称查询，不能根据部分表格盲推。',
      rowLabels: rule.rows.slice(0, 20).map((row) => row.label),
      clarification: related
        ? [clarification, specific].filter(Boolean).join('；').slice(0, 600)
        : '',
    })
  }
  return {
    async resolve(storeId, productId, question, thread) {
      options.assertActive?.()
      const first = ruleFor(storeId, productId)
      if (!first) return null
      let valid = false
      try {
        valid = await options.isBindingValid({ storeId, productId })
      } catch {
        valid = false
      }
      options.assertActive?.()
      if (!valid) return null
      // A concurrent save/disable/rebind during catalog lookup must not leak the old version.
      const current = ruleFor(storeId, productId)
      if (!current || current.id !== first.id || current.version !== first.version) return null
      return build(current, String(question).slice(0, 2000), thread)
    },
  }
}

import { z } from 'zod'
import {
  convertSizeValue,
  measurementName,
  parseNumericRange,
  sizeRuleContextSchema,
  sizeUnitMeta,
  type SizeBindingStatus,
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
const selectionPatterns = [
  /(?:推荐|建议).{0,12}(?:尺码|码|号|大小)/iu,
  /(?:我|他|她|买家).{0,8}(?:穿|选|买).{0,8}(?:多大|几|哪|什么|码|号|尺码)/iu,
  /(?:穿|选|买).{0,8}(?:多大|几码|哪个码|什么码|哪一号)/iu,
  /(?:尺码|码|号).{0,6}(?:推荐|建议|适合)/iu,
  /适合(?:我|他|她)/iu,
  /(?:哪|什么|几).{0,6}(?:尺码|码|号).{0,8}(?:合适|适合)/iu,
]
const tableQueryPattern =
  /(?:尺码|规格|尺寸|参数|身高|体重|脚长|胸围|衣长).{0,12}(?:范围|上限|下限|多少|是什么|表)|(?:范围|上限|下限)/iu
const personChange =
  /给.{0,4}(?:妈妈|爸爸|妈|爸|孩子|女儿|儿子|朋友|老婆|老公)|我(?:妈妈|爸爸|妈|爸|孩子|朋友)|换个人|别人穿/gu
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
const EPSILON = 1e-9

function namedIn(name: string, question: string): boolean {
  if (!name) return false
  return new RegExp(`(^|[^a-z0-9_-])${escaped(name)}($|[^a-z0-9_-])`, 'i').test(question)
}

export function isSelectionQuestion(question: string): boolean {
  return selectionPatterns.some((pattern) => pattern.test(question))
}

/** Direct table lookups use the saved row/column facts but never request body measurements. */
export function isSizeTableQuestion(
  question: string,
  rule: Pick<SizeRuleRecord, 'columns' | 'rows'>,
): boolean {
  const selected = rule.rows.some((row) => namedIn(row.label, question))
  if (selected) return true
  if (tableQueryPattern.test(question)) return true
  return rule.columns.some(
    (column) => question.includes(column.name) && /(?:多少|范围|上限|下限|表|是)/u.test(question),
  )
}

/** Used when the domain is unavailable: ordinary chat may continue, size questions must not guess. */
export function isSizeIntentQuestion(question: string): boolean {
  return isSelectionQuestion(question) || tableQueryPattern.test(question)
}

function measurementFacts(requirements: SizeRuleMeasurement[], thread: unknown, question: string) {
  const parsed = threadSchema.parse(thread)
  const texts = parsed
    .filter((message) => message.from === 'buyer' && (!message.type || message.type === 'text'))
    .map((message) => message.content.slice(0, 4000))
    .slice(-8)
  if (texts.at(-1) !== question) texts.push(question.slice(0, 2000))
  // Cut at the last character position of a person-change marker, not at a whole message.
  // A later measurement after that marker belongs to the new person and remains eligible.
  let offset = 0
  let cutoff = 0
  for (const text of texts) {
    for (const match of text.matchAll(personChange))
      cutoff = offset + (match.index ?? 0) + match[0].length
    offset += text.length + 1
  }
  const content = texts.join('\n').slice(cutoff)
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
      // Do not round toward an interval. Only the fixed absolute epsilon below
      // accommodates binary floating-point representation; it must not scale with the value.
      facts.push({ name: requirement.name, value, unit: requirement.unit })
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
  checkBinding?(binding: { storeId: string; productId: string }): Promise<SizeBindingStatus>
  /** Legacy test port; production passes checkBinding so lookup failures stay distinguishable. */
  isBindingValid?(binding: { storeId: string; productId: string }): Promise<boolean>
  assertActive?(): void
}

const lookupClarification = (status: SizeBindingStatus) =>
  status === 'missing'
    ? '该商品已不在当前商品目录或绑定已失效；未使用未经核对的尺码表，请刷新商品目录后重试。'
    : '当前商品目录暂时无法核对；未使用未经核对的尺码表，请稍后重试。'

export function createSizeEvidenceResolver(options: SizeEvidenceOptions): SizeEvidenceResolver {
  const checkBinding =
    options.checkBinding ??
    (options.isBindingValid
      ? async (binding: { storeId: string; productId: string }) =>
          (await options.isBindingValid!(binding)) ? ('valid' as const) : ('missing' as const)
      : async () => 'valid' as const)
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
  function build(
    rule: SizeRuleRecord,
    storeId: string,
    productId: string,
    question: string,
    thread: unknown,
    bindingStatus: SizeBindingStatus,
  ): SizeRuleContext {
    const questionText = String(question).slice(0, 2000)
    const selectionRequested = isSelectionQuestion(questionText)
    const tableQueryRequested = isSizeTableQuestion(questionText, rule)
    const selected = rule.rows.filter((row) => namedIn(row.label, questionText))
    if (bindingStatus !== 'valid') {
      return sizeRuleContextSchema.parse({
        source: 'size-rule',
        ruleId: rule.id,
        ruleVersion: rule.version,
        storeId,
        productId,
        bindingStatus,
        name: rule.name,
        columns: rule.columns,
        rows: [],
        totalRows: rule.rows.length,
        complete: false,
        filteredByLabels: false,
        advice: '',
        requiredMeasurements: rule.measurements,
        providedMeasurements: [],
        selectionRequested,
        tableQueryRequested,
        eligibleLabels: [],
        clarification: lookupClarification(bindingStatus),
      })
    }
    const rows = selected.length ? selected : rule.rows
    const providedMeasurements = measurementFacts(rule.measurements, thread, questionText)
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
                    return value >= range.min - EPSILON && value <= range.max + EPSILON
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
      storeId,
      productId,
      bindingStatus,
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
      tableQueryRequested,
      eligibleLabels,
      clarification,
    }
    if (Buffer.byteLength(JSON.stringify(result), 'utf8') <= 9000)
      return sizeRuleContextSchema.parse(result)
    const related =
      selectionRequested ||
      tableQueryRequested ||
      selected.length > 0 ||
      /规格|尺寸|尺码|参数|长度|宽|高|容量/u.test(questionText) ||
      rule.columns.some((column) => questionText.includes(column.name))
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
      const questionText = String(question).slice(0, 2000)
      const sizeIntent =
        isSelectionQuestion(questionText) || isSizeTableQuestion(questionText, first)
      let bindingStatus: SizeBindingStatus = 'error'
      try {
        bindingStatus = await checkBinding({ storeId, productId })
      } catch {
        bindingStatus = 'error'
      }
      options.assertActive?.()
      if (bindingStatus !== 'valid' && !sizeIntent) return null
      // A concurrent save/disable/rebind during catalog lookup must not leak the old version.
      const current = ruleFor(storeId, productId)
      if (!current || current.id !== first.id || current.version !== first.version) return null
      return build(current, storeId, productId, questionText, thread, bindingStatus)
    },
  }
}

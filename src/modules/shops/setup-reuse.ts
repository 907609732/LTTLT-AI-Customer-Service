import { createBlankSetupDraft, type SetupDraft } from './setup-rules'

/**
 * 店铺配置复用的纯逻辑：四类选择、字段映射和“来源缺项保留目标值”。
 * 只操作当前草稿，不读写持久化，也不建立店铺之间的持续关联。
 */
export const reuseSections = ['style', 'logistics', 'reception', 'afterSales'] as const
export type ReuseSection = (typeof reuseSections)[number]
export type ReuseSelection = Record<ReuseSection, boolean>
export const reuseSectionNames: Record<ReuseSection, string> = {
  style: '客服风格',
  logistics: '物流与发货政策',
  reception: '接待设置',
  afterSales: '售后政策',
}
export type PolicyReuseSection = Exclude<ReuseSection, 'reception'>
const policySections: PolicyReuseSection[] = ['style', 'logistics', 'afterSales']

export function defaultReuseSelection(): ReuseSelection {
  return { style: true, logistics: true, reception: true, afterSales: true }
}
export function selectedReuseSections(selection: ReuseSelection): ReuseSection[] {
  return reuseSections.filter((section) => selection[section])
}

type Field = keyof SetupDraft
const fieldNames: Record<Field, string> = {
  style: '客服风格',
  length: '回复长度',
  customPrompt: '客服回复要求',
  maxReplyChars: '回复字数上限',
  origins: '发货地',
  carriers: '常用快递',
  designatedCourier: '指定快递政策',
  dispatchTime: '发货时效',
  cutoffTime: '截单时间',
  shippingNotes: '其他发货说明',
  freightInsurance: '运费险',
  insuranceExcessPayer: '运费险承担方',
  insuranceNotes: '运费险说明',
  exchangeSupported: '换货支持',
  exchangePolicy: '换货说明',
  returnSupported: '退货退款支持',
  returnPolicy: '退货退款条件',
  cashbackSupported: '返现活动',
  cashbackAmount: '返现金额',
  cashbackProcess: '返现流程',
  compensationSupported: '小额补偿',
  compensationLimit: '补偿限额',
  compensationPolicy: '补偿说明',
  warrantyPolicy: '保修政策',
}

export function cloneSetupDraft(draft: SetupDraft): SetupDraft {
  // 草稿可能是 Vue 响应式代理；结构化克隆前先转成纯数据。
  return JSON.parse(JSON.stringify(draft)) as SetupDraft
}

/** 空字符串、空数组和 null 都表示来源没有填写，绝不覆盖目标值。显式 false 会复制。 */
function present(value: unknown): boolean {
  if (typeof value === 'string') return value.trim().length > 0
  if (Array.isArray(value))
    return value.some((item) => typeof item === 'string' && item.trim().length > 0)
  return value !== null && value !== undefined
}
function copyRaw<K extends Field>(target: SetupDraft, source: SetupDraft, key: K) {
  const value = source[key]
  // 动态字段复制：键与值来自同一份 SetupDraft，数组需要独立副本。
  target[key] = (Array.isArray(value) ? [...value] : value) as SetupDraft[K]
}
function copyIfPresent<K extends Field>(
  target: SetupDraft,
  source: SetupDraft,
  key: K,
  hints: string[],
) {
  if (!present(source[key])) {
    hints.push(`来源店铺未填写${fieldNames[key]}，已保留本店内容`)
    return
  }
  copyRaw(target, source, key)
}

export interface PolicyReuseResult {
  draft: SetupDraft
  /** 来源整体未配置、因而整类保留目标值的策略类别。 */
  missing: PolicyReuseSection[]
  hints: string[]
}

/**
 * 合并来源策略到目标草稿。
 * 支持/保险等“开关 + 说明”按同一决策整组复制：来源显式关闭时同步清空隐藏条件，
 * 不把目标店旧条款带进新政策；来源未配置整类时保留目标值并提示。
 */
export function mergePolicyReuse(options: {
  target: SetupDraft
  source: SetupDraft
  sourceConfigured: boolean
  selection: ReuseSelection
}): PolicyReuseResult {
  const { target, source, sourceConfigured, selection } = options
  const draft = cloneSetupDraft(target)
  const missing: PolicyReuseSection[] = []
  const hints: string[] = []
  if (!sourceConfigured) {
    const selected = policySections.filter((section) => selection[section])
    if (selected.length) {
      missing.push(...selected)
      hints.push(
        `来源店铺未配置${selected.map((section) => reuseSectionNames[section]).join('、')}，已保留本店填写`,
      )
    }
    return { draft, missing, hints }
  }
  if (selection.style) {
    copyIfPresent(draft, source, 'style', hints)
    copyIfPresent(draft, source, 'length', hints)
    copyIfPresent(draft, source, 'customPrompt', hints)
    copyIfPresent(draft, source, 'maxReplyChars', hints)
  }
  if (selection.logistics) {
    for (const key of [
      'origins',
      'carriers',
      'designatedCourier',
      'dispatchTime',
      'cutoffTime',
      'shippingNotes',
    ] as const)
      copyIfPresent(draft, source, key, hints)
    if (present(source.freightInsurance)) {
      copyRaw(draft, source, 'freightInsurance')
      copyRaw(draft, source, 'insuranceExcessPayer')
      copyRaw(draft, source, 'insuranceNotes')
    } else hints.push('来源店铺未填写运费险，已保留本店内容')
  }
  if (selection.afterSales) {
    const groups = [
      ['exchangeSupported', ['exchangePolicy']],
      ['returnSupported', ['returnPolicy']],
      ['cashbackSupported', ['cashbackAmount', 'cashbackProcess']],
      ['compensationSupported', ['compensationLimit', 'compensationPolicy']],
    ] as const
    for (const [flag, dependent] of groups) {
      if (!present(source[flag])) {
        hints.push(`来源店铺未填写${fieldNames[flag]}，已保留本店内容`)
        continue
      }
      copyRaw(draft, source, flag)
      for (const key of dependent) copyRaw(draft, source, key)
    }
    copyIfPresent(draft, source, 'warrantyPolicy', hints)
  }
  return { draft, missing, hints }
}

/** 是否有足够内容需要用户明确确认“替换本店填写”。 */
export function draftHasContent(draft: SetupDraft): boolean {
  const blank = createBlankSetupDraft()
  return (Object.keys(blank) as Field[]).some(
    (key) => JSON.stringify(draft[key]) !== JSON.stringify(blank[key]),
  )
}

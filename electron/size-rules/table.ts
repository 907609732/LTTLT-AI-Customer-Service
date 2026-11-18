import Papa from 'papaparse'
import {
  blankSizeRuleDraft,
  normalizeSizeUnit,
  sizeRuleFieldsSchema,
  sizeRulePreviewSchema,
  sizeUnitMeta,
  type SizeRuleColumn,
  type SizeRuleFields,
  type SizeRulePreview,
  type SizeRuleRecord,
  type SizeRuleTemplateKind,
} from '../../src/shared/contracts/size-rules'

const MAX_BYTES = 1_048_576
const HEADER = /^(尺码|规格|名称|尺寸)$/

function parseHeaderCell(header: string, index: number): SizeRuleColumn {
  const value = header.trim()
  const match = value.match(/^(.+?)[(（]([^()（）]+)[)）]$/)
  if (!match) throw new Error(`参数列需要注明单位，如胸围(cm)或材质(文本)；第 ${index + 1} 列无效`)
  const name = match[1]!.trim()
  if (!name || name.length > 40) throw new Error(`参数名称需要 1～40 字；第 ${index + 1} 列无效`)
  const token = match[2]!.trim()
  if (token === '文本') return { id: `c${index + 1}`, name, kind: 'text', unit: 'none' }
  if (token === '无单位') return { id: `c${index + 1}`, name, kind: 'number', unit: 'none' }
  const unit = normalizeSizeUnit(token)
  if (!unit || unit === 'none')
    throw new Error(`不支持的参数单位“${token}”；请使用项目支持的单位或“文本”`)
  return { id: `c${index + 1}`, name, kind: 'number', unit }
}

/** Formula escaping used on export is reversed for an exact logical round trip. */
function decodeCell(value: unknown): string {
  const text = String(value ?? '').trim()
  const hasControl = [...text].some((character) => {
    const code = character.charCodeAt(0)
    return (
      (code >= 0x00 && code <= 0x08) ||
      code === 0x0b ||
      code === 0x0c ||
      (code >= 0x0e && code <= 0x1f)
    )
  })
  if (hasControl) throw new Error('单元格包含不可见控制字符，请清理后重试')
  if (/^'[=+\-@]/.test(text)) return text.slice(1)
  return text
}

export function previewSizeTable(raw: unknown): SizeRulePreview {
  if (typeof raw !== 'string' || Buffer.byteLength(raw, 'utf8') > MAX_BYTES)
    throw new Error('粘贴表格最大 1 MB')
  const parsed = Papa.parse<string[]>(raw.replace(/^\uFEFF/, ''), {
    skipEmptyLines: 'greedy',
  })
  if (parsed.errors.length) throw new Error('表格 CSV/TSV 格式不完整')
  const [headers, ...data] = parsed.data
  if (!headers?.length || !HEADER.test(String(headers[0] ?? '').trim()))
    throw new Error('首列标题需要是尺码、规格、名称或尺寸')
  if (headers.length < 2) throw new Error('至少需要一个参数列')
  if (headers.length - 1 > 12) throw new Error('最多 12 个参数列')
  if (!data.length) throw new Error('至少需要一个规格行')
  if (data.length > 100) throw new Error('最多 100 个规格行')
  const columns = headers.slice(1).map((header, index) => parseHeaderCell(String(header), index))
  const rows = data.map((cells, rowIndex) => {
    if (!Array.isArray(cells) || cells.length !== headers.length)
      throw new Error(`第 ${rowIndex + 2} 行的列数必须与标题一致`)
    const label = decodeCell(cells[0])
    if (!label || label.length > 60)
      throw new Error(`第 ${rowIndex + 2} 行尺码/规格名称需要 1～60 字`)
    const values: Record<string, string> = {}
    columns.forEach((column, index) => {
      const value = decodeCell(cells[index + 1])
      if (value.length > 200) throw new Error(`第 ${rowIndex + 2} 行单元格超过 200 字`)
      values[column.id] = value
    })
    return { label, values }
  })
  try {
    const result = sizeRuleFieldsSchema.parse({
      ...blankSizeRuleDraft(),
      name: '粘贴预览',
      enabled: false,
      columns,
      rows,
      advice: '',
      measurements: [],
      bindings: [],
    })
    return sizeRulePreviewSchema.parse({
      columns: result.columns,
      rows: result.rows,
      count: rows.length,
    })
  } catch (error) {
    const issues: unknown =
      error && typeof error === 'object' && 'issues' in error
        ? Reflect.get(error, 'issues')
        : undefined
    const message = Array.isArray(issues)
      ? issues
          .slice(0, 3)
          .map((issue) => String(Reflect.get(issue as object, 'message') ?? ''))
          .filter(Boolean)
          .join('；')
      : error instanceof Error
        ? error.message
        : String(error)
    throw new Error(`粘贴表格无效：${message}`)
  }
}

function headerFor(column: SizeRuleColumn): string {
  const unit = column.kind === 'text' ? '文本' : column.unit === 'none' ? '无单位' : column.unit
  return `${column.name}(${unit})`
}

export function exportSizeTable(rule: SizeRuleRecord): string {
  const rows = [
    ['规格', ...rule.columns.map(headerFor)],
    ...rule.rows.map((row) => [
      row.label,
      ...rule.columns.map((column) => row.values[column.id] ?? ''),
    ]),
  ]
  return Papa.unparse(rows, { escapeFormulae: true, newline: '\r\n' })
}

function emptyRows(labels: string[], columns: SizeRuleColumn[]) {
  return labels.map((label) => ({
    label,
    values: Object.fromEntries(columns.map((column) => [column.id, ''])),
  }))
}

export function createSizeTableTemplate(kind: SizeRuleTemplateKind): SizeRuleFields {
  if (kind === 'blank') return blankSizeRuleDraft()
  const columns = (names: string[]): SizeRuleColumn[] =>
    names.map((name, index) => ({ id: `c${index + 1}`, name, kind: 'number', unit: 'cm' }))
  if (kind === 'women') {
    const values = columns(['胸围', '衣长'])
    return sizeRuleFieldsSchema.parse({
      ...blankSizeRuleDraft(),
      name: '女装尺码草稿',
      columns: values,
      rows: emptyRows(['S', 'M', 'L'], values),
      advice: '请填写并核对本商品的实际尺寸；模板没有预置接待数值。',
      measurements: [
        { name: '身高', unit: 'cm' },
        { name: '体重', unit: 'kg' },
      ],
    })
  }
  if (kind === 'men') {
    const values = columns(['胸围', '肩宽', '衣长'])
    return sizeRuleFieldsSchema.parse({
      ...blankSizeRuleDraft(),
      name: '男装尺码草稿',
      columns: values,
      rows: emptyRows(['M', 'L', 'XL'], values),
      advice: '请填写并核对本商品的实际尺寸；模板没有预置接待数值。',
      measurements: [
        { name: '身高', unit: 'cm' },
        { name: '体重', unit: 'kg' },
      ],
    })
  }
  if (kind === 'shoes') {
    const values = columns(['适用脚长', '鞋内长'])
    return sizeRuleFieldsSchema.parse({
      ...blankSizeRuleDraft(),
      name: '鞋码草稿',
      columns: values,
      rows: emptyRows(['38', '39', '40'], values),
      advice: '请填写并核对本商品的实际尺寸；模板没有预置接待数值。',
      measurements: [{ name: '脚长', unit: 'cm' }],
    })
  }
  const storage = columns(['长', '宽', '高'])
  return sizeRuleFieldsSchema.parse({
    ...blankSizeRuleDraft(),
    name: '收纳箱规格草稿',
    columns: storage,
    rows: emptyRows(['小号', '大号'], storage),
    advice: '请填写并核对本商品的实际尺寸；模板没有预置接待数值。',
  })
}

/** Kept exported for the unit table UI without duplicating labels in the renderer. */
export function sizeUnitOptions() {
  return Object.entries(sizeUnitMeta).map(([value, unit]) => ({
    value,
    label: unit.label,
    group: unit.group,
  }))
}

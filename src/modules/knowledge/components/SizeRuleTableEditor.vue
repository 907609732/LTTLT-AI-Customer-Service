<script setup lang="ts">
import type {
  SizeRuleColumn,
  SizeRuleMeasurement,
  SizeRuleRow,
  SizeUnitOption,
} from '@/shared/contracts/size-rules'

const props = defineProps<{
  columns: SizeRuleColumn[]
  rows: SizeRuleRow[]
  measurements: SizeRuleMeasurement[]
  advice: string
  units: SizeUnitOption[]
  unitOptions: SizeUnitOption[]
  disabled: boolean
}>()
const emit = defineEmits<{
  'update:columns': [value: SizeRuleColumn[]]
  'update:rows': [value: SizeRuleRow[]]
  'update:measurements': [value: SizeRuleMeasurement[]]
  'update:advice': [value: string]
}>()

const valueOf = (event: Event) => (event.target as HTMLInputElement).value
function updateColumn(index: number, patch: Partial<SizeRuleColumn>) {
  emit(
    'update:columns',
    props.columns.map((column, current) => (current === index ? { ...column, ...patch } : column)),
  )
}
function changeKind(index: number, kind: SizeRuleColumn['kind']) {
  const current = props.columns[index]
  if (!current) return
  updateColumn(index, {
    kind,
    unit: kind === 'text' ? 'none' : current.unit === 'none' ? 'cm' : current.unit,
  })
}
function addColumn() {
  let number = 1
  while (props.columns.some((column) => column.id === `c${number}`)) number += 1
  const id = `c${number}`
  emit('update:columns', [
    ...props.columns,
    { id, name: `参数${number}`, kind: 'number', unit: 'cm' },
  ])
  emit(
    'update:rows',
    props.rows.map((row) => ({ ...row, values: { ...row.values, [id]: '' } })),
  )
}
function removeColumn(id: string) {
  if (props.columns.length <= 1) return
  emit(
    'update:columns',
    props.columns.filter((column) => column.id !== id),
  )
  emit(
    'update:rows',
    props.rows.map((row) => ({
      ...row,
      values: Object.fromEntries(
        Object.entries(row.values).filter(([columnId]) => columnId !== id),
      ),
    })),
  )
}
function updateRowLabel(index: number, label: string) {
  emit(
    'update:rows',
    props.rows.map((row, current) => (current === index ? { ...row, label } : row)),
  )
}
function updateCell(rowIndex: number, columnId: string, value: string) {
  emit(
    'update:rows',
    props.rows.map((row, current) =>
      current === rowIndex ? { ...row, values: { ...row.values, [columnId]: value } } : row,
    ),
  )
}
function addRow() {
  let number = 1
  while (props.rows.some((row) => row.label === `规格${number}`)) number += 1
  emit('update:rows', [
    ...props.rows,
    {
      label: `规格${number}`,
      values: Object.fromEntries(props.columns.map((column) => [column.id, ''])),
    },
  ])
}
function removeRow(index: number) {
  if (props.rows.length <= 1) return
  emit(
    'update:rows',
    props.rows.filter((_, current) => current !== index),
  )
}
function updateMeasurement(index: number, patch: Partial<SizeRuleMeasurement>) {
  emit(
    'update:measurements',
    props.measurements.map((measurement, current) =>
      current === index ? { ...measurement, ...patch } : measurement,
    ),
  )
}
function addMeasurement() {
  emit('update:measurements', [...props.measurements, { name: '', unit: 'cm' }])
}
function removeMeasurement(index: number) {
  emit(
    'update:measurements',
    props.measurements.filter((_, current) => current !== index),
  )
}
</script>

<template>
  <fieldset :disabled="disabled">
    <h3>参数列与单位</h3>
    <div class="size-rules__columns">
      <div v-for="(column, index) in columns" :key="column.id" class="size-rules__column">
        <label>
          参数名称 {{ index + 1 }}
          <input
            :value="column.name"
            :aria-label="`参数名称 ${index + 1}`"
            maxlength="40"
            required
            @input="updateColumn(index, { name: valueOf($event) })"
          />
        </label>
        <label>
          参数类型 {{ index + 1 }}
          <select
            :value="column.kind"
            :aria-label="`参数类型 ${index + 1}`"
            @change="
              changeKind(
                index,
                ($event.target as HTMLSelectElement).value as SizeRuleColumn['kind'],
              )
            "
          >
            <option value="number">数字或区间</option>
            <option value="text">文字说明</option>
          </select>
        </label>
        <label>
          参数单位 {{ index + 1 }}
          <select
            :value="column.unit"
            :aria-label="`参数单位 ${index + 1}`"
            :disabled="column.kind === 'text'"
            @change="
              updateColumn(index, {
                unit: ($event.target as HTMLSelectElement).value as SizeRuleColumn['unit'],
              })
            "
          >
            <option v-for="unit in units" :key="unit.value" :value="unit.value">
              {{ unit.label }}
            </option>
          </select>
        </label>
        <button
          type="button"
          :disabled="columns.length <= 1"
          :aria-label="`删除参数 ${index + 1}`"
          @click="removeColumn(column.id)"
        >
          删除列
        </button>
      </div>
    </div>
    <button type="button" :disabled="columns.length >= 12" @click="addColumn">添加参数列</button>

    <h3>尺码与规格数据</h3>
    <p>数值可填 92 或 92~96，闭区间包含端点；单位由参数列指定。</p>
    <div class="size-rules__table-scroll" role="region" aria-label="尺码表格">
      <table>
        <thead>
          <tr>
            <th>尺码 / 规格</th>
            <th v-for="column in columns" :key="column.id">
              {{ column.name }} · {{ column.unit === 'none' ? '文字/无单位' : column.unit }}
            </th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(row, rowIndex) in rows" :key="`${rowIndex}-${row.label}`">
            <td>
              <input
                :value="row.label"
                :aria-label="`规格名称 ${rowIndex + 1}`"
                maxlength="60"
                required
                @input="updateRowLabel(rowIndex, valueOf($event))"
              />
            </td>
            <td v-for="column in columns" :key="column.id">
              <input
                :value="row.values[column.id] ?? ''"
                :aria-label="`${column.name} ${row.label}`"
                maxlength="200"
                :placeholder="column.kind === 'number' ? '数字或区间' : '文字说明'"
                @input="updateCell(rowIndex, column.id, valueOf($event))"
              />
            </td>
            <td>
              <button
                type="button"
                :disabled="rows.length <= 1"
                :aria-label="`删除规格 ${rowIndex + 1}`"
                @click="removeRow(rowIndex)"
              >
                删除行
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <button type="button" :disabled="rows.length >= 100" @click="addRow">添加规格行</button>

    <h3>选码前需确认的买家参数</h3>
    <p>
      只有请求选码建议时才追问；直接询问某规格尺寸、普通问候不追问。请写清参数名称与单位，
      照片不用于猜测身体尺寸。
    </p>
    <div
      v-for="(measurement, index) in measurements"
      :key="`${index}-${measurement.name}`"
      class="size-rules__measurement"
    >
      <label>
        测量参数名称 {{ index + 1 }}
        <input
          :value="measurement.name"
          :aria-label="`测量参数名称 ${index + 1}`"
          maxlength="20"
          required
          @input="updateMeasurement(index, { name: valueOf($event) })"
        />
      </label>
      <label>
        测量参数单位 {{ index + 1 }}
        <select
          :value="measurement.unit"
          :aria-label="`测量参数单位 ${index + 1}`"
          @change="
            updateMeasurement(index, {
              unit: ($event.target as HTMLSelectElement).value as SizeRuleMeasurement['unit'],
            })
          "
        >
          <option v-for="unit in unitOptions" :key="unit.value" :value="unit.value">
            {{ unit.label }}
          </option>
        </select>
      </label>
      <button
        type="button"
        :aria-label="`移除测量参数 ${index + 1}`"
        @click="removeMeasurement(index)"
      >
        移除参数
      </button>
    </div>
    <button type="button" :disabled="measurements.length >= 6" @click="addMeasurement">
      添加测量参数
    </button>

    <label class="size-rules__field">
      选码或规格说明
      <textarea
        :value="advice"
        aria-label="选码或规格说明"
        maxlength="3000"
        rows="3"
        placeholder="填写版型、测量方法、适用范围等真实说明"
        @input="emit('update:advice', valueOf($event))"
      />
    </label>
  </fieldset>
</template>

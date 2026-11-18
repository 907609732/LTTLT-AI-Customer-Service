<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { ProductCatalogRow } from '@/shared/contracts/product-catalog'
import {
  blankSizeRuleDraft,
  sizeUnitKeys,
  sizeUnitMeta,
  type SizeRuleBinding,
  type SizeRuleColumn,
  type SizeRuleFields,
  type SizeRulePreview,
  type SizeRuleRecord,
  type SizeRuleTemplateKind,
} from '@/shared/contracts/size-rules'
import { useRuntimeStore } from '@/shared/state/runtime'
import { createSizeRulesClient } from '../size-rules-service'

type Draft = SizeRuleFields & { id?: string; version?: number; updatedAt?: number }
const runtime = useRuntimeStore()
const client = createSizeRulesClient((command) => runtime.run(command))
// Vue exposes reactive proxies; JSON cloning yields the plain DTO that the IPC boundary accepts.
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T
const messageOf = (error: unknown) =>
  (error instanceof Error ? error.message : String(error)).replace(
    /^Error invoking remote method '[^']+': (?:Error: )?/,
    '',
  )

const rules = ref<SizeRuleRecord[]>([])
const revision = ref(0)
const units = ref(
  sizeUnitKeys.map((value) => ({
    value,
    label: sizeUnitMeta[value].label,
    group: sizeUnitMeta[value].group,
  })),
)
const draft = ref<Draft>(blankSizeRuleDraft())
const dirty = ref(false)
const pending = ref(false)
const error = ref('')
const notice = ref('')
const tableText = ref('')
const preview = ref<SizeRulePreview | null>(null)
const deleteTarget = ref<SizeRuleRecord | null>(null)

const catalogStore = ref('')
const catalogQuery = ref('')
const catalogOffset = ref(0)
const catalog = ref<ProductCatalogRow[]>([])
const catalogTotal = ref(0)
const catalogLoading = ref(false)
let live = true
let generation = 0
let catalogTicket = 0
let resetting = false
let queryTimer: ReturnType<typeof setTimeout> | undefined

watch(
  draft,
  () => {
    if (!resetting) dirty.value = true
  },
  { deep: true, flush: 'sync' },
)

const templates: { kind: SizeRuleTemplateKind; label: string }[] = [
  { kind: 'blank', label: '空白新建' },
  { kind: 'women', label: '女装草稿' },
  { kind: 'men', label: '男装草稿' },
  { kind: 'shoes', label: '鞋码草稿' },
  { kind: 'storage', label: '收纳箱草稿' },
]
const unitOptions = computed(() => units.value.filter((unit) => unit.value !== 'none'))
const visibleBoundProducts = computed(() =>
  draft.value.bindings.map((binding) => ({
    ...binding,
    storeName:
      runtime.snapshot.stores.find((store) => store.id === binding.storeId)?.storeName ||
      binding.storeId,
  })),
)

function replaceDraft(value: Draft) {
  resetting = true
  draft.value = clone(value)
  resetting = false
}
function message(errorValue: unknown) {
  return messageOf(errorValue)
}
async function run(job: () => Promise<void>): Promise<boolean> {
  if (pending.value) return false
  pending.value = true
  error.value = ''
  notice.value = ''
  try {
    await job()
    return true
  } catch (cause) {
    error.value = message(cause)
    return false
  } finally {
    pending.value = false
  }
}

async function loadRules() {
  const ticket = ++generation
  const workspace = runtime.snapshot.workspaceId
  try {
    const result = await client.list()
    if (!live || ticket !== generation || workspace !== runtime.snapshot.workspaceId) return
    rules.value = result.rules
    revision.value = result.revision
    units.value = result.units
    if (!dirty.value && draft.value.id) {
      const current = result.rules.find((rule) => rule.id === draft.value.id)
      if (current) replaceDraft(current)
    }
  } catch (cause) {
    if (live && ticket === generation) error.value = message(cause)
  }
}

function loadCatalog() {
  const ticket = ++catalogTicket
  const storeId = catalogStore.value
  if (!storeId) {
    catalog.value = []
    catalogTotal.value = 0
    catalogLoading.value = false
    return
  }
  catalogLoading.value = true
  void client
    .products(storeId, catalogQuery.value, catalogOffset.value)
    .then((page) => {
      if (!live || ticket !== catalogTicket || storeId !== catalogStore.value) return
      catalog.value = page.items
      catalogTotal.value = page.total
    })
    .catch((cause) => {
      if (live && ticket === catalogTicket) error.value = message(cause)
    })
    .finally(() => {
      if (live && ticket === catalogTicket) catalogLoading.value = false
    })
}

function changeCatalogStore() {
  catalogOffset.value = 0
  catalogQuery.value = ''
  loadCatalog()
}

function editQuery() {
  clearTimeout(queryTimer)
  queryTimer = setTimeout(() => {
    catalogOffset.value = 0
    loadCatalog()
  }, 180)
}

function pageCatalog(delta: number) {
  catalogOffset.value = Math.max(0, catalogOffset.value + delta)
  loadCatalog()
}

function pick(rule: SizeRuleRecord) {
  replaceDraft(rule)
  dirty.value = false
  preview.value = null
  deleteTarget.value = null
  error.value = ''
  notice.value = ''
}

function useTemplate(kind: SizeRuleTemplateKind) {
  void run(async () => {
    const result = await client.template(kind)
    replaceDraft(result)
    dirty.value = true
    preview.value = null
    notice.value = '模板已放入未保存草稿；不会自动启用、绑定商品或开启 AI。'
  })
}

function addColumn() {
  let number = 1
  while (draft.value.columns.some((column) => column.id === `c${number}`)) number += 1
  const id = `c${number}`
  draft.value.columns.push({ id, name: `参数${number}`, kind: 'number', unit: 'cm' })
  for (const row of draft.value.rows) row.values[id] = ''
}
function removeColumn(id: string) {
  if (draft.value.columns.length <= 1) return
  draft.value.columns = draft.value.columns.filter((column) => column.id !== id)
  for (const row of draft.value.rows) delete row.values[id]
}
function updateColumnKind(column: SizeRuleColumn) {
  if (column.kind === 'text') column.unit = 'none'
  else if (column.unit === 'none') column.unit = 'cm'
}
function addRow() {
  let number = 1
  while (draft.value.rows.some((row) => row.label === `规格${number}`)) number += 1
  draft.value.rows.push({
    label: `规格${number}`,
    values: Object.fromEntries(draft.value.columns.map((column) => [column.id, ''])),
  })
}
function removeRow(index: number) {
  if (draft.value.rows.length <= 1) return
  draft.value.rows.splice(index, 1)
}
function addMeasurement() {
  draft.value.measurements.push({ name: '', unit: 'cm' })
}
function removeMeasurement(index: number) {
  draft.value.measurements.splice(index, 1)
}
function bindingKey(binding: SizeRuleBinding) {
  return JSON.stringify([binding.storeId, binding.productId])
}
function ownerFor(binding: SizeRuleBinding) {
  const key = bindingKey(binding)
  return rules.value.find(
    (rule) => rule.id !== draft.value.id && rule.bindings.some((item) => bindingKey(item) === key),
  )
}
function isBound(binding: SizeRuleBinding) {
  const key = bindingKey(binding)
  return draft.value.bindings.some((item) => bindingKey(item) === key)
}
function toggleBinding(binding: SizeRuleBinding, checked: boolean) {
  if (checked) {
    if (!isBound(binding)) draft.value.bindings.push({ ...binding })
  } else {
    const key = bindingKey(binding)
    draft.value.bindings = draft.value.bindings.filter((item) => bindingKey(item) !== key)
  }
}
function onProductToggle(row: ProductCatalogRow, event: Event) {
  const checked = (event.target as HTMLInputElement).checked
  toggleBinding({ storeId: catalogStore.value, productId: row.productId }, checked)
}
function releaseBinding(binding: SizeRuleBinding) {
  toggleBinding(binding, false)
}

function fields(): SizeRuleFields {
  const { id: _id, version: _version, updatedAt: _updated, ...value } = draft.value
  void _id
  void _version
  void _updated
  return clone(value)
}

function persist() {
  void run(async () => {
    const ticket = generation
    const value = fields()
    const result = await client.save({
      ...value,
      expectedRevision: revision.value,
      ...(draft.value.id && draft.value.version
        ? { id: draft.value.id, version: draft.value.version }
        : {}),
    })
    if (!live || ticket !== generation) return
    revision.value = result.revision
    const index = rules.value.findIndex((rule) => rule.id === result.rule.id)
    if (index < 0) rules.value = [...rules.value, result.rule]
    else rules.value = rules.value.map((rule) => (rule.id === result.rule.id ? result.rule : rule))
    replaceDraft(result.rule)
    dirty.value = false
    preview.value = null
    notice.value = result.rule.enabled
      ? '尺码规则已保存；AI 开关未改变，请核对后再用于接待。'
      : '尺码规则草稿已保存；未自动启用、绑定商品或开启 AI。'
  })
}

function confirmRemove() {
  const target = deleteTarget.value
  if (!target?.version) return
  void run(async () => {
    const ticket = generation
    const result = await client.remove({
      id: target.id,
      version: target.version,
      expectedRevision: revision.value,
      confirmed: true,
    })
    if (!live || ticket !== generation) return
    revision.value = result.revision
    rules.value = rules.value.filter((rule) => rule.id !== target.id)
    deleteTarget.value = null
    replaceDraft(blankSizeRuleDraft())
    dirty.value = false
    notice.value = '规则已删除，原商品绑定已解除。'
  })
}

function previewTable() {
  void run(async () => {
    preview.value = await client.preview(tableText.value)
  })
}
function usePreview() {
  if (!preview.value) return
  draft.value.columns = clone(preview.value.columns)
  draft.value.rows = clone(preview.value.rows)
  preview.value = null
  notice.value = '预览表格已放入草稿，尚未保存。'
}
function requestDelete() {
  if (draft.value.id && draft.value.version) deleteTarget.value = draft.value as SizeRuleRecord
}
function exportCsv() {
  if (!draft.value.id) {
    error.value = '请先保存规则再导出已保存表格'
    return
  }
  void run(async () => {
    const result = await client.exportCsv(draft.value.id!)
    if (typeof URL.createObjectURL !== 'function') throw new Error('当前环境不支持下载表格')
    const url = URL.createObjectURL(
      new Blob(['\uFEFF' + result.csv], { type: 'text/csv;charset=utf-8' }),
    )
    const link = document.createElement('a')
    link.href = url
    link.download = '尺码规格表.csv'
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  })
}

watch(
  () => runtime.snapshot.workspaceId,
  () => {
    generation += 1
    catalogTicket += 1
    rules.value = []
    revision.value = 0
    replaceDraft(blankSizeRuleDraft())
    dirty.value = false
    preview.value = null
    deleteTarget.value = null
    tableText.value = ''
    error.value = ''
    notice.value = ''
    catalog.value = []
    catalogTotal.value = 0
    catalogStore.value = runtime.selectedStoreId || runtime.snapshot.stores[0]?.id || ''
    void loadRules()
    loadCatalog()
  },
)
watch(
  () => runtime.snapshot.stores.map((store) => store.id).join('\n'),
  () => {
    if (!runtime.snapshot.stores.some((store) => store.id === catalogStore.value)) {
      catalogStore.value = runtime.snapshot.stores[0]?.id ?? ''
      loadCatalog()
    }
  },
)

onMounted(() => {
  live = true
  catalogStore.value = runtime.selectedStoreId || runtime.snapshot.stores[0]?.id || ''
  void loadRules()
  loadCatalog()
})
onBeforeUnmount(() => {
  live = false
  generation += 1
  catalogTicket += 1
  clearTimeout(queryTimer)
})
</script>

<template>
  <section class="size-rules" data-v-5f3c24c3="" aria-label="结构化尺码规则">
    <header class="size-rules__head">
      <div>
        <h2>结构化尺码规则</h2>
        <p>
          用当前本机商品目录绑定准确店铺和商品；同一店铺商品只能归属一条规则，停用也占用绑定。
          规则只作为已保存证据，不会自动开启 AI 或覆盖下方自由文本知识候选。
        </p>
      </div>
      <button type="button" :disabled="pending" @click="loadRules">重新载入规则</button>
    </header>
    <p v-if="error" class="size-rules__error" role="alert">{{ error }}</p>
    <p v-if="notice" class="size-rules__notice" role="status">{{ notice }}</p>

    <div class="size-rules__layout">
      <aside class="size-rules__list" aria-label="尺码规则列表">
        <h3>规则 · {{ rules.length }}</h3>
        <button
          v-for="rule in rules"
          :key="rule.id"
          type="button"
          :disabled="pending"
          :aria-pressed="rule.id === draft.id"
          :aria-label="`选择尺码规则 ${rule.name}`"
          @click="pick(rule)"
        >
          <strong>{{ rule.name }}</strong>
          <small>
            {{ rule.enabled ? '已启用' : '草稿/停用' }} · {{ rule.bindings.length }} 个商品
          </small>
        </button>
        <p v-if="!rules.length">尚无结构化规则；可新建空白或模板草稿。</p>
        <h3>模板草稿</h3>
        <button
          v-for="template in templates"
          :key="template.kind"
          type="button"
          :disabled="pending"
          :aria-label="template.label"
          @click="useTemplate(template.kind)"
        >
          {{ template.label }}
        </button>
        <p>模板没有预置接待数值，不会自动启用、绑定商品或开启 AI。</p>
      </aside>

      <form class="size-rules__form" @submit.prevent="persist">
        <fieldset :disabled="pending">
          <label class="size-rules__field">
            尺码规则名称
            <input v-model="draft.name" aria-label="尺码规则名称" maxlength="100" required />
          </label>
          <label class="size-rules__check">
            <input v-model="draft.enabled" type="checkbox" />
            启用本规则供接待和训练参考
          </label>
          <p class="size-rules__hint">
            空数值可保存为停用草稿；启用前必须填写完整表格，并为每个选码参数配置同名数字列。
          </p>

          <h3>参数列与单位</h3>
          <div class="size-rules__columns">
            <div
              v-for="(column, index) in draft.columns"
              :key="column.id"
              class="size-rules__column"
            >
              <label>
                参数名称 {{ index + 1 }}
                <input
                  v-model="column.name"
                  :aria-label="`参数名称 ${index + 1}`"
                  maxlength="40"
                  required
                />
              </label>
              <label>
                参数类型 {{ index + 1 }}
                <select
                  v-model="column.kind"
                  :aria-label="`参数类型 ${index + 1}`"
                  @change="updateColumnKind(column)"
                >
                  <option value="number">数字或区间</option>
                  <option value="text">文字说明</option>
                </select>
              </label>
              <label>
                参数单位 {{ index + 1 }}
                <select
                  v-model="column.unit"
                  :aria-label="`参数单位 ${index + 1}`"
                  :disabled="column.kind === 'text'"
                >
                  <option v-for="unit in units" :key="unit.value" :value="unit.value">
                    {{ unit.label }}
                  </option>
                </select>
              </label>
              <button
                type="button"
                :disabled="draft.columns.length <= 1"
                :aria-label="`删除参数 ${index + 1}`"
                @click="removeColumn(column.id)"
              >
                删除列
              </button>
            </div>
          </div>
          <button type="button" :disabled="draft.columns.length >= 12" @click="addColumn">
            添加参数列
          </button>

          <h3>尺码与规格数据</h3>
          <p>数值可填 92 或 92~96，闭区间包含端点；单位由参数列指定。</p>
          <div class="size-rules__table-scroll" role="region" aria-label="尺码表格">
            <table>
              <thead>
                <tr>
                  <th>尺码 / 规格</th>
                  <th v-for="column in draft.columns" :key="column.id">
                    {{ column.name }} · {{ column.unit === 'none' ? '文字/无单位' : column.unit }}
                  </th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(row, rowIndex) in draft.rows" :key="`${rowIndex}-${row.label}`">
                  <td>
                    <input
                      v-model="row.label"
                      :aria-label="`规格名称 ${rowIndex + 1}`"
                      maxlength="60"
                      required
                    />
                  </td>
                  <td v-for="column in draft.columns" :key="column.id">
                    <input
                      v-model="row.values[column.id]"
                      :aria-label="`${column.name} ${row.label}`"
                      maxlength="200"
                      :placeholder="column.kind === 'number' ? '数字或区间' : '文字说明'"
                    />
                  </td>
                  <td>
                    <button
                      type="button"
                      :disabled="draft.rows.length <= 1"
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
          <button type="button" :disabled="draft.rows.length >= 100" @click="addRow">
            添加规格行
          </button>

          <h3>选码前需确认的买家参数</h3>
          <p>
            只有请求选码建议时才追问；直接询问某规格尺寸、普通问候不追问。请写清参数名称与单位，
            照片不用于猜测身体尺寸。
          </p>
          <div
            v-for="(measurement, index) in draft.measurements"
            :key="`${index}-${measurement.name}`"
            class="size-rules__measurement"
          >
            <label>
              测量参数名称 {{ index + 1 }}
              <input
                v-model="measurement.name"
                :aria-label="`测量参数名称 ${index + 1}`"
                maxlength="20"
                required
              />
            </label>
            <label>
              测量参数单位 {{ index + 1 }}
              <select v-model="measurement.unit" :aria-label="`测量参数单位 ${index + 1}`">
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
          <button type="button" :disabled="draft.measurements.length >= 6" @click="addMeasurement">
            添加测量参数
          </button>

          <label class="size-rules__field">
            选码或规格说明
            <textarea
              v-model="draft.advice"
              aria-label="选码或规格说明"
              maxlength="3000"
              rows="3"
              placeholder="填写版型、测量方法、适用范围等真实说明"
            />
          </label>

          <fieldset class="size-rules__bindings">
            <legend>店铺与商品绑定 · 已选 {{ draft.bindings.length }} 个商品</legend>
            <p>停用规则仍保留归属；若商品已归属其他规则，必须先解除原绑定。</p>
            <label class="size-rules__field">
              绑定店铺
              <select v-model="catalogStore" aria-label="绑定店铺" @change="changeCatalogStore">
                <option value="">请选择店铺</option>
                <option v-for="store in runtime.snapshot.stores" :key="store.id" :value="store.id">
                  {{ store.storeName || store.id }}
                </option>
              </select>
            </label>
            <label class="size-rules__field">
              搜索绑定商品
              <input
                v-model="catalogQuery"
                aria-label="搜索绑定商品"
                maxlength="200"
                placeholder="商品编号、编码或名称"
                @input="editQuery"
              />
            </label>
            <div class="size-rules__catalog" :aria-busy="catalogLoading">
              <p v-if="catalogLoading">正在读取商品目录…</p>
              <p v-else-if="!catalog.length">
                {{ catalogStore ? '当前商品目录没有符合条件的结果。' : '请选择店铺。' }}
              </p>
              <template v-else>
                <label v-for="row in catalog" :key="row.productId">
                  <input
                    type="checkbox"
                    :aria-label="`绑定商品 ${row.productId}`"
                    :checked="isBound({ storeId: catalogStore, productId: row.productId })"
                    :disabled="
                      Boolean(ownerFor({ storeId: catalogStore, productId: row.productId }))
                    "
                    @change="onProductToggle(row, $event)"
                  />
                  {{ row.title }} · {{ row.productId }}
                  <span v-if="row.enabled === false">（商品知识已停用）</span>
                  <span v-if="ownerFor({ storeId: catalogStore, productId: row.productId })">
                    （已归属
                    {{ ownerFor({ storeId: catalogStore, productId: row.productId })?.name }}）
                  </span>
                </label>
              </template>
            </div>
            <div class="size-rules__pager">
              <button
                type="button"
                :disabled="catalogLoading || catalogOffset === 0"
                @click="pageCatalog(-20)"
              >
                商品上一页
              </button>
              <button
                type="button"
                :disabled="catalogLoading || catalogOffset + 20 >= catalogTotal"
                @click="pageCatalog(20)"
              >
                商品下一页
              </button>
            </div>
            <ul class="size-rules__binding-list">
              <li
                v-for="binding in visibleBoundProducts"
                :key="`${binding.storeId}:${binding.productId}`"
              >
                <button
                  type="button"
                  :aria-label="`解除绑定 ${binding.storeId} ${binding.productId}`"
                  @click="releaseBinding(binding)"
                >
                  {{ binding.storeName }} · {{ binding.productId }} ×
                </button>
              </li>
            </ul>
          </fieldset>

          <details class="size-rules__paste">
            <summary>粘贴 CSV 或 TSV 表格</summary>
            <p>
              首列写“尺码”或“规格”，其他列注明单位，例如“胸围(cm)”“材质(文本)”。预览只替换草稿。
            </p>
            <textarea v-model="tableText" aria-label="尺码表格文本" maxlength="1048576" rows="4" />
            <button type="button" :disabled="!tableText" @click="previewTable">预览表格</button>
            <div v-if="preview" class="size-rules__preview">
              <p>预览：{{ preview.count }} 行、{{ preview.columns.length }} 列；尚未保存。</p>
              <table>
                <thead>
                  <tr>
                    <th>规格</th>
                    <th v-for="column in preview.columns" :key="column.id">
                      {{ column.name }}（{{ column.unit }}）
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <tr
                    v-for="(row, index) in preview.rows.slice(0, 5)"
                    :key="`${index}-${row.label}`"
                  >
                    <td>{{ row.label }}</td>
                    <td v-for="column in preview.columns" :key="column.id">
                      {{ row.values[column.id] }}
                    </td>
                  </tr>
                </tbody>
              </table>
              <button type="button" @click="usePreview">使用预览表格</button>
            </div>
          </details>

          <div class="size-rules__actions">
            <button type="submit">保存尺码规则</button>
            <button type="button" :disabled="!draft.id" @click="exportCsv">导出已保存 CSV</button>
            <button v-if="draft.id" type="button" @click="requestDelete">删除尺码规则</button>
          </div>
        </fieldset>
      </form>
    </div>

    <div
      v-if="deleteTarget"
      class="size-rules__delete"
      role="alertdialog"
      aria-label="确认删除尺码规则"
    >
      <p>删除“{{ deleteTarget.name }}”并解除其 {{ deleteTarget.bindings.length }} 个商品绑定？</p>
      <button type="button" :disabled="pending" @click="deleteTarget = null">取消删除规则</button>
      <button type="button" :disabled="pending" @click="confirmRemove">确认删除规则</button>
    </div>
  </section>
</template>

<style scoped>
.size-rules {
  margin-top: 24px;
  border-top: 1px solid var(--el-border-color-light);
  padding-top: 16px;
}
.size-rules__head,
.size-rules__actions,
.size-rules__pager {
  display: flex;
  gap: 8px;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
}
.size-rules__layout {
  display: grid;
  grid-template-columns: minmax(180px, 240px) minmax(0, 1fr);
  gap: 16px;
}
.size-rules__list button {
  display: block;
  width: 100%;
  margin-bottom: 6px;
  text-align: left;
}
.size-rules__list small {
  display: block;
  color: var(--el-text-color-secondary);
}
.size-rules__form fieldset {
  border: 0;
  padding: 0;
  min-width: 0;
}
.size-rules__field,
.size-rules__measurement label,
.size-rules__column label {
  display: grid;
  gap: 4px;
  margin-bottom: 8px;
}
.size-rules__check {
  display: flex;
  gap: 6px;
  align-items: center;
}
.size-rules__hint,
.size-rules__error {
  color: var(--el-color-danger);
}
.size-rules__notice {
  color: var(--el-color-success);
}
.size-rules__columns,
.size-rules__measurement {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 8px;
  align-items: end;
}
.size-rules__table-scroll {
  overflow: auto;
}
.size-rules__table-scroll table,
.size-rules__preview table {
  border-collapse: collapse;
  width: 100%;
}
.size-rules__table-scroll th,
.size-rules__table-scroll td,
.size-rules__preview th,
.size-rules__preview td {
  border: 1px solid var(--el-border-color-lighter);
  padding: 4px;
}
.size-rules__catalog {
  max-height: 220px;
  overflow: auto;
  margin: 8px 0;
}
.size-rules__catalog label {
  display: block;
  margin: 4px 0;
}
.size-rules__binding-list {
  list-style: none;
  padding: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.size-rules__delete {
  margin-top: 12px;
  padding: 12px;
  border: 1px solid var(--el-color-warning);
  background: var(--el-color-warning-light-9);
}
@media (max-width: 760px) {
  .size-rules__layout {
    grid-template-columns: 1fr;
  }
}
</style>

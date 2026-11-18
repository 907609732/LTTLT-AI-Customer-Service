<script setup lang="ts">
import SizeRuleBindingEditor from './SizeRuleBindingEditor.vue'
import SizeRuleTableEditor from './SizeRuleTableEditor.vue'
import { useSizeRulesController } from './use-size-rules-controller'

const {
  rules,
  draft,
  pending,
  error,
  notice,
  tableText,
  preview,
  deleteTarget,
  catalogStore,
  catalogQuery,
  catalogOffset,
  catalog,
  catalogTotal,
  catalogLoading,
  templates,
  units,
  unitOptions,
  stores,
  loadRules,
  setCatalogStore,
  setCatalogQuery,
  pageCatalog,
  pick,
  useTemplate,
  toggleBinding,
  releaseBinding,
  persist,
  confirmRemove,
  previewTable,
  usePreview,
  requestDelete,
  exportCsv,
} = useSizeRulesController()
</script>

<template>
  <section class="size-rules" data-v-5f3c24c3="" aria-label="结构化尺码规则">
    <header class="size-rules__head">
      <div>
        <h2>结构化尺码规则</h2>
        <p>
          绑定店铺和商品后可保存规则；同一商品只能绑定一条规则，停用也保留绑定。规则不会自动开启
          AI，也不覆盖下方自由文本知识。
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

          <SizeRuleTableEditor
            v-model:columns="draft.columns"
            v-model:rows="draft.rows"
            v-model:measurements="draft.measurements"
            v-model:advice="draft.advice"
            :units="units"
            :unit-options="unitOptions"
            :disabled="pending"
          />

          <SizeRuleBindingEditor
            :bindings="draft.bindings"
            :stores="stores"
            :rules="rules"
            :draft-rule-id="draft.id"
            :products="catalog"
            :store-id="catalogStore"
            :query="catalogQuery"
            :offset="catalogOffset"
            :total="catalogTotal"
            :loading="catalogLoading"
            :disabled="pending"
            @update:store-id="setCatalogStore"
            @update:query="setCatalogQuery"
            @page="pageCatalog"
            @toggle="toggleBinding"
            @release="releaseBinding"
          />

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
:deep(.size-rules__pager) {
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
:deep(.size-rules__field),
:deep(.size-rules__measurement label),
:deep(.size-rules__column label) {
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
:deep(.size-rules__columns),
:deep(.size-rules__measurement) {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 8px;
  align-items: end;
}
:deep(.size-rules__table-scroll) {
  overflow: auto;
}
:deep(.size-rules__table-scroll table),
:deep(.size-rules__preview table) {
  border-collapse: collapse;
  width: 100%;
}
:deep(.size-rules__table-scroll th),
:deep(.size-rules__table-scroll td),
:deep(.size-rules__preview th),
:deep(.size-rules__preview td) {
  border: 1px solid var(--el-border-color-lighter);
  padding: 4px;
}
:deep(.size-rules__catalog) {
  max-height: 220px;
  overflow: auto;
  margin: 8px 0;
}
:deep(.size-rules__catalog label) {
  display: block;
  margin: 4px 0;
}
:deep(.size-rules__binding-list) {
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

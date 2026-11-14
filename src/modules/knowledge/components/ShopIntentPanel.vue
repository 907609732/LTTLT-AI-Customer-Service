<script setup lang="ts">
import { reactive, ref } from 'vue'
import { ElMessageBox } from 'element-plus'
import RuntimePanel from '@/shared/ui/RuntimePanel.vue'
import { useRuntimeStore } from '@/shared/state/runtime'
import { useTask } from '@/shared/ui/use-task'
import { downloadText } from '@/shared/platform/files'
import { intentsSchema, importPreviewSchema, type IntentPack } from '@/shared/contracts/backend'
import { auditQuestion } from '../learning'
const runtime = useRuntimeStore(),
  task = useTask()
type Draft = Omit<IntentPack, 'id' | 'version' | 'source'> &
  Partial<Pick<IntentPack, 'id' | 'version'>>
const blank = (): Draft => ({
  name: '',
  enabled: true,
  storeIds: runtime.selectedStoreId ? [runtime.selectedStoreId] : [],
  productIds: [],
  entries: [{ question: '', keywords: [], answer: '', enabled: true }],
})
const draft = reactive<Draft>(blank()),
  packs = ref<IntentPack[]>([]),
  productIdsText = ref(''),
  importing = ref(''),
  preview = ref<{ revision: number; count: number } | null>(null)
async function load() {
  packs.value = intentsSchema.parse((await runtime.run({ action: 'list-intent-packs' })).data).packs
}
function edit(pack?: IntentPack) {
  delete draft.id
  delete draft.version
  const next = pack
    ? {
        id: pack.id,
        version: pack.version,
        name: pack.name,
        enabled: pack.enabled,
        storeIds: [...pack.storeIds],
        productIds: [...pack.productIds],
        entries: pack.entries.map((entry) => ({ ...entry, keywords: [...entry.keywords] })),
      }
    : blank()
  Object.assign(draft, next)
  productIdsText.value = next.productIds.join('\n')
}
async function save() {
  await task.run(async () => {
    const result = await runtime.run({
      action: 'save-intent-pack',
      values: {
        ...draft,
        storeIds: [...draft.storeIds],
        productIds: productIdsText.value
          .split(/\r?\n/)
          .map((x) => x.trim())
          .filter(Boolean),
        entries: draft.entries.map((x) => ({
          ...x,
          keywords: [...x.keywords],
          enabled: x.question === auditQuestion ? false : x.enabled,
        })),
      },
    })
    await load()
    edit()
    preview.value = null
    task.message.value = result.message
  })
}
async function remove(pack: IntentPack) {
  try {
    await ElMessageBox.confirm(`删除“${pack.name}”知识包？`, '确认删除')
  } catch {
    return
  }
  await task.run(async () => {
    await runtime.run({
      action: 'remove-intent-pack',
      values: { id: pack.id, version: pack.version, confirmed: true },
    })
    preview.value = null
    await load()
  })
}
async function exportJson() {
  await task.run(async () => {
    const result = await runtime.run({ action: 'export-intent-packs' })
    if (typeof result.data.json !== 'string') throw new Error('导出内容无效')
    downloadText('意图知识包.json', result.data.json)
  })
}
async function previewJson() {
  await task.run(async () => {
    preview.value = importPreviewSchema.parse(
      (await runtime.run({ action: 'preview-intent-import', values: { json: importing.value } }))
        .data,
    )
  })
}
async function importJson() {
  await task.run(async () => {
    if (!preview.value) throw new Error('请先预览')
    await runtime.run({
      action: 'import-intent-packs',
      values: { json: importing.value, revision: preview.value.revision, confirmed: true },
    })
    preview.value = null
    await load()
    task.message.value = '知识包已导入。'
  })
}
if (runtime.available) void task.run(load)
</script>
<template>
  <RuntimePanel
    title="意图问法与知识包"
    description="知识按店铺和商品编号绑定，接待与训练使用同一份资料。"
    :error="task.error.value"
    :message="task.message.value"
  >
    <template #actions
      ><el-button :disabled="task.pending.value" @click="task.run(load)">刷新知识包</el-button
      ><el-button @click="edit()">新建知识包</el-button
      ><el-button :disabled="task.pending.value" @click="exportJson">导出 JSON</el-button></template
    >
    <div class="runtime-two-columns">
      <div>
        <button
          v-for="pack in packs"
          :key="pack.id"
          class="runtime-entry"
          :class="{ active: draft.id === pack.id }"
          :disabled="task.pending.value"
          @click="edit(pack)"
        >
          <b>{{ pack.name }}</b>
          <p>
            {{ pack.entries.length }} 条问答 · {{ pack.enabled ? '启用' : '停用'
            }}{{ pack.source ? ' · 人工纠错来源' : '' }}
          </p>
        </button>
        <p v-if="!packs.length">暂无知识包，可在右侧新建。</p>
      </div>
      <form class="runtime-form" @submit.prevent="save">
        <label
          >知识包名称<el-input
            v-model="draft.name"
            aria-label="知识包名称"
            maxlength="100" /></label
        ><el-switch v-model="draft.enabled" active-text="启用知识包" /><label
          >应用店铺<el-select v-model="draft.storeIds" multiple aria-label="知识应用店铺"
            ><el-option
              v-for="shop in runtime.snapshot.stores"
              :key="shop.id"
              :value="shop.id"
              :label="shop.storeName || '待识别店铺'" /></el-select></label
        ><label
          >绑定商品编号（每行一个，留空用于所选店铺全部商品）<el-input
            v-model="productIdsText"
            type="textarea"
            :rows="2"
        /></label>
        <div v-for="(entry, index) in draft.entries" :key="index" class="runtime-card">
          <template v-if="entry.question === auditQuestion">
            <strong>学习来源审计（保持停用，不参与接待检索）</strong>
            <pre style="white-space: pre-wrap; overflow-wrap: anywhere">{{ entry.answer }}</pre>
          </template>
          <template v-else>
            <label
              >问法 {{ index + 1
              }}<el-input
                v-model="entry.question"
                type="textarea"
                :rows="2"
                maxlength="1000" /></label
            ><label
              >关键词（每行一个）<el-input
                :model-value="entry.keywords.join('\n')"
                type="textarea"
                :rows="2"
                @update:model-value="
                  entry.keywords = String($event).split(/\r?\n/).filter(Boolean)
                " /></label
            ><label
              >标准答案<el-input v-model="entry.answer" type="textarea" :rows="3" maxlength="4000"
            /></label>
            <div class="runtime-toolbar">
              <el-switch v-model="entry.enabled" active-text="启用本条" /><el-button
                :disabled="draft.entries.length <= 1"
                @click="draft.entries.splice(index, 1)"
                >移除问答</el-button
              >
            </div>
          </template>
        </div>
        <el-button
          @click="draft.entries.push({ question: '', keywords: [], answer: '', enabled: true })"
          >增加问答</el-button
        >
        <div class="runtime-actions">
          <el-button
            type="primary"
            native-type="submit"
            :loading="task.pending.value"
            :disabled="!runtime.available"
            >保存知识包</el-button
          ><el-button
            v-if="draft.id"
            type="danger"
            :disabled="task.pending.value"
            @click="
              packs.find((x) => x.id === draft.id) && remove(packs.find((x) => x.id === draft.id)!)
            "
            >删除当前知识包</el-button
          >
        </div>
      </form>
    </div>
    <details class="runtime-card">
      <summary>JSON 导入</summary>
      <el-input
        v-model="importing"
        type="textarea"
        :rows="5"
        aria-label="知识包 JSON"
        @input="preview = null"
      />
      <div class="runtime-toolbar">
        <el-button :disabled="!importing || task.pending.value" @click="previewJson"
          >预览 JSON</el-button
        ><el-button :disabled="!preview || task.pending.value" @click="importJson"
          >确认导入 {{ preview?.count ?? 0 }} 个包</el-button
        >
      </div>
    </details>
  </RuntimePanel>
</template>

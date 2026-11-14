<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, ref } from 'vue'
import { ElMessage } from 'element-plus'
import {
  customPhrases,
  observePhraseWorkspace,
  readPhraseJsonFile,
  phraseStores,
  downloadPhraseJson,
  parsePhraseImport,
  serializePhraseExport,
  phraseDraftSchema,
  type CustomPhrase,
  type PhraseDraft,
  type PhraseLibrary,
  type PhraseScope,
} from '../services/custom-phrases'

const stores = ref<{ id: string; name: string }[]>([])
const workspaceId = ref(''),
  storeId = ref(''),
  query = ref(''),
  error = ref('')
const library = ref<PhraseLibrary>({ revision: 0, rows: [] })
const busy = ref(false),
  ready = ref(false),
  editing = ref(false),
  editingId = ref<string>()
const draft = ref<PhraseDraft>({ title: '', scene: '', reply: '' })
const importText = ref(''),
  importing = ref(false),
  deleteId = ref('')
let ticket = 0
let stopObserving: (() => void) | undefined
onBeforeUnmount(() => {
  ticket++
  stopObserving?.()
})
const rows = computed(() =>
  library.value.rows.filter((row) =>
    `${row.title} ${row.scene} ${row.reply}`
      .toLocaleLowerCase()
      .includes(query.value.toLocaleLowerCase().trim()),
  ),
)
const preview = computed(() => {
  if (!importText.value.trim()) return { count: 0, error: '' }
  try {
    return { count: parsePhraseImport(importText.value).length, error: '' }
  } catch (cause) {
    return { count: 0, error: cause instanceof Error ? cause.message : '格式错误' }
  }
})
function scope(): PhraseScope {
  if (!workspaceId.value || !storeId.value) throw new Error('请先选择店铺')
  return { workspaceId: workspaceId.value, storeId: storeId.value }
}
function clearDrafts() {
  editing.value = false
  editingId.value = undefined
  importing.value = false
  importText.value = ''
  deleteId.value = ''
}
async function load(initialize = false) {
  const current = ++ticket
  busy.value = true
  ready.value = false
  error.value = ''
  library.value = { revision: 0, rows: [] }
  clearDrafts()
  try {
    if (initialize) {
      const result = await phraseStores()
      if (current !== ticket) return
      workspaceId.value = result.workspaceId
      stores.value = result.stores
      if (!stores.value.some((row) => row.id === storeId.value))
        storeId.value = stores.value[0]?.id ?? ''
    }
    if (!storeId.value) throw new Error('请先添加店铺，再管理该店铺的快捷话术')
    const result = await customPhrases.list(scope())
    if (current === ticket) {
      library.value = result
      ready.value = true
    }
  } catch (cause) {
    if (current === ticket) error.value = cause instanceof Error ? cause.message : '加载失败'
  } finally {
    if (current === ticket) busy.value = false
  }
}
onMounted(() => {
  stopObserving = observePhraseWorkspace((nextWorkspaceId, storeIds) => {
    if (
      workspaceId.value &&
      (nextWorkspaceId !== workspaceId.value ||
        (storeId.value && !storeIds.includes(storeId.value)))
    ) {
      ticket++
      busy.value = false
      ready.value = false
      clearDrafts()
      library.value = { revision: 0, rows: [] }
      stores.value = []
      storeId.value = ''
      workspaceId.value = ''
      error.value = '工作区或店铺已变化，旧话术已隐藏，请刷新后重新选择'
    }
  })
  void load(true)
})
function edit(row?: CustomPhrase) {
  clearDrafts()
  editingId.value = row?.id
  draft.value = row
    ? { title: row.title, scene: row.scene, reply: row.reply }
    : { title: '', scene: '', reply: '' }
  editing.value = true
}
function beginImport() {
  clearDrafts()
  importing.value = true
}
async function chooseImportFile(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file || busy.value) return
  const current = ++ticket
  busy.value = true
  error.value = ''
  try {
    const text = await readPhraseJsonFile(file)
    if (current === ticket) importText.value = text
  } catch (cause) {
    if (current === ticket) error.value = cause instanceof Error ? cause.message : '读取文件失败'
  } finally {
    if (current === ticket) busy.value = false
    input.value = ''
  }
}
async function mutate(action: (value: PhraseScope) => Promise<PhraseLibrary>, success: string) {
  if (busy.value || !ready.value) return
  const current = ++ticket
  busy.value = true
  error.value = ''
  try {
    const result = await action(scope())
    if (current === ticket) {
      library.value = result
      clearDrafts()
      ElMessage.success(success)
    }
  } catch (cause) {
    if (current === ticket) error.value = cause instanceof Error ? cause.message : '操作失败'
  } finally {
    if (current === ticket) busy.value = false
  }
}
function save() {
  const value = phraseDraftSchema.safeParse(draft.value)
  if (!value.success) {
    error.value = '请填写标题（80字内）、场景（40字内）、回复（4000字内），内容不能为空'
    return
  }
  void mutate(
    (valueScope) =>
      customPhrases.save(valueScope, {
        revision: library.value.revision,
        id: editingId.value,
        draft: value.data,
      }),
    '话术已保存到当前店铺',
  )
}
async function copy(row: CustomPhrase) {
  if (busy.value) return
  busy.value = true
  try {
    await customPhrases.copy(scope(), row.id)
    ElMessage.success('话术已复制，请核对后自行使用，不会直接发送')
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '复制失败'
  } finally {
    busy.value = false
  }
}
function exportJson() {
  try {
    downloadPhraseJson(serializePhraseExport(library.value.rows))
    ElMessage.success('已导出当前店铺的自定义话术')
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '导出失败'
  }
}
</script>

<template>
  <section class="custom-library" data-testid="custom-phrases">
    <p>
      自定义话术仅在当前工作区、所选店铺保存。点击复制后自行核对使用，不直接发送，也不会自动加入 AI
      系统参考。
    </p>
    <div class="custom-toolbar">
      <el-select
        v-model="storeId"
        aria-label="自定义话术店铺"
        placeholder="选择店铺"
        :disabled="busy"
        @change="load()"
      >
        <el-option v-for="store in stores" :key="store.id" :label="store.name" :value="store.id" />
      </el-select>
      <el-button :disabled="busy" @click="load(true)">刷新</el-button>
      <el-button :disabled="busy || !ready" @click="edit()">新建话术</el-button>
      <el-button :disabled="busy || !ready" @click="beginImport">导入 JSON</el-button>
      <el-button :disabled="busy || !ready" @click="exportJson">导出 JSON</el-button>
    </div>
    <p v-if="error" role="alert" class="custom-error">{{ error }}</p>
    <p v-if="busy" role="status">正在处理，请稍候…</p>
    <el-form v-if="editing" class="custom-editor" label-position="top" @submit.prevent="save">
      <el-form-item label="标题"
        ><el-input v-model="draft.title" aria-label="话术标题" maxlength="80" :disabled="busy"
      /></el-form-item>
      <el-form-item label="场景"
        ><el-input v-model="draft.scene" aria-label="话术场景" maxlength="40" :disabled="busy"
      /></el-form-item>
      <el-form-item label="回复正文"
        ><el-input
          v-model="draft.reply"
          aria-label="话术正文"
          type="textarea"
          :rows="4"
          maxlength="4000"
          show-word-limit
          :disabled="busy"
      /></el-form-item>
      <el-button type="primary" :disabled="busy" @click="save">保存话术</el-button>
      <el-button :disabled="busy" @click="clearDrafts">取消编辑</el-button>
    </el-form>
    <div v-if="importing" class="custom-editor">
      <label
        >选择 JSON 文件
        <input
          type="file"
          accept=".json,application/json"
          aria-label="选择话术JSON文件"
          :disabled="busy"
          @change="chooseImportFile"
      /></label>
      <p>
        粘贴导出的 JSON，先预览再追加导入；完全相同的话术自动跳过，已有话术不会被覆盖。最多 500 条。
      </p>
      <el-input
        v-model="importText"
        aria-label="导入话术 JSON"
        type="textarea"
        :rows="5"
        :maxlength="2000000"
        :disabled="busy"
      />
      <p role="status">{{ preview.error || `待导入 ${preview.count} 条` }}</p>
      <el-button
        type="primary"
        :disabled="busy || !preview.count || Boolean(preview.error)"
        @click="
          mutate(
            (value) =>
              customPhrases.import(value, { revision: library.revision, text: importText }),
            '导入已完成，重复话术已跳过',
          )
        "
        >确认追加导入</el-button
      >
      <el-button :disabled="busy" @click="clearDrafts">取消导入</el-button>
    </div>
    <el-input
      v-model="query"
      aria-label="搜索自定义话术"
      placeholder="搜索标题、场景或正文"
      clearable
    />
    <p>当前 {{ rows.length }} / {{ library.rows.length }} 条（最多 500 条）</p>
    <div class="custom-list">
      <article v-for="row in rows" :key="row.id" class="custom-row">
        <strong>{{ row.title }}</strong> <span>{{ row.scene }}</span>
        <p class="custom-reply">{{ row.reply }}</p>
        <el-button :disabled="busy || !ready" @click="copy(row)">复制话术</el-button>
        <el-button :disabled="busy || !ready" @click="edit(row)">编辑</el-button>
        <el-button :disabled="busy || !ready" @click="deleteId = row.id">删除</el-button>
        <div v-if="deleteId === row.id" role="alert">
          确认删除“{{ row.title }}”？
          <el-button
            type="danger"
            :disabled="busy"
            @click="
              mutate(
                (value) => customPhrases.remove(value, { revision: library.revision, id: row.id }),
                '话术已删除',
              )
            "
            >确认删除</el-button
          >
          <el-button :disabled="busy" @click="deleteId = ''">取消删除</el-button>
        </div>
      </article>
      <p v-if="ready && !rows.length">
        {{
          library.rows.length
            ? '没有匹配的话术'
            : '当前店铺还没有自定义话术，点击新建或导入开始使用。'
        }}
      </p>
    </div>
  </section>
</template>

<style scoped>
.custom-library {
  color: #52637b;
  font-size: 13px;
}
.custom-toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin: 12px 0;
}
.custom-toolbar .el-select {
  width: 180px;
}
.custom-toolbar .el-button + .el-button {
  margin-left: 0;
}
.custom-editor,
.custom-row {
  padding: 14px;
  border: 1px solid #dce5f1;
  border-radius: 8px;
  margin-bottom: 12px;
}
.custom-editor {
  background: #f8fbff;
}
.custom-list {
  max-height: 40vh;
  overflow: auto;
}
.custom-reply {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  user-select: text;
  line-height: 1.6;
}
.custom-error {
  color: #b42318;
  white-space: pre-wrap;
}
</style>

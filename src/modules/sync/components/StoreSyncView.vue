<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRuntimeStore } from '@/shared/state/runtime'
import { getStoreSyncClient } from '../services/client'
import type { SyncBackup, SyncPreview, SyncResult, SyncSection } from '../contracts'

const runtime = useRuntimeStore()
const client = getStoreSyncClient()
const source = ref(''),
  targets = ref<string[]>([]),
  sections = ref<SyncSection[]>(['products'])
const productIds = ref(''),
  conflict = ref<'skip' | 'replace'>('skip'),
  confirmed = ref(false)
const preview = ref<SyncPreview>(),
  result = ref<SyncResult>(),
  backups = ref<SyncBackup[]>([])
const busy = ref(false),
  error = ref(''),
  rollbackId = ref('')
const stores = computed(() => runtime.snapshot.stores)
const labels: Record<SyncSection, string> = {
  products: '商品知识',
  welcome: '文字欢迎',
  vision: '图片识别开关',
  handoff: '本店转人工关键词',
}
const actionLabels = { add: '新增', replace: '覆盖', skip: '跳过冲突', unchanged: '无需修改' }
const statusLabels = {
  completed: '同步完成',
  failed: '同步未完成，请查看备份',
  'rolled-back': '已回滚',
  'rollback-blocked': '回滚被阻止，请核对后续修改',
}
watch(
  [source, targets, sections, productIds, conflict],
  () => {
    preview.value = undefined
    confirmed.value = false
    if (!runtime.snapshot.stores.some((s) => s.id === source.value)) source.value = ''
  },
  { deep: true },
)
watch(
  () => runtime.snapshot.workspaceId,
  () => {
    preview.value = undefined
    confirmed.value = false
    source.value = ''
    targets.value = []
    productIds.value = ''
    error.value = ''
    backups.value = []
    result.value = undefined
    rollbackId.value = ''
  },
)
async function run(work: (current: () => boolean) => Promise<void>) {
  if (busy.value) return
  busy.value = true
  error.value = ''
  const workspace = runtime.snapshot.workspaceId
  try {
    await work(() => workspace === runtime.snapshot.workspaceId)
  } catch (cause) {
    if (workspace === runtime.snapshot.workspaceId)
      error.value = cause instanceof Error ? cause.message : String(cause)
  } finally {
    busy.value = false
  }
}
async function refreshBackups() {
  const workspace = runtime.snapshot.workspaceId
  if (client) {
    const next = await client.backups()
    if (workspace === runtime.snapshot.workspaceId) backups.value = next
  }
}
function createPreview() {
  void run(async (current) => {
    if (!client) throw Error('跨店同步尚未接入当前运行环境')
    result.value = undefined
    preview.value = undefined
    confirmed.value = false
    const next = await client.preview({
      sourceStoreId: source.value,
      targetStoreIds: [...targets.value],
      sections: [...sections.value],
      productIds: productIds.value
        .split(/[\n,，]/)
        .map((s) => s.trim())
        .filter(Boolean),
      conflict: conflict.value,
    })
    if (current()) preview.value = next
  })
}
function apply() {
  const plan = preview.value
  if (!client || !plan || !confirmed.value) return
  void run(async (current) => {
    preview.value = undefined
    confirmed.value = false
    const next = await client.apply({ planId: plan.planId, confirmed: true })
    if (!current()) return
    result.value = next
    await refreshBackups()
    await runtime.refresh()
  })
}
function rollback() {
  const id = rollbackId.value
  if (!client || !id) return
  void run(async (current) => {
    rollbackId.value = ''
    preview.value = undefined
    const next = await client.rollback({ backupId: id, confirmed: true })
    if (!current()) return
    result.value = next
    await refreshBackups()
    await runtime.refresh()
  })
}
onMounted(() => {
  void run(refreshBackups)
})
</script>
<template>
  <section class="store-sync" aria-labelledby="sync-title">
    <h1 id="sync-title">跨店同步</h1>
    <p>
      将本机商品知识和选中的接待配置复制到目标店。请先核对商品编号对应关系；保存不会开启店铺 AI。
    </p>
    <p v-if="!client" role="status">当前环境尚未接入跨店同步，不能保存。浏览器仅供界面预览。</p>
    <p v-if="error" role="alert">{{ error }}</p>
    <p v-if="result" role="status">
      {{ statusLabels[result.status] }}：确认写入 {{ result.applied }} 项，已恢复
      {{ result.restored }} 项。备份 {{ result.backupId }}<br />{{ result.error }}
    </p>
    <fieldset :disabled="busy || !client">
      <legend>选择同步范围</legend>
      <label
        >源店铺<select v-model="source" aria-label="源店铺">
          <option value="">请选择</option>
          <option v-for="store in stores" :key="store.id" :value="store.id">
            {{ store.storeName }}
          </option>
        </select></label
      >
      <fieldset>
        <legend>目标店铺</legend>
        <label v-for="store in stores.filter((s) => s.id !== source)" :key="store.id"
          ><input v-model="targets" type="checkbox" :value="store.id" />{{ store.storeName }}</label
        >
      </fieldset>
      <fieldset>
        <legend>同步内容</legend>
        <label v-for="(label, key) in labels" :key="key"
          ><input v-model="sections" type="checkbox" :value="key" />{{ label }}</label
        >
      </fieldset>
      <label v-if="sections.includes('products')"
        >源店商品编号（每行一个，最多1000个）<textarea
          v-model="productIds"
          rows="4"
          aria-label="源店商品编号"
        />
      </label>
      <label
        >目标已有内容<select v-model="conflict" aria-label="冲突处理">
          <option value="skip">保留目标已有内容</option>
          <option value="replace">覆盖目标已有内容</option>
        </select></label
      >
      <button type="button" @click="createPreview">预览变更</button>
    </fieldset>
    <section v-if="preview" aria-label="同步预览">
      <h2>预览变更</h2>
      <p v-for="warning in preview.warnings" :key="warning">{{ warning }}</p>
      <div class="sync-table">
        <table>
          <thead>
            <tr>
              <th>目标店</th>
              <th>内容</th>
              <th>编号</th>
              <th>处理</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in preview.rows" :key="`${row.storeId}:${row.section}:${row.key}`">
              <td>{{ stores.find((s) => s.id === row.storeId)?.storeName || row.storeId }}</td>
              <td>{{ labels[row.section] }}</td>
              <td>{{ row.key }}</td>
              <td>{{ actionLabels[row.action] }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <label
        ><input
          v-model="confirmed"
          type="checkbox"
          :disabled="busy"
        />已核对源店、目标店及商品编号，确认以上变更</label
      >
      <button
        type="button"
        :disabled="
          busy ||
          !confirmed ||
          !preview.rows.some((r) => r.action === 'add' || r.action === 'replace')
        "
        @click="apply"
      >
        备份并执行同步
      </button>
    </section>
    <section aria-label="同步备份">
      <h2>备份与回滚</h2>
      <button type="button" :disabled="busy || !client" @click="run(refreshBackups)">
        刷新备份
      </button>
      <p v-if="!backups.length">暂无同步备份。</p>
      <ul>
        <li v-for="backup in backups" :key="backup.backupId">
          <span
            >{{ new Date(backup.createdAt).toLocaleString() }} · {{ statusLabels[backup.status] }} ·
            {{ backup.backupId }}</span
          ><button
            type="button"
            :disabled="busy || backup.status === 'rolled-back'"
            @click="rollbackId = backup.backupId"
          >
            选择回滚
          </button>
        </li>
      </ul>
      <div v-if="rollbackId" role="group" aria-label="确认回滚">
        <p>确认恢复备份 {{ rollbackId }} 的目标店配置？后续已修改的内容将阻止回滚。</p>
        <button type="button" :disabled="busy" @click="rollback">确认回滚</button
        ><button type="button" :disabled="busy" @click="rollbackId = ''">取消</button>
      </div>
    </section>
  </section>
</template>
<style scoped>
.store-sync {
  max-width: 1040px;
  margin: 24px auto;
  padding: 24px;
  color: #273346;
  background: white;
  border-radius: 12px;
}
fieldset {
  border: 1px solid #dbe2ec;
  border-radius: 8px;
  padding: 16px;
  margin: 12px 0;
}
label {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  margin: 8px 16px 8px 0;
}
textarea {
  min-width: 280px;
  max-width: 100%;
}
button,
select {
  padding: 8px 12px;
  margin: 4px;
}
button {
  cursor: pointer;
}
button:disabled {
  cursor: default;
  opacity: 0.55;
}
.sync-table {
  max-height: 360px;
  overflow: auto;
}
table {
  border-collapse: collapse;
  width: 100%;
}
th,
td {
  text-align: left;
  border-bottom: 1px solid #dbe2ec;
  padding: 10px;
}
[role='alert'] {
  color: #a52424;
}
[role='status'] {
  padding: 12px;
  background: #f1f5fa;
  overflow-wrap: anywhere;
}
li {
  margin: 12px 0;
  overflow-wrap: anywhere;
}
@media (max-width: 600px) {
  .store-sync {
    padding: 12px;
    margin: 0;
  }
  label {
    display: flex;
    flex-wrap: wrap;
  }
}
</style>

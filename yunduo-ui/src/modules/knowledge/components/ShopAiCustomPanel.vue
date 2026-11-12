<script setup lang="ts">
import { reactive, ref } from 'vue'
import { ElMessageBox } from 'element-plus'
import RuntimePanel from '@/shared/ui/RuntimePanel.vue'
import StoreSelect from '@/shared/ui/StoreSelect.vue'
import { useRuntimeStore } from '@/shared/state/runtime'
import { useTask } from '@/shared/ui/use-task'
import { profilesSchema, type ModelProfile } from '@/shared/contracts/backend'
const runtime = useRuntimeStore(),
  task = useTask()
const profiles = ref<ModelProfile[]>([]),
  revision = ref(0),
  bindings = ref<Record<string, string>>({}),
  globalPrompt = ref(''),
  expectedPrompt = ref('')
const draft = reactive<{
  id?: string
  version?: number
  name: string
  prompt: string
  maxReplyChars: number
}>({ name: '', prompt: '', maxReplyChars: 200 })
async function load() {
  const result = profilesSchema.parse((await runtime.run({ action: 'list-model-profiles' })).data)
  profiles.value = result.profiles
  revision.value = result.revision
  bindings.value = result.bindings
  globalPrompt.value = result.globalPrompt
  expectedPrompt.value = result.globalPrompt
}
function edit(profile?: ModelProfile) {
  delete draft.id
  delete draft.version
  Object.assign(
    draft,
    profile
      ? {
          id: profile.id,
          version: profile.version,
          name: profile.name,
          prompt: profile.prompt,
          maxReplyChars: profile.maxReplyChars,
        }
      : { name: '', prompt: '', maxReplyChars: 200 },
  )
}
async function save() {
  await task.run(async () => {
    const result = await runtime.run({ action: 'save-model-profile', values: { ...draft } })
    await load()
    edit()
    task.message.value = result.message
  })
}
async function bind(profileId: string) {
  await task.run(async () => {
    const result = await runtime.run({
      action: 'bind-model-profile',
      storeId: runtime.selectedStoreId,
      values: { profileId, revision: revision.value },
    })
    await load()
    task.message.value = result.message
  })
}
async function remove(profile: ModelProfile) {
  try {
    await ElMessageBox.confirm('删除方案后，绑定店铺恢复全局规则。', '删除方案')
  } catch {
    return
  }
  await task.run(async () => {
    await runtime.run({
      action: 'remove-model-profile',
      values: { id: profile.id, version: profile.version, confirmed: true },
    })
    await load()
  })
}
async function saveGlobal() {
  await task.run(async () => {
    const result = await runtime.run({
      action: 'save-config',
      screenId: 'UX17',
      values: { prompt: globalPrompt.value, expectedPrompt: expectedPrompt.value },
    })
    expectedPrompt.value = globalPrompt.value
    task.message.value = result.message
  })
}
if (runtime.available) void task.run(load)
</script>
<template>
  <RuntimePanel
    title="模型规则方案"
    description="方案配置本店提示规则和回复长度；实际模型与密钥在模型设置中统一配置。"
    :error="task.error.value"
    :message="task.message.value"
  >
    <template #actions
      ><el-button :disabled="task.pending.value" @click="task.run(load)">载入最新方案</el-button
      ><el-button @click="edit()">新建方案</el-button></template
    >
    <StoreSelect :disabled="task.pending.value" />
    <p>
      本店当前方案：{{
        profiles.find((row) => row.id === bindings[runtime.selectedStoreId])?.name || '继承全局规则'
      }}
    </p>
    <el-button :disabled="!runtime.selectedStoreId || task.pending.value" @click="bind('')"
      >本店恢复全局规则</el-button
    >
    <el-table :data="profiles" row-key="id" empty-text="暂无规则方案"
      ><el-table-column prop="name" label="方案" /><el-table-column
        prop="maxReplyChars"
        label="回复字数上限"
      /><el-table-column label="操作" width="260"
        ><template #default="{ row }"
          ><el-button link :disabled="task.pending.value" @click="edit(row)">编辑</el-button
          ><el-button
            link
            :disabled="!runtime.selectedStoreId || task.pending.value"
            @click="bind(row.id)"
            >绑定本店</el-button
          ><el-button link type="danger" :disabled="task.pending.value" @click="remove(row)"
            >删除</el-button
          ></template
        ></el-table-column
      ></el-table
    >
    <form class="runtime-form" @submit.prevent="save">
      <h2>{{ draft.id ? '编辑方案' : '新建方案' }}</h2>
      <label>方案名称<el-input v-model="draft.name" maxlength="100" /></label
      ><label
        >提示规则<el-input
          v-model="draft.prompt"
          type="textarea"
          :rows="6"
          maxlength="8000" /></label
      ><label
        >回复字数上限<el-input-number
          v-model="draft.maxReplyChars"
          :min="1"
          :max="2000"
          :precision="0" /></label
      ><el-button
        type="primary"
        native-type="submit"
        :disabled="!runtime.available || !draft.name.trim() || !draft.prompt.trim()"
        :loading="task.pending.value"
        >保存方案</el-button
      >
    </form>
    <form class="runtime-form" @submit.prevent="saveGlobal">
      <h2>全局提示规则</h2>
      <el-input
        v-model="globalPrompt"
        type="textarea"
        :rows="6"
        maxlength="8000"
        aria-label="全局提示规则"
      /><el-button native-type="submit" :disabled="!runtime.available || task.pending.value"
        >保存全局规则</el-button
      >
    </form>
  </RuntimePanel>
</template>

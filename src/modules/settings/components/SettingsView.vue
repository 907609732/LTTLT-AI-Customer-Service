<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'
import RuntimePanel from '@/shared/ui/RuntimePanel.vue'
import { useRuntimeStore } from '@/shared/state/runtime'
import { useTask } from '@/shared/ui/use-task'
import ModelSourceSettings from './ModelSourceSettings.vue'
import { modelPresets } from '../model-presets'

const runtime = useRuntimeStore(),
  task = useTask()
const baseUrl = ref(''),
  model = ref(''),
  apiKey = ref(''),
  dirty = ref(false)
const provider = ref('custom')
const pacingTask = useTask(),
  pacingSeconds = ref(60),
  pacingDirty = ref(false),
  pacingLoadedMs = ref(60000)
function reloadPacing() {
  pacingLoadedMs.value = runtime.snapshot.config.reply.perUidMinIntervalMs
  pacingSeconds.value = pacingLoadedMs.value / 1000
  pacingDirty.value = false
}
watch(
  () => runtime.snapshot.config.reply.perUidMinIntervalMs,
  () => {
    if (!pacingDirty.value && !pacingTask.pending.value) reloadPacing()
  },
  { immediate: true },
)
async function savePacing() {
  task.message.value = ''
  task.error.value = ''
  await pacingTask.run(async () => {
    const result = await runtime.run({
      action: 'save-config',
      screenId: 'REPLY_PACING',
      values: { seconds: pacingSeconds.value, expectedMs: pacingLoadedMs.value },
    })
    reloadPacing()
    pacingTask.message.value = result.message
  })
}
function chooseProvider(value: string) {
  if (Object.hasOwn(modelPresets, value)) {
    const preset = modelPresets[value as keyof typeof modelPresets]
    baseUrl.value = preset.baseUrl
    model.value = preset.model
  }
  apiKey.value = ''
  dirty.value = true
}
function reload() {
  baseUrl.value = runtime.snapshot.config.ai.baseUrl
  model.value = runtime.snapshot.config.ai.model
  apiKey.value = ''
  dirty.value = false
  provider.value =
    Object.entries(modelPresets).find(
      ([, preset]) =>
        preset.baseUrl.replace(/\/+$/, '') === baseUrl.value.replace(/\/+$/, '') &&
        preset.model === model.value,
    )?.[0] || 'custom'
}
watch(
  () => runtime.snapshot.config.ai,
  () => {
    if (!dirty.value && !task.pending.value) reload()
  },
  { immediate: true },
)
watch(
  () => runtime.snapshot.workspaceId,
  () => {
    // 来源/身份切换后旧表单不属于新工作区，即使尚有编辑也必须丢弃。
    reload()
    reloadPacing()
    task.error.value = ''
    task.message.value = ''
    pacingTask.error.value = ''
    pacingTask.message.value = ''
  },
)
async function save(testConnection: boolean) {
  pacingTask.error.value = ''
  pacingTask.message.value = ''
  await task.run(async () => {
    const result = await runtime.run({
      action: 'save-model-settings',
      values: {
        baseUrl: baseUrl.value.trim(),
        model: model.value.trim(),
        apiKey: apiKey.value.trim(),
        testConnection,
      },
    })
    apiKey.value = ''
    dirty.value = false
    task.message.value = result.message
  })
}
onBeforeUnmount(() => {
  apiKey.value = ''
})
</script>
<template>
  <RuntimePanel
    title="设置"
    :error="task.error.value || pacingTask.error.value"
    :message="task.message.value || pacingTask.message.value"
  >
    <h2>AI 回复间隔</h2>
    <form class="runtime-form reply-pacing" @submit.prevent="savePacing">
      <label
        >同一买家两次回复至少间隔（秒）<el-input-number
          v-model="pacingSeconds"
          aria-label="同一买家回复间隔（秒）"
          :min="0"
          :max="3600"
          :step="1"
          :disabled="pacingTask.pending.value"
          @change="pacingDirty = true"
      /></label>
      <p>当前：{{ runtime.snapshot.config.reply.perUidMinIntervalMs / 1000 }} 秒；0 表示不限制。</p>
      <div class="runtime-actions">
        <el-button
          type="primary"
          native-type="submit"
          :loading="pacingTask.pending.value"
          :disabled="!runtime.available || pacingSeconds === null"
          >保存回复间隔</el-button
        ><el-button :disabled="pacingTask.pending.value" @click="reloadPacing"
          >载入已保存间隔</el-button
        >
      </div>
    </form>
    <details class="advanced-model">
      <summary>高级模型配置</summary>
      <el-tag
        v-if="runtime.snapshot.capabilities.modelMode === 'local'"
        :type="runtime.snapshot.capabilities.apiKeyConfigured ? 'success' : 'info'"
        >{{
          runtime.snapshot.capabilities.apiKeyConfigured ? '本机已加密保存密钥' : '尚未保存密钥'
        }}</el-tag
      >
      <form
        v-if="runtime.snapshot.capabilities.modelMode === 'local'"
        class="runtime-form"
        @submit.prevent="save(false)"
      >
        <label
          >模型服务商<el-select
            v-model="provider"
            aria-label="模型服务商"
            :disabled="task.pending.value"
            @change="chooseProvider(String($event))"
            ><el-option
              v-for="(preset, key) in modelPresets"
              :key="key"
              :value="key"
              :label="preset.label" /><el-option
              value="custom"
              label="自定义兼容接口 / 本机模型" /></el-select
        ></label>
        <label
          >模型接口地址<el-input
            v-model="baseUrl"
            aria-label="模型接口地址"
            placeholder="填写服务商的 OpenAI 兼容接口地址，例如以 /v1 结尾"
            :disabled="task.pending.value"
            @input="dirty = true"
        /></label>
        <label
          >模型名称<el-input
            v-model="model"
            aria-label="模型名称"
            placeholder="填写服务商提供的模型标识"
            :disabled="task.pending.value"
            @input="dirty = true"
        /></label>
        <label
          >API Key<el-input
            v-model="apiKey"
            aria-label="模型 API Key"
            type="password"
            show-password
            autocomplete="off"
            placeholder="留空保留已保存的密钥；更换接口时需重新填写"
            :disabled="task.pending.value"
            @input="dirty = true"
        /></label>
        <div class="runtime-actions">
          <el-button
            type="primary"
            native-type="submit"
            :loading="task.pending.value"
            :disabled="!runtime.available || !baseUrl.trim() || !model.trim()"
            >保存模型设置</el-button
          ><el-button
            :disabled="!runtime.available || task.pending.value || !baseUrl.trim() || !model.trim()"
            @click="save(true)"
            >测试连接并保存</el-button
          ><el-button :disabled="task.pending.value" @click="reload">载入已保存配置</el-button>
        </div>
      </form>
    </details>
    <ModelSourceSettings />
  </RuntimePanel>
</template>

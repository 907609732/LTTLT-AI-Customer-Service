<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import {
  defaultVisionModelSnapshot,
  toVisionExpected,
  type VisionModelService,
  type VisionModelSettingsView,
  type VisionModelSnapshot,
  type VisionMode,
} from '../../../shared/contracts/vision'
import {
  draftFromSnapshot,
  validateVisionModelDraft,
  visionModelPresets,
} from '../vision-model-service'

const props = defineProps<{ service?: VisionModelService }>()
const mode = ref<VisionMode>('inherit')
const baseUrl = ref('')
const model = ref('')
const apiKey = ref('')
const loaded = ref<VisionModelSnapshot>(defaultVisionModelSnapshot())
const loadedRevision = ref(0)
const dirty = ref(false)
const pendingAction = ref<'load' | 'save' | 'probe' | 'verify' | 'clear' | null>(null)
const error = ref('')
const message = ref('')
const connection = ref('')
const showClearConfirm = ref(false)
let actionId = 0
let controller: AbortController | undefined
let disposed = false

const isPending = computed(() => pendingAction.value !== null)
const canUse = computed(() => Boolean(props.service))
const statusText = computed(() => {
  switch (loaded.value.status) {
    case 'inherit':
      return '沿用文字模型 · 未独立验证'
    case 'unverified':
      return '未验证'
    case 'verified':
      return '已验证'
    case 'failed':
      return '验证失败'
    case 'stale':
      return '配置已变更，需重新验证'
    default:
      return '状态未知'
  }
})
const apiKeyText = computed(() => (loaded.value.apiKeyConfigured ? '已配置（不会回显）' : '未配置'))

function resetDraft(snapshot: VisionModelSnapshot): void {
  const draft = draftFromSnapshot(snapshot)
  mode.value = draft.mode
  baseUrl.value = draft.baseUrl
  model.value = draft.model
  apiKey.value = ''
  dirty.value = false
}

function applyView(view: VisionModelSettingsView): void {
  loaded.value = { ...view.snapshot }
  loadedRevision.value = view.revision
  resetDraft(view.snapshot)
}

function expectedState() {
  return toVisionExpected({ snapshot: loaded.value, revision: loadedRevision.value })
}

function safeError(value: unknown): string {
  return value instanceof Error && value.message ? value.message : '图片模型操作失败，请重试'
}

function markDirty(): void {
  dirty.value = true
}

function selectMode(value: string | number | boolean | undefined): void {
  if (value !== 'inherit' && value !== 'custom') return
  if (mode.value === value) return
  mode.value = value
  dirty.value = true
  showClearConfirm.value = false
}

function fillPreset(): void {
  const preset = visionModelPresets[0]
  mode.value = 'custom'
  baseUrl.value = preset.baseUrl
  model.value = preset.model
  dirty.value = true
  showClearConfirm.value = false
}

function beginAction(kind: NonNullable<typeof pendingAction.value>) {
  controller?.abort()
  controller = new AbortController()
  const id = ++actionId
  pendingAction.value = kind
  error.value = ''
  message.value = ''
  return {
    signal: controller.signal,
    isCurrent: () => !disposed && id === actionId,
  }
}

function finishAction(isCurrent: () => boolean): void {
  if (isCurrent()) pendingAction.value = null
}

async function load(service: VisionModelService): Promise<void> {
  const action = beginAction('load')
  try {
    const view = await service.load({ signal: action.signal })
    if (!action.isCurrent()) return
    applyView(view)
    connection.value = ''
  } catch (reason) {
    if (!action.isCurrent() || action.signal.aborted) return
    error.value = safeError(reason)
  } finally {
    finishAction(action.isCurrent)
  }
}

watch(
  () => props.service,
  (service) => {
    controller?.abort()
    controller = undefined
    actionId++
    pendingAction.value = null
    error.value = ''
    message.value = ''
    connection.value = ''
    showClearConfirm.value = false
    const initial = defaultVisionModelSnapshot()
    loaded.value = initial
    loadedRevision.value = 0
    resetDraft(initial)
    if (service) void load(service)
  },
  { immediate: true },
)

async function save(): Promise<void> {
  const service = props.service
  if (!service || isPending.value) return
  const validation = validateVisionModelDraft(
    { mode: mode.value, baseUrl: baseUrl.value, model: model.value, apiKey: apiKey.value },
    loaded.value.apiKeyConfigured,
    loaded.value.baseUrl,
  )
  if (validation) {
    error.value = validation
    return
  }
  const action = beginAction('save')
  try {
    const key = apiKey.value.trim()
    const view = await service.save({
      mode: mode.value,
      baseUrl: baseUrl.value.trim(),
      model: model.value.trim(),
      ...(key ? { apiKey: key } : {}),
      expected: expectedState(),
    })
    if (!action.isCurrent()) return
    applyView(view)
    connection.value = ''
    message.value = '图片模型配置已保存；未自动测试连接或图片验证。'
  } catch (reason) {
    if (!action.isCurrent()) return
    error.value = safeError(reason)
  } finally {
    finishAction(action.isCurrent)
  }
}

async function probe(): Promise<void> {
  const service = props.service
  if (!service || isPending.value || dirty.value) return
  const action = beginAction('probe')
  try {
    const result = await service.probe({ signal: action.signal })
    if (!action.isCurrent()) return
    connection.value = result.ok ? '连接成功' : '连接失败'
    if (result.ok) message.value = result.message
    else error.value = result.message
  } catch (reason) {
    if (!action.isCurrent() || action.signal.aborted) return
    connection.value = '连接失败'
    error.value = safeError(reason)
  } finally {
    finishAction(action.isCurrent)
  }
}

async function verify(): Promise<void> {
  const service = props.service
  if (!service || isPending.value || dirty.value) return
  const action = beginAction('verify')
  try {
    const result = await service.verify({ signal: action.signal })
    if (!action.isCurrent()) return
    loaded.value = { ...loaded.value, status: result.status, reason: result.message }
    loadedRevision.value = result.revision
    if (result.ok) message.value = result.message
    else error.value = result.message
  } catch (reason) {
    if (!action.isCurrent() || action.signal.aborted) return
    error.value = safeError(reason)
  } finally {
    finishAction(action.isCurrent)
  }
}

function requestClearKey(): void {
  if (!props.service || isPending.value) return
  showClearConfirm.value = true
  error.value = ''
  message.value = ''
}

async function clearKey(): Promise<void> {
  const service = props.service
  if (!service || isPending.value) return
  const action = beginAction('clear')
  showClearConfirm.value = false
  try {
    const view = await service.clearKey(expectedState(), {
      signal: action.signal,
    })
    if (!action.isCurrent()) return
    applyView(view)
    message.value = '已清除已保存的图片模型 Key；图片学习保持关闭。'
  } catch (reason) {
    if (!action.isCurrent()) return
    error.value = safeError(reason)
  } finally {
    finishAction(action.isCurrent)
  }
}

onBeforeUnmount(() => {
  disposed = true
  actionId++
  controller?.abort()
  controller = undefined
})
</script>

<template>
  <section class="vision-model-settings" aria-label="图片识别模型">
    <header class="vision-head">
      <div>
        <h3>图片识别模型</h3>
        <p>
          图片知识学习可单独使用视觉模型；文字训练、接待回复和摘要继续使用原文字模型。托管模式始终使用托管路由。
        </p>
      </div>
    </header>

    <p v-if="!service" class="vision-error" role="alert">
      未提供图片模型配置服务，本机独立图片模型设置不可用。
    </p>

    <el-radio-group
      :model-value="mode"
      aria-label="图片识别模型模式"
      :disabled="!canUse || isPending"
      @update:model-value="selectMode"
    >
      <el-radio-button value="inherit">沿用文字模型</el-radio-button>
      <el-radio-button value="custom">独立配置</el-radio-button>
    </el-radio-group>

    <p class="vision-status" data-vision-status>
      验证状态：<strong>{{ statusText }}</strong>
    </p>
    <p class="vision-reason">{{ loaded.reason }}</p>
    <p v-if="mode === 'inherit'" class="vision-hint">
      旧用户缺少独立视觉文件时保持原图片能力，不强制重新验证；该兼容路径不会被标记为“已验证”。
    </p>

    <div v-else class="vision-fields">
      <div class="vision-preset">
        <el-button
          size="small"
          :disabled="!canUse || isPending"
          aria-label="填入 DeepSeek 视觉预设"
          @click="fillPreset"
          >填入 DeepSeek 视觉预设</el-button
        >
        <span>{{ visionModelPresets[0].label }} · {{ visionModelPresets[0].model }}</span>
      </div>
      <label for="vision-base-url">API 地址</label>
      <el-input
        id="vision-base-url"
        v-model="baseUrl"
        aria-label="图片模型 API 地址"
        placeholder="https://api.deepseek.com"
        autocomplete="off"
        :disabled="!canUse || isPending"
        @input="markDirty"
      />
      <label for="vision-model-name">模型名称</label>
      <el-input
        id="vision-model-name"
        v-model="model"
        aria-label="图片模型名称"
        placeholder="deepseek-flash"
        autocomplete="off"
        :disabled="!canUse || isPending"
        @input="markDirty"
      />
      <label for="vision-api-key">API Key</label>
      <el-input
        id="vision-api-key"
        v-model="apiKey"
        type="password"
        show-password
        aria-label="图片模型 API Key"
        :placeholder="loaded.apiKeyConfigured ? '已配置，留空保持不变' : '输入图片模型 API Key'"
        autocomplete="new-password"
        :disabled="!canUse || isPending"
        @input="markDirty"
      />
      <p class="vision-key-state">
        Key 状态：{{ apiKeyText }}。Key 只在主进程系统加密保存，不会回传或显示原文。
      </p>
      <div class="vision-key-actions">
        <el-button
          size="small"
          :disabled="!canUse || isPending || !loaded.apiKeyConfigured"
          aria-label="清除图片模型 Key"
          @click="requestClearKey"
          >清除 Key</el-button
        >
        <span class="vision-dirty" v-if="dirty">未保存</span>
      </div>
      <div v-if="showClearConfirm" class="vision-clear-confirm" role="alert">
        <span>确认清除已保存的图片模型 Key？清除后图片学习需重新配置并验证。</span>
        <el-button size="small" aria-label="取消清除图片模型 Key" @click="showClearConfirm = false"
          >取消</el-button
        >
        <el-button size="small" type="danger" aria-label="确认清除图片模型 Key" @click="clearKey"
          >确认清除</el-button
        >
      </div>
    </div>

    <div class="vision-actions">
      <el-button
        type="primary"
        size="small"
        :disabled="!canUse || isPending"
        :loading="pendingAction === 'save'"
        aria-label="保存图片模型设置"
        @click="save"
        >保存配置</el-button
      >
      <el-button
        size="small"
        :disabled="!canUse || isPending || dirty"
        :loading="pendingAction === 'probe'"
        aria-label="测试图片模型连接"
        @click="probe"
        >测试连接</el-button
      >
      <el-button
        size="small"
        :disabled="!canUse || isPending || dirty"
        :loading="pendingAction === 'verify'"
        aria-label="验证图片识别能力"
        @click="verify"
        >验证图片识别</el-button
      >
    </div>
    <p v-if="connection" class="vision-connection" role="status">
      {{ connection }}；图片验证状态：{{ statusText }}
    </p>
    <p class="vision-hint">
      保存、连接测试和图片验证都需要手动点击。保存不会自动连接，普通连接成功也不代表图片能力验证通过。
    </p>
    <p v-if="dirty" class="vision-hint">有未保存修改；请先保存再测试连接或验证图片。</p>
    <p v-if="error" class="vision-error" role="alert">{{ error }}</p>
    <p v-if="message" class="vision-message" role="status">{{ message }}</p>
  </section>
</template>

<style scoped>
.vision-model-settings {
  border: 1px solid var(--el-border-color-light);
  border-radius: 8px;
  padding: 14px 16px;
  margin: 12px 0;
  background: var(--el-bg-color);
}
.vision-head h3 {
  margin: 0 0 4px;
  font-size: 15px;
}
.vision-head p,
.vision-hint,
.vision-reason {
  margin: 4px 0;
  color: var(--el-text-color-secondary);
  font-size: 12px;
  line-height: 1.55;
}
.vision-status {
  margin: 10px 0 2px;
  font-size: 13px;
}
.vision-fields {
  display: grid;
  grid-template-columns: 88px minmax(0, 1fr);
  gap: 8px 10px;
  align-items: center;
  margin-top: 12px;
}
.vision-fields label {
  font-size: 13px;
}
.vision-preset,
.vision-key-state,
.vision-key-actions,
.vision-clear-confirm,
.vision-actions {
  grid-column: 1 / -1;
}
.vision-preset {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
.vision-key-state {
  margin: 0;
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
.vision-key-actions,
.vision-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.vision-actions {
  margin-top: 12px;
}
.vision-clear-confirm {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  padding: 8px 10px;
  border: 1px solid var(--el-color-warning-light-5);
  background: var(--el-color-warning-light-9);
  border-radius: 6px;
  font-size: 12px;
}
.vision-dirty {
  color: var(--el-color-warning);
  font-size: 12px;
}
.vision-connection {
  margin: 8px 0 0;
  color: var(--el-color-success);
  font-size: 12px;
}
.vision-error {
  color: var(--el-color-danger);
  font-size: 12px;
  margin: 8px 0 0;
}
.vision-message {
  color: var(--el-color-success);
  font-size: 12px;
  margin: 8px 0 0;
}
</style>

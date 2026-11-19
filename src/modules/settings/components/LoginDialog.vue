<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useRuntimeStore } from '@/shared/state/runtime'
import { permanentAccountExpiry } from '@/shared/contracts/managed'
import { useTask } from '@/shared/ui/use-task'
import { modelPresets } from '../model-presets'
import { Refresh } from '@element-plus/icons-vue'
import ModelSourceSettings from './ModelSourceSettings.vue'
import VisionModelSettings from './VisionModelSettings.vue'
import { createVisionModelService } from '../services/vision-model-client'
const visible = defineModel<boolean>({ default: false })
const runtime = useRuntimeStore(),
  task = useTask(),
  router = useRouter()
const provider = ref<keyof typeof modelPresets | 'custom'>('deepseek'),
  apiKey = ref(''),
  customBaseUrl = ref(''),
  customModel = ref(''),
  availableModels = ref<string[]>([]),
  loadingModels = ref(false)
const awaitingLogin = ref(false),
  activating = ref(false)
const managed = computed(() => runtime.snapshot.managed)
const session = computed(() => managed.value.session)
const visionService = runtime.available
  ? createVisionModelService((command) => runtime.run(command))
  : undefined
const visionMountKey = computed(
  () =>
    `${runtime.snapshot.workspaceId}:${managed.value.active.mode}:${managed.value.active.apiOrigin}`,
)
const quotaExpiry = computed(() => {
  const expires = session.value.account?.trial.expiresAt
  if (expires === permanentAccountExpiry) return '含永久额度'
  return expires ? new Date(expires * 1000).toLocaleString('zh-CN') : '未提供'
})
watch(provider, () => {
  apiKey.value = ''
  customModel.value = ''
  availableModels.value = []
})
watch(visible, (open) => {
  if (!open) apiKey.value = ''
})
onBeforeUnmount(() => {
  apiKey.value = ''
})
async function activate(mode: 'local' | 'managed') {
  await runtime.run({ action: 'activate-model-source', values: { mode } })
  if (managed.value.restartRequired || managed.value.active.mode !== mode)
    throw new Error('工作区切换未完成，请重试')
}
async function saveKey() {
  const key = apiKey.value.trim(),
    preset = provider.value === 'custom' ? null : modelPresets[provider.value],
    baseUrl = (preset?.baseUrl ?? customBaseUrl.value).trim().replace(/\/+$/, ''),
    model = (preset?.model ?? customModel.value).trim(),
    originalMode = managed.value.active.mode
  await task.run(async () => {
    if (!key) throw new Error('请填写 API Key')
    if (!baseUrl) throw new Error('请填写 API 地址')
    if (!model) throw new Error('请填写模型名称')
    let endpoint: URL
    try {
      endpoint = new URL(baseUrl)
    } catch {
      throw new Error('API 地址格式无效，请填写完整的 http(s) 地址')
    }
    if (endpoint.protocol !== 'https:' && endpoint.protocol !== 'http:')
      throw new Error('API 地址必须使用 http 或 https')
    if (managed.value.active.mode !== 'local' || managed.value.restartRequired)
      await activate('local')
    try {
      await runtime.run({
        action: 'save-model-settings',
        values: { baseUrl, model, apiKey: key, testConnection: true },
      })
    } catch (validationError) {
      // 验证失败不能把原服务端账号留在本机工作区；恢复也失败时保留两项事实。
      if (originalMode === 'managed') {
        try {
          await activate(originalMode)
        } catch (restoreError) {
          const detail = (error: unknown) =>
            error instanceof Error ? error.message : String(error)
          throw new Error(
            `${detail(validationError)}；原账号工作区恢复失败：${detail(restoreError)}`,
          )
        }
      }
      throw validationError
    }
    apiKey.value = ''
    visible.value = false
  })
}
async function fetchModels() {
  const baseUrl = customBaseUrl.value.trim().replace(/\/+$/, '')
  const key = apiKey.value.trim()
  await task.run(async () => {
    if (!baseUrl) throw new Error('请填写 API 地址')
    if (!key) throw new Error('请先填写 API Key')
    let endpoint: URL
    try {
      endpoint = new URL(baseUrl)
    } catch {
      throw new Error('API 地址格式无效，请填写完整的 http(s) 地址')
    }
    if (endpoint.protocol !== 'http:' && endpoint.protocol !== 'https:')
      throw new Error('API 地址必须使用 http 或 https')
    loadingModels.value = true
    try {
      const result = await runtime.run({
        action: 'list-custom-models',
        values: { baseUrl, apiKey: key },
      })
      const models = result.data.models
      if (!Array.isArray(models) || !models.every((model) => typeof model === 'string'))
        throw new Error('服务返回的模型列表格式无效')
      availableModels.value = models
      if (!models.includes(customModel.value)) customModel.value = ''
      if (!models.length) throw new Error('该 API 未返回可用模型')
    } finally {
      loadingModels.value = false
    }
  })
}
async function finishLogin() {
  if (
    task.pending.value ||
    !awaitingLogin.value ||
    activating.value ||
    session.value.status !== 'signed_in'
  )
    return
  activating.value = true
  const success = await task.run(async () => {
    await activate('managed')
    if (session.value.status !== 'signed_in') throw new Error('登录状态尚未就绪，请重试')
    awaitingLogin.value = false
    visible.value = false
  })
  activating.value = false
  if (!success) awaitingLogin.value = false
}
watch(
  () => session.value.status,
  () => {
    void finishLogin()
  },
)
async function enterAccount() {
  awaitingLogin.value = true
  await finishLogin()
}
async function login() {
  const success = await task.run(async () => {
    if (managed.value.restartRequired) await activate(managed.value.configured.mode)
    awaitingLogin.value = true
    await runtime.run({ action: 'managed-login' })
  })
  if (!success) awaitingLogin.value = false
  else await finishLogin()
}
async function accountAction(action: 'managed-cancel-login' | 'managed-logout') {
  awaitingLogin.value = false
  await task.run(async () => {
    await runtime.run({ action })
  })
}
async function recharge() {
  await task.run(async () => {
    await router.push('/shop/recharge')
    visible.value = false
  })
}
</script>
<template>
  <el-dialog
    v-model="visible"
    title="登录"
    width="760px"
    class="simple-login-dialog"
    :close-on-click-modal="false"
  >
    <el-alert v-if="task.error.value" :title="task.error.value" type="error" :closable="false" />
    <ModelSourceSettings />
    <div class="login-options">
      <section class="login-option key-option">
        <h2>使用自己的 Key</h2>
        <form @submit.prevent="saveKey">
          <label
            >厂商<el-select v-model="provider" aria-label="登录模型" :disabled="task.pending.value">
              <el-option value="deepseek" label="DeepSeek" /><el-option
                value="qwen"
                label="千问"
              /><el-option value="qwenVision" label="千问识图" /><el-option
                value="custom"
                label="自定义 API"
              /> </el-select
          ></label>
          <template v-if="provider === 'custom'">
            <label
              >API 地址<el-input
                v-model="customBaseUrl"
                aria-label="自定义 API 地址"
                placeholder="https://api.example.com/v1"
                autocomplete="url"
                :disabled="task.pending.value"
            /></label>
            <label>模型名称</label>
            <div class="model-picker">
              <el-select
                v-model="customModel"
                aria-label="自定义模型名称"
                filterable
                allow-create
                default-first-option
                placeholder="获取列表后选择，也可手动输入"
                :disabled="task.pending.value"
              >
                <el-option
                  v-for="model in availableModels"
                  :key="model"
                  :value="model"
                  :label="model"
                />
              </el-select>
              <el-button
                aria-label="获取模型列表"
                title="获取可用模型"
                :loading="loadingModels"
                :disabled="task.pending.value || !customBaseUrl.trim() || !apiKey.trim()"
                @click="fetchModels"
              >
                <el-icon><Refresh /></el-icon>
              </el-button>
            </div>
          </template>
          <label
            >API Key<el-input
              v-model="apiKey"
              aria-label="登录 API Key"
              type="password"
              show-password
              autocomplete="off"
              :disabled="task.pending.value"
          /></label>
          <el-button
            native-type="submit"
            :loading="task.pending.value"
            :disabled="
              !runtime.available ||
              !apiKey.trim() ||
              (provider === 'custom' && (!customBaseUrl.trim() || !customModel.trim())) ||
              session.status === 'authorizing'
            "
            >保存并使用</el-button
          >
        </form>
      </section>
      <section class="login-option service-option">
        <div class="service-heading">
          <h2>服务端登录 <span class="recommended">推荐</span></h2>
          <el-button
            type="primary"
            data-account-recharge
            :disabled="task.pending.value || session.status === 'authorizing'"
            @click="recharge"
            >充值</el-button
          >
        </div>
        <template v-if="session.status === 'authorizing'">
          <p>请在浏览器中完成登录和授权</p>
          <p v-if="session.login">
            确认码 <strong>{{ session.login.userCode }}</strong>
          </p>
          <el-button :disabled="task.pending.value" @click="accountAction('managed-cancel-login')"
            >取消授权</el-button
          >
        </template>
        <template v-else-if="session.status === 'signed_in' && session.account">
          <p>{{ session.account.displayName }}</p>
          <dl class="account-quota" aria-label="服务端账号额度">
            <dt>总额度</dt>
            <dd>{{ session.account.trial.limit }} 次</dd>
            <dt>剩余额度</dt>
            <dd>{{ session.account.trial.remaining }} 次</dd>
            <dt>到期时间</dt>
            <dd>{{ quotaExpiry }}</dd>
          </dl>
          <div class="account-actions">
            <el-button
              v-if="managed.active.mode !== 'managed' || managed.restartRequired"
              type="primary"
              :disabled="task.pending.value"
              @click="enterAccount"
              >进入账号</el-button
            >
            <el-button :disabled="task.pending.value" @click="accountAction('managed-logout')"
              >退出登录</el-button
            >
          </div>
        </template>
        <template v-else>
          <p>使用账号登录，直接开始使用</p>
          <el-alert
            v-if="session.message"
            :title="session.message"
            type="warning"
            :closable="false"
          />
          <el-button
            type="primary"
            :loading="task.pending.value"
            :disabled="!runtime.available"
            aria-label="浏览器登录"
            @click="login"
            >{{
              ['offline', 'expired', 'disabled'].includes(session.status) ? '重新登录' : '登录'
            }}</el-button
          >
        </template>
      </section>
    </div>
    <VisionModelSettings
      v-if="visible && managed.active.mode === 'local'"
      :key="visionMountKey"
      :service="visionService"
    />
  </el-dialog>
</template>
<style scoped>
:global(.simple-login-dialog) {
  max-width: calc(100vw - 32px);
}
.login-options {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 20px;
  color: #25334d;
}
.login-option {
  padding: 24px;
  border: 1px solid #e5e7ef;
  border-radius: 12px;
  min-width: 0;
}
.login-option h2 {
  font-size: 18px;
  margin: 0 0 24px;
}
.login-option form,
.login-option label {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.login-option form {
  gap: 20px;
}
.model-picker {
  display: flex;
  gap: 8px;
}
.model-picker :deep(.el-select) {
  flex: 1;
}
.service-option {
  background: #f3f1ff;
  border-color: #e8e4ff;
}
.service-heading {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  margin-bottom: 24px;
}
.service-heading h2 {
  margin: 0;
}
.recommended {
  color: #5b68ed;
  font-size: 12px;
}
.account-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.account-quota {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 10px 16px;
  margin: 20px 0;
  font-size: 13px;
}
.account-quota dt {
  color: #66718a;
}
.account-quota dd {
  margin: 0;
  text-align: right;
  overflow-wrap: anywhere;
}
.account-actions .el-button {
  margin-left: 0;
}
.login-option :deep(.el-button--primary) {
  --el-button-bg-color: #5b68ed;
  --el-button-border-color: #5b68ed;
}
@media (max-width: 640px) {
  .login-options {
    grid-template-columns: 1fr;
  }
  .service-option {
    grid-row: 1;
  }
}
</style>

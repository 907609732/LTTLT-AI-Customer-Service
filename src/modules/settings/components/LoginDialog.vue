<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useRuntimeStore } from '@/shared/state/runtime'
import { useTask } from '@/shared/ui/use-task'
import { modelPresets } from '../model-presets'
const visible = defineModel<boolean>({ default: false })
const runtime = useRuntimeStore(),
  task = useTask()
const provider = ref<keyof typeof modelPresets>('deepseek'),
  apiKey = ref('')
const awaitingLogin = ref(false),
  activating = ref(false)
const managed = computed(() => runtime.snapshot.managed)
const session = computed(() => managed.value.session)
watch(provider, () => {
  apiKey.value = ''
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
    preset = modelPresets[provider.value],
    originalMode = managed.value.active.mode
  await task.run(async () => {
    if (!key) throw new Error('请填写 API Key')
    if (managed.value.active.mode !== 'local' || managed.value.restartRequired)
      await activate('local')
    try {
      await runtime.run({
        action: 'save-model-settings',
        values: { baseUrl: preset.baseUrl, model: preset.model, apiKey: key, testConnection: true },
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
async function accountAction(
  action: 'managed-cancel-login' | 'managed-logout' | 'managed-refresh',
) {
  awaitingLogin.value = false
  await task.run(async () => {
    await runtime.run({ action })
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
    <div class="login-options">
      <section class="login-option key-option">
        <h2>使用自己的 Key</h2>
        <form @submit.prevent="saveKey">
          <label
            >厂商<el-select v-model="provider" aria-label="登录模型" :disabled="task.pending.value">
              <el-option value="deepseek" label="DeepSeek" /><el-option
                value="qwen"
                label="千问"
              /><el-option value="qwenVision" label="千问识图" /> </el-select
          ></label>
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
            :disabled="!runtime.available || !apiKey.trim() || session.status === 'authorizing'"
            >保存并使用</el-button
          >
        </form>
      </section>
      <section class="login-option service-option">
        <h2>服务端登录 <span class="recommended">推荐</span></h2>
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
          <p>剩余 {{ session.account.trial.remaining }} 次</p>
          <div class="account-actions">
            <el-button
              v-if="managed.active.mode !== 'managed' || managed.restartRequired"
              type="primary"
              :disabled="task.pending.value"
              @click="enterAccount"
              >进入账号</el-button
            >
            <el-button :disabled="task.pending.value" @click="login">切换账号</el-button
            ><el-button :disabled="task.pending.value" @click="accountAction('managed-logout')"
              >退出登录</el-button
            ><el-button
              link
              :disabled="task.pending.value"
              @click="accountAction('managed-refresh')"
              >刷新次数</el-button
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
.service-option {
  background: #f3f1ff;
  border-color: #e8e4ff;
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

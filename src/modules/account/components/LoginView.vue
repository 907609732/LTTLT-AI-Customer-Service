<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { PRODUCT_NAME } from '@/shared/brand'
import { useRuntimeStore } from '@/shared/state/runtime'
import { useTask } from '@/shared/ui/use-task'
import { getDesktop } from '@/shared/platform/desktop'
import loginPromo from '@/assets/lingtu-ai-login-promo.png'
import BrandMark from '@/shared/ui/BrandMark.vue'

const router = useRouter()
const runtime = useRuntimeStore()
const task = useTask()
const managed = computed(() => runtime.snapshot.managed)
const session = computed(() => managed.value.session)
const awaitingLogin = ref(false)
const activating = ref(false)
const brandInfo = { name: PRODUCT_NAME }

function winClose() {
  void getDesktop()
    .close()
    .catch(() => {
      task.error.value = '无法关闭窗口'
    })
}

async function activate(mode: 'local' | 'managed') {
  await runtime.run({ action: 'activate-model-source', values: { mode } })
  if (managed.value.restartRequired || managed.value.active.mode !== mode)
    throw new Error('登录设置尚未生效，请重试')
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
    await router.push('/')
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

async function login() {
  const success = await task.run(async () => {
    if (managed.value.restartRequired) await activate(managed.value.configured.mode)
    awaitingLogin.value = true
    await runtime.run({ action: 'managed-login' })
  })
  if (!success) awaitingLogin.value = false
  else await finishLogin()
}

async function cancelLogin() {
  awaitingLogin.value = false
  await task.run(async () => {
    await runtime.run({ action: 'managed-cancel-login' })
  })
}

async function enterAccount() {
  awaitingLogin.value = true
  await finishLogin()
}

async function logout() {
  awaitingLogin.value = false
  await task.run(async () => {
    await runtime.run({ action: 'managed-logout' })
  })
}

async function refreshSession() {
  await task.run(async () => {
    await runtime.run({ action: 'managed-refresh' })
  })
}
</script>

<template>
  <main class="login-page">
    <section class="login-shell">
      <aside class="login-promo">
        <img
          class="login-promo-artwork"
          :src="loginPromo"
          :alt="brandInfo.name + ' 电商AI客服能力'"
        />
        <div class="login-promo-brand"><BrandMark /></div>
      </aside>
      <section class="login-panel" aria-labelledby="login-heading">
        <button class="login-panel-close" type="button" aria-label="关闭" @click="winClose">
          ×
        </button>
        <header class="login-header">
          <h1 id="login-heading">托管账号登录</h1>
          <p>完成浏览器授权后，即可使用托管 AI 服务与账号额度。</p>
        </header>

        <el-alert
          v-if="task.error.value"
          :title="task.error.value"
          type="error"
          :closable="false"
        />
        <template v-if="session.status === 'authorizing'">
          <div class="login-state" role="status">
            <strong>请在浏览器中完成登录和授权</strong>
            <p v-if="session.login" class="login-code">
              确认码 <span>{{ session.login.userCode }}</span>
            </p>
            <p>授权成功后本页会自动返回工作台。</p>
          </div>
          <el-alert
            v-if="session.message"
            :title="session.message"
            type="warning"
            :closable="false"
          />
          <el-button :disabled="task.pending.value" @click="cancelLogin">取消授权</el-button>
        </template>
        <template v-else-if="session.status === 'signed_in' && session.account">
          <div class="login-state" role="status">
            <strong>已登录：{{ session.account.displayName }}</strong>
            <p>登录状态有效，会话凭据已由系统安全存储加密保存。</p>
            <dl class="account-quota">
              <dt>总额度</dt>
              <dd>{{ session.account.trial.limit }} 次</dd>
              <dt>剩余额度</dt>
              <dd>{{ session.account.trial.remaining }} 次</dd>
              <dt>到期时间</dt>
              <dd>
                {{
                  session.account.trial.expiresAt
                    ? new Date(session.account.trial.expiresAt * 1000).toLocaleString('zh-CN')
                    : '未提供'
                }}
              </dd>
            </dl>
          </div>
          <div class="login-actions">
            <el-button
              v-if="managed.active.mode !== 'managed' || managed.restartRequired"
              type="primary"
              :disabled="task.pending.value || activating"
              @click="enterAccount"
              >进入托管账号</el-button
            >
            <el-button
              type="primary"
              :disabled="task.pending.value || activating"
              @click="router.push('/')"
              >进入工作台</el-button
            >
            <el-button :disabled="task.pending.value" @click="login">切换账号</el-button>
            <el-button :disabled="task.pending.value" @click="logout">退出登录</el-button>
            <el-button link :disabled="task.pending.value" @click="refreshSession"
              >刷新账号</el-button
            >
          </div>
        </template>
        <template v-else>
          <div class="login-state">
            <strong>使用托管账号安全登录</strong>
            <p>登录将在浏览器中完成，不会在本页收集账号密码或短信验证码。</p>
          </div>
          <el-alert
            v-if="session.message"
            :title="session.message"
            type="warning"
            :closable="false"
          />
          <el-button
            data-testid="managed-login"
            type="primary"
            :loading="task.pending.value"
            :disabled="!runtime.available"
            @click="login"
          >
            {{
              ['offline', 'expired', 'disabled'].includes(session.status)
                ? '重新登录'
                : '浏览器登录'
            }}
          </el-button>
        </template>

        <div class="persistence-note" data-persistent-login>
          <strong>持久化登录</strong>
          <p>
            登录成功后，会话凭据由系统安全存储加密保存在本机，并在下次启动时自动恢复。退出登录后才会移除。
          </p>
        </div>
        <p v-if="!runtime.available" class="login-register-hint" role="status">
          浏览器预览仅供查看界面；授权、凭据保存和登录恢复需要桌面版。
        </p>
        <el-button class="local-workbench" @click="router.push('/')">继续使用本机工作台</el-button>
      </section>
    </section>
  </main>
</template>

<style scoped>
.login-page {
  min-height: 100%;
  display: grid;
  place-items: center;
  padding: 32px;
  background: #f4f7fc;
}
.login-shell {
  width: min(1040px, 100%);
  min-height: 600px;
  display: grid;
  grid-template-columns: minmax(0, 1.05fr) minmax(380px, 0.95fr);
  overflow: hidden;
  background: #fff;
  border: 1px solid #e6ebf3;
  border-radius: 20px;
  box-shadow: 0 24px 72px rgb(35 56 90 / 12%);
}
.login-promo {
  position: relative;
  min-height: 600px;
  overflow: hidden;
  background: #c5e1ff;
}
.login-promo-artwork {
  width: 100%;
  height: 100%;
  min-height: 600px;
  display: block;
  object-fit: cover;
}
.login-promo-brand {
  position: absolute;
  inset: 0 0 auto;
  display: flex;
  justify-content: center;
  padding: 20px;
  background: #c5e1ff;
}
.login-panel {
  position: relative;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 20px;
  padding: 64px 52px 40px;
}
.login-panel-close {
  position: absolute;
  top: 18px;
  right: 20px;
  width: 34px;
  height: 34px;
  border: 0;
  border-radius: 50%;
  color: #66718a;
  background: transparent;
  font-size: 24px;
  cursor: pointer;
}
.login-panel-close:hover {
  background: #f1f3f8;
}
.login-header h1 {
  margin: 0 0 10px;
  color: #25334d;
  font-size: 26px;
}
.login-header p,
.login-state p,
.persistence-note p,
.login-register-hint {
  margin: 0;
  color: #68758d;
  font-size: 14px;
  line-height: 1.7;
}
.login-state {
  padding: 18px;
  border: 1px solid #e5e9f2;
  border-radius: 12px;
  background: #fafbfe;
  color: #25334d;
}
.login-state > strong {
  display: block;
  margin-bottom: 8px;
  font-size: 16px;
}
.login-code {
  margin: 14px 0 !important;
  color: #3948bb !important;
}
.login-code span {
  margin-left: 8px;
  font-size: 22px;
  font-weight: 700;
  letter-spacing: 0.08em;
}
.account-quota {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 8px 16px;
  margin: 16px 0 0;
  font-size: 13px;
}
.account-quota dt {
  color: #68758d;
}
.account-quota dd {
  margin: 0;
  text-align: right;
  overflow-wrap: anywhere;
}
.login-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.login-actions .el-button {
  margin-left: 0;
}
.persistence-note {
  padding: 14px 16px;
  border-radius: 10px;
  background: #f2f7ff;
}
.persistence-note strong {
  display: block;
  margin-bottom: 4px;
  color: #354a78;
  font-size: 14px;
}
.persistence-note p {
  font-size: 13px;
}
.local-workbench {
  align-self: flex-start;
}
@media (max-width: 760px) {
  .login-page {
    padding: 16px;
  }
  .login-shell {
    min-height: auto;
    grid-template-columns: 1fr;
  }
  .login-promo {
    min-height: 180px;
    max-height: 220px;
  }
  .login-promo-artwork {
    min-height: 220px;
  }
  .login-panel {
    padding: 56px 24px 28px;
  }
}
</style>

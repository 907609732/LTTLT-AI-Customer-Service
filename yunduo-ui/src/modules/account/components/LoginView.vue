<!-- LoginView：保留还原样式标记，业务能力由模块服务逐步接入。 -->
<script setup lang="ts">
import { useRouter } from 'vue-router'
import { notifyUnavailable } from '@/shared/ui/feedback'
import { getDesktop } from '@/shared/platform/desktop'
import IconIphone from '@/shared/icons/IconIphone.vue'
import IconLock from '@/shared/icons/IconLock.vue'
import Local4021cc from '@/shared/icons/IconVerified.vue'
import asset_yunduo_login_promo_hd_CPBBNFUQ from '@/assets/yunduo-login-promo-hd-CPBBNFUQ.png'
import { ref, computed } from 'vue'
import { createLoginViewDemo } from '@/modules/account/demo/LoginView'
const demo = createLoginViewDemo()
const router = useRouter()
const winClose = () =>
  getDesktop()
    .close()
    .catch(() => notifyUnavailable('关闭窗口'))
const __stub = notifyUnavailable
const loginMode = ref(demo.button)
const codeSending = ref(demo.isLoading)
const codeCooldownSeconds = ref(demo.disabled)
const autoLogin = ref(demo.modelValue)
const loginForm = ref(demo.mobile)
const caption = computed(() => demo.loginFormPanel)
const brandInfo = ref(demo.alt)
</script>

<template>
  <main class="login-page">
    <section class="login-stage">
      <div class="login-shell">
        <div class="login-drag-zone" data-window-drag></div>
        <button class="login-panel-close" aria-label="关闭" data-nav @click="winClose">×</button>
        <aside class="login-promo">
          <img
            class="login-promo-artwork"
            :src="asset_yunduo_login_promo_hd_CPBBNFUQ"
            :alt="brandInfo?.['name'] + ' 电商AI客服能力'"
          />
          <div class="login-promo-platform-bar" aria-hidden="true"></div>
        </aside>
        <section class="login-form-panel">
          <div class="login-form-content">
            <header class="login-form-header">
              <h2>欢迎登录</h2>
              <p class="login-form-caption">{{ caption }}</p>
            </header>
            <div class="login-mode-switch">
              <button
                type="button"
                :class="{ active: loginMode === 'code' }"
                @click="loginMode = 'code'"
              >
                手机号登录</button
              ><button
                type="button"
                :class="{ active: loginMode === 'password' }"
                @click="loginMode = 'password'"
              >
                密码登录
              </button>
            </div>
            <el-form class="login-form" @submit="__stub('此操作')"
              ><el-form-item
                ><el-input
                  v-model="loginForm.mobile"
                  :prefix-icon="IconIphone"
                  placeholder="请输入手机号"
                  maxlength="11"
                  autocomplete="username"
                ></el-input></el-form-item
              ><template v-if="loginMode === 'code'"
                ><el-form-item class="verification-item"
                  ><el-input
                    v-model="loginForm.code"
                    :prefix-icon="Local4021cc"
                    placeholder="请输入验证码"
                    maxlength="6"
                    autocomplete="one-time-code"
                  ></el-input
                  ><el-button
                    class="send-code-btn"
                    :loading="codeSending"
                    :disabled="codeCooldownSeconds > 0"
                    @click="__stub('此操作')"
                    >{{
                      codeCooldownSeconds > 0 ? codeCooldownSeconds + 's' : '获取验证码'
                    }}</el-button
                  ></el-form-item
                ></template
              ><template v-else
                ><el-form-item
                  ><el-input
                    v-model="loginForm.password"
                    :prefix-icon="IconLock"
                    type="password"
                    show-password=""
                    placeholder="请输入密码"
                    autocomplete="current-password"
                  ></el-input></el-form-item></template
              ><el-button
                class="login-submit"
                type="primary"
                native-type="button"
                data-nav
                @click="__stub('登录')"
              >
                登录
              </el-button></el-form
            >
            <div class="auto-login-row">
              <label class="auto-login-main"
                ><el-switch v-model="autoLogin"></el-switch><span>自动登录</span></label
              >
            </div>
            <el-button type="primary" @click="router.push('/')">进入本机工作台</el-button>
            <p class="login-register-hint">
              当前使用自己的模型密钥，无需软件账号；手机号登录尚未接入
            </p>
            <p class="agreement">
              登录即表示同意
              <a
                href="https://www.yuque.com/yuqueyonghufcirrg/da2iaf/ofvxz6tpg046qsb0"
                target="_blank"
                rel="noopener"
                @click="__stub('此操作')"
                >《用户协议》</a
              >
            </p>
          </div>
        </section>
      </div>
    </section>
  </main>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { getDesktop } from '../platform/desktop'
import type { AppUpdateResult } from '../contracts/app-update'

const desktop = getDesktop()
const pending = ref(false)
const message = ref('检查更新')
const result = ref<AppUpdateResult | null>(null)
const visible = ref(false)
const downloadError = ref('')
async function check(manual: boolean) {
  if (pending.value) return
  if (!desktop.checkForUpdates) {
    message.value = '请在桌面版检查更新'
    return
  }
  pending.value = true
  message.value = '正在检查更新…'
  try {
    result.value = await desktop.checkForUpdates(manual)
    visible.value = result.value.status === 'available'
    message.value = visible.value
      ? '发现新版本'
      : manual
        ? result.value.status === 'current'
          ? '已是最新版本 · 再次检查'
          : '暂无正式版本 · 再次检查'
        : '检查更新'
  } catch {
    message.value = '检查失败，点击重试'
  } finally {
    pending.value = false
  }
}
async function download() {
  if (!result.value?.releaseUrl) return
  downloadError.value = ''
  try {
    await desktop.openExternal(result.value.releaseUrl)
  } catch {
    downloadError.value = '无法打开下载页，请重试'
  }
}
onMounted(() => {
  if (desktop.isElectron) void check(false)
})
</script>

<template>
  <div class="app-update">
    <button type="button" class="app-update-check" :disabled="pending" @click="check(true)">
      {{ message }}
    </button>
    <section
      v-if="visible && result"
      class="app-update-notice"
      role="status"
      aria-label="软件更新提示"
    >
      <button
        type="button"
        class="app-update-dismiss"
        aria-label="稍后更新"
        @click="visible = false"
      >
        ×
      </button>
      <strong>发现新版本 v{{ result.latestVersion }}</strong>
      <p>新版本已准备好，欢迎下载更新。</p>
      <button type="button" class="app-update-download" data-update-download @click="download">
        前往下载
      </button>
      <p v-if="downloadError" role="alert">{{ downloadError }}</p>
    </section>
  </div>
</template>

<style scoped>
.app-update {
  position: relative;
  flex-basis: 100%;
  padding: 0 12px;
}
.app-update-check {
  border: 0;
  background: transparent;
  padding: 4px 0;
  font-size: 12px;
  color: #58708f;
  cursor: pointer;
}
.app-update-check:disabled {
  cursor: wait;
}
.app-update-notice {
  position: absolute;
  bottom: calc(100% + 12px);
  left: 12px;
  box-sizing: border-box;
  width: calc(100% - 12px);
  max-width: 280px;
  padding: 18px;
  border: 1px solid #dce6f5;
  border-radius: 14px;
  background: #fff;
  box-shadow: 0 8px 32px #15386b24;
  color: #20334d;
  z-index: 100;
}
.app-update-notice strong {
  display: block;
  padding-right: 16px;
  font-size: 14px;
}
.app-update-notice p {
  margin: 10px 0;
  font-size: 12px;
  line-height: 1.6;
}
.app-update-dismiss {
  position: absolute;
  top: 7px;
  right: 9px;
  border: 0;
  background: transparent;
  font-size: 20px;
  color: #6b7d96;
  cursor: pointer;
}
.app-update .app-update-notice button.app-update-download {
  padding: 7px 14px;
  border: 0;
  border-radius: 7px;
  background: #3267ee;
  color: #fff;
  cursor: pointer;
}
</style>

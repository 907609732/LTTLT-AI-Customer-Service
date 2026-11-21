<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { getDesktop } from '../platform/desktop'
import type { AppUpdateResult } from '../contracts/app-update'

const props = withDefaults(defineProps<{ variant?: 'default' | 'footer'; compact?: boolean }>(), {
  variant: 'default',
  compact: false,
})
const desktop = getDesktop()
const pending = ref(false)
const message = ref('检查更新')
const result = ref<AppUpdateResult | null>(null)
const visible = ref(false)
const downloadError = ref('')
const lastCheckFailed = ref(false)
const notice = ref<HTMLElement | null>(null)
const buttonLabel = computed(() => {
  if (pending.value) return '正在检查更新…'
  // 保留已知版本提示，但最近一次手动检查失败必须优先暴露，不能继续显示“发现新版本”。
  if (lastCheckFailed.value) return message.value
  if (result.value?.status === 'available' && result.value.latestVersion)
    return `发现新版本 v${result.value.latestVersion}`
  return message.value
})
const compactLabel = computed(() => {
  if (pending.value) return '检查中'
  if (lastCheckFailed.value) return '重试更新'
  if (result.value?.status === 'available') return '有新版本'
  return '检查更新'
})
async function check(manual: boolean) {
  if (pending.value) return
  if (!desktop.checkForUpdates) {
    message.value = '请在桌面版检查更新'
    return
  }
  pending.value = true
  lastCheckFailed.value = false
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
    lastCheckFailed.value = true
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
// footer 自身可滚动；发现更新后把原有提示滚入可见区，不删除提示或失败重试。
watch(visible, async (shown) => {
  if (!shown || props.variant !== 'footer') return
  await nextTick()
  notice.value?.scrollIntoView?.({ block: 'nearest' })
})
</script>

<template>
  <div
    :class="[
      'app-update',
      { 'app-update--footer': variant === 'footer', 'app-update--compact': compact },
    ]"
  >
    <button
      type="button"
      :class="[
        'app-update-check',
        {
          'has-update': !lastCheckFailed && result?.status === 'available',
          'is-footer': variant === 'footer',
        },
      ]"
      :disabled="pending"
      :title="compact ? buttonLabel : undefined"
      :aria-label="compact ? buttonLabel : undefined"
      @click="check(true)"
    >
      <span v-if="variant === 'footer'" class="app-update-icon" aria-hidden="true">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">
          <path
            fill="currentColor"
            d="M771.776 794.88A384 384 0 0 1 128 512h64a320 320 0 0 0 555.712 216.448H654.72a32 32 0 1 1 0-64h149.056a32 32 0 0 1 32 32v148.928a32 32 0 1 1-64 0v-50.56zM276.288 295.616h92.992a32 32 0 0 1 0 64H220.16a32 32 0 0 1-32-32V178.56a32 32 0 0 1 64 0v50.56A384 384 0 0 1 896.128 512h-64a320 320 0 0 0-555.776-216.384z"
          />
        </svg>
      </span>
      <span>{{ compact ? compactLabel : buttonLabel }}</span>
    </button>
    <section
      v-if="visible && result"
      ref="notice"
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
  flex: 0 0 auto;
  box-sizing: border-box;
  width: 100%;
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

/* footer 变体沿用同一检查/重试逻辑，只把入口对齐 footer 的白色描边按钮。 */
.app-update.app-update--footer {
  padding: 0;
}
.app-sidebar-footer .app-update-check.is-footer,
.app-update--footer .app-update-check.is-footer {
  display: flex;
  width: 100%;
  height: 34px;
  align-items: center;
  justify-content: center;
  gap: 6px;
  box-sizing: border-box;
  padding: 0 10px;
  border: 1px solid #e4e7ed;
  border-radius: 9px;
  background: #fff;
  color: #606266;
  font: inherit;
  font-size: 12px;
  line-height: 1;
}
.app-update--footer .app-update-check.is-footer:hover {
  border-color: #cbd6ec;
  background: #f5f7fa;
  color: #2453e8;
}
.app-update--footer .app-update-check.is-footer.has-update {
  border-color: #cbd9ff;
  background: #edf2ff;
  color: #2453e8;
  font-weight: 600;
}
.app-update--footer .app-update-check.is-footer:disabled {
  cursor: wait;
  opacity: 0.65;
}
.app-update--footer .app-update-check.is-footer:focus-visible {
  outline: 2px solid #8fabff;
  outline-offset: 2px;
}
.app-update--footer .app-update-icon {
  display: inline-flex;
  width: 15px;
  height: 15px;
}
.app-update--footer .app-update-icon svg {
  width: 15px;
  height: 15px;
}
/* footer 内部可滚动，提示改为内联卡片，避免绝对定位被滚动容器裁掉。 */
.app-update--footer .app-update-notice {
  position: relative;
  inset: auto;
  width: auto;
  max-width: none;
  margin-top: 8px;
  padding: 12px;
  border-color: #dce6f5;
  border-radius: 9px;
  background: #fff;
  box-shadow: none;
  color: #303133;
}
.app-update--footer .app-update-notice strong {
  padding-right: 26px;
  color: #303133;
  font-size: 12px;
  font-weight: 600;
}
.app-update--footer .app-update-notice p {
  margin: 7px 0;
  color: #606266;
  font-size: 11px;
  line-height: 1.6;
}
.app-update--footer .app-update-dismiss {
  top: 3px;
  right: 6px;
  color: #909399;
}
.app-update--footer .app-update-dismiss:hover {
  color: #606266;
}
.app-update--footer .app-update-notice button.app-update-download {
  padding: 5px 10px;
  border-radius: 7px;
  background: #3366ff;
  color: #fff;
  font-size: 11px;
  font-weight: 600;
}
/* 版本同行入口保持小尺寸；新版详情跨整行显示，避免挤压版本或裁切提示。 */
.app-update--footer.app-update--compact {
  display: contents;
}
.app-update--compact .app-update-check.is-footer {
  width: auto;
  height: 24px;
  gap: 3px;
  padding: 0 6px;
  border-radius: 6px;
  font-size: 11px;
  white-space: nowrap;
}
.app-update--compact .app-update-icon {
  width: 12px;
  height: 12px;
}
.app-update--compact .app-update-notice {
  grid-column: 1 / -1;
  margin-top: 0;
}
</style>

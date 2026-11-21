<script setup lang="ts">
import { ref } from 'vue'
import AppVersion from '@/shared/ui/AppVersion.vue'
import UpdateStatus from '@/shared/ui/UpdateStatus.vue'
import IconChatDotRound from '@/shared/icons/IconChatDotRound.vue'
import IconDocument from '@/shared/icons/IconDocument.vue'
import IconMonitor from '@/shared/icons/IconMonitor.vue'
import IconService from '@/shared/icons/IconService.vue'
import { openOfficialTutorial } from '../sidebar-footer'

withDefaults(
  defineProps<{
    pendingCount?: number
    monitorBusy?: boolean
    monitorError?: string
  }>(),
  { pendingCount: 0, monitorBusy: false, monitorError: '' },
)
const emit = defineEmits<{
  'quick-reply': []
  'reply-monitor': []
  contact: []
}>()
const tutorialError = ref('')

async function tutorial() {
  tutorialError.value = ''
  try {
    await openOfficialTutorial()
  } catch (error) {
    tutorialError.value = error instanceof Error ? error.message : '无法打开使用教程，请稍后重试'
  }
}
</script>

<template>
  <footer class="sidebar-footer app-sidebar-footer">
    <div class="footer-tools" aria-label="快捷工具">
      <button type="button" class="footer-tool" @click="emit('quick-reply')">
        <el-icon><IconChatDotRound /></el-icon><span>快捷回复</span>
      </button>
      <button
        type="button"
        class="footer-tool"
        aria-label="回复监控"
        :disabled="monitorBusy"
        @click="emit('reply-monitor')"
      >
        <el-icon><IconMonitor /></el-icon>
        <span>回复监控</span>
        <span v-if="pendingCount" class="pending-count" aria-label="待确认回复数">
          {{ pendingCount }}
        </span>
      </button>
    </div>
    <p v-if="monitorError" class="monitor-error" role="alert">{{ monitorError }}</p>

    <nav class="footer-actions" aria-label="客服与帮助">
      <button type="button" class="footer-action" @click="emit('contact')">
        <el-icon><IconService /></el-icon><span>添加客服</span>
      </button>
      <button type="button" class="footer-action" @click="tutorial">
        <el-icon><IconDocument /></el-icon><span>使用教程</span>
      </button>
    </nav>
    <p v-if="tutorialError" class="monitor-error" role="alert">{{ tutorialError }}</p>
    <div class="footer-version">
      <AppVersion prefix="当前版本 v" />
      <UpdateStatus variant="footer" compact />
    </div>
  </footer>
</template>

<style scoped>
/* 首页 footer 跟随 workbench-light 的蓝白主题；尺寸、滚动和交互保持原布局。 */
.sidebar-footer.app-sidebar-footer {
  display: flex;
  flex: 0 1 auto;
  flex-direction: column;
  align-items: stretch;
  gap: 8px;
  box-sizing: border-box;
  width: 100%;
  max-height: min(48vh, 360px);
  min-height: 0;
  padding: 10px;
  overflow-x: hidden;
  overflow-y: auto;
  border-top: 1px solid #e8e8eb;
  background: #fff;
  color: #606266;
  container-type: inline-size;
  scrollbar-width: thin;
  scrollbar-color: #c5ccd6 transparent;
}
.app-sidebar-footer .footer-tools {
  display: grid;
  width: 100%;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 6px;
}
.app-sidebar-footer .footer-tool {
  position: relative;
  display: inline-flex;
  min-width: 0;
  height: 30px;
  align-items: center;
  justify-content: center;
  gap: 3px;
  padding: 0 3px;
  border: 1px solid #e4e7ed;
  border-radius: 8px;
  background: #fff;
  color: #606266;
  font: inherit;
  font-size: 12px;
  line-height: 1;
  white-space: nowrap;
  cursor: pointer;
}
.app-sidebar-footer .footer-tool:hover {
  background: #f5f7fa;
  color: #2453e8;
}
.app-sidebar-footer .footer-tool:disabled {
  cursor: wait;
  opacity: 0.55;
}
.app-sidebar-footer .footer-tool .el-icon {
  flex: 0 0 auto;
  width: 13px;
  font-size: 13px;
}
.app-sidebar-footer .pending-count {
  display: inline-grid;
  min-width: 15px;
  height: 15px;
  place-items: center;
  padding: 0 3px;
  border-radius: 999px;
  background: #edf2ff;
  color: #2453e8;
  font-size: 10px;
  font-weight: 700;
}
.app-sidebar-footer .monitor-error {
  margin: 0;
  padding: 0 2px;
  color: #c45656;
  font-size: 11px;
  line-height: 1.45;
  overflow-wrap: anywhere;
}
.app-sidebar-footer .footer-actions {
  display: flex;
  width: 100%;
  flex-direction: column;
  gap: 8px;
}
.app-sidebar-footer .footer-action {
  display: flex;
  width: 100%;
  height: 34px;
  align-items: center;
  justify-content: center;
  gap: 6px;
  box-sizing: border-box;
  border: 1px solid #e4e7ed;
  border-radius: 9px;
  background: #fff;
  color: #606266;
  font: inherit;
  font-size: 12px;
  line-height: 1;
  cursor: pointer;
}
.app-sidebar-footer .footer-action:hover {
  border-color: #cbd6ec;
  background: #f5f7fa;
  color: #2453e8;
}
.app-sidebar-footer .footer-action .el-icon {
  width: 15px;
  font-size: 15px;
}
.app-sidebar-footer .footer-version {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 6px;
  padding-top: 1px;
}
.app-sidebar-footer .footer-version :deep(.app-version) {
  min-width: 0;
  padding: 2px 2px 0;
  color: #909399;
  font-size: 11px;
  line-height: 17px;
  overflow-wrap: anywhere;
}
.app-sidebar-footer button:focus-visible {
  outline: 2px solid #8fabff;
  outline-offset: 2px;
}
/* 150px 级窄栏无法容纳两列工具，改为单列避免文字被截断。 */
@container (max-width: 170px) {
  .app-sidebar-footer .footer-tools {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>

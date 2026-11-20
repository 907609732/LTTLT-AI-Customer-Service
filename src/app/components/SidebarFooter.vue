<script setup lang="ts">
import { ref } from 'vue'
import AppVersion from '@/shared/ui/AppVersion.vue'
import UpdateStatus from '@/shared/ui/UpdateStatus.vue'
import IconChatDotRound from '@/shared/icons/IconChatDotRound.vue'
import IconDocument from '@/shared/icons/IconDocument.vue'
import IconMonitor from '@/shared/icons/IconMonitor.vue'
import IconService from '@/shared/icons/IconService.vue'
import { openOfficialTutorial, type SidebarBalance } from '../sidebar-footer'

const props = withDefaults(
  defineProps<{
    account: SidebarBalance
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
  login: []
  recharge: []
}>()
const tutorialError = ref('')

function recharge() {
  // 未登录（含切换账号待重启）时复用顶部登录弹窗，不在 footer 另建认证入口。
  if (props.account.canRecharge) emit('recharge')
  else emit('login')
}
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

    <section class="quota-card" aria-label="剩余算力">
      <div class="quota-heading">
        <span>剩余算力</span>
        <span class="quota-dot" aria-hidden="true"></span>
      </div>
      <strong
        :class="['quota-value', { 'is-status': account.balance === null }]"
        :title="account.detail"
        >{{ account.label }}</strong
      >
      <button
        type="button"
        class="recharge-button"
        :aria-label="account.canRecharge ? '充值算力' : '登录后充值算力'"
        @click="recharge"
      >
        充值
      </button>
    </section>

    <nav class="footer-actions" aria-label="客服与帮助">
      <button type="button" class="footer-action" @click="emit('contact')">
        <el-icon><IconService /></el-icon><span>添加客服</span>
      </button>
      <button type="button" class="footer-action" @click="tutorial">
        <el-icon><IconDocument /></el-icon><span>使用教程</span>
      </button>
      <UpdateStatus variant="footer" />
    </nav>
    <p v-if="tutorialError" class="monitor-error" role="alert">{{ tutorialError }}</p>
    <div class="footer-version"><AppVersion prefix="当前 v" /></div>
  </footer>
</template>

<style scoped>
/* 两处布局只共用此 footer；深色区域和圆角卡片按参考图重建，其他蓝白界面不动。 */
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
  border-top: 1px solid #3c3937;
  background: #2e2e2e;
  color: #d7d2ce;
  container-type: inline-size;
  scrollbar-width: thin;
  scrollbar-color: #5d5956 transparent;
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
  border: 1px solid #484442;
  border-radius: 8px;
  background: #353432;
  color: #e2ddd8;
  font: inherit;
  font-size: 11px;
  line-height: 1;
  white-space: nowrap;
  cursor: pointer;
}
.app-sidebar-footer .footer-tool:hover {
  background: #3d3b39;
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
  background: #e6ddd5;
  color: #1b1a19;
  font-size: 10px;
  font-weight: 700;
}
.app-sidebar-footer .monitor-error {
  margin: 0;
  padding: 0 2px;
  color: #f0b3a5;
  font-size: 11px;
  line-height: 1.45;
  overflow-wrap: anywhere;
}
.app-sidebar-footer .quota-card {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  box-sizing: border-box;
  width: 100%;
  container-type: inline-size;
  padding: 9px 9px 10px;
  border: 1px solid #171615;
  border-radius: 11px;
  background: #050505;
  box-shadow: inset 0 1px #292724;
}
.app-sidebar-footer .quota-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  color: #bbb3ad;
  font-size: 12px;
  line-height: 17px;
}
.app-sidebar-footer .quota-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: #d8cec6;
  opacity: 0.7;
}
.app-sidebar-footer .quota-value {
  display: block;
  min-height: 38px;
  padding: 2px 0 4px;
  color: #f2eae3;
  font-size: clamp(20px, 16cqw, 30px);
  font-variant-numeric: tabular-nums;
  font-weight: 750;
  letter-spacing: 0.4px;
  line-height: 38px;
  text-align: center;
  white-space: nowrap;
}
.app-sidebar-footer .quota-value.is-status {
  font-size: 18px;
  letter-spacing: 0;
}
.app-sidebar-footer .recharge-button {
  height: 29px;
  border: 0;
  border-radius: 8px;
  background: #f4f3f0;
  color: #151413;
  font: inherit;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
}
.app-sidebar-footer .recharge-button:hover {
  background: #fff;
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
  border: 1px solid #484442;
  border-radius: 9px;
  background: transparent;
  color: #d9d3ce;
  font: inherit;
  font-size: 12px;
  line-height: 1;
  cursor: pointer;
}
.app-sidebar-footer .footer-action:hover {
  border-color: #6a625c;
  background: #353331;
  color: #f0e9e2;
}
.app-sidebar-footer .footer-action .el-icon {
  width: 15px;
  font-size: 15px;
}
.app-sidebar-footer .footer-version {
  padding-top: 1px;
}
.app-sidebar-footer .footer-version :deep(.app-version) {
  padding: 2px 2px 0;
  color: #8f8984;
  font-size: 11px;
  line-height: 17px;
}
/* 150px 级窄栏无法容纳两列工具，改为单列避免文字被截断。 */
@container (max-width: 170px) {
  .app-sidebar-footer .footer-tools {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>

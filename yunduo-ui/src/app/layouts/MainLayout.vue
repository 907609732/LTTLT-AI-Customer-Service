<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import BrandMark from '@/shared/ui/BrandMark.vue'
import IconHomeFilled from '@/shared/icons/IconHomeFilled.vue'
import IconShop from '@/shared/icons/IconShop.vue'
import IconMonitor from '@/shared/icons/IconMonitor.vue'
import IconSearch from '@/shared/icons/IconSearch.vue'
import IconPlus from '@/shared/icons/IconPlus.vue'
import IconMinus from '@/shared/icons/IconMinus.vue'
import IconFullScreen from '@/shared/icons/IconFullScreen.vue'
import IconClose from '@/shared/icons/IconClose.vue'
import IconSetting from '@/shared/icons/IconSetting.vue'
import { QuickReplyDialog, ScheduledTasksDialog } from '@/modules/workbench'
import { AddShopDialog } from '@/modules/shops'
import { getDesktop } from '@/shared/platform/desktop'
import { notifyUnavailable } from '@/shared/ui/feedback'
import { useRuntimeStore } from '@/shared/state/runtime'
import { useTask } from '@/shared/ui/use-task'
import type { LocalStore } from '@/shared/contracts/backend'
const router = useRouter(),
  route = useRoute(),
  desktop = getDesktop(),
  runtime = useRuntimeStore(),
  task = useTask()
const navigation = [
  { label: '店铺首页', path: '/', icon: IconHomeFilled },
  { label: '配置中心', path: '/shop/manage', icon: IconShop },
  { label: 'AI辅助中心', path: '/float/assist', icon: IconMonitor },
]
const sidebarCollapsed = ref(false),
  shopQuery = ref(''),
  shopStatus = ref('offline'),
  addShopVisible = ref(false),
  quickReplyVisible = ref(false),
  scheduleVisible = ref(false),
  enterToSend = ref(true),
  clearAfterSend = ref(false)
const shops = computed(() =>
  runtime.snapshot.stores.filter(
    (shop) =>
      (shopStatus.value === 'online' ? shop.runtime.online : !shop.runtime.online) &&
      [shop.storeName, shop.platform].some((value) => value.includes(shopQuery.value)),
  ),
)
watch(
  [
    () => route.path,
    () => runtime.platformStoreId,
    () => runtime.snapshot.stores.length,
    addShopVisible,
    quickReplyVisible,
    scheduleVisible,
  ],
  () => {
    const visible =
      route.path === '/' &&
      Boolean(runtime.platformStoreId) &&
      runtime.snapshot.stores.some((s) => s.id === runtime.platformStoreId) &&
      !addShopVisible.value &&
      !quickReplyVisible.value &&
      !scheduleVisible.value
    void runtime.presentStore(runtime.platformStoreId, visible).catch((error) => {
      task.error.value = error instanceof Error ? error.message : String(error)
    })
  },
  { immediate: true },
)
onBeforeUnmount(() => {
  void runtime.presentStore('', false).catch(() => {})
})
async function windowAction(action: 'minimize' | 'toggleMaximize' | 'close') {
  if (!desktop.isElectron) {
    notifyUnavailable('浏览器预览不支持窗口控制')
    return
  }
  try {
    await desktop[action]()
  } catch {
    notifyUnavailable('窗口操作失败')
  }
}
async function openShop(shop: LocalStore) {
  sidebarCollapsed.value = false
  await task.run(async () => {
    runtime.selectedStoreId = shop.id
    await runtime.run({ action: 'open-store', storeId: shop.id })
    runtime.platformStoreId = shop.id
    await runtime.presentStore(shop.id, true)
  })
}
async function closeShop(shop: LocalStore) {
  await task.run(async () => {
    await runtime.run({ action: 'close-store', storeId: shop.id })
    if (runtime.platformStoreId === shop.id) runtime.platformStoreId = ''
  })
}
async function setAi(shop: LocalStore) {
  await task.run(async () => {
    const r = await runtime.run({
      action: 'set-ai',
      storeId: shop.id,
      values: { enabled: !shop.aiEnabled },
    })
    task.message.value = r.message
  })
}
async function openLogs() {
  await task.run(async () => {
    await runtime.run({ action: 'open-runtime-logs' })
  })
}
</script>
<template>
  <div :class="['workbench-shell', { 'sidebar-collapsed': sidebarCollapsed }]">
    <header class="workbench-titlebar" data-window-drag @dblclick="windowAction('toggleMaximize')">
      <div class="top-brand-block"><BrandMark size="md" /></div>
      <nav class="top-navigation">
        <button
          v-for="item in navigation"
          :key="item.path"
          :class="{ active: route.path === item.path }"
          @click="router.push(item.path)"
        >
          <el-icon class="nav-icon"><component :is="item.icon" /></el-icon
          ><span>{{ item.label }}</span>
        </button>
      </nav>
      <div class="titlebar-drag-region" aria-hidden="true"></div>
      <div class="top-actions">
        <button class="top-pill" aria-label="实时日志" @click="openLogs">
          日志<span v-if="runtime.snapshot.review.replies.some((r) => r.status === 'pending')">
            ·
            {{ runtime.snapshot.review.replies.filter((r) => r.status === 'pending').length }}
            待确认</span
          >
        </button>
        <button class="top-pill model-switch-pill" @click="router.push('/settings')">
          模型 · {{ runtime.snapshot.capabilities.apiKeyConfigured ? '已配置' : '待配置' }}</button
        ><button
          class="store-control-trigger"
          :disabled="task.pending.value"
          @click="
            task.run(async () => {
              await runtime.run({ action: 'batch', values: { operation: 'disable' } })
            })
          "
        >
          全部关闭 AI
        </button>
        <div class="plan-recharge">
          <button class="plan-badge plan-badge-trigger" @click="router.push('/settings')">
            本机密钥模式
          </button>
        </div>
        <div class="window-controls" data-no-drag>
          <button aria-label="最小化" title="最小化" @click="windowAction('minimize')">
            <el-icon><IconMinus /></el-icon></button
          ><button
            aria-label="最大化或还原"
            title="最大化或还原"
            @click="windowAction('toggleMaximize')"
          >
            <el-icon><IconFullScreen /></el-icon></button
          ><button class="close" aria-label="关闭" title="关闭" @click="windowAction('close')">
            <el-icon><IconClose /></el-icon>
          </button>
        </div>
      </div>
    </header>
    <div class="workbench-body">
      <aside :class="['store-sidebar my-platform', { 'is-collapsed': sidebarCollapsed }]">
        <el-alert
          v-if="task.error.value || runtime.error"
          :title="task.error.value || runtime.error"
          type="error"
          :closable="true"
          @close="task.error.value = ''"
        />
        <div class="sidebar-panel">
          <div class="store-search">
            <el-input
              v-if="!sidebarCollapsed"
              v-model="shopQuery"
              clearable
              placeholder="搜索账号 / 平台"
              :prefix-icon="IconSearch"
            /><button
              class="store-add-btn"
              aria-label="添加店铺"
              title="添加店铺"
              @click="addShopVisible = true"
            >
              <el-icon><IconPlus /></el-icon>
            </button>
          </div>
        </div>
        <div
          v-show="!sidebarCollapsed"
          class="store-tabs platform-tabs"
          role="tablist"
          aria-label="店铺状态筛选"
        >
          <button
            v-for="status in ['online', 'offline']"
            :key="status"
            role="tab"
            :aria-selected="shopStatus === status"
            :class="{ active: shopStatus === status }"
            @click="shopStatus = status"
          >
            <span class="store-tab-label">{{ status === 'online' ? '在线' : '未登录' }}</span
            ><span class="store-tab-count">{{
              runtime.snapshot.stores.filter((s) =>
                status === 'online' ? s.runtime.online : !s.runtime.online,
              ).length
            }}</span>
          </button>
        </div>
        <div v-show="!sidebarCollapsed" class="store-list">
          <div v-if="!shops.length" class="store-list-empty">
            <p>{{ shopStatus === 'online' ? '暂无在线店铺' : '暂无未登录店铺' }}</p>
            <button @click="addShopVisible = true">添加店铺</button>
          </div>
          <article v-for="shop in shops" :key="shop.id" class="local-shop-card">
            <button class="local-shop-title" :disabled="task.pending.value" @click="openShop(shop)">
              {{ shop.storeName || '待识别店铺' }}
            </button>
            <p>
              {{ shop.platform }} ·
              {{ shop.runtime.online ? '已连接' : shop.runtime.open ? '等待平台登录' : '未打开' }}
            </p>
            <p
              v-if="shop.runtime.lastError || shop.runtime.collectionError"
              class="local-shop-error"
            >
              {{ shop.runtime.lastError || shop.runtime.collectionError }}
            </p>
            <div class="runtime-actions">
              <el-button size="small" :disabled="task.pending.value" @click="openShop(shop)"
                >打开工作台</el-button
              ><el-button size="small" :disabled="task.pending.value" @click="setAi(shop)">{{
                shop.aiEnabled ? '关闭 AI' : '开启 AI'
              }}</el-button
              ><el-button size="small" :disabled="task.pending.value" @click="closeShop(shop)"
                >关闭店铺</el-button
              >
            </div>
          </article>
        </div>
        <button
          class="sidebar-collapse"
          :disabled="Boolean(runtime.platformStoreId)"
          :aria-expanded="!sidebarCollapsed"
          title="折叠或展开店铺栏"
          @click="sidebarCollapsed = !sidebarCollapsed"
        >
          {{ sidebarCollapsed ? '›' : '‹' }}
        </button>
        <footer class="sidebar-footer">
          <button @click="router.push('/settings')">
            <el-icon><IconSetting /></el-icon>设置</button
          ><button @click="quickReplyVisible = true">快捷回复</button
          ><button @click="scheduleVisible = true">定时任务</button>
        </footer>
      </aside>
      <main class="workbench-main"><router-view /></main>
    </div>
    <AddShopDialog v-model="addShopVisible" /><QuickReplyDialog
      v-model="quickReplyVisible"
      v-model:enter-to-send="enterToSend"
      v-model:clear-after-send="clearAfterSend"
    /><ScheduledTasksDialog v-model="scheduleVisible" />
  </div>
</template>
<style scoped>
.workbench-main {
  flex: 1;
  min-width: 0;
  overflow: auto;
}
.sidebar-collapse {
  position: absolute;
  right: -8px;
  top: 48%;
  border: 0;
  border-radius: 6px;
  background: #edf5ff;
  color: #6698d9;
  z-index: 2;
}
.store-sidebar {
  position: relative;
}
.local-shop-card {
  margin: 12px;
  padding: 14px;
  border: 1px solid #dce8fb;
  background: #fff;
  border-radius: 12px;
}
.local-shop-card p {
  font-size: 12px;
  color: #8493a9;
  margin: 8px 0;
}
.local-shop-title {
  background: none;
  border: 0;
  font-size: 15px;
  font-weight: 600;
  color: #25334d;
  cursor: pointer;
}
.local-shop-card .runtime-actions {
  gap: 5px;
}
.local-shop-card .el-button {
  margin: 0;
}
.local-shop-card .local-shop-error {
  color: #cf4d4d;
}
</style>

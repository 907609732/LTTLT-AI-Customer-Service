<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { isNavigationFailure, useRoute, useRouter } from 'vue-router'
import BrandMark from '@/shared/ui/BrandMark.vue'
import ContactQrDialog from '@/shared/ui/ContactQrDialog.vue'
import SidebarFooter from '@/app/components/SidebarFooter.vue'
import { useSidebarBalance } from '@/app/sidebar-footer'
import IconHomeFilled from '@/shared/icons/IconHomeFilled.vue'
import IconShop from '@/shared/icons/IconShop.vue'
import IconMonitor from '@/shared/icons/IconMonitor.vue'
import IconSearch from '@/shared/icons/IconSearch.vue'
import IconPlus from '@/shared/icons/IconPlus.vue'
import IconMinus from '@/shared/icons/IconMinus.vue'
import IconFullScreen from '@/shared/icons/IconFullScreen.vue'
import IconClose from '@/shared/icons/IconClose.vue'
import { openKnowledgeManager } from '@/modules/knowledge'
import { QuickReplyDialog } from '@/modules/workbench'
import { LoginDialog } from '@/modules/settings'
import { AddShopDialog, StoreSidebarCard, useShopSetupStore } from '@/modules/shops'
import { getDesktop } from '@/shared/platform/desktop'
import { notifyUnavailable } from '@/shared/ui/feedback'
import { useRuntimeStore } from '@/shared/state/runtime'
import { useTask } from '@/shared/ui/use-task'
import type { LocalStore } from '@/shared/contracts/backend'
import { useAssistLocation } from '@/app/use-assist-location'
const router = useRouter(),
  route = useRoute(),
  desktop = getDesktop(),
  runtime = useRuntimeStore(),
  setup = useShopSetupStore(),
  task = useTask(),
  sidebarBalance = useSidebarBalance()
const pendingReplyCount = computed(
  () => runtime.snapshot.review.replies.filter((reply) => reply.status === 'pending').length,
)
const zoomPercent = ref(100)
watch(
  () => runtime.platformStoreId,
  () => {
    zoomPercent.value = 100
    if (runtime.platformStoreId && desktop.setStoreZoom) {
      void desktop
        .setStoreZoom({
          workspaceId: runtime.snapshot.workspaceId,
          storeId: runtime.platformStoreId,
          percent: 100,
        })
        .catch(() => {})
    }
  },
)
async function changeZoom(event: Event) {
  const percent = Number((event.target as HTMLSelectElement).value)
  await task.run(async () => {
    if (!desktop.setStoreZoom) throw Error('当前环境不支持网页缩放')
    zoomPercent.value = await desktop.setStoreZoom({
      workspaceId: runtime.snapshot.workspaceId,
      storeId: runtime.platformStoreId,
      percent,
    })
  })
}
const isConfiguration = computed(() => route.name === 'shop-manage')
const navigation = [
  { label: '店铺首页', path: '/', icon: IconHomeFilled },
  { label: '配置中心', path: '/shop/manage', icon: IconShop },
  { label: 'AI辅助中心', path: '/float/assist', icon: IconMonitor },
]
useAssistLocation(route, router, runtime, (message) => {
  task.error.value = message
})
const sidebarCollapsed = ref(false),
  shopQuery = ref(''),
  shopStatus = ref('offline'),
  addShopVisible = ref(false),
  quickReplyVisible = ref(false),
  loginVisible = ref(false),
  contactVisible = ref(false)
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
    loginVisible,
    contactVisible,
    () => setup.visible,
    () => setup.onboardingPhase,
    () => setup.returnAvailable,
  ],
  () => {
    const visible =
      route.path === '/' &&
      Boolean(runtime.platformStoreId) &&
      runtime.snapshot.stores.some((s) => s.id === runtime.platformStoreId) &&
      !addShopVisible.value &&
      !quickReplyVisible.value &&
      !loginVisible.value &&
      !contactVisible.value &&
      !setup.visible
    const presentation =
      setup.onboardingPhase === 'login' && !setup.returnAvailable
        ? runtime.presentStore(runtime.platformStoreId, visible, 'onboarding-login')
        : runtime.presentStore(runtime.platformStoreId, visible)
    void presentation.catch((error) => {
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
  if (setup.visible || (setup.storeId && setup.storeId !== shop.id)) setup.dismiss()
  const workspace = runtime.snapshot.workspaceId
  await task.run(async () => {
    // 知识库可能因草稿未保存而阻止离开；取消导航时不能打开原生店铺页覆盖编辑器。
    const navigation = await router.push('/')
    if (isNavigationFailure(navigation) && route.path !== '/') return
    if (route.path !== '/' || workspace !== runtime.snapshot.workspaceId) return
    runtime.selectedStoreId = shop.id
    await runtime.run({ action: 'open-store', storeId: shop.id })
    if (
      workspace !== runtime.snapshot.workspaceId ||
      runtime.selectedStoreId !== shop.id ||
      !runtime.snapshot.stores.some((item) => item.id === shop.id)
    )
      return
    if (route.path !== '/') {
      await runtime.presentStore(shop.id, false)
      return
    }
    if (workspace !== runtime.snapshot.workspaceId || runtime.selectedStoreId !== shop.id) return
    runtime.platformStoreId = shop.id
    await runtime.presentStore(
      shop.id,
      !setup.visible && !addShopVisible.value && !quickReplyVisible.value && !loginVisible.value,
    )
  })
}
async function closeShop(shop: LocalStore) {
  if (setup.storeId === shop.id) setup.dismiss()
  const workspace = runtime.snapshot.workspaceId
  await task.run(async () => {
    await runtime.run({ action: 'close-store', storeId: shop.id })
    if (workspace === runtime.snapshot.workspaceId && runtime.platformStoreId === shop.id)
      runtime.platformStoreId = ''
  })
}
async function setAi(shop: LocalStore) {
  await task.run(async () => {
    const r = await runtime.run({
      action: 'set-ai',
      storeId: shop.id,
      values: {
        enabled: !(
          shop.aiEnabled ||
          (shop.aiRestore?.desiredEnabled &&
            ['waiting', 'restoring'].includes(shop.aiRestore.status))
        ),
      },
    })
    task.message.value = r.message
  })
}
async function openLogs() {
  await task.run(async () => {
    await runtime.run({ action: 'open-reply-monitor' })
  })
}
async function openRecharge() {
  await router.push('/shop/recharge')
}
async function setSendMode(shop: LocalStore, mode: 'review' | 'auto') {
  await task.run(async () => {
    const result = await runtime.run({
      action: 'set-store-send-mode',
      values: { storeId: shop.id, mode },
    })
    task.message.value = result.message
  })
}
async function openBackend(shop: LocalStore) {
  await task.run(async () => {
    const result = await runtime.run({ action: 'open-store-backend', storeId: shop.id })
    task.message.value = result.message
  })
}
async function navigate(path: string) {
  if (setup.visible) {
    if (path === '/') setup.dismiss()
    else setup.pauseForConfiguration()
  }
  if (path !== '/float/assist' || !desktop.isElectron) {
    await router.push(path)
    return
  }
  await task.run(async () => {
    if (!desktop.openAssist) throw new Error('辅助中心窗口尚未接入，请更新桌面程序')
    await desktop.openAssist()
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
          @click="navigate(item.path)"
        >
          <el-icon class="nav-icon"><component :is="item.icon" /></el-icon
          ><span>{{ item.label }}</span>
        </button>
      </nav>
      <div class="titlebar-drag-region" aria-hidden="true"></div>
      <div class="top-actions">
        <button class="top-pill login-trigger" @click="loginVisible = true">
          {{
            runtime.snapshot.managed.active.mode === 'managed' &&
            runtime.snapshot.managed.session.status === 'signed_in'
              ? runtime.snapshot.managed.session.account?.displayName || '已登录'
              : runtime.snapshot.capabilities.modelMode === 'local' &&
                  runtime.snapshot.capabilities.apiKeyConfigured
                ? '自己的 Key'
                : '登录'
          }}</button
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
        <label
          v-if="runtime.platformStoreId"
          data-no-drag
          style="display: flex; align-items: center; gap: 4px; font-size: 12px"
        >
          网页缩放
          <select
            aria-label="平台网页缩放"
            :value="zoomPercent"
            :disabled="task.pending.value"
            @change="changeZoom"
          >
            <option
              v-for="percent in [75, 100, 125, 150, 175, 200]"
              :key="percent"
              :value="percent"
            >
              {{ percent }}%{{ percent === 100 ? '（原始）' : '' }}
            </option>
          </select>
        </label>
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
      <aside
        v-show="!isConfiguration"
        :class="['store-sidebar my-platform', { 'is-collapsed': sidebarCollapsed }]"
      >
        <el-alert
          v-if="runtime.snapshot.modelIssue"
          :title="runtime.snapshot.modelIssue.message"
          type="error"
          :closable="false"
          @click="loginVisible = true"
        />
        <el-alert
          v-if="task.error.value || runtime.error"
          :title="task.error.value || runtime.error"
          type="error"
          :closable="true"
          @close="task.error.value = ''"
        />
        <el-alert
          v-if="task.message.value"
          :title="task.message.value"
          type="success"
          show-icon
          @close="task.message.value = ''"
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
          <StoreSidebarCard
            v-for="shop in shops"
            :key="shop.id"
            :shop="shop"
            :selected="runtime.platformStoreId === shop.id"
            :busy="task.pending.value"
            @open="openShop(shop)"
            @toggle-ai="setAi(shop)"
            @send-mode="setSendMode(shop, $event)"
            @setup="setup.open(shop.id)"
            @import-knowledge="task.run(() => openKnowledgeManager(shop.id))"
            @settings="notifyUnavailable('店铺设置入口已预留，功能暂未接入')"
            @backend="openBackend(shop)"
            @close="closeShop(shop)"
          />
        </div>
        <button
          class="sidebar-collapse"
          :disabled="Boolean(runtime.platformStoreId) || setup.visible"
          :aria-expanded="!sidebarCollapsed"
          title="折叠或展开店铺栏"
          @click="sidebarCollapsed = !sidebarCollapsed"
        >
          {{ sidebarCollapsed ? '›' : '‹' }}
        </button>
        <SidebarFooter
          :account="sidebarBalance"
          :pending-count="pendingReplyCount"
          :monitor-busy="task.pending.value"
          @quick-reply="quickReplyVisible = true"
          @reply-monitor="openLogs"
          @contact="contactVisible = true"
          @login="loginVisible = true"
          @recharge="openRecharge"
        />
      </aside>
      <main class="workbench-main" :inert="setup.visible">
        <router-view v-slot="{ Component }">
          <component
            v-if="isConfiguration"
            :is="Component"
            @quick-reply="quickReplyVisible = true"
            @contact="contactVisible = true"
            @login="loginVisible = true"
            @recharge="openRecharge"
          />
          <component :is="Component" v-else />
        </router-view>
      </main>
    </div>
    <LoginDialog v-model="loginVisible" />
    <AddShopDialog v-model="addShopVisible" /><QuickReplyDialog v-model="quickReplyVisible" />
    <ContactQrDialog v-model="contactVisible" />
  </div>
</template>
<style scoped>
/* 低窗口优先保证店铺列表可滚动，footer 在自身高度内滚动而不是压住列表。 */
.store-list {
  min-height: 64px;
}
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
</style>

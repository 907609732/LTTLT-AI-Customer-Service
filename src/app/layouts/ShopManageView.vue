<!--
  配置中心（源码级还原）
  原始实现：Vue3 + Element Plus，左侧功能导航 + 右侧动态面板。
  页面按注册面板导航，业务动作由领域模块服务处理。
-->
<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useShopSetupStore } from '@/modules/shops'
import { openKnowledgeManager } from '@/modules/knowledge'
import { useRuntimeStore } from '@/shared/state/runtime'
import { useRoute, useRouter } from 'vue-router'
import SidebarFooter from '@/app/components/SidebarFooter.vue'
import { useSidebarBalance } from '@/app/sidebar-footer'
import { useTask } from '@/shared/ui/use-task'
import {
  navGroups,
  panelRegistry,
  resolvePanelKey,
  type PanelKey,
  type NavItem,
} from '../navigation'
const router = useRouter(),
  route = useRoute()
const setup = useShopSetupStore()
const runtime = useRuntimeStore()
const task = useTask()
const sidebarBalance = useSidebarBalance()
const pendingReplyCount = computed(
  () => runtime.snapshot.review.replies.filter((reply) => reply.status === 'pending').length,
)
// 认证、快捷回复和支付仍由工作台父层唯一持有；配置页只转发事件。
const emit = defineEmits<{
  login: []
  recharge: []
  contact: []
  'quick-reply': []
}>()
// 兼容旧收藏和看板入口，接待配置只保留店铺设置向导。
watch(
  [() => route.query.panel, () => runtime.selectedStoreId],
  ([panel, storeId]) => {
    if (panel !== 'transfer' && panel !== 'welcome') return
    if (!runtime.snapshot.stores.some((shop) => shop.id === storeId)) return
    setup.open(storeId)
    setup.step = 3
    void router.replace('/')
  },
  { immediate: true },
)
async function openLegacyTraining() {
  const requestedPanel = route.query.panel
  // A bookmarked route can mount before the first desktop snapshot arrives.
  await runtime.refresh()
  if (route.query.panel !== requestedPanel) return
  const storeId = runtime.selectedStoreId,
    { source: _source, ...rest } = route.query
  void _source
  await router.replace({ query: { ...rest, panel: 'shops' } })
  await task.run(async () => {
    if (!storeId || !runtime.snapshot.stores.some((shop) => shop.id === storeId))
      throw Error('请先选择店铺，再从知识库打开 AI训练场')
    await openKnowledgeManager(storeId, { tab: 'training' })
  })
}
// 训练场已迁入知识库：旧收藏地址先离开废弃面板，再打开当前店铺的知识库训练 tab。
watch(
  () => route.query.panel,
  (panel) => {
    if (panel === 'training' || panel === 'sim') void openLegacyTraining()
  },
  { immediate: true },
)
const activeKey = computed(() => resolvePanelKey(route.query.panel))
const expanded = ref<Partial<Record<PanelKey, boolean>>>({ shops: true, intent: true })
const crumb = computed(() => panelRegistry[activeKey.value].title)
const currentPanel = computed(() => panelRegistry[activeKey.value].component)
const isNavOn = (key: PanelKey) =>
  key === activeKey.value || (key === 'shops' && ['goods', 'desk'].includes(activeKey.value))
const isChildActive = (item: NavItem) =>
  item.children?.some((child) => child.key === activeKey.value) ?? false
function toggle(key: PanelKey) {
  expanded.value[key] = !expanded.value[key]
}
function select(key: PanelKey) {
  const { source: _source, ...rest } = route.query
  void _source
  void router.replace({
    query: { ...rest, panel: key, ...(key === 'intent-chat' ? { source: 'chats' } : {}) },
  })
}
async function openMonitor() {
  await task.run(async () => {
    await runtime.run({ action: 'open-reply-monitor' })
  })
}
</script>

<template>
  <div class="shop-manage" data-v-105c9fec="">
    <div class="app" data-v-105c9fec="">
      <div class="shell" data-v-105c9fec="">
        <aside class="sider" aria-label="功能导航" data-v-105c9fec="">
          <div class="sider__heading" data-v-105c9fec="">功能列表</div>
          <nav class="sider__nav" data-v-105c9fec="">
            <template v-for="(group, gi) in navGroups" :key="group.label">
              <div
                class="sider__group"
                :class="{ 'sider__group--first': gi === 0 }"
                data-v-105c9fec=""
              >
                {{ group.label }}
              </div>
              <template v-for="item in group.items" :key="item.key">
                <div
                  v-if="item.children && item.children.length"
                  class="sider-fold"
                  data-v-105c9fec=""
                >
                  <div
                    class="sider-fold__row"
                    :class="{ 'is-on': isNavOn(item.key), 'is-in': isChildActive(item) }"
                    data-v-105c9fec=""
                  >
                    <button
                      type="button"
                      class="sider-fold__main"
                      @click="select(item.key)"
                      data-v-105c9fec=""
                    >
                      {{ item.title }}
                    </button>
                    <span
                      class="sider-fold__caret"
                      :class="{ 'is-open': expanded[item.key] }"
                      role="button"
                      tabindex="0"
                      :aria-expanded="expanded[item.key] ? 'true' : 'false'"
                      @click="toggle(item.key)"
                      data-v-105c9fec=""
                    >
                      ▾
                    </span>
                  </div>
                  <div v-show="expanded[item.key]" class="sider-fold__kids" data-v-105c9fec="">
                    <button
                      v-for="child in item.children"
                      :key="child.key"
                      type="button"
                      class="sider-fold__child"
                      :class="{ 'is-on': activeKey === child.key }"
                      @click="select(child.key)"
                      data-v-105c9fec=""
                    >
                      {{ child.title }}
                    </button>
                  </div>
                </div>
                <button
                  v-else
                  :key="item.key"
                  type="button"
                  :class="{ 'is-on': isNavOn(item.key) }"
                  @click="select(item.key)"
                  data-v-105c9fec=""
                >
                  {{ item.title }}
                </button>
              </template>
            </template>
          </nav>
          <SidebarFooter
            :account="sidebarBalance"
            :pending-count="pendingReplyCount"
            :monitor-busy="task.pending.value"
            :monitor-error="task.error.value"
            @quick-reply="emit('quick-reply')"
            @reply-monitor="openMonitor"
            @contact="emit('contact')"
            @login="emit('login')"
            @recharge="emit('recharge')"
          />
        </aside>

        <main class="main" data-v-105c9fec="">
          <div
            class="crumb-bar"
            data-v-105c9fec=""
            style="display: flex; align-items: center; justify-content: space-between"
          >
            <div
              v-if="activeKey !== 'goods' && activeKey !== 'desk'"
              class="crumb"
              data-v-105c9fec=""
            >
              {{ crumb }}
            </div>
            <button
              v-if="activeKey === 'goods' || activeKey === 'desk'"
              class="btn-site goods-back"
              style="margin-left: auto"
              data-no-drag
              type="button"
              @click="select('shops')"
            >
              ← 返回店铺列表
            </button>
          </div>
          <div class="shop-main-panel-host is-active" data-v-105c9fec="">
            <component
              :is="currentPanel"
              :key="activeKey"
              :view-key="activeKey"
              :source-key="route.query.source"
              @return-products="select('goods')"
              class="shop-main-panel"
            />
          </div>
        </main>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* 配置中心复用工作台标题栏，只占用其下方的可用内容高度。 */
.shop-manage[data-v-105c9fec] {
  height: 100%;
  min-height: 0;
}
.shop-manage .app {
  grid-template-rows: minmax(0, 1fr);
}
.shop-manage .sider {
  /* 菜单独占剩余高度；footer 自身有界滚动，低窗口下不挤压菜单和关键按钮。 */
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto;
}
.sider__nav {
  min-height: 0;
}
</style>

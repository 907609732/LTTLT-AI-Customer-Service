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
import AppVersion from '@/shared/ui/AppVersion.vue'
import UpdateStatus from '@/shared/ui/UpdateStatus.vue'
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
          <div class="sider__monitor">
            <button
              type="button"
              class="sider__monitor-button"
              aria-label="回复监控"
              :disabled="task.pending.value"
              @click="openMonitor"
            >
              回复监控<span
                v-if="runtime.snapshot.review.replies.some((r) => r.status === 'pending')"
              >
                ·
                {{ runtime.snapshot.review.replies.filter((r) => r.status === 'pending').length }}
                待确认</span
              >
            </button>
            <p v-if="task.error.value" class="sider__monitor-error" role="alert">
              {{ task.error.value }}
            </p>
          </div>
          <UpdateStatus />
          <AppVersion />
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
  /* 菜单独占剩余高度，底部入口按内容占高，避免子组件的 flex-basis 挤掉菜单。 */
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto auto auto;
}
.sider__nav {
  min-height: 0;
}

.sider__monitor {
  margin-top: 0;
  padding: 8px 12px 0;
  border-top: 1px solid #edf0f4;
}
.sider__monitor-button {
  width: 100%;
  border: 1px solid #dfe6ef;
  border-radius: 5px;
  padding: 6px 8px;
  background: #fff;
  color: #56657a;
  font-size: 12px;
  text-align: left;
  cursor: pointer;
}
.sider__monitor-button:disabled {
  opacity: 0.5;
  cursor: wait;
}
.sider__monitor-error {
  margin: 5px 0 0;
  color: #c65746;
  font-size: 11px;
}
</style>

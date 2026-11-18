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
import BrandMark from '@/shared/ui/BrandMark.vue'
import AppVersion from '@/shared/ui/AppVersion.vue'
import { notifyUnavailable } from '@/shared/ui/feedback'
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
const __stub = notifyUnavailable
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
function goHome() {
  void router.push('/')
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
      <header class="topbar" data-window-drag data-v-105c9fec="">
        <div class="brand-block" data-v-105c9fec="">
          <BrandMark size="md" data-v-105c9fec="" />
        </div>
        <div class="topbar-center" data-v-105c9fec="">
          <div class="topbar-title" role="heading" aria-level="1" data-v-105c9fec="">
            <strong data-v-105c9fec="">客服系统配置中心</strong>
            <em data-v-105c9fec="">{{ crumb }}</em>
          </div>
        </div>
        <div class="top-actions" data-v-105c9fec="">
          <button class="btn-site" type="button" data-nav @click="goHome">返回工作台</button>
          <button
            class="btn-site"
            type="button"
            v-if="activeKey !== 'goods' && activeKey !== 'desk'"
            @click="router.push('/shop/manage?panel=intent-doc&source=products')"
          >
            商品自动学习
          </button>
          <div class="top-actions__billing" data-v-105c9fec="">
            <button
              class="btn-site"
              type="button"
              @click="__stub('灵兔AI电商客服 官网')"
              data-v-105c9fec=""
            >
              灵兔AI电商客服 官网
            </button>
          </div>
        </div>
      </header>

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
.sider__monitor {
  margin-top: auto;
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

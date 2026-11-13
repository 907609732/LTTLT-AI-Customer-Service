<!--
  配置中心（源码级还原）
  原始实现：Vue3 + Element Plus，左侧功能导航 + 右侧动态面板。
  本工程只还原界面与导航；所有业务动作统一提示「暂未接入」。
-->
<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import BrandMark from '@/shared/ui/BrandMark.vue'
import { notifyUnavailable } from '@/shared/ui/feedback'
import { navGroups, panelRegistry, isPanelKey, type PanelKey, type NavItem } from '../navigation'
const router = useRouter(),
  route = useRoute()
const __stub = notifyUnavailable
const activeKey = computed(() => (isPanelKey(route.query.panel) ? route.query.panel : 'shops'))
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
  void router.replace({ query: { ...route.query, panel: key } })
}
function goHome() {
  void router.push('/')
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
          <button class="btn-site" type="button" @click="__stub('商品自动学习')">
            商品自动学习
          </button>
          <div class="top-actions__billing" data-v-105c9fec="">
            <button
              class="btn-site"
              type="button"
              @click="__stub('灵兔 AI 官网')"
              data-v-105c9fec=""
            >
              灵兔 AI 官网
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
          <div class="sider__foot" data-v-105c9fec="">
            <button
              class="sider-recharge"
              type="button"
              title="打开充值选购"
              data-nav
              @click="router.push('/shop/recharge')"
              data-v-105c9fec=""
            >
              充值
            </button>
            <button
              class="sider-cs"
              type="button"
              title="联系客服"
              @click="__stub('联系客服')"
              data-v-105c9fec=""
            >
              <span class="sider-cs__text" data-v-105c9fec="">
                <strong data-v-105c9fec="">联系客服</strong>
                <em data-v-105c9fec="">微信 yunduo-kf</em>
              </span>
            </button>
          </div>
        </aside>

        <main class="main" data-v-105c9fec="">
          <div class="crumb-bar" data-v-105c9fec="">
            <div class="crumb" data-v-105c9fec="">{{ crumb }}</div>
          </div>
          <div class="shop-main-panel-host is-active" data-v-105c9fec="">
            <component
              :is="currentPanel"
              :key="activeKey"
              :view-key="activeKey"
              class="shop-main-panel"
            />
          </div>
        </main>
      </div>
    </div>
  </div>
</template>

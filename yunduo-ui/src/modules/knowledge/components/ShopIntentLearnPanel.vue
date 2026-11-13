<!-- ShopIntentLearnPanel：保留还原样式标记，业务能力由模块服务逐步接入。 -->
<script setup lang="ts">
import { computed } from 'vue'
import { createShopIntentLearnPanelDemo } from '@/modules/knowledge/demo/ShopIntentLearnPanel'
const demo = createShopIntentLearnPanelDemo()
interface Props {
  viewKey?: string
}
const props = withDefaults(defineProps<Props>(), { viewKey: '' })
const shopHomePanel = computed(() => demo.shopHomePanel)
</script>

<template>
  <section class="shop-home-panel view is-on">
    <div class="page-head">
      <div>
        <h1>{{ shopHomePanel?.title }}</h1>
        <p>{{ shopHomePanel?.desc }}</p>
      </div>
    </div>
    <div class="dash-wip">
      <div class="dash-wip__badge">暂未上线</div>
      <strong></strong>
      <p>这项还不能使用，上线后才能在这里设置。</p>
    </div>
  </section>
</template>

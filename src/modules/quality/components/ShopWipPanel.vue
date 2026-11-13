<!-- ShopWipPanel：保留还原样式标记，业务能力由模块服务逐步接入。 -->
<script setup lang="ts">
import { computed } from 'vue'
import { createShopWipPanelDemo } from '@/modules/quality/demo/ShopWipPanel'
const demo = createShopWipPanelDemo()
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
        <p>{{ shopHomePanel?.subtitle }}</p>
      </div>
    </div>
    <div class="dash-wip">
      <div class="dash-wip__badge">开发中</div>
      <strong>{{ shopHomePanel?.headline }}</strong>
      <p>{{ shopHomePanel?.desc }}</p>
    </div>
  </section>
</template>

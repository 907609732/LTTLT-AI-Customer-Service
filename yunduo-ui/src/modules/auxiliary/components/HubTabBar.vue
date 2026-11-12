<!-- HubTabBar：保留还原样式标记，业务能力由模块服务逐步接入。 -->
<script setup lang="ts">
import { notifyUnavailable } from '@/shared/ui/feedback'
import { ref, computed } from 'vue'
import { createHubTabBarDemo } from '@/modules/auxiliary/demo/HubTabBar'
const demo = createHubTabBarDemo()
interface Props {
  tabs?: Array<string>
  activeId?: string
  openingAll?: boolean
}
const props = withDefaults(defineProps<Props>(), {
  tabs: () => [],
  activeId: '',
  openingAll: false,
})
const __stub = notifyUnavailable
const rows = computed(() => demo.rows)
const isModelValue = ref(demo.isModelValue)
const hubLevelHubLevel_2Items = computed(() => demo.hubLevelHubLevel_2Items)
const inputValue = ref(demo.modelValue)
const hubLevelHubLevel_3Items = computed(() => demo.hubLevelHubLevel_3Items)
const modelValueState = ref(demo.modelValueState)
</script>

<template>
  <header class="hub-bar">
    <div class="hub-level hub-level-1">
      <el-tabs :model-value="isModelValue" @update:modelValue="__stub('此操作')" class="hub-tabs"
        ><template :key="entryIndex" v-for="(item, entryIndex) in rows"
          ><el-tab-pane :name="item?.['id']" :label="item?.['name']"></el-tab-pane></template
      ></el-tabs>
      <div class="hub-level-1-actions">
        <button
          type="button"
          class="hub-open-all"
          :disabled="props?.['openingAll']"
          title="打开所有平台当前在线店铺的商家后台"
          @click="__stub('此操作')"
        >
          {{ props?.['openingAll'] ? '正在打开…' : '一键打开所有店铺后台' }}
        </button>
      </div>
    </div>
    <div v-show="hubLevelHubLevel_2Items?.['length']" class="hub-level hub-level-2">
      <el-tabs
        :model-value="inputValue"
        @update:modelValue="__stub('此操作')"
        class="hub-tabs"
        closable=""
        @tabRemove="__stub('此操作')"
        ><template :key="entryIndex" v-for="(item, entryIndex) in hubLevelHubLevel_2Items"
          ><el-tab-pane :name="item?.['id']" :label="item?.['name']"></el-tab-pane></template
      ></el-tabs>
    </div>
    <div v-show="hubLevelHubLevel_3Items?.['length']" class="hub-level hub-level-3">
      <el-tabs
        :model-value="modelValueState"
        @update:modelValue="__stub('此操作')"
        type="card"
        class="hub-tabs hub-tabs-pages"
        closable=""
        @tabRemove="__stub('此操作')"
        ><template :key="entryIndex" v-for="(item, entryIndex) in hubLevelHubLevel_3Items"
          ><el-tab-pane
            :name="item?.['id']"
            :label="item?.['title'] || '未命名'"
          ></el-tab-pane></template
      ></el-tabs>
    </div>
  </header>
</template>

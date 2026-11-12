<!-- UsagePanel：保留还原样式标记，业务能力由模块服务逐步接入。 -->
<script setup lang="ts">
import { notifyUnavailable } from '@/shared/ui/feedback'
import { ref, computed } from 'vue'
import { createUsagePanelDemo } from '@/modules/billing/demo/UsagePanel'
const demo = createUsagePanelDemo()

const __stub = notifyUnavailable
const asset_Pu = ''
const inputValue = ref(demo.modelValue)
const modelValueState = ref(demo.modelValueState)
const currentPage = ref(demo.currentPage)
const pageSize = ref(demo.pageSize)
const total = ref(demo.total)
const dataItems = ref(demo.dataItems)
const elTable = ref(demo.elTable)
const isTemplate = ref(demo.isTemplate)
const rows = computed(() => demo.rows)
</script>

<template>
  <div class="usage-panel" data-v-a08d080e="">
    <div class="page-head" data-v-a08d080e="">
      <div data-v-a08d080e="">
        <h1 data-v-a08d080e="">算力消耗</h1>
        <p data-v-a08d080e="">按小时汇总各店铺 AI 调用消耗</p>
      </div>
      <el-button @click="__stub('此操作')" data-v-a08d080e="">刷新</el-button>
    </div>
    <div class="card" data-v-a08d080e="">
      <div class="filters" data-v-a08d080e="">
        <span class="label" data-v-a08d080e="">按小时统计</span
        ><el-select
          :model-value="inputValue"
          @update:modelValue="__stub('此操作')"
          :style="{ width: '160px' }"
          data-v-a08d080e=""
          ><template :key="entryIndex" v-for="(item, entryIndex) in rows"
            ><el-option
              :label="item?.label"
              :value="item"
              data-v-a08d080e=""
            ></el-option></template></el-select
        ><el-select
          :model-value="modelValueState"
          @update:modelValue="__stub('此操作')"
          :style="{ width: '130px' }"
          data-v-a08d080e=""
          ><el-option label="全部平台" value="all" data-v-a08d080e=""></el-option
          ><template :key="entryIndex" v-for="(item, entryIndex) in asset_Pu"
            ><el-option
              :label="item"
              :value="item"
              data-v-a08d080e=""
            ></el-option></template></el-select
        ><el-select :model-value="'0'" :style="{ width: '140px' }" data-v-a08d080e=""
          ><el-option label="店铺回复" value="0" data-v-a08d080e=""></el-option></el-select
        ><template v-if="isTemplate"
          ><el-tag type="warning" size="small" effect="plain" data-v-a08d080e=""
            >演示数据</el-tag
          ></template
        >
      </div>
      <el-table
        v-show="elTable"
        :data="dataItems"
        stripe=""
        empty-text="暂无算力消耗记录"
        data-v-a08d080e=""
        ><el-table-column prop="hour" label="小时" width="80" data-v-a08d080e=""></el-table-column
        ><el-table-column
          prop="shop"
          label="店铺"
          min-width="140"
          show-overflow-tooltip=""
          data-v-a08d080e=""
        ></el-table-column
        ><el-table-column prop="plat" label="平台" width="100" data-v-a08d080e=""></el-table-column
        ><el-table-column
          prop="type"
          label="日志类型"
          width="120"
          data-v-a08d080e=""
        ></el-table-column
        ><el-table-column label="算力消耗条数" width="130" data-v-a08d080e=""
          ><span class="power" data-v-a08d080e=""></span></el-table-column
        ><el-table-column
          prop="range"
          label="统计时段"
          min-width="180"
          show-overflow-tooltip=""
          data-v-a08d080e=""
        ></el-table-column
      ></el-table>
      <div class="pager" data-v-a08d080e="">
        <el-pagination
          :current-page="currentPage"
          @update:currentPage="__stub('此操作')"
          :page-size="pageSize"
          @update:pageSize="__stub('此操作')"
          background=""
          layout="total, sizes, prev, pager, next"
          :total="total"
          :page-sizes="[10, 20, 50]"
          @currentChange="__stub('此操作')"
          @sizeChange="__stub('此操作')"
          data-v-a08d080e=""
        ></el-pagination>
      </div>
    </div>
  </div>
</template>

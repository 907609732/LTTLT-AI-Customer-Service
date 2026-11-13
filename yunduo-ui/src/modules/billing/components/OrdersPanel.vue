<!-- OrdersPanel：保留还原样式标记，业务能力由模块服务逐步接入。 -->
<script setup lang="ts">
import { notifyUnavailable } from '@/shared/ui/feedback'
import { ref, computed } from 'vue'
import { createOrdersPanelDemo } from '@/modules/billing/demo/OrdersPanel'
const demo = createOrdersPanelDemo()

const __stub = notifyUnavailable
const em = ref(demo.em)
const isLoading = ref(demo.isLoading)
const card = ref(demo.card)
const currentPage = ref(demo.currentPage)
const pageSize = ref(demo.pageSize)
const summaryItem = computed(() => demo.summaryItem)
const summary = computed(() => demo.summary)
const total = computed(() => demo.total)
const data = computed(() => demo.data)
const id = ref(demo.id)
</script>

<template>
  <div class="orders-panel" data-v-d2122d6b="">
    <div class="page-head" data-v-d2122d6b="">
      <div data-v-d2122d6b="">
        <h1 data-v-d2122d6b="">我的订单</h1>
        <p data-v-d2122d6b="">套餐购买与支付记录</p>
      </div>
      <el-button type="primary" @click="__stub('此操作')" data-v-d2122d6b="">去充值</el-button>
    </div>
    <div class="summary card" data-v-d2122d6b="">
      <div class="summary-item" data-v-d2122d6b="">
        <em data-v-d2122d6b="">当前套餐</em><strong data-v-d2122d6b="">{{ summary }}</strong>
      </div>
      <div class="summary-item" data-v-d2122d6b="">
        <em data-v-d2122d6b="">剩余算力</em
        ><strong class="em" data-v-d2122d6b="">{{ summaryItem }}</strong>
      </div>
      <div class="summary-item" data-v-d2122d6b="">
        <em data-v-d2122d6b="">到期</em><strong data-v-d2122d6b="">{{ em?.expireAt }}</strong>
      </div>
      <div class="summary-item summary-item--act" data-v-d2122d6b="">
        <el-button type="primary" size="small" @click="__stub('此操作')" data-v-d2122d6b=""
          >去充值</el-button
        >
      </div>
    </div>
    <div class="card table-card" data-v-d2122d6b="">
      <div class="table-toolbar" data-v-d2122d6b="">
        <p class="tip" data-v-d2122d6b="">{{ card || '展示当前登录账号的套餐订单。' }}</p>
        <el-button
          text=""
          type="primary"
          :loading="isLoading"
          @click="__stub('此操作')"
          data-v-d2122d6b=""
          >刷新</el-button
        >
      </div>
      <el-table
        v-show="isLoading"
        :data="data"
        stripe=""
        empty-text="暂无订单"
        height="420"
        :style="{ width: '100%' }"
        table-layout="fixed"
        data-v-d2122d6b=""
        ><el-table-column
          prop="id"
          label="订单号"
          min-width="130"
          show-overflow-tooltip=""
          data-v-d2122d6b=""
        ></el-table-column
        ><el-table-column
          prop="packageName"
          label="套餐名称"
          min-width="110"
          show-overflow-tooltip=""
          data-v-d2122d6b=""
        ></el-table-column
        ><el-table-column
          prop="power"
          label="购买算力"
          width="110"
          data-v-d2122d6b=""
        ></el-table-column
        ><el-table-column
          prop="amount"
          label="金额"
          width="100"
          data-v-d2122d6b=""
        ></el-table-column
        ><el-table-column prop="status" label="订单状态" width="100" data-v-d2122d6b=""
          ><el-tag size="small" data-v-d2122d6b="">{{ id?.status }}</el-tag></el-table-column
        ><el-table-column
          prop="createdAt"
          label="下单时间"
          width="168"
          show-overflow-tooltip=""
          data-v-d2122d6b=""
        ></el-table-column
        ><el-table-column
          prop="paidAt"
          label="支付时间"
          width="168"
          show-overflow-tooltip=""
          data-v-d2122d6b=""
        ></el-table-column
        ><el-table-column
          prop="expireAt"
          label="到期时间"
          width="120"
          show-overflow-tooltip=""
          data-v-d2122d6b=""
        ></el-table-column
      ></el-table>
      <div class="pager" data-v-d2122d6b="">
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
          data-v-d2122d6b=""
        ></el-pagination>
      </div>
    </div>
  </div>
</template>

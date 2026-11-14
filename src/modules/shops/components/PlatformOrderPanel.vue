<script setup lang="ts">
import RuntimePanel from '@/shared/ui/RuntimePanel.vue'
import StoreSelect from '@/shared/ui/StoreSelect.vue'
import { usePlatformOrders } from '../platform-orders'
defineEmits<{ back: [] }>()
const orders = usePlatformOrders()
const {
  runtime,
  transport,
  state,
  report,
  summary,
  rows,
  from,
  to,
  page,
  error,
  busy,
  reading,
  importConfirmed,
} = orders
const money = (cents: number | null | undefined) =>
  cents === null || cents === undefined ? '—' : `¥${(cents / 100).toFixed(2)}`
const date = (value: number | null | undefined) =>
  value
    ? new Intl.DateTimeFormat('zh-CN', {
        timeZone: 'Asia/Shanghai',
        dateStyle: 'short',
        timeStyle: 'medium',
      }).format(new Date(value))
    : '—'
function selectFile(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (file) void orders.importFile(file)
  input.value = ''
}
</script>
<template>
  <RuntimePanel
    title="平台订单"
    description="按原平台声明的查询范围核对订单，软件充值订单单独保留。金额为平台页面实收，不等于净营收。"
    :error="error"
  >
    <template #actions
      ><el-button data-order-back @click="$emit('back')">返回接待概况</el-button></template
    >
    <el-alert
      v-if="!transport"
      title="平台订单服务尚未连接，请使用已接通的桌面版。"
      type="info"
      :closable="false"
    />
    <div class="runtime-form order-tools">
      <StoreSelect :disabled="busy || reading" />
      <label
        >起始日期（北京时间）<input
          v-model="from"
          type="date"
          aria-label="订单起始日期"
          :disabled="busy || reading"
      /></label>
      <label
        >截止日期<input
          v-model="to"
          type="date"
          aria-label="订单截止日期"
          :disabled="busy || reading"
      /></label>
      <el-button
        type="primary"
        :disabled="!transport || !runtime.selectedStoreId || reading"
        :loading="busy"
        @click="orders.action('read')"
        >读取所选范围</el-button
      >
      <el-button v-if="reading" :loading="busy" @click="orders.action('cancel')"
        >停止采集</el-button
      >
      <el-button :disabled="!report || busy || reading" @click="orders.exportReport"
        >导出订单与范围</el-button
      >
    </div>
    <p class="order-scope">
      范围：{{ report?.range.from || from }} ～ {{ report?.range.to || to }} · 北京时间 ·
      全部订单及售后状态 · 按{{ report?.range.timeField === 'paid' ? '付款' : '下单' }}时间
    </p>
    <el-alert
      v-if="state?.task?.error"
      :title="state.task.error"
      :type="state.task.state === 'failed' ? 'error' : 'warning'"
      :closable="false"
    />
    <div class="order-scope" role="status">
      <template v-if="reading"
        >采集中：已读取 {{ state?.task?.pages }} 页 /
        {{ state?.task?.records }} 条；尚未发布完整结果。</template
      >
      <template v-else-if="report"
        >{{ report.complete ? '所选范围采集完整' : '已导入记录，平台完整性尚未核实' }} · 已读取
        {{ report.pages }} 页 / {{ report.records.length }} 条 ·
        {{ report.total === null ? '平台总数未知' : `平台总数 ${report.total}` }} ·
        {{ date(report.capturedAt) }}</template
      >
      <template v-else>尚未读取，未知值不显示为零。</template>
    </div>
    <p v-if="report && state?.task?.state === 'failed'" class="order-old">
      下方保留上一次成功结果，其日期范围与时间以上方报告为准；本次失败未覆盖旧报表。
    </p>
    <div class="order-metrics">
      <div>
        <span>{{ report?.complete ? '范围订单数' : '已读取订单数' }}</span
        ><strong>{{ summary?.orders ?? '—' }}</strong>
      </div>
      <div>
        <span>平台实收合计</span><strong>{{ money(summary?.receivedCents) }}</strong>
      </div>
      <div>
        <span>已核实退款</span><strong>{{ money(summary?.refundedCents) }}</strong>
      </div>
    </div>
    <p class="order-note">
      {{
        report?.receivedLabel || '原平台实收金额'
      }}按整数分汇总；退款金额未在来源提供时保留未知，不能按零计算或据此推断净营收。原生查询最多90个自然日，一次采集最多200页/10000条；超限请缩小范围。
    </p>
    <div class="order-table">
      <el-table :data="rows" empty-text="暂无可展示记录；请先核对采集状态与范围">
        <el-table-column prop="id" label="平台订单号" min-width="210" />
        <el-table-column prop="title" label="商品" min-width="200" show-overflow-tooltip />
        <el-table-column prop="rawStatus" label="原平台状态" min-width="140" />
        <el-table-column prop="quantity" label="数量" width="70" />
        <el-table-column label="实收" min-width="100"
          ><template #default="scope">{{
            money(scope.row.receivedCents)
          }}</template></el-table-column
        >
        <el-table-column label="退款" min-width="100"
          ><template #default="scope">{{
            money(scope.row.refundedCents)
          }}</template></el-table-column
        >
        <el-table-column label="下单时间" min-width="170"
          ><template #default="scope">{{ date(scope.row.createdAt) }}</template></el-table-column
        >
        <el-table-column label="付款时间" min-width="170"
          ><template #default="scope">{{ date(scope.row.paidAt) }}</template></el-table-column
        >
      </el-table>
    </div>
    <el-pagination
      v-if="report"
      v-model:current-page="page"
      :page-size="50"
      :total="report.records.length"
      layout="prev, pager, next, total"
    />
    <section class="runtime-card order-import">
      <h2>导入平台导出CSV</h2>
      <p>
        文件须包含订单号、商品名称、订单状态、商品数量、商品总价、实收金额及下单时间；可选付款时间和退款金额。导入只代表文件内记录，未核对平台总数时不标记全量。
      </p>
      <el-checkbox v-model="importConfirmed" :disabled="busy || reading"
        >我已核对当前店铺及上方日期范围，文件不混入其他店铺</el-checkbox
      >
      <input
        type="file"
        accept=".csv,text/csv"
        aria-label="导入订单CSV"
        :disabled="!transport || !importConfirmed || busy || reading"
        @change="selectFile"
      />
    </section>
  </RuntimePanel>
</template>
<style scoped>
.order-tools {
  display: flex;
  align-items: end;
  gap: 12px;
  flex-wrap: wrap;
}
.order-tools label {
  display: grid;
  gap: 6px;
}
.order-tools input {
  min-height: 32px;
  border: 1px solid var(--el-border-color);
  border-radius: 6px;
  padding: 4px 8px;
}
.order-scope,
.order-note,
.order-old {
  line-height: 1.7;
  overflow-wrap: anywhere;
}
.order-scope {
  margin: 16px 0;
  color: var(--el-text-color-regular);
}
.order-old {
  color: var(--el-color-warning);
}
.order-note {
  font-size: 12px;
  color: var(--el-text-color-secondary);
}
.order-metrics {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 16px;
  margin: 18px 0;
}
.order-metrics > div {
  display: grid;
  gap: 8px;
  padding: 18px;
  border: 1px solid var(--el-border-color);
  border-radius: 12px;
}
.order-metrics strong {
  font-size: 26px;
}
.order-table {
  max-width: 100%;
  overflow-x: auto;
}
.order-import {
  margin-top: 24px;
  display: grid;
  gap: 10px;
}
@media (max-width: 900px) {
  .order-metrics {
    grid-template-columns: 1fr;
  }
  .order-tools {
    align-items: stretch;
  }
  .order-tools label {
    flex: 1 1 220px;
  }
}
@media (max-width: 600px) {
  .order-tools > * {
    width: 100%;
  }
}
</style>

<script setup lang="ts">
import { watch } from 'vue'
import { useBilling } from '../use-billing'
defineProps<{ section?: 'plans' | 'orders' | 'usage' }>()
const billing = useBilling()
const { account, catalog, orders, pending, error, signedIn } = billing
watch(
  billing.identity,
  () => {
    void billing.refresh()
  },
  { immediate: true },
)
const money = (amount: number) => `¥${(amount / 100).toFixed(2)}`
const date = (unix: number) => (unix ? new Date(unix * 1000).toLocaleString('zh-CN') : '—')
</script>
<template>
  <div class="billing-dashboard" data-v-a08d080e="" data-v-d2122d6b="">
    <div class="page-head">
      <div>
        <h1>
          {{
            section === 'orders' ? '我的订单' : section === 'usage' ? '额度与计费' : '套餐与充值'
          }}
        </h1>
        <p>托管额度以服务端账本为准，支付返回页面不代表已入账。</p>
      </div>
      <el-button :loading="pending" :disabled="!signedIn" @click="billing.refresh"
        >刷新账本</el-button
      >
    </div>
    <el-alert
      v-if="!signedIn"
      type="info"
      :closable="false"
      title="使用托管账号后可查询额度和订单。本机 Key 的费用由模型服务商管理。"
    />
    <el-alert
      v-else-if="!billing.transport"
      type="warning"
      :closable="false"
      title="充值服务尚未接入当前客户端，不能创建支付或查询订单。下方额度来自最近一次账号同步。"
    />
    <el-alert v-if="error" type="error" :closable="false" :title="error" />
    <section v-if="account" class="card billing-quota" aria-label="服务端调用额度">
      <div>
        <span>总额度</span><strong>{{ account.trial.limit }} 次</strong>
      </div>
      <div>
        <span>已结算</span><strong>{{ account.trial.used }} 次</strong>
      </div>
      <div>
        <span>处理中或待对账</span><strong>{{ account.trial.reserved }} 次</strong>
      </div>
      <div>
        <span>剩余</span><strong>{{ account.trial.remaining }} 次</strong>
      </div>
      <div>
        <span>到期时间</span><strong>{{ date(account.trial.expiresAt) }}</strong>
      </div>
      <p>摘要与正式回复可能各消耗一次调用。失败释放占用，结果不确定时保留占用等待对账。</p>
    </section>
    <section v-if="section !== 'orders' && section !== 'usage'" class="card">
      <h2>可选套餐</h2>
      <el-alert
        v-if="catalog && !catalog.ready"
        type="warning"
        :closable="false"
        title="商户支付尚未配置，当前不能付款。"
      />
      <el-empty v-if="!catalog?.plans.length" description="暂无已发布套餐" />
      <div v-for="plan in catalog?.plans ?? []" :key="plan.id" class="billing-plan">
        <div>
          <h3>{{ plan.name }}</h3>
          <p>{{ plan.calls }} 次调用 · 有效期 {{ plan.valid_days }} 天</p>
          <strong>{{ money(plan.amount) }}</strong>
        </div>
        <el-button
          type="primary"
          :disabled="!catalog?.ready || !signedIn"
          :loading="pending"
          @click="billing.checkout(plan)"
          >创建订单并前往支付</el-button
        >
      </div>
      <p>
        充值增加调用额度，不自动启用
        AI。有效期采用当前到期时间与本次充值有效期的较晚值，已过期未使用额度不会恢复。
      </p>
    </section>
    <section v-if="section !== 'usage'" class="card">
      <h2>最近订单</h2>
      <p>只显示当前账号最近 100 笔订单；支付后点击刷新账本核对服务端入账。</p>
      <el-table :data="orders" empty-text="暂无可核实的订单记录">
        <el-table-column prop="id" label="订单号" min-width="200" />
        <el-table-column prop="plan.name" label="套餐" min-width="120" />
        <el-table-column label="金额" width="100"
          ><template #default="scope">{{ money(scope.row.plan.amount) }}</template></el-table-column
        >
        <el-table-column label="状态" width="140"
          ><template #default="scope">{{
            scope.row.state === 'paid' ? '服务端已入账' : '待支付或待对账'
          }}</template></el-table-column
        >
        <el-table-column label="创建时间" min-width="180"
          ><template #default="scope">{{ date(scope.row.created_at) }}</template></el-table-column
        >
      </el-table>
    </section>
    <section v-if="section === 'usage'" class="card">
      <p>这里展示账号累计调用账本，尚未接入按店铺、平台或小时拆分的扣费明细。</p>
    </section>
  </div>
</template>
<style scoped>
.billing-dashboard {
  display: grid;
  gap: 16px;
  padding: 24px;
}
.billing-quota {
  display: flex;
  flex-wrap: wrap;
  gap: 24px;
}
.billing-quota div {
  display: grid;
  gap: 8px;
}
.billing-quota p {
  flex-basis: 100%;
}
.billing-plan {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 24px;
  padding: 16px 0;
  border-bottom: 1px solid var(--el-border-color);
}
</style>

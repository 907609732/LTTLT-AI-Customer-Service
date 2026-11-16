<script setup lang="ts">
import { computed, watch } from 'vue'
import { useBilling } from '../use-billing'
const props = defineProps<{ section?: 'plans' | 'orders' | 'usage'; compact?: boolean }>()
const billing = useBilling()
const {
  account,
  catalog,
  orders,
  pending,
  signedIn,
  catalogError,
  ordersError,
  ledgerError,
  checkoutError,
  catalogPending,
  ordersPending,
  ledgerPending,
  ordersLoaded,
  ledgerSyncedAt,
} = billing
const signedOutReason = computed(() => {
  const managed = billing.runtime.snapshot.managed
  if (managed.restartRequired) return '账号或服务配置已变化，请重启客户端后重新核对充值账本。'
  if (managed.session.status === 'expired')
    return '托管登录已过期，请在主页登录入口重新登录后查询充值订单。'
  if (managed.session.status === 'disabled') return '托管账号已停用，请联系管理员核对权限。'
  if (managed.session.status === 'offline')
    return '暂时无法连接托管服务，请在主页登录入口重新同步账号。'
  return '使用托管账号后可查询额度和充值订单。本机 Key 的费用由模型服务商管理。'
})
async function refresh() {
  if (!props.compact) return billing.refresh()
  await Promise.all([
    billing.refreshLedger(),
    props.section === 'orders' ? billing.refreshOrders() : Promise.resolve(),
  ])
}
watch(
  billing.identity,
  () => {
    void refresh()
  },
  { immediate: true },
)
const money = (amount: number) => `¥${(amount / 100).toFixed(2)}`
const date = (unix: number) => (unix ? new Date(unix * 1000).toLocaleString('zh-CN') : '—')
</script>
<template>
  <div class="billing-dashboard" :class="{ compact }" data-v-a08d080e="" data-v-d2122d6b="">
    <div class="page-head">
      <div v-if="!compact">
        <h1>
          {{
            section === 'orders' ? '充值订单' : section === 'usage' ? '额度与计费' : '套餐与充值'
          }}
        </h1>
        <p>托管额度以服务端账本为准，支付返回页面不代表已入账。</p>
      </div>
      <el-button :loading="pending" :disabled="!signedIn" @click="refresh">刷新账本</el-button>
    </div>
    <el-alert v-if="!signedIn" type="info" :closable="false" :title="signedOutReason" />
    <el-alert
      v-else-if="!billing.transport"
      type="warning"
      :closable="false"
      title="充值服务尚未接入当前客户端，不能创建支付或查询订单。下方额度来自最近一次账号同步。"
    />
    <el-alert v-if="checkoutError" type="error" :closable="false" :title="checkoutError" />
    <el-alert
      v-if="compact && ledgerError"
      type="error"
      :closable="false"
      :title="ledgerError + '；额度为上次同步结果，请重试刷新。'"
    />
    <section v-if="signedIn && !compact" class="card ledger-sync" aria-label="账本同步状态">
      <el-alert v-if="ledgerError" type="error" :closable="false" :title="ledgerError" />
      <p>
        {{
          ledgerError
            ? '下方额度来自上次同步，尚未核实本次入账。'
            : ledgerSyncedAt
              ? `账本最近同步：${new Date(ledgerSyncedAt).toLocaleString('zh-CN')}`
              : '额度来自最近一次账号同步，尚未完成本页账本核对。'
        }}
      </p>
      <el-button :loading="ledgerPending" @click="billing.refreshLedger">重新核对账本</el-button>
    </section>
    <section
      v-if="account && (!compact || section === 'usage')"
      class="card billing-quota"
      aria-label="服务端调用额度"
    >
      <div class="quota-remaining">
        <span>剩余调用额度</span><strong>{{ account.trial.remaining }} <small>次</small></strong>
      </div>
      <div class="quota-stat">
        <span>总额度</span><strong>{{ account.trial.limit }} 次</strong>
      </div>
      <div class="quota-stat">
        <span>已结算</span><strong>{{ account.trial.used }} 次</strong>
      </div>
      <div class="quota-stat">
        <span>处理中或待对账</span><strong>{{ account.trial.reserved }} 次</strong>
      </div>
      <div class="quota-stat">
        <span>到期时间</span><strong>{{ date(account.trial.expiresAt) }}</strong>
      </div>
      <p>摘要与正式回复可能各消耗一次调用。失败释放占用，结果不确定时保留占用等待对账。</p>
    </section>
    <section v-if="section !== 'orders' && section !== 'usage'" class="plans-section">
      <div class="section-head">
        <h2>可选套餐</h2>
        <el-button
          v-if="signedIn && billing.transport"
          :loading="catalogPending"
          @click="billing.refreshCatalog"
          >刷新套餐</el-button
        >
      </div>
      <el-alert v-if="catalogError" type="error" :closable="false" :title="catalogError" />
      <el-alert
        v-if="catalog && !catalog.ready"
        type="warning"
        :closable="false"
        :title="
          catalog.reason === 'plans_not_configured'
            ? '管理员尚未发布充值套餐，当前不能付款。'
            : '商户支付尚未配置，当前不能付款。'
        "
      />
      <el-empty
        v-if="catalog?.ready && !catalogError && !catalog.plans.length"
        description="暂无已发布套餐"
      />
      <p v-if="catalogPending && !catalog">正在加载服务端套餐…</p>
      <div class="plans-grid">
        <div
          v-for="plan in catalog?.ready && !catalogError ? catalog.plans : []"
          :key="plan.id"
          class="billing-plan"
        >
          <div>
            <h3>{{ plan.name }}</h3>
            <div class="plan-price">{{ money(plan.amount) }}</div>
            <dl class="plan-details">
              <div>
                <dt>调用额度</dt>
                <dd>{{ plan.calls }} 次</dd>
              </div>
              <div>
                <dt>有效期</dt>
                <dd>{{ plan.valid_days }} 天</dd>
              </div>
            </dl>
          </div>
          <el-button
            type="primary"
            :disabled="!catalog?.ready || !signedIn || Boolean(catalogError)"
            :loading="pending"
            @click="billing.checkout(plan)"
            >创建订单并前往支付</el-button
          >
        </div>
      </div>
      <p class="section-note">
        充值增加调用额度，不自动启用
        AI。有效期采用当前到期时间与本次充值有效期的较晚值，已过期未使用额度不会恢复。
      </p>
    </section>
    <section v-if="section !== 'usage'" class="card">
      <div class="section-head orders-head">
        <div>
          <h2>最近充值订单</h2>
          <p>只显示当前账号最近 100 笔软件充值订单；支付后点击刷新账本核对服务端入账。</p>
        </div>
        <el-button
          v-if="signedIn && billing.transport"
          :loading="ordersPending"
          @click="billing.refreshOrders"
          >刷新充值订单</el-button
        >
      </div>
      <el-alert v-if="ordersError" type="error" :closable="false" :title="ordersError" />
      <p v-if="ordersError && ordersLoaded">下方为上次成功读取的充值订单，本次状态尚未核实。</p>
      <div class="orders-table">
        <el-table v-if="ordersLoaded" :data="orders" empty-text="暂无可核实的充值订单记录">
          <el-table-column prop="id" label="订单号" min-width="200" />
          <el-table-column prop="plan.name" label="套餐" min-width="120" />
          <el-table-column label="金额" width="100" align="right"
            ><template #default="scope">{{
              money(scope.row.plan.amount)
            }}</template></el-table-column
          >
          <el-table-column label="状态" width="140"
            ><template #default="scope"
              ><span class="order-state" :class="{ 'is-paid': scope.row.state === 'paid' }">{{
                scope.row.state === 'paid' ? '服务端已入账' : '待支付或待对账'
              }}</span></template
            ></el-table-column
          >
          <el-table-column label="创建时间" min-width="180"
            ><template #default="scope">{{ date(scope.row.created_at) }}</template></el-table-column
          >
        </el-table>
      </div>
    </section>
    <section v-if="section === 'usage'" class="card">
      <p>这里展示账号累计调用账本，尚未接入按店铺、平台或小时拆分的扣费明细。</p>
    </section>
    <p
      v-if="section !== 'orders' && section !== 'usage' && catalog?.service"
      class="billing-service"
    >
      计费服务 {{ catalog.service.version }} · 协议 {{ catalog.service.billing_protocol }}
    </p>
  </div>
</template>
<style scoped>
.billing-dashboard {
  box-sizing: border-box;
  display: grid;
  gap: 24px;
  width: 100%;
  max-width: 1224px;
  margin: 0 auto;
  padding: 32px;
  color: #243449;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Microsoft YaHei', sans-serif;
  font-size: 14px;
  line-height: 1.6;
  --el-color-primary: #3779ed;
}
h1,
h2,
h3,
p,
dl,
dd {
  margin: 0;
}
h1 {
  font-size: 24px;
  line-height: 1.4;
  font-weight: 650;
  letter-spacing: -0.4px;
}
h2 {
  font-size: 17px;
  line-height: 1.5;
  font-weight: 650;
}
h3 {
  font-size: 16px;
  line-height: 1.5;
  font-weight: 600;
}
p {
  color: #738196;
  font-size: 13px;
}
.page-head,
.section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
}
.page-head p,
.orders-head p {
  margin-top: 6px;
}
.card {
  min-width: 0;
  padding: 24px;
  background: #fff;
  border: 1px solid #e2e8f0;
  border-radius: 14px;
  box-shadow: 0 3px 14px #203b6310;
}
.ledger-sync {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 20px;
  box-shadow: none;
}
.ledger-sync > .el-alert {
  flex-basis: 100%;
}
.billing-quota {
  display: grid;
  grid-template-columns: 1.25fr repeat(3, 1fr) 1.6fr;
  align-items: center;
  gap: 20px;
}
.billing-quota > div {
  display: grid;
  gap: 7px;
  min-width: 0;
}
.billing-quota span {
  color: #738196;
  font-size: 12px;
}
.billing-quota strong {
  font-size: 16px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  overflow-wrap: anywhere;
}
.billing-quota .quota-remaining {
  padding-right: 22px;
  border-right: 1px solid #e8edf5;
}
.quota-remaining strong {
  color: #286be4;
  font-size: 36px;
  line-height: 1.2;
  letter-spacing: -0.8px;
}
.quota-remaining small {
  font-size: 14px;
  font-weight: 400;
}
.billing-quota > p {
  grid-column: 1 / -1;
  padding-top: 16px;
  border-top: 1px solid #edf1f6;
  font-size: 12px;
}
.plans-section {
  display: grid;
  min-width: 0;
  gap: 16px;
}
.plans-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 20px;
}
.billing-plan {
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  gap: 26px;
  padding: 24px;
  min-width: 0;
  border: 1px solid #dce5f1;
  border-radius: 14px;
  background: #fff;
  box-shadow: 0 3px 14px #203b6308;
}
.plan-price {
  margin: 16px 0 22px;
  color: #243449;
  font-size: 34px;
  line-height: 1.2;
  font-weight: 700;
  letter-spacing: -0.8px;
  font-variant-numeric: tabular-nums;
  overflow-wrap: anywhere;
}
.plan-details {
  display: grid;
  gap: 12px;
}
.plan-details > div {
  display: flex;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px;
}
.plan-details dt {
  color: #8190a3;
  font-size: 13px;
}
.plan-details dd {
  color: #40516a;
  font-size: 13px;
  font-weight: 500;
}
.billing-plan > .el-button {
  width: 100%;
  min-height: 40px;
  margin: auto 0 0;
  border-radius: 8px;
  font-size: 13px;
}
.section-note {
  font-size: 12px;
}
.orders-head {
  margin-bottom: 20px;
  align-items: flex-start;
}
.orders-head .el-button,
.page-head .el-button,
.section-head > .el-button {
  flex-shrink: 0;
}
.orders-table {
  width: 100%;
  min-width: 0;
  overflow-x: auto;
}
.orders-table :deep(.el-table) {
  font-size: 13px;
  --el-table-header-bg-color: #f7f9fc;
  --el-table-header-text-color: #78879b;
  --el-table-border-color: #edf1f6;
  --el-table-row-hover-bg-color: #f8faff;
}
.orders-table :deep(.el-table__cell) {
  padding: 13px 0;
}
.order-state {
  display: inline-block;
  padding: 3px 8px;
  border-radius: 5px;
  background: #f1f4f8;
  color: #77869a;
  font-size: 11px;
  white-space: nowrap;
}
.order-state.is-paid {
  color: #4d7d70;
  background: #edf6f2;
}
.billing-service {
  text-align: right;
  color: #98a3b2;
  font-size: 11px;
}
.billing-dashboard.compact {
  width: auto;
  max-width: none;
  margin: 0;
  padding: 0;
  gap: 12px;
}
.compact .page-head {
  justify-content: flex-end;
}
.compact .card {
  padding: 16px;
  box-shadow: none;
}
.compact .billing-quota {
  display: flex;
  flex-wrap: wrap;
  gap: 20px;
}
.compact .billing-quota .quota-remaining {
  border: 0;
  padding: 0;
}
.compact .quota-remaining strong {
  color: #243449;
  font-size: 16px;
  letter-spacing: normal;
}
.compact .billing-quota > p {
  flex-basis: 100%;
}
@media (max-width: 900px) {
  .billing-quota {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .billing-quota .quota-remaining {
    border: 0;
    padding: 0;
  }
  .plans-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
@media (max-width: 600px) {
  .billing-dashboard {
    padding: 20px 16px;
    gap: 20px;
  }
  .page-head {
    align-items: flex-start;
    flex-wrap: wrap;
    gap: 12px;
  }
  .plans-grid {
    grid-template-columns: minmax(0, 1fr);
    gap: 14px;
  }
  .card {
    padding: 20px;
  }
  .ledger-sync {
    padding: 14px 16px;
  }
  .orders-head {
    flex-wrap: wrap;
    gap: 12px;
  }
}
</style>

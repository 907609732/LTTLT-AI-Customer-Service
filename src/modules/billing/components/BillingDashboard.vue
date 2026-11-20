<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { permanentAccountExpiry } from '@/shared/contracts/managed'
import { useBilling } from '../use-billing'
import { paymentCodeImage } from '../payment-code'
import { callCountText, costPerThousand, planValueComparison } from '../plan-value'
import type { BillingChannel, BillingOrder, BillingPlan } from '../contracts'
const props = defineProps<{ section?: 'plans' | 'orders' | 'usage'; compact?: boolean }>()
const billing = useBilling()
const validity = (plan: BillingPlan) => (plan.permanent ? '永久有效' : `${plan.valid_days} 天`)
const {
  account,
  catalog,
  orders,
  pending,
  visiblePending,
  signedIn,
  catalogError,
  ordersError,
  ledgerError,
  checkoutError,
  paymentError,
  catalogPending,
  checkoutPending,
  paymentActionPending,
  ordersLoaded,
  activePayment,
  pollingExpired,
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
/** 服务端只发布已配置的官方渠道；缺省按未配置展示，绝不自动替换成其他付款方式。 */
const channels = computed(() =>
  (['alipay', 'wechat'] as const).map(
    (id) =>
      catalog.value?.channels?.find((item) => item.id === id) ?? { id, ready: false, reason: '' },
  ),
)
/** 只有服务端明确 ready 的官方扫码渠道才能进入收银台。 */
const nativeReady = computed(() => channels.value.some((channel) => channel.ready))
const quotaExpanded = ref(false)
const cashierOpen = ref(false)
const existingOrderNotice = ref<{ orderId: string; text: string } | null>(null)
const selectedPlan = ref<BillingPlan | null>(null)
const selectedChannel = ref<BillingChannel>('alipay')
const qrImage = ref('')
const qrError = ref('')
const NOTICE_OTHER_ORDER = '您有一笔未完成的订单，请先完成支付或关闭原订单。'
const NOTICE_ORIGINAL_TERMS =
  '您有一笔未完成的订单，仍按下单时的价格和额度结算；如需购买当前套餐，请先关闭原订单。'
// 等待创建/恢复时先显示当前选择；收到实际订单后必须让订单快照优先，避免目录变化后错配二维码。
const cashierIntent = ref<BillingPlan | null>(null)
const cashierPlan = computed(
  () => cashierIntent.value ?? activePayment.value?.order.plan ?? selectedPlan.value,
)
// 提示只对它所指向的待付订单有效；关闭、换单或新订单形成后不会残留。
const orderNotice = computed(() => {
  const notice = existingOrderNotice.value
  const order = activePayment.value?.order
  if (!notice || !order || order.id !== notice.orderId) return ''
  return ['pending', 'reconciling'].includes(order.state) ? notice.text : ''
})
// 订单一旦被接收，快照立即优先；仍在等待创建/恢复时保留当前选择。
watch(
  activePayment,
  (payment) => {
    if (payment) cashierIntent.value = null
  },
  { flush: 'sync' },
)
const planComparison = (plan: BillingPlan) => planValueComparison(plan, catalog.value?.plans ?? [])
// 套餐 ID 不随额度改名；同 ID 但下单条款不同时仍必须提示正在恢复旧订单。
const sameOffer = (current: BillingPlan, next: BillingPlan) =>
  current.amount === next.amount &&
  current.calls === next.calls &&
  current.valid_days === next.valid_days &&
  Boolean(current.permanent) === Boolean(next.permanent)
function noteExistingOrder(order: BillingOrder, selected: BillingPlan) {
  if (order.plan.id !== selected.id)
    existingOrderNotice.value = { orderId: order.id, text: NOTICE_OTHER_ORDER }
  else if (!sameOffer(order.plan, selected))
    existingOrderNotice.value = { orderId: order.id, text: NOTICE_ORIGINAL_TERMS }
  else existingOrderNotice.value = null
}
const channelReady = (id: BillingChannel) =>
  channels.value.some((channel) => channel.id === id && channel.ready)
const createLabel = computed(() =>
  checkoutError.value || paymentError.value
    ? '重试加载二维码'
    : activePayment.value && ['pending', 'reconciling'].includes(activePayment.value.order.state)
      ? '关闭原订单并切换支付方式'
      : '加载支付二维码',
)
function channelReason(channel: { ready: boolean; reason: string }) {
  if (channel.ready) return ''
  return channel.reason && !/^[a-z_]+$/.test(channel.reason) ? channel.reason : '商户支付尚未配置'
}
async function choose(plan: BillingPlan, preferredChannel?: BillingChannel) {
  if (pending.value) return
  existingOrderNotice.value = null
  paymentError.value = ''
  selectedPlan.value = plan
  selectedChannel.value =
    preferredChannel ?? channels.value.find((channel) => channel.ready)?.id ?? 'alipay'
  cashierOpen.value = true
  if (ordersError.value || !ordersLoaded.value) {
    paymentError.value = '暂时无法核实充值订单，请刷新订单后重试。'
    return
  }
  const current =
    activePayment.value && ['pending', 'reconciling'].includes(activePayment.value.order.state)
      ? activePayment.value.order
      : orders.value.find((order) => ['pending', 'reconciling'].includes(order.state))
  // Reopening a cashier must not replace an unpaid order or generate another payment code.
  if (current && ['pending', 'reconciling'].includes(current.state)) {
    noteExistingOrder(current, plan)
    selectedPlan.value = current.plan
    if (current.channel === 'alipay' || current.channel === 'wechat')
      selectedChannel.value = current.channel
    cashierIntent.value = current.plan
    try {
      await billing.resumeOrder(current)
    } finally {
      cashierIntent.value = null
    }
    return
  }
  cashierIntent.value = plan
  try {
    await billing.checkout(plan, selectedChannel.value)
  } finally {
    cashierIntent.value = null
  }
}
async function checkoutSelected() {
  const plan = selectedPlan.value
  if (!plan) return
  const current = activePayment.value?.order
  // Only an explicit channel change may close the known active order first.
  if (
    current &&
    ['pending', 'reconciling'].includes(current.state) &&
    current.channel !== selectedChannel.value
  ) {
    cashierIntent.value = plan
    try {
      await billing.checkout(plan, selectedChannel.value)
    } finally {
      cashierIntent.value = null
    }
  } else await choose(plan, selectedChannel.value)
}
async function refreshCashierOrders() {
  const identity = billing.identity.value
  const plan = selectedPlan.value
  await billing.refreshOrders()
  if (
    identity === billing.identity.value &&
    cashierOpen.value &&
    plan === selectedPlan.value &&
    plan
  )
    await choose(plan)
}
async function resume(order: BillingOrder) {
  cashierOpen.value = true
  const currentOffer = catalog.value?.plans.find((plan) => plan.id === order.plan.id)
  existingOrderNotice.value =
    currentOffer && !sameOffer(order.plan, currentOffer)
      ? { orderId: order.id, text: NOTICE_ORIGINAL_TERMS }
      : null
  selectedPlan.value = order.plan
  cashierIntent.value = order.plan
  try {
    await billing.resumeOrder(order)
  } finally {
    cashierIntent.value = null
  }
}
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
    cashierOpen.value = false
    existingOrderNotice.value = null
    cashierIntent.value = null
    quotaExpanded.value = false
    selectedPlan.value = null
    qrImage.value = ''
    qrError.value = ''
    void refresh()
  },
  { immediate: true },
)
// 二维码内容变化即重绘；迟到结果按序号丢弃，身份切换后不再显示旧订单的码。
let qrGeneration = 0
watch(
  () => activePayment.value?.qr_code,
  async (text) => {
    const ticket = ++qrGeneration
    qrImage.value = ''
    qrError.value = ''
    if (!text) return
    try {
      const image = await paymentCodeImage(text)
      if (ticket === qrGeneration) qrImage.value = image
    } catch {
      if (ticket === qrGeneration) qrError.value = '二维码生成失败，请重试查询或改用官方渠道页面。'
    }
  },
)
const money = (amount: number) => `¥${(amount / 100).toFixed(2)}`
// Benefits belong to this published support tier, not arbitrary similarly priced plans.
const isPremium = (plan: BillingPlan) => plan.id === 'support_100000' && plan.amount === 100000
const date = (unix: number) => (unix ? new Date(unix * 1000).toLocaleString('zh-CN') : '—')
const channelName = (id?: string) =>
  id === 'wechat' ? '微信支付' : id === 'alipay' ? '支付宝' : '网页支付'
const stateNames: Record<string, string> = {
  pending: '待支付',
  paid: '服务端已入账',
  closed: '已关闭',
  reconciling: '待对账',
}
const stateName = (state: string) => stateNames[state] ?? '待对账'
</script>
<template>
  <div class="billing-dashboard" :class="{ compact }" data-v-a08d080e="" data-v-d2122d6b="">
    <div class="page-head">
      <div v-if="!compact">
        <h1>
          {{ section === 'orders' ? '充值订单' : section === 'usage' ? '额度与计费' : '支持我们' }}
        </h1>
      </div>
      <el-button :loading="visiblePending" :disabled="!signedIn" @click="refresh">刷新</el-button>
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
      v-if="ledgerError"
      type="error"
      :closable="false"
      :title="ledgerError + '；额度可能未更新，请稍后刷新。'"
    />
    <section
      v-if="account && (!compact || section === 'usage')"
      class="card billing-quota"
      aria-label="服务端调用额度"
    >
      <div class="quota-remaining">
        <span>可用额度</span
        ><strong
          >{{ catalog?.quota ? catalog.quota.remaining : account.trial.remaining }}
          <small>次</small></strong
        >
      </div>
      <button
        class="details-toggle"
        type="button"
        :aria-expanded="quotaExpanded"
        aria-controls="billing-quota-details"
        @click="quotaExpanded = !quotaExpanded"
      >
        额度明细 {{ quotaExpanded ? '收起' : '展开' }}
      </button>
      <div id="billing-quota-details" class="quota-details" v-show="quotaExpanded">
        <template v-if="catalog?.quota">
          <div class="quota-stat">
            <span>付费剩余</span><strong>{{ catalog.quota.paid.remaining }} 次</strong>
            <span>到期 {{ date(catalog.quota.paid.expires_at) }}</span>
          </div>
          <div v-if="catalog.quota.permanent?.limit" class="quota-stat">
            <span>永久额度剩余</span><strong>{{ catalog.quota.permanent.remaining }} 次</strong>
            <span>永久有效</span>
          </div>
          <div class="quota-stat">
            <span>试用剩余</span><strong>{{ catalog.quota.trial.remaining }} 次</strong>
            <span>到期 {{ date(catalog.quota.trial.expires_at) }}</span>
          </div>
          <div class="quota-stat">
            <span>处理中或待对账</span
            ><strong
              >{{
                catalog.quota.paid.reserved +
                catalog.quota.trial.reserved +
                (catalog.quota.permanent?.reserved ?? 0)
              }}
              次</strong
            >
          </div>
        </template>
        <template v-else>
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
            <span>到期时间</span
            ><strong>{{
              account.trial.expiresAt === permanentAccountExpiry
                ? '含永久额度'
                : date(account.trial.expiresAt)
            }}</strong>
          </div>
        </template>
        <p>AI 回复按次计费，处理中额度将在结果确认后更新。</p>
        <p v-if="catalog?.quota?.trial.provenance === 'legacy_mixed'">
          历史额度包含早期充值记录，无法单独拆分试用和付费次数。
        </p>
      </div>
    </section>
    <section v-if="section !== 'orders' && section !== 'usage'" class="plans-section">
      <div class="section-head">
        <h2>支持套餐</h2>
      </div>
      <p class="support-note">
        您的支持是我们的动力，帮助灵兔开源项目加快开发与完善。支持项目即可获赠套餐所列调用额度，可在有效期内使用托管
        AI 服务。
      </p>
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
          :class="{ 'billing-plan--premium': isPremium(plan) }"
        >
          <div>
            <span v-if="isPremium(plan)" class="premium-badge">共创支持</span>
            <h3>{{ plan.name }}</h3>
            <div class="plan-price">
              {{ money(plan.amount)
              }}<del v-if="plan.list_amount && plan.list_amount > plan.amount">{{
                money(plan.list_amount)
              }}</del>
            </div>
            <dl class="plan-details">
              <div>
                <dt>调用额度</dt>
                <dd>{{ callCountText(plan.calls) }}</dd>
              </div>
              <div v-if="costPerThousand(plan)">
                <dt>每千次费用</dt>
                <dd>{{ costPerThousand(plan) }}</dd>
              </div>
              <div>
                <dt>有效期</dt>
                <dd>{{ validity(plan) }}</dd>
              </div>
            </dl>
            <p v-if="planComparison(plan)" class="plan-value">{{ planComparison(plan) }}</p>
            <div v-if="isPremium(plan)" class="premium-benefits">
              <strong>专属一对一客服</strong>
              <span>程序开发者一对一对接</span>
            </div>
          </div>
          <el-button
            v-if="nativeReady"
            type="primary"
            :disabled="!catalog?.ready || !signedIn || Boolean(catalogError)"
            :loading="checkoutPending || paymentActionPending"
            @click="choose(plan)"
            >支持我们</el-button
          >
          <el-button
            v-else
            type="primary"
            :disabled="!catalog?.ready || !signedIn || Boolean(catalogError)"
            :loading="checkoutPending"
            @click="billing.checkout(plan)"
            >支持我们</el-button
          >
        </div>
      </div>
      <p v-if="!nativeReady && catalog?.ready && catalogError === ''" class="section-note">
        微信/支付宝扫码渠道尚未配置；如管理员启用了网页支付，可使用上方按钮按网页收银台付款。
      </p>
      <p class="section-note">充值后会延长未到期的试用额度。</p>
    </section>
    <el-dialog
      v-if="!compact && signedIn && billing.transport"
      v-model="cashierOpen"
      title="扫码收银台"
      class="billing-cashier-dialog"
      width="520px"
      align-center
      append-to-body
      destroy-on-close
      :close-on-click-modal="false"
    >
      <div class="cashier">
        <p v-if="cashierPlan">
          {{ cashierPlan.name }} · {{ money(cashierPlan.amount) }} ·
          {{ callCountText(cashierPlan.calls) }} · 有效期 {{ validity(cashierPlan) }}
        </p>
        <p v-if="selectedPlan && isPremium(selectedPlan)" class="premium-benefits">
          专属一对一客服 · 程序开发者一对一对接
        </p>
        <fieldset v-if="selectedPlan" class="billing-channels">
          <legend>选择支付方式</legend>
          <label v-for="channel in channels" :key="channel.id"
            ><input
              v-model="selectedChannel"
              type="radio"
              :value="channel.id"
              :disabled="!channelReady(channel.id) || pending"
            />{{ channelName(channel.id)
            }}<small v-if="!channel.ready">（暂不可用：{{ channelReason(channel) }}）</small></label
          >
        </fieldset>
        <p v-if="checkoutPending" role="status">正在加载支付二维码…</p>
        <p v-else-if="paymentActionPending" role="status">正在查询支付结果…</p>
        <el-alert v-if="checkoutError" type="error" :closable="false" :title="checkoutError" />
        <el-alert v-if="paymentError" type="error" :closable="false" :title="paymentError" />
        <el-button
          v-if="ordersError || !ordersLoaded"
          :loading="visiblePending"
          @click="refreshCashierOrders"
        >
          刷新订单并重试
        </el-button>
        <p v-if="orderNotice">{{ orderNotice }}</p>
        <template v-if="activePayment && !checkoutPending && !checkoutError">
          <p>
            订单 {{ activePayment.order.id }} · {{ channelName(activePayment.order.channel) }} ·
            {{ stateName(activePayment.order.state) }}
          </p>
          <template v-if="activePayment.order.state === 'pending'">
            <img v-if="qrImage" :src="qrImage" alt="支付二维码" class="billing-qr" />
            <p v-else>
              {{
                qrError ||
                (activePayment.qr_code ? '正在生成二维码…' : '暂无可用二维码，请查询订单结果。')
              }}
            </p>
            <p>
              请使用{{ channelName(activePayment.order.channel) }}扫码。有效期至
              {{ date(activePayment.expires_at || activePayment.order.expires_at || 0) }}
            </p>
          </template>
          <p v-if="activePayment.order.state === 'paid'">
            服务端已确认付款并入账，请查看最新额度。
          </p>
          <p v-if="activePayment.order.state === 'reconciling'">
            渠道结果尚未确认，请勿重复付款；可重试查询，确认关闭前不能更换渠道。
          </p>
          <p v-if="pollingExpired">自动查询已暂停，可手动重试；请勿重复付款。</p>
          <el-button :loading="paymentActionPending" @click="billing.checkPayment(true)"
            >重试查询结果</el-button
          >
          <el-button
            v-if="
              activePayment.order.state === 'pending' || activePayment.order.state === 'reconciling'
            "
            :disabled="pending"
            @click="billing.closePayment"
            >关闭原订单</el-button
          >
        </template>
        <el-button
          v-if="
            selectedPlan &&
            !checkoutPending &&
            (checkoutError || !activePayment || activePayment.order.channel !== selectedChannel)
          "
          type="primary"
          :loading="checkoutPending"
          :disabled="
            !channelReady(selectedChannel) ||
            !signedIn ||
            Boolean(catalogError) ||
            Boolean(ordersError) ||
            !ordersLoaded ||
            pending
          "
          @click="checkoutSelected"
          >{{ createLabel }}</el-button
        >
        <p>支付成功后额度自动到账。关闭弹窗不影响支付结果查询。</p>
      </div>
      <template #footer>
        <el-button @click="cashierOpen = false">稍后支付</el-button>
      </template>
    </el-dialog>
    <section v-if="section !== 'usage'" class="card orders-card">
      <div class="section-head orders-head">
        <h2>最近充值订单</h2>
      </div>
      <el-alert v-if="ordersError" type="error" :closable="false" :title="ordersError" />
      <p v-if="ordersError && ordersLoaded">下方为上次成功读取的充值订单，本次状态尚未核实。</p>
      <div class="orders-content">
        <div class="orders-table">
          <el-table v-if="ordersLoaded" :data="orders" empty-text="暂无可核实的充值订单记录">
            <el-table-column prop="id" label="订单号" min-width="200" />
            <el-table-column prop="plan.name" label="套餐" min-width="120" />
            <el-table-column label="金额" width="100" align="right"
              ><template #default="scope">{{
                money(scope.row.plan.amount)
              }}</template></el-table-column
            >
            <el-table-column label="支付方式" width="110"
              ><template #default="scope">{{
                channelName(scope.row.channel)
              }}</template></el-table-column
            >
            <el-table-column label="状态" width="140"
              ><template #default="scope"
                ><span class="order-state" :class="{ 'is-paid': scope.row.state === 'paid' }">{{
                  stateName(scope.row.state)
                }}</span></template
              ></el-table-column
            >
            <el-table-column label="创建时间" min-width="180"
              ><template #default="scope">{{
                date(scope.row.created_at)
              }}</template></el-table-column
            >
            <el-table-column v-if="!compact" label="操作" width="150"
              ><template #default="scope"
                ><el-button
                  v-if="scope.row.state !== 'closed'"
                  :disabled="!signedIn || pending"
                  @click="resume(scope.row)"
                  >查询 / 继续支付</el-button
                ></template
              ></el-table-column
            >
          </el-table>
        </div>
      </div>
    </section>
    <section v-if="section === 'usage'" class="card">
      <p>这里展示账号累计调用账本，尚未接入按店铺、平台或小时拆分的扣费明细。</p>
    </section>
  </div>
</template>
<style scoped>
.billing-dashboard {
  box-sizing: border-box;
  display: grid;
  gap: 20px;
  width: 100%;
  max-width: 1224px;
  margin: 0 auto;
  padding: 24px 32px;
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
.billing-quota {
  display: grid;
  grid-template-columns: 1fr auto;
  align-items: center;
  gap: 16px;
}
.billing-quota .quota-remaining,
.quota-stat {
  display: grid;
  gap: 6px;
}
.quota-details {
  grid-column: 1 / -1;
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: 16px;
  padding-top: 16px;
  border-top: 1px solid #edf1f6;
}
.quota-details > p {
  grid-column: 1 / -1;
}
.details-toggle {
  padding: 6px 0;
  border: 0;
  background: transparent;
  color: #286be4;
  font: inherit;
  cursor: pointer;
}
.details-toggle:focus-visible {
  outline: 2px solid #3779ed;
  outline-offset: 4px;
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
  gap: 18px;
  padding: 20px;
  min-width: 0;
  border: 1px solid #dce5f1;
  border-radius: 14px;
  background: #fff;
  box-shadow: 0 3px 14px #203b6308;
}
.billing-plan--premium {
  border-color: #d7a847;
  background: linear-gradient(145deg, #fff5cf 0%, #f6d778 58%, #edc058 100%);
  box-shadow: 0 8px 24px #b67f2524;
}
.billing-plan--premium h3,
.billing-plan--premium .plan-price {
  color: #68420d;
}
.billing-plan--premium .plan-details dt,
.billing-plan--premium .plan-details dd {
  color: #765320;
}
.premium-badge {
  display: inline-block;
  margin-bottom: 10px;
  padding: 3px 10px;
  border-radius: 20px;
  background: #7d5416;
  color: #fff4ce;
  font-size: 11px;
  font-weight: 600;
}
.premium-benefits {
  display: grid;
  gap: 4px;
  margin-top: 16px;
  color: #68420d;
  font-size: 13px;
}
.billing-plan--premium > .el-button {
  color: #fff8df;
  border-color: #80551b;
  background: #80551b;
}
.billing-plan--premium > .el-button:hover {
  background: #674211;
  border-color: #674211;
}
.plan-price {
  margin: 12px 0 16px;
  color: #243449;
  font-size: 34px;
  line-height: 1.2;
  font-weight: 700;
  letter-spacing: -0.8px;
  font-variant-numeric: tabular-nums;
  overflow-wrap: anywhere;
}
.plan-price del {
  margin-left: 10px;
  color: #98a3b2;
  font-size: 14px;
  font-weight: 400;
  letter-spacing: normal;
}
.plan-details {
  display: grid;
  gap: 8px;
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
  overflow-wrap: anywhere;
}
.plan-value {
  margin-top: 12px;
  color: #5d6c80;
  font-size: 12px;
  line-height: 1.5;
  overflow-wrap: anywhere;
}
.billing-plan--premium .plan-value {
  color: #765320;
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
.cashier {
  display: grid;
  gap: 14px;
}
:global(.billing-cashier-dialog) {
  max-width: calc(100vw - 32px);
  max-height: calc(100vh - 48px);
  overflow-y: auto;
}
.cashier > .el-button {
  justify-self: start;
}
.billing-channels {
  display: grid;
  gap: 10px;
  margin: 0;
  padding: 12px 16px;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
}
.billing-channels legend {
  padding: 0 6px;
  color: #738196;
  font-size: 12px;
}
.billing-channels label {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
}
.billing-channels small {
  color: #98a3b2;
}
.billing-qr {
  display: block;
  width: 240px;
  height: 240px;
  margin: 0 auto;
}
.orders-head {
  margin-bottom: 0;
  align-items: flex-start;
}
.page-head .el-button,
.section-head > .el-button {
  flex-shrink: 0;
}
.orders-content {
  margin-top: 16px;
}
.support-note {
  color: #526782;
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
  display: grid;
  gap: 16px;
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

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useRuntimeStore } from '@/shared/state/runtime'
import { useShopSetupStore } from '../setup-store'
const setup = useShopSetupStore(),
  runtime = useRuntimeStore(),
  router = useRouter()
watch(
  () => [setup.visible, setup.storeId],
  () => {
    if (
      setup.visible &&
      setup.storeId &&
      runtime.available &&
      !setup.loaded &&
      !setup.loading &&
      !setup.error
    )
      void setup.loadRules()
  },
  { immediate: true },
)
const steps = ['引导页面', '客服风格', '物流设置', '发货政策', '售后政策', '完成设置']
const styles = [
  {
    id: 'soft',
    name: '软萌型',
    icon: '♥',
    description: '软萌可爱，语气亲切',
    sample: '您好呀～告诉我您想了解的商品，我来帮您看看。',
  },
  {
    id: 'cute',
    name: '可爱型',
    icon: '✿',
    description: '活泼俏皮，轻松友好',
    sample: '来啦！您想了解哪款商品呢？我来帮您查一查～',
  },
  {
    id: 'practical',
    name: '实用型',
    icon: '✓',
    description: '简洁高效，直奔主题',
    sample: '您好，请提供商品名称或规格，我为您核实。',
  },
  {
    id: 'professional',
    name: '专业型',
    icon: '●',
    description: '严谨规范，商务正式',
    sample: '您好，请告知您咨询的商品与规格，我将为您核实相关信息。',
  },
  {
    id: 'warm',
    name: '热情型',
    icon: '☀',
    description: '主动积极，热情饱满',
    sample: '您好，欢迎咨询！您想了解哪款商品？很乐意为您详细介绍。',
  },
  {
    id: 'cool',
    name: '高冷型',
    icon: '❄',
    description: '简洁克制，不多废话',
    sample: '您好，请提供商品与规格。',
  },
  {
    id: 'humorous',
    name: '幽默型',
    icon: '☺',
    description: '轻松风趣，自然交流',
    sample: '您好，商品小助手就位！您想了解哪款？我来帮您查个明白。',
  },
  {
    id: 'gentle',
    name: '温柔型',
    icon: '☾',
    description: '耐心细致，温柔贴心',
    sample: '您好，您可以慢慢告诉我想了解的商品和规格，我会耐心为您核实。',
  },
] as const
const selectedStyle = computed(
  () => styles.find((item) => item.id === setup.draft.style) ?? styles[2]!,
)
const lengths = ['short', 'balanced', 'detailed'] as const
const lengthNames = { short: '精简', balanced: '适中', detailed: '自由' }
const replyLength = computed({
  get: () => lengths.indexOf(setup.draft.length),
  set: (value: number) => {
    setup.draft.length = lengths[value] ?? 'balanced'
  },
})
const preview = computed(() => {
  const sample = selectedStyle.value.sample
  return setup.draft.length === 'short'
    ? sample.split('，')[0] + '。'
    : setup.draft.length === 'detailed'
      ? sample + '也可以告诉我您的具体需求，我会结合已核实的商品资料为您说明。'
      : sample
})
const productCount = computed(() => runtime.snapshot.products.byStore[setup.storeId] ?? 0)
const origins = [
  '浙江',
  '广东',
  '江苏',
  '上海',
  '福建',
  '山东',
  '河北',
  '河南',
  '湖北',
  '四川',
  '北京',
]
const carriers = [
  '圆通快递',
  '申通快递',
  '中通快递',
  '韵达快递',
  '顺丰速运',
  '邮政快递',
  '极兔速递',
  '京东物流',
]
const dispatchOptions = ['24小时内', '48小时内', '72小时内', '14点前下单 当天发货']
const otherDispatch = ref(false)
watch(
  () => setup.storeId,
  () => {
    otherDispatch.value = false
  },
)
const dispatchChoice = computed({
  get: () =>
    otherDispatch.value ||
    (setup.draft.dispatchTime && !dispatchOptions.includes(setup.draft.dispatchTime))
      ? '其他'
      : setup.draft.dispatchTime,
  set: (value: string) => {
    otherDispatch.value = value === '其他'
    setup.draft.dispatchTime = value === '其他' ? '' : value
  },
})
const validation = ref('')
watch(
  () => setup.step,
  () => {
    validation.value = ''
  },
)
function next() {
  validation.value = ''
  if (setup.step === 2) {
    if (!setup.draft.origins.length) validation.value = '请至少选择一个发货地'
    else if (!setup.draft.carriers.length) validation.value = '请至少选择一家快递公司'
    else if (setup.draft.designatedCourier === null) validation.value = '请选择是否支持客户指定快递'
  }
  if (setup.step === 3) {
    if (!setup.draft.dispatchTime.trim()) validation.value = '请选择或填写通常的发货时间'
    else if (setup.draft.freightInsurance === null) validation.value = '请选择是否提供运费险'
    else if (setup.draft.freightInsurance && !setup.draft.insuranceExcessPayer)
      validation.value = '请选择运费险超额部分承担方'
  }
  if (!validation.value) setup.step++
}
async function save() {
  validation.value = ''
  if (await setup.saveRules()) setup.step = 5
}
function editAgain() {
  setup.saved = false
  setup.step = 1
}
async function configure(panel: string) {
  const target = setup.storeId
  setup.pauseForConfiguration()
  try {
    await router.push(
      panel === 'model-settings'
        ? { path: '/settings' }
        : { path: '/shop/manage', query: { panel } },
    )
  } catch (cause) {
    if (target && setup.storeId === target) {
      setup.error = cause instanceof Error ? cause.message : String(cause)
      setup.resume()
    }
  }
}
function connect() {
  void setup.connect(async () => {
    await router.push('/')
  })
}
const yesNo = (value: boolean | null) => (value === null ? '未填写' : value ? '是' : '否')
const payerNames = { '': '未填写', merchant: '商家承担', buyer: '买家承担', negotiate: '双方协商' }
const afterSales = [
  { key: 'exchangeSupported', title: '支持换货吗？', policy: 'exchangePolicy', label: '换货说明' },
  {
    key: 'returnSupported',
    title: '支持退货退款吗？',
    policy: 'returnPolicy',
    label: '退货退款条件',
  },
  {
    key: 'cashbackSupported',
    title: '有好评返现活动吗？',
    policy: 'cashbackProcess',
    label: '返现流程',
  },
  {
    key: 'compensationSupported',
    title: '支持小额补偿吗？',
    policy: 'compensationPolicy',
    label: '补偿说明',
  },
] as const
</script>
<template>
  <el-button
    v-if="setup.returnAvailable && !setup.visible"
    class="shop-setup-resume"
    type="primary"
    @click="setup.resume()"
    >继续基础设置</el-button
  >
  <main
    v-if="setup.visible"
    class="shop-setup-page"
    role="dialog"
    aria-modal="true"
    aria-label="店铺信息助手"
    @keydown.esc="!setup.saving && setup.dismiss()"
  >
    <header class="wizard-header" data-window-drag>
      <div class="wizard-header-content">
        <div class="wizard-brand">
          <span class="shop-symbol" aria-hidden="true">▣</span><strong>店铺信息助手</strong
          ><span class="shop-name">{{ setup.shop?.storeName }}</span>
        </div>
        <div class="wizard-header-actions" data-no-drag>
          <span
            >填写进度 {{ setup.step * 20 }}% ·
            {{ setup.step === 5 ? '设置已保存' : '最后一步统一保存' }}</span
          ><button
            data-dismiss
            aria-label="关闭引导"
            :disabled="setup.saving"
            @click="setup.dismiss()"
          >
            ×
          </button>
        </div>
      </div>
    </header>
    <div class="wizard-scroll">
      <nav class="wizard-steps" aria-label="店铺设置步骤">
        <div
          v-for="(label, index) in steps"
          :key="label"
          class="wizard-step"
          :class="{ active: setup.step === index, passed: setup.step > index }"
          :aria-current="setup.step === index ? 'step' : undefined"
        >
          <span class="step-circle">{{ setup.step > index ? '✓' : index + 1 }}</span
          ><span>{{ label }}</span>
        </div>
      </nav>
      <section
        class="wizard-card"
        :class="{ 'intro-card': setup.step === 0, 'finish-card': setup.step === 5 }"
        :aria-busy="setup.loading || setup.saving"
      >
        <div v-if="setup.loading" class="loading-banner" role="status">
          正在读取本店设置，请稍候…
        </div>
        <fieldset
          class="wizard-fields"
          :disabled="setup.loading || setup.saving"
          :inert="setup.loading || setup.saving"
        >
          <template v-if="setup.step === 0">
            <div class="intro-count">
              <strong data-product-count>{{ productCount }}</strong
              ><span>本店已采集商品</span><small>以当前工作区实际商品记录为准</small>
            </div>
            <div class="intro-actions">
              <el-button type="primary" data-start :disabled="setup.loading" @click="setup.step = 1"
                >开始设置</el-button
              ><el-button @click="setup.dismiss()">稍后再说</el-button>
            </div>
            <h1>{{ setup.shop?.storeName }}，完善您的店铺信息</h1>
            <p class="intro-description">
              设置客服风格、物流和售后政策，让 AI 根据您确认的信息提供服务。
            </p>
            <div class="setup-shortcuts">
              <button @click="configure('goods')">商品知识</button
              ><button @click="configure('model-settings')">模型连接设置</button
              ><button @click="configure('training')">AI 训练场</button
              ><button :disabled="setup.pending" @click="connect">
                {{ setup.shop?.runtime.online ? '打开店铺' : '连接店铺' }}
              </button>
            </div>
            <p class="quiet-note">设置不会自动采集商品或开启 AI；正式回复仍需逐条确认。</p>
          </template>
          <template v-else-if="setup.step === 1">
            <h2>AI 客服回复风格设置</h2>
            <div class="style-columns">
              <div class="style-settings">
                <h3>选择基础风格（必选）</h3>
                <div class="style-options" role="radiogroup" aria-label="客服风格">
                  <button
                    v-for="style in styles"
                    :key="style.id"
                    type="button"
                    role="radio"
                    :data-style="style.id"
                    :aria-checked="setup.draft.style === style.id"
                    :class="{ selected: setup.draft.style === style.id }"
                    @click="setup.draft.style = style.id"
                  >
                    <strong
                      ><span class="style-icon" :class="style.id">{{ style.icon }}</span
                      >{{ style.name }}</strong
                    ><small>{{ style.description }}</small>
                  </button>
                </div>
                <h3 class="length-title">回复热度（长度控制）</h3>
                <el-slider
                  v-model="replyLength"
                  :min="0"
                  :max="2"
                  :step="1"
                  :show-tooltip="false"
                  aria-label="回复长度"
                />
                <div class="length-labels"><span>精简</span><span>适中</span><span>自由</span></div>
              </div>
              <aside class="conversation-preview">
                <h3>◉ 话术示例预览</h3>
                <div class="conversation-body">
                  <div class="buyer-message"><span>请问这款商品怎么样？</span><b>客</b></div>
                  <div class="ai-message">
                    <b>AI</b><span>{{ preview }}</span>
                  </div>
                </div>
                <p>本地语气示例，不代表本店库存、发货时效或服务承诺。</p>
              </aside>
            </div>
          </template>
          <template v-else-if="setup.step === 2">
            <div class="field-section">
              <h2>从哪里发货呢？</h2>
              <p>可多选，支持输入详细地址（至少选 1 个）</p>
              <el-select
                :teleported="false"
                v-model="setup.draft.origins"
                multiple
                filterable
                allow-create
                default-first-option
                placeholder="请选择或输入发货地"
                aria-label="发货地"
                ><el-option v-for="origin in origins" :key="origin" :label="origin" :value="origin"
              /></el-select>
            </div>
            <div class="field-section">
              <h2>常用哪些快递呢？</h2>
              <p>可多选，支持输入其他快递公司（至少选 1 个）</p>
              <el-select
                :teleported="false"
                v-model="setup.draft.carriers"
                multiple
                filterable
                allow-create
                default-first-option
                placeholder="请选择或输入快递公司"
                aria-label="常用快递"
                ><el-option
                  v-for="carrier in carriers"
                  :key="carrier"
                  :label="carrier"
                  :value="carrier"
              /></el-select>
            </div>
            <div class="field-section">
              <h3>支持客户指定快递吗？</h3>
              <el-radio-group v-model="setup.draft.designatedCourier" aria-label="支持指定快递"
                ><el-radio :value="true" border>是</el-radio
                ><el-radio :value="false" border>否</el-radio></el-radio-group
              >
            </div>
          </template>
          <template v-else-if="setup.step === 3">
            <div class="field-section">
              <h2>一般多久发货呢？</h2>
              <p>请选择通常的发货时间</p>
              <el-radio-group
                v-model="dispatchChoice"
                class="dispatch-options"
                aria-label="发货时效"
                ><el-radio
                  v-for="option in [...dispatchOptions, '其他']"
                  :key="option"
                  :value="option"
                  border
                  >{{ option }}</el-radio
                ></el-radio-group
              ><el-input
                v-if="dispatchChoice === '其他'"
                v-model="setup.draft.dispatchTime"
                class="conditional-field"
                placeholder="请填写本店实际发货时效"
                aria-label="其他发货时效"
                maxlength="2000"
              />
            </div>
            <div class="field-section">
              <h2>提供运费险吗？</h2>
              <el-radio-group v-model="setup.draft.freightInsurance" aria-label="提供运费险"
                ><el-radio :value="true" border>是</el-radio
                ><el-radio :value="false" border>否</el-radio></el-radio-group
              >
              <div v-if="setup.draft.freightInsurance" class="conditional-field">
                <label class="field-label">运费险超额部分由谁承担？</label
                ><el-radio-group
                  v-model="setup.draft.insuranceExcessPayer"
                  aria-label="运费险超额承担方"
                  ><el-radio value="merchant" border>商家承担</el-radio
                  ><el-radio value="buyer" border>买家承担</el-radio
                  ><el-radio value="negotiate" border>双方协商</el-radio></el-radio-group
                ><el-input
                  v-model="setup.draft.insuranceNotes"
                  class="conditional-field"
                  type="textarea"
                  :rows="2"
                  maxlength="2000"
                  placeholder="请补充运费险的其他说明（选填）"
                  aria-label="运费险说明"
                />
              </div>
            </div>
            <div class="shipping-extras">
              <label class="field-label">截单时间（选填）</label
              ><el-input
                v-model="setup.draft.cutoffTime"
                placeholder="仅填写本店实际执行的截单时间"
                maxlength="2000"
                aria-label="截单时间"
              /><label class="field-label conditional-field">其他发货说明（选填）</label
              ><el-input
                v-model="setup.draft.shippingNotes"
                type="textarea"
                :rows="2"
                maxlength="2000"
                placeholder="如特殊地区、预售商品或节假日安排"
                aria-label="其他发货说明"
              />
            </div>
          </template>
          <template v-else-if="setup.step === 4">
            <h2>售后政策设置</h2>
            <div class="after-sales-form">
              <section v-for="field in afterSales" :key="field.key" class="field-section">
                <h3>{{ field.title }}</h3>
                <el-radio-group v-model="setup.draft[field.key]" :aria-label="field.title"
                  ><el-radio :value="true" border>是</el-radio
                  ><el-radio :value="false" border>否</el-radio></el-radio-group
                >
                <div v-if="setup.draft[field.key]" class="conditional-field">
                  <template v-if="field.key === 'cashbackSupported'"
                    ><label class="field-label">返现金额（元）</label
                    ><el-input
                      v-model="setup.draft.cashbackAmount"
                      inputmode="decimal"
                      placeholder="请填写实际活动金额"
                      aria-label="返现金额"
                      maxlength="30" /></template
                  ><template v-if="field.key === 'compensationSupported'"
                    ><label class="field-label">小额补偿上限（元）</label
                    ><el-input
                      v-model="setup.draft.compensationLimit"
                      inputmode="decimal"
                      placeholder="请填写本店确认的补偿上限"
                      aria-label="小额补偿上限"
                      maxlength="30" /></template
                  ><label class="field-label conditional-field">{{ field.label }}</label
                  ><el-input
                    v-model="setup.draft[field.policy]"
                    type="textarea"
                    :rows="2"
                    maxlength="2000"
                    :placeholder="'请填写本店实际的' + field.label"
                    :aria-label="field.label"
                  />
                </div>
              </section>
            </div>
            <p class="quiet-note">
              请核对以上政策，保存后将写入本店客服规则；不会自动处理退款、返现或补偿。
            </p>
          </template>
          <template v-else>
            <div class="finish-hero">
              <span class="success-symbol">✓</span>
              <h1>设置完成</h1>
              <p>本店客服设置已保存，请在训练场核对实际回复效果。</p>
            </div>
            <h2 class="summary-title">您的店铺信息摘要</h2>
            <section class="summary-group">
              <h3>客服风格</h3>
              <dl>
                <dt>AI 客服风格</dt>
                <dd>{{ selectedStyle.name }}（回复长度：{{ lengthNames[setup.draft.length] }}）</dd>
              </dl>
            </section>
            <section class="summary-group">
              <h3>物流设置</h3>
              <dl>
                <dt>发货地</dt>
                <dd>{{ setup.draft.origins.join('、') || '未填写' }}</dd>
                <dt>常用快递</dt>
                <dd>{{ setup.draft.carriers.join('、') || '未填写' }}</dd>
                <dt>支持指定快递</dt>
                <dd>{{ yesNo(setup.draft.designatedCourier) }}</dd>
              </dl>
            </section>
            <section class="summary-group">
              <h3>发货政策</h3>
              <dl>
                <dt>发货时效</dt>
                <dd>{{ setup.draft.dispatchTime || '未填写' }}</dd>
                <dt>运费险</dt>
                <dd>
                  {{ yesNo(setup.draft.freightInsurance)
                  }}<template v-if="setup.draft.freightInsurance"
                    >（超额部分：{{ payerNames[setup.draft.insuranceExcessPayer] }}）{{
                      setup.draft.insuranceNotes
                    }}</template
                  >
                </dd>
                <template v-if="setup.draft.cutoffTime"
                  ><dt>截单时间</dt>
                  <dd>{{ setup.draft.cutoffTime }}</dd></template
                ><template v-if="setup.draft.shippingNotes"
                  ><dt>其他说明</dt>
                  <dd>{{ setup.draft.shippingNotes }}</dd></template
                >
              </dl>
            </section>
            <section class="summary-group">
              <h3>售后政策</h3>
              <dl>
                <template v-for="field in afterSales" :key="field.key"
                  ><dt>{{ field.title.replace('吗？', '').replace('？', '') }}</dt>
                  <dd>
                    {{ yesNo(setup.draft[field.key])
                    }}<template v-if="setup.draft[field.key]"
                      >：<template v-if="field.key === 'cashbackSupported'"
                        >{{ setup.draft.cashbackAmount }} 元；</template
                      ><template v-if="field.key === 'compensationSupported'"
                        >上限 {{ setup.draft.compensationLimit }} 元；</template
                      >{{ setup.draft[field.policy] || '未补充说明' }}</template
                    >
                  </dd></template
                >
              </dl>
            </section>
            <p class="quiet-note">完成设置不会自动开启 AI，正式发送仍需逐条批准。</p>
            <div class="setup-shortcuts">
              <button @click="configure('goods')">商品知识</button
              ><button @click="configure('model-settings')">模型连接设置</button
              ><button @click="configure('training')">AI 训练场</button>
            </div>
            <footer class="finish-actions">
              <el-button @click="editAgain">重新修改</el-button
              ><el-button type="primary" @click="setup.finish()">完成并返回</el-button>
            </footer>
          </template>
        </fieldset>
        <el-alert
          v-if="validation || setup.error"
          class="wizard-error"
          :title="validation || setup.error"
          type="error"
          :closable="false"
          show-icon
        />
        <el-button
          v-if="setup.error"
          class="conditional-field"
          :loading="setup.loading"
          :disabled="setup.saving"
          @click="setup.loadRules()"
          >重新载入</el-button
        >
        <footer v-if="setup.step > 0 && setup.step < 5" class="wizard-footer">
          <el-button data-back :disabled="setup.saving" @click="setup.step--">上一步</el-button
          ><span>尚未保存</span
          ><el-button
            v-if="setup.step < 4"
            type="primary"
            data-next
            :disabled="setup.loading"
            @click="next"
            >下一步</el-button
          ><el-button
            v-else
            type="primary"
            data-save
            :loading="setup.saving"
            :disabled="setup.loading"
            @click="save"
            >保存并完成</el-button
          >
        </footer>
      </section>
    </div>
  </main>
</template>
<style scoped>
.shop-setup-page {
  position: fixed;
  inset: 0;
  z-index: 2100;
  background: #f7f8fa;
  color: #18283d;
  font-size: 14px;
  display: flex;
  flex-direction: column;
}
.wizard-header {
  height: 56px;
  min-height: 56px;
  background: white;
  border-bottom: 1px solid #edeff2;
}
.wizard-header-content {
  max-width: 1360px;
  height: 100%;
  margin: auto;
  padding: 0 28px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}
.wizard-brand,
.wizard-header-actions {
  display: flex;
  align-items: center;
  gap: 10px;
}
.wizard-brand strong {
  font-size: 16px;
  color: #172231;
}
.shop-symbol {
  display: grid;
  place-items: center;
  background: #2189ff;
  border-radius: 5px;
  color: white;
  width: 29px;
  height: 29px;
  font-size: 23px;
}
.shop-name {
  color: #7c899b;
  margin-left: 12px;
  font-size: 12px;
}
.wizard-header-actions {
  color: #6c788a;
  font-size: 12px;
}
.wizard-header-actions button {
  background: transparent;
  border: 0;
  font-size: 26px;
  color: #728095;
  cursor: pointer;
  width: 32px;
  height: 32px;
}
.wizard-scroll {
  flex: 1;
  overflow: auto;
  padding: 16px 24px 48px;
}
.wizard-steps {
  display: flex;
  max-width: 840px;
  margin: 0 auto 30px;
}
.wizard-step {
  position: relative;
  flex: 1;
  display: flex;
  align-items: center;
  flex-direction: column;
  gap: 8px;
  color: #a0a8b5;
  font-size: 14px;
}
.wizard-step:not(:last-child)::after {
  content: '';
  position: absolute;
  height: 1px;
  left: calc(50% + 11px);
  right: calc(-50% + 11px);
  top: 10px;
  background: #aab2be;
}
.wizard-step.passed::after {
  background: #63c83d;
}
.step-circle {
  border: 1px solid currentColor;
  border-radius: 50%;
  background: #fff;
  width: 20px;
  height: 20px;
  display: grid;
  place-items: center;
  font-size: 12px;
}
.wizard-step.active {
  color: #172231;
  font-weight: 600;
}
.wizard-step.passed {
  color: #62c43a;
}
.wizard-card {
  box-sizing: border-box;
  max-width: 840px;
  margin: 0 auto;
  padding: 18px 16px 16px;
  border-radius: 12px;
  background: white;
  box-shadow: 0 3px 5px #14233814;
}
.wizard-card h1 {
  font-size: 21px;
  margin: 16px 0 12px;
  color: #142338;
}
.wizard-card h2 {
  font-size: 17px;
  font-weight: 600;
  margin: 0 0 16px;
}
.wizard-card h3 {
  font-size: 14px;
  font-weight: 600;
  margin: 0 0 14px;
}
.intro-card {
  min-height: 478px;
  text-align: center;
  padding: 46px 28px 30px;
}
.intro-count {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}
.intro-count strong {
  color: #1766ff;
  font-size: 44px;
  font-weight: 600;
  line-height: 1.2;
}
.intro-count span {
  font-size: 16px;
}
.intro-count small {
  color: #8a94a4;
  font-size: 12px;
}
.intro-actions {
  margin-top: 60px;
  margin-bottom: 18px;
}
.intro-description {
  color: #50647f;
  line-height: 1.8;
}
.setup-shortcuts {
  display: flex;
  flex-wrap: wrap;
  gap: 22px;
  justify-content: center;
  margin-top: 26px;
}
.setup-shortcuts button {
  padding: 0;
  color: #3678db;
  font-size: 12px;
  background: none;
  border: 0;
  cursor: pointer;
}
.quiet-note {
  font-size: 12px;
  color: #8b96a6;
  line-height: 1.8;
  margin-top: 18px;
}
.style-columns {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 14px;
  align-items: start;
}
.style-settings {
  border-radius: 12px;
  padding: 16px 14px 22px;
  box-shadow: 0 1px 8px #1722310d;
}
.style-options {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 7px;
  max-height: 252px;
  overflow: auto;
  padding-right: 6px;
}
.style-options button {
  min-height: 64px;
  border: 1px solid #cfd6e2;
  border-radius: 6px;
  background: white;
  text-align: left;
  padding: 10px;
  color: #293d59;
  cursor: pointer;
}
.style-options button.selected {
  background: #e8f4ff;
  border-color: #248cff;
  color: #2087ff;
}
.style-options strong {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 14px;
  font-weight: 500;
}
.style-icon {
  font-size: 16px;
  color: #5989ff;
}
.style-icon.soft {
  color: #ef72b2;
}
.style-icon.warm {
  color: #ff8f20;
}
.style-icon.practical {
  color: #17c76a;
}
.style-options small {
  display: block;
  color: #72829a;
  font-size: 11px;
  margin-top: 5px;
}
.style-settings .length-title {
  margin: 18px 0 8px;
}
.style-settings :deep(.el-slider) {
  width: calc(100% - 10px);
  margin: auto;
}
.length-labels {
  display: flex;
  justify-content: space-between;
  color: #75849c;
  font-size: 11px;
}
.conversation-preview {
  background: #f7f8fa;
  padding: 16px 14px;
  border-radius: 8px;
}
.conversation-body {
  background: #fff;
  border-radius: 5px;
  min-height: 244px;
  padding: 12px 8px;
}
.buyer-message,
.ai-message {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  margin-bottom: 20px;
  font-size: 12px;
  line-height: 1.8;
}
.buyer-message {
  justify-content: flex-end;
}
.buyer-message span {
  background: #f2f3f5;
  border-radius: 12px 12px 2px 12px;
  padding: 8px 10px;
}
.buyer-message b,
.ai-message b {
  border-radius: 50%;
  height: 25px;
  min-width: 25px;
  display: grid;
  place-items: center;
  color: white;
  background: #9aa4b3;
  font-weight: 400;
}
.ai-message b {
  background: #218bff;
}
.ai-message span {
  background: #e8f4ff;
  padding: 8px 10px;
  border-radius: 2px 12px 12px;
}
.conversation-preview p {
  font-size: 11px;
  line-height: 1.7;
  color: #8795a8;
  margin: 12px 0 0;
}
.field-section {
  margin: 0 0 26px;
}
.field-section p {
  color: #708199;
  margin: 0 0 16px;
  line-height: 1.7;
}
.field-section :deep(.el-select) {
  width: 100%;
}
.field-section :deep(.el-radio-group) {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}
.field-section :deep(.el-radio.is-bordered) {
  margin: 0;
  height: 48px;
  min-width: 100px;
  padding: 0 20px;
  border-radius: 6px;
}
.field-section :deep(.el-radio.is-bordered.is-checked) {
  background: #e7f4ff;
  border-color: #238cff;
}
.dispatch-options :deep(.el-radio.is-bordered) {
  min-width: 0;
  height: 44px;
  padding: 0 14px;
}
.conditional-field {
  margin-top: 16px;
}
.field-label {
  display: block;
  margin-bottom: 9px;
  font-size: 12px;
  color: #38475b;
}
.shipping-extras {
  margin-top: 24px;
}
.after-sales-form {
  border-radius: 12px;
  padding: 22px 18px 1px;
  box-shadow: 0 1px 8px #1722310d;
}
.after-sales-form .field-section {
  margin-bottom: 32px;
}
.wizard-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  margin-top: 28px;
  padding-top: 26px;
  border-top: 1px solid #e3e7ee;
}
.wizard-footer span {
  color: #9aa4b3;
  font-size: 12px;
  margin-left: auto;
}
.wizard-footer :deep(.el-button + .el-button) {
  margin-left: 0;
}
.wizard-error {
  margin-top: 18px;
}
.wizard-fields {
  min-width: 0;
  margin: 0;
  padding: 0;
  border: 0;
}
.wizard-fields:disabled {
  pointer-events: none;
}
.loading-banner {
  margin-bottom: 20px;
  color: #3c80df;
  font-size: 13px;
}
.finish-card {
  padding: 26px 34px 22px;
}
.finish-hero {
  text-align: center;
  padding-top: 14px;
}
.success-symbol {
  display: inline-grid;
  place-items: center;
  width: 36px;
  height: 36px;
  border-radius: 50%;
  color: white;
  background: #05c55a;
  font-size: 21px;
}
.finish-hero h1 {
  font-size: 18px;
}
.finish-hero p {
  color: #6d819e;
  font-size: 13px;
}
.summary-title {
  text-align: center;
  margin-top: 56px !important;
  margin-bottom: 28px !important;
}
.summary-title::after {
  content: '';
  display: block;
  width: 52px;
  height: 3px;
  background: #2a8bff;
  margin: 8px auto 0;
}
.summary-group h3 {
  border-bottom: 1px solid #e0e5ec;
  padding-bottom: 12px;
  margin: 22px 0 14px;
}
.summary-group dl {
  display: grid;
  grid-template-columns: 135px 1fr;
  gap: 16px;
  font-size: 12px;
  line-height: 1.8;
  margin: 0 8px;
}
.summary-group dt {
  font-weight: 600;
}
.summary-group dd {
  margin: 0;
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}
.finish-actions {
  border-top: 1px solid #e1e6ee;
  padding-top: 28px;
  margin-top: 28px;
  display: flex;
  justify-content: center;
  gap: 18px;
}
.shop-setup-resume {
  position: fixed;
  right: 30px;
  bottom: 24px;
  z-index: 1800;
  box-shadow: 0 4px 16px #3377ff30;
}
.shop-setup-page :deep(.el-button--primary) {
  background: #2d70ff;
  border-color: #2d70ff;
}
.shop-setup-page :deep(.el-button) {
  min-height: 36px;
  border-radius: 3px;
}
@media (max-width: 700px) {
  .wizard-header-content {
    padding: 0 16px;
  }
  .shop-name,
  .wizard-header-actions span {
    display: none;
  }
  .wizard-scroll {
    padding: 16px 12px 32px;
  }
  .wizard-steps {
    margin-bottom: 24px;
  }
  .wizard-step {
    font-size: 11px;
    gap: 7px;
  }
  .style-columns {
    grid-template-columns: 1fr;
  }
  .intro-card {
    padding-left: 16px;
    padding-right: 16px;
  }
  .intro-card h1 {
    font-size: 19px;
  }
  .conversation-body {
    min-height: 150px;
  }
  .finish-card {
    padding: 22px 18px;
  }
  .summary-group dl {
    grid-template-columns: 100px 1fr;
    gap: 12px;
  }
}
</style>

<!-- ShopRechargeView：保留还原样式标记，业务能力由模块服务逐步接入。 -->
<script setup lang="ts">
import { notifyUnavailable } from '@/shared/ui/feedback'
import ContactQrTrigger from '@/shared/ui/ContactQrTrigger.vue'
import { ref, computed } from 'vue'
import { createShopRechargeViewDemo } from '@/modules/billing/demo/ShopRechargeView'
const demo = createShopRechargeViewDemo()
const __stub = notifyUnavailable

const isTemplate = ref(demo.isTemplate)
const th = ref(demo.th)
const rows = computed(() => demo.rows)
const input = ref(demo.input)
const select = ref(demo.select)
const rowsSummary = computed(() => demo.rowsSummary)
const locked = computed(() => demo.locked)
const is = ref(demo.is)
const isState = ref(demo.isState)
const isDiv = ref(demo.isDiv)
const isHidden = ref(demo.isHidden)
const div = ref(demo.div)
const isHiddenState = ref(demo.isHiddenState)
const rcToast__card = ref(demo.rcToast__card)
const isButton = ref(demo.isButton)
const label = ref(demo.label)
const divState = ref(demo.divState)
const template = ref(demo.template)
const displayText = ref(demo.displayText)
const rcQr__placeholder = ref(demo.rcQr__placeholder)
const thState = ref(demo.thState)
const table = ref(demo.table)
const divStateDetail = ref(demo.divStateDetail)
const fxConfetti = computed(() => demo.fxConfetti)
const rcSheet__body = ref(demo.rcSheet__body)
const isRcPayPanel = computed(() => demo.isRcPayPanel)
const btnLabel = computed(() => demo.btnLabel)
const wechat = ref(demo.wechat)

const emptyPreviewRowsA = demo.emptyPreviewRowsA
const emptyPreviewRowsB = demo.emptyPreviewRowsB
</script>

<template>
  &lt;div class="vip-win-drag" aria-hidden="true"&gt;&lt;/div&gt;&lt;div class="fx-orbs"
  aria-hidden="true"&gt;&lt;i class="orb orb-a"&gt;&lt;/i&gt;&lt;i class="orb
  orb-b"&gt;&lt;/i&gt;&lt;i class="orb orb-c"&gt;&lt;/i&gt;&lt;/div&gt;&lt;canvas id="fxConfetti"
  class="fx-confetti" aria-hidden="true"&gt;&lt;/canvas&gt;
  <div :class="['vip-zoom-hud', { 'is-show': divStateDetail }]" aria-hidden="true">
    {{ fxConfetti }}
  </div>
  <div class="vip-page">
    <header class="vip-hero" data-reveal="">
      <ContactQrTrigger class="vip-hero-qr" text="扫码联系"></ContactQrTrigger>
      <p class="vip-kicker">
        <span class="vip-kicker__dot"></span><span aria-hidden="true"></span>
      </p>
      <h1>咨询能接住，没下单能催，多店不用来回切</h1>
      <p class="vip-hero__desc">按每天来咨询的人数选一档</p>
      <div class="vip-proof">
        <strong>已服务 40,000+ 商家</strong>
        <div class="vip-plats">
          <template
            :key="entryIndex"
            v-for="(item, entryIndex) in [
              '淘宝',
              '天猫',
              '拼多多',
              '抖店',
              '京东',
              '快手',
              '微信小店',
              '小红书',
              '闲鱼',
              '得物',
            ]"
            ><span>{{ item }}</span></template
          >
        </div>
      </div>
      <p class="vip-upsell"><b>进阶版起</b>催拍催付、商品推荐、邀好评、好评返现、小额打款</p>
      <p class="vip-hero__fine"></p>
    </header>
    <main class="vip-shell">
      <div
        class="vip-table-wrap"
        data-reveal=""
        data-reveal-delay="80"
        @pointermove="__stub('此操作')"
        @pointerup="__stub('此操作')"
        @pointercancel="__stub('此操作')"
      >
        <table :class="['vip-compare', { 'is-col-hover': table }]" id="vipCompare">
          <thead>
            <tr>
              <th class="vip-feat-head" scope="col">套餐功能</th>
              <template :key="entryIndex" v-for="(item, entryIndex) in rows"
                ><th
                  scope="col"
                  :class="{
                    'vip-col-rec': th?.[item]?.['recommended'],
                    'is-hover': thState === String(1),
                  }"
                  :data-col="1"
                >
                  <div class="vip-plan-head">
                    <template v-if="th?.[item]?.['badge']"
                      ><span class="vip-plan-badge">{{ th?.[item]?.['badge'] }}</span></template
                    >
                    <div class="vip-plan-name">{{ th?.[item]?.['name'] }}</div>
                    <div class="vip-plan-price">
                      <span class="cur">¥</span
                      ><span class="num" :data-count="th?.[item]?.['price']"></span
                      ><template v-if="true"><span class="wan">万</span></template
                      ><span class="unit">{{ th?.[item]?.['unit'] }}</span>
                    </div>
                    <div class="vip-plan-avg">{{ th?.[item]?.['avg'] }}</div>
                    <div class="vip-plan-fit">{{ th?.[item]?.['fit'] }}</div>
                    <div class="vip-plan-extra">{{ th?.[item]?.['extra'] }}</div>
                    <button
                      :class="[
                        'vip-btn',
                        {
                          'vip-btn--hot': th?.[item]?.['hot'],
                          'vip-btn--dark': th?.[item]?.['contactOnly'],
                        },
                      ]"
                      type="button"
                      :data-buy="item"
                      data-ripple=""
                      @click="__stub('此操作')"
                    >
                      <span aria-hidden="true"></span
                      ><template v-if="th?.[item]?.['hot']"
                        ><span class="vip-hot-tag">热销</span></template
                      >
                    </button>
                  </div>
                </th></template
              >
            </tr>
          </thead>
          <tbody>
            <tr class="vip-cat vip-cat--power">
              <td :colspan="rows?.['length'] + 1">套餐额度</td>
            </tr>
            <tr class="vip-row-metric vip-row-power">
              <td>
                <div class="vip-feat-label">
                  <span class="vip-feat-ico">⚡</span
                  ><span class="vip-power-name"
                    ><span aria-hidden="true"></span><em class="vip-power-tag">套餐额度</em></span
                  >
                </div>
              </td>
              <template :key="index" v-for="(item, index) in rows"
                ><td :data-col="index + 1" :class="false">
                  <b class="vip-power-val"
                    ><component :is="th?.[item]?.['quota']"></component
                    ><span>{{ th?.[item]?.['quotaUnit'] }}</span></b
                  >
                </td></template
              >
            </tr>
            <tr class="vip-row-submetric">
              <td>
                <div class="vip-feat-label">
                  <span class="vip-feat-ico">👥</span
                  ><span class="vip-feat-copy"
                    ><span aria-hidden="true"></span><em>按每天来咨询的人数</em></span
                  >
                </div>
              </td>
              <template :key="index" v-for="(item, index) in rows"
                ><td :data-col="index + 1" :class="false">
                  <b class="vip-metric">{{ th?.[item]?.['reception'] }}</b>
                </td></template
              >
            </tr>
            <template :key="entryIndex" v-for="(item, entryIndex) in emptyPreviewRowsA"
              ><template v-if="item?.['title']"
                ><tr class="vip-cat">
                  <td :colspan="rows?.['length'] + 1">{{ item?.['title'] }}</td>
                </tr></template
              ><template :key="entryIndex" v-for="(childItem, entryIndex) in item?.['rows']"
                ><tr>
                  <td>
                    <div class="vip-feat-label">
                      <span class="vip-feat-ico">{{ childItem?.['ico'] }}</span
                      ><span class="vip-feat-copy"
                        ><span aria-hidden="true"></span
                        ><template v-if="childItem?.['sub']"
                          ><em>{{ childItem?.['sub'] }}</em></template
                        ></span
                      >
                    </div>
                  </td>
                  <template :key="index" v-for="(childItem, index) in emptyPreviewRowsB"
                    ><td :class="false" :data-col="index + 1">
                      <template v-if="childItem?.['kind'] === 'metric'"
                        ><b class="vip-metric">{{ childItem?.['text'] }}</b></template
                      ><template v-else-if="childItem?.['kind'] === 'check'"
                        ><span class="vip-check">✓</span></template
                      ><template v-else-if="childItem?.['kind'] === 'cross'"
                        ><span class="vip-cross">×</span></template
                      ><template v-else-if="childItem?.['kind'] === 'special'"
                        ><span class="vip-special">{{ childItem?.['text'] }}</span></template
                      ><template v-else-if="childItem?.['kind'] === 'blank'"
                        ><span class="vip-blank">—</span></template
                      ><template v-else
                        ><span class="vip-locked">{{ childItem?.['text'] }}</span></template
                      >
                    </td></template
                  >
                </tr></template
              ></template
            >
          </tbody>
        </table>
      </div>
      <section class="vip-power-buy" data-reveal="" data-reveal-delay="90">
        <div class="vip-power-buy__main">
          <strong>单独充值算力</strong><template v-if="locked?.['locked']"><p></p></template
          ><template v-else
            ><p>
              <span aria-hidden="true"></span
              ><select v-show="select" @update:modelValue="__stub('此操作')">
                <template :key="entryIndex" v-for="(item, entryIndex) in rowsSummary"
                  ><option :value="item">{{ th?.[item]?.['name'] }}</option></template
                ></select
              ><span aria-hidden="true"></span></p
          ></template>
          <div class="vip-power-chips">
            <template :key="entryIndex" v-for="(item, entryIndex) in [1, 5, 10, 20, 50]"
              ><button
                type="button"
                :class="{ 'is-on': locked?.['wan'] === item }"
                @click="__stub('此操作')"
              ></button
            ></template>
          </div>
        </div>
        <label class="vip-power-buy__field"
          ><input
            v-show="input"
            @update:modelValue="__stub('此操作')"
            type="number"
            min="1"
            step="1"
            inputmode="numeric"
          /><span>万条</span></label
        >
        <div class="vip-power-buy__sum"></div>
        <button
          type="button"
          class="vip-addon__btn"
          :disabled="locked?.['wan'] < 1"
          @click="__stub('此操作')"
        >
          去充值
        </button>
      </section>
      <section class="vip-addons" data-reveal="" data-reveal-delay="100">
        <h2>按需加购</h2>
        <article class="vip-addon">
          <div>
            <strong>消息聚合</strong>
            <p>一台电脑一年，不限店铺。网页端和客户端在同一个窗口回复。</p>
          </div>
          <div class="vip-addon__price">
            <b><i>¥</i><component :is="is?.['price']"></component></b><span>/台/年</span>
          </div>
          <button type="button" class="vip-addon__btn" @click="__stub('此操作')">立即开通</button>
        </article>
        <article class="vip-addon">
          <div>
            <strong>登录电脑</strong>
            <p>每份永久多一台电脑同时登录，不含算力。</p>
          </div>
          <div class="vip-addon__price">
            <b><i>¥</i><component :is="isState?.['price']"></component></b><span>/台 · 永久</span>
          </div>
          <button type="button" class="vip-addon__btn" @click="__stub('此操作')">立即加购</button>
        </article>
        <article class="vip-addon">
          <div>
            <strong>售后系统</strong>
            <p>
              订单、工单、评价、拦截、催收异常自动处理，帮客户挽回损失、避免平台罚款。私有化赠送一年，其他版本单独购买。
            </p>
          </div>
          <div class="vip-addon__price"><em>单独购买</em></div>
          <button
            type="button"
            class="vip-addon__btn vip-addon__btn--ghost"
            @click="__stub('此操作')"
          >
            去下载
          </button>
        </article>
      </section>
      &lt;div class="vip-notes" data-reveal data-reveal-delay="160"&gt;&lt;article
      class="vip-note"&gt;&lt;div class="vip-note__ico"&gt;⚡&lt;/div&gt;&lt;div
      class="vip-note__body"&gt;&lt;strong&gt;算力怎么扣&lt;/strong&gt;&lt;p&gt;套餐费用充入算力。回复一条消息扣一次，单个客户
      5 条封顶，超出后按已购套餐单价单独充值。&lt;/p&gt;&lt;/div&gt;&lt;/article&gt;&lt;article
      class="vip-note"&gt;&lt;div class="vip-note__ico"&gt;🎁&lt;/div&gt;&lt;div
      class="vip-note__body"&gt;&lt;strong&gt;年费福利&lt;/strong&gt;&lt;p&gt;年付折合更低。轻量版起解锁多店聚合与商品学习。&lt;/p&gt;&lt;/div&gt;&lt;/article&gt;&lt;article
      class="vip-note"&gt;&lt;div class="vip-note__ico"&gt;🛡&lt;/div&gt;&lt;div
      class="vip-note__body"&gt;&lt;strong&gt;终身保价&lt;/strong&gt;&lt;p&gt;服务期内锁定档位权益，一次购买更省心。&lt;/p&gt;&lt;/div&gt;&lt;/article&gt;&lt;/div&gt;&lt;p
      class="vip-disclaimer"&gt;可开发票，对公支付可谈&lt;/p&gt;
    </main>
  </div>
  <div
    :class="['rc-mask', { 'is-show': isDiv }]"
    id="rcMask"
    :hidden="!isHidden"
    @click="__stub('此操作')"
  ></div>
  <aside :class="['rc-sheet', { open: isDiv }]" id="rcSheet" aria-hidden="true">
    <header class="rc-sheet__head">
      <div>
        <strong id="sheetTitle">确认充值</strong>
        <p id="sheetSub">请确认套餐与支付方式</p>
      </div>
      <button
        type="button"
        class="rc-sheet__close"
        id="sheetClose"
        aria-label="关闭"
        @click="__stub('此操作')"
      >
        ×
      </button>
    </header>
    <div class="rc-sheet__body">
      <div class="rc-order">
        <div class="rc-order__row">
          <span>套餐</span><b id="orderName">{{ rcSheet__body?.['name'] }}</b>
        </div>
        <div class="rc-order__row">
          <span>周期</span><b id="orderCycle">{{ rcSheet__body?.['cycle'] }}</b>
        </div>
        <div class="rc-order__row"><span>应付金额</span><b class="price" id="orderPrice"></b></div>
      </div>
      <div class="rc-payways">
        <label :class="['rc-payway', { active: label === 'wechat' }]"
          ><input
            v-show="label"
            @update:modelValue="__stub('此操作')"
            type="radio"
            name="payway"
            value="wechat"
            @change="__stub('此操作')"
          /><span class="ico wechat">微</span><span>微信支付</span></label
        ><label :class="['rc-payway', { active: label === 'alipay' }]"
          ><input
            v-show="label"
            @update:modelValue="__stub('此操作')"
            type="radio"
            name="payway"
            value="alipay"
            @change="__stub('此操作')"
          /><span class="ico alipay">支</span><span>支付宝</span></label
        ><template v-if="isTemplate"
          ><label :class="['rc-payway', { active: label === 'corp' }]"
            ><input
              v-show="label"
              @update:modelValue="__stub('此操作')"
              type="radio"
              name="payway"
              value="corp"
              @change="__stub('此操作')"
            /><span class="ico corp">公</span><span>对公支付</span></label
          ></template
        >
      </div>
      <div v-show="!isRcPayPanel" class="rc-pay-panel" id="payPanelScan">
        <div class="rc-qr">
          <div :class="['rc-qr__box', { 'has-qr': !!divState }]" id="qrBox">
            <template v-if="divState"
              ><img class="rc-qr__img" id="payQrImg" :src="divState" alt="支付二维码" /></template
            ><template v-else
              ><div class="rc-qr__placeholder" id="payQrPlaceholder">
                <div class="rc-qr__scan"></div>
                <span id="payQrHint">{{ rcQr__placeholder }}</span>
              </div></template
            >
          </div>
          <p id="payScanTip">
            <span aria-hidden="true"></span
            ><b id="paywayName">{{
              { wechat: '微信', alipay: '支付宝', corp: '对公支付' }?.[label]
            }}</b
            ><span aria-hidden="true"></span><br /><small id="payStatusTip">{{
              displayText
            }}</small>
          </p>
        </div>
        <template v-if="template"
          ><div id="payError" class="rc-error">{{ template }}</div></template
        >
      </div>
      <div v-show="isRcPayPanel && isTemplate" class="rc-pay-panel" id="payPanelCorp">
        <div class="rc-corp">
          <div class="rc-corp__title">对公转账账户</div>
          <div class="rc-corp__row">
            <span>账户名称</span><b id="corpName">{{ undefined?.['accountName'] }}</b
            ><button
              type="button"
              class="rc-copy"
              :data-copy="undefined?.['accountName']"
              @click="__stub('此操作')"
            >
              复制
            </button>
          </div>
          <div class="rc-corp__row">
            <span>账号</span><b id="corpAccount">{{ undefined?.['accountNumberDisplay'] }}</b
            ><button
              type="button"
              class="rc-copy"
              :data-copy="undefined?.['accountNumber']"
              @click="__stub('此操作')"
            >
              复制
            </button>
          </div>
          <div class="rc-corp__row">
            <span>开户行</span><b>{{ undefined?.['bankName'] }}</b
            ><button
              type="button"
              class="rc-copy"
              :data-copy="undefined?.['bankName']"
              @click="__stub('此操作')"
            >
              复制
            </button>
          </div>
        </div>
        <div class="rc-tip">
          <strong>充值提示</strong>
          <p>{{ undefined?.['tip'] }}</p>
          <template v-if="wechat?.['wechat']"
            ><p>
              <span aria-hidden="true"></span><b>{{ wechat?.['wechat'] }}</b>
            </p></template
          ><template v-if="false"
            ><p><span aria-hidden="true"></span><b></b></p
          ></template>
          <p>
            <button type="button" class="rc-copy" @click="__stub('此操作')">查看客服二维码</button>
          </p>
        </div>
      </div>
    </div>
    <footer class="rc-sheet__foot">
      <button
        type="button"
        class="vip-btn vip-btn--ghost"
        id="sheetCancel"
        data-ripple=""
        @click="__stub('此操作')"
      >
        取消</button
      ><button
        type="button"
        :class="['vip-btn', { 'is-loading': isButton }]"
        id="sheetPay"
        data-ripple=""
        :disabled="isButton"
        @click="__stub('此操作')"
      >
        <span class="btn-label" id="sheetPayLabel" :hidden="isButton">{{ btnLabel }}</span
        ><span class="btn-loading" :hidden="!isButton">处理中…</span>
      </button>
    </footer>
  </aside>
  <div :class="['rc-toast', { 'is-show': div }]" id="rcToast" :hidden="!isHiddenState">
    <div class="rc-toast__card">
      <div class="rc-toast__ok">✓</div>
      <strong>充值成功</strong>
      <p id="toastMsg">{{ rcToast__card }}</p>
      <button type="button" class="vip-btn" id="toastOk" @click="__stub('此操作')">关闭窗口</button>
    </div>
  </div>
</template>

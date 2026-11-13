<!-- AutoSettings：保留还原样式标记，业务能力由模块服务逐步接入。 -->
<script setup lang="ts">
import { notifyUnavailable } from '@/shared/ui/feedback'
import { ref, computed } from 'vue'
import { createAutoSettingsDemo } from '@/modules/reception/demo/AutoSettings'
const demo = createAutoSettingsDemo()
interface Props {
  cfg?: {
    orderNote: boolean
    pddAgreeNote: boolean
    pddAgreeAddr: boolean
    urgeOn: boolean
    pddCouponOn: boolean
    fallbackOn: boolean
    inviteReviewOn: boolean
    pauseAi: string
    orderNoteMode: string
    fallbackSeconds: string
    fallbackHoursOn: boolean
    fallbackStart: string
    fallbackEnd: string
    fallbackReplies: Record<string, string>
    inviteReviewIdleMin: string
    inviteReviewText: string
    pddCouponName: string
    urgeNudgeOn: string
    urgeNudgeIdleMin: string
    urgeNudgeReplies: Record<string, string>
    urgePayOn: string
    urgePayIdleMin: string
    urgePayDiscount: string
    urgePayMaxReduceYuan: string
    urgePayAlsoText: string
    urgePayText: string
  }
  ignoreKw?: Array<string>
  shop?: string
  saved?: string
}
const props = withDefaults(defineProps<Props>(), {
  cfg: () => ({
    orderNote: false,
    pddAgreeNote: false,
    pddAgreeAddr: false,
    urgeOn: false,
    pddCouponOn: false,
    fallbackOn: false,
    inviteReviewOn: false,
    pauseAi: '',
    orderNoteMode: '',
    fallbackSeconds: '',
    fallbackHoursOn: false,
    fallbackStart: '',
    fallbackEnd: '',
    fallbackReplies: {},
    inviteReviewIdleMin: '',
    inviteReviewText: '',
    pddCouponName: '',
    urgeNudgeOn: '',
    urgeNudgeIdleMin: '',
    urgeNudgeReplies: {},
    urgePayOn: '',
    urgePayIdleMin: '',
    urgePayDiscount: '',
    urgePayMaxReduceYuan: '',
    urgePayAlsoText: '',
    urgePayText: '',
  }),
  ignoreKw: () => [],
  shop: '',
  saved: '',
})
const __stub = notifyUnavailable
const rows = computed(() => demo.rows)
const applies = computed(() => demo.applies)
const autoScope = computed(() => demo.autoScope)
const div = ref(demo.div)
</script>

<template>
  <div class="auto-layout" data-v-8643e214="">
    <aside class="auto-rail" aria-label="自动操作功能" data-v-8643e214="">
      <template :key="entryIndex" v-for="(item, entryIndex) in rows"
        ><div :class="['auto-rail__group', { 'is-soon': item?.soon }]" data-v-8643e214="">
          <div class="auto-rail__label" data-v-8643e214="">{{ item?.label }}</div>
          <template :key="entryIndex" v-for="(childItem, entryIndex) in item?.items"
            ><button
              type="button"
              :class="[
                'auto-rail__item',
                {
                  'is-on': childItem?.key === applies?.key,
                  'is-idle': !childItem?.applies || !childItem?.planOk,
                  'is-soon': childItem?.preview && childItem?.planOk,
                  'is-lock': !childItem?.planOk,
                },
              ]"
              @click="__stub('此操作')"
              data-v-8643e214=""
            >
              <span class="auto-rail__name" data-v-8643e214=""
                ><template v-if="childItem?.dirty"
                  ><i
                    class="auto-rail__dot"
                    title="这项有未保存的修改"
                    data-v-8643e214=""
                  ></i></template
                >{{ ' ' + childItem?.title }}</span
              ><em class="auto-rail__state" :data-tone="childItem?.meta?.tone" data-v-8643e214="">{{
                childItem?.meta?.text
              }}</em
              ><span class="auto-rail__plats" data-v-8643e214=""></span></button
          ></template></div
      ></template>
    </aside>
    <div class="auto-detail" data-v-8643e214="">
      <div class="auto-detail__hd" data-v-8643e214="">
        <div data-v-8643e214="">
          <div class="auto-detail__title" data-v-8643e214="">
            <h3 data-v-8643e214="">{{ applies?.title }}</h3>
            <template v-if="applies?.planOk"
              ><template v-if="applies?.preview"
                ><span class="auto-soon" data-v-8643e214="">待上线</span></template
              ></template
            ><template v-else><span class="auto-lock" data-v-8643e214="">需升级</span></template>
          </div>
          <p class="auto-detail__desc" data-v-8643e214="">{{ applies?.desc }}</p>
        </div>
        <template v-if="applies?.key === 'orderNote'"
          ><el-switch
            :model-value="applies?.editable && props?.cfg?.orderNote"
            :disabled="!applies?.editable"
            @change="__stub('此操作')"
            data-v-8643e214=""
          ></el-switch></template
        ><template v-else-if="applies?.key === 'pddAgreeNote'"
          ><el-switch
            :model-value="applies?.editable && props?.cfg?.pddAgreeNote"
            :disabled="!applies?.editable"
            @change="__stub('此操作')"
            data-v-8643e214=""
          ></el-switch></template
        ><template v-else-if="applies?.key === 'pddAgreeAddr'"
          ><el-switch
            :model-value="applies?.editable && props?.cfg?.pddAgreeAddr"
            :disabled="!applies?.editable"
            @change="__stub('此操作')"
            data-v-8643e214=""
          ></el-switch></template
        ><template v-else-if="applies?.key === 'urge'"
          ><el-switch
            :model-value="applies?.editable && props?.cfg?.urgeOn"
            :disabled="!applies?.editable"
            @change="__stub('此操作')"
            data-v-8643e214=""
          ></el-switch></template
        ><template v-else-if="applies?.key === 'pddCoupon'"
          ><el-switch
            :model-value="applies?.editable && props?.cfg?.pddCouponOn"
            :disabled="!applies?.editable"
            @change="__stub('此操作')"
            data-v-8643e214=""
          ></el-switch></template
        ><template v-else-if="applies?.key === 'fallback'"
          ><el-switch
            :model-value="applies?.editable && props?.cfg?.fallbackOn"
            :disabled="!applies?.editable"
            @change="__stub('此操作')"
            data-v-8643e214=""
          ></el-switch></template
        ><template v-else-if="applies?.key === 'invite'"
          ><el-switch
            :model-value="applies?.editable && props?.cfg?.inviteReviewOn"
            :disabled="!applies?.editable"
            @change="__stub('此操作')"
            data-v-8643e214=""
          ></el-switch></template
        ><template v-else-if="applies?.key === 'pauseAi'"
          ><el-select
            :model-value="props?.cfg?.pauseAi"
            @update:modelValue="__stub('此操作')"
            :style="{ width: '120px' }"
            @change="__stub('此操作')"
            data-v-8643e214=""
            ><template
              :key="entryIndex"
              v-for="(item, entryIndex) in ['从不', '2分钟', '15分钟', '30分钟', '1小时', '永久']"
              ><el-option
                :label="item"
                :value="item"
                data-v-8643e214=""
              ></el-option></template></el-select
        ></template>
      </div>
      <div class="auto-brief" data-v-8643e214="">
        <div data-v-8643e214="">
          <span data-v-8643e214="">状态</span
          ><b :data-tone="applies?.meta?.tone" data-v-8643e214="">{{ applies?.meta?.text }}</b>
        </div>
        <div data-v-8643e214="">
          <span data-v-8643e214="">适用平台</span><b data-v-8643e214=""></b>
        </div>
        <div data-v-8643e214="">
          <span data-v-8643e214="">当前店铺</span
          ><b data-tone="idle" data-v-8643e214="">{{ applies?.applies ? '会执行' : '不生效' }}</b>
        </div>
      </div>
      <p class="auto-scope" data-v-8643e214="">{{ autoScope }}</p>
      <template v-if="!applies?.planOk && !applies?.preview"
        ><p class="auto-lock-tip" data-v-8643e214=""></p></template
      ><template v-if="applies?.key === 'orderNote' && props?.cfg?.orderNote"
        ><div class="auto-note-mode" data-v-8643e214="">
          <div class="auto-note-mode__label" data-v-8643e214="">写入方式</div>
          <el-radio-group
            :model-value="props?.cfg?.orderNoteMode"
            @update:modelValue="__stub('此操作')"
            class="auto-note-mode__list"
            :disabled="!applies?.applies"
            @change="__stub('此操作')"
            data-v-8643e214=""
            ><template
              :key="entryIndex"
              v-for="(item, entryIndex) in [
                {
                  id: 'replace',
                  label: '修改备注',
                  tip: '订单已有备注时，直接替换为本次内容（默认）',
                },
                { id: 'append', label: '叠加备注', tip: '在原备注后面追加本次内容' },
                { id: 'skip', label: '有备注则跳过', tip: '订单本身已有备注时，不再写入' },
              ]"
              ><el-radio :label="item?.id" border="" class="auto-note-mode__item" data-v-8643e214=""
                ><strong data-v-8643e214="">{{ item?.label }}</strong
                ><em data-v-8643e214="">{{ item?.tip }}</em></el-radio
              ></template
            ></el-radio-group
          >
        </div></template
      ><template v-else-if="applies?.key === 'fallback'"
        ><div class="auto-fallback-box" data-v-8643e214="">
          <label data-v-8643e214="">超时秒数</label>
          <div class="auto-fallback-seconds-row" data-v-8643e214="">
            <span data-v-8643e214="">超过</span
            ><el-input
              class="auto-fallback-seconds"
              type="number"
              :min="1"
              :max="300"
              :disabled="!applies?.applies"
              :model-value="props?.cfg?.fallbackSeconds ?? 120"
              @update:modelValue="__stub('此操作')"
              @blur="__stub('此操作')"
              data-v-8643e214=""
            ></el-input
            ><span data-v-8643e214=""></span>
          </div>
          <label data-v-8643e214="">生效时间</label>
          <div class="auto-fallback-hours" data-v-8643e214="">
            <el-checkbox
              :model-value="props?.cfg?.fallbackHoursOn"
              @update:modelValue="__stub('此操作')"
              :disabled="!applies?.applies"
              @change="__stub('此操作')"
              data-v-8643e214=""
            >
              只在这段时间发兜底 </el-checkbox
            ><input
              v-show="props?.cfg?.fallbackStart"
              @update:modelValue="__stub('此操作')"
              type="time"
              :disabled="!applies?.applies"
              @change="__stub('此操作')"
              data-v-8643e214=""
            /><span data-v-8643e214="">至</span
            ><input
              v-show="props?.cfg?.fallbackEnd"
              @update:modelValue="__stub('此操作')"
              type="time"
              :disabled="!applies?.applies"
              @change="__stub('此操作')"
              data-v-8643e214=""
            />
          </div>
          <p class="auto-fallback-note" data-v-8643e214="">
            不勾选则全天可发。可以跨天，例如 22:00 到次日 09:00。时段外不发兜底。
          </p>
          <label data-v-8643e214="">兜底话术（建议填满 3 条，发送时随机一条）</label>
          <p class="auto-fallback-note" data-v-8643e214="">
            先点下面某一条，再点模板，会直接换成这条话术。
          </p>
          <div class="auto-fallback-presets" data-v-8643e214="">
            <template
              :key="entryIndex"
              v-for="(item, entryIndex) in [
                {
                  id: 'wait',
                  label: '稍等回复',
                  text: '亲亲不好意思让您久等了，您的消息我已经看到了，马上回您～',
                },
                {
                  id: 'offline',
                  label: '客服不在线',
                  text: '现在客服不在线，您的消息已经记下了，上线后尽快回复您～',
                },
                {
                  id: 'notAftersale',
                  label: '非售后',
                  text: '这边不处理售后问题，售后请在订单里申请或联系售后客服～',
                },
                { id: 'daytime', label: '白天统一处理' },
              ]"
              ><button
                type="button"
                :disabled="!applies?.applies"
                @click="__stub('此操作')"
                data-v-8643e214=""
              >
                {{ item?.label }}
              </button></template
            >
          </div>
          <template :key="entryIndex" v-for="(item, entryIndex) in 3"
            ><div
              :class="['auto-fallback-item', { 'is-on': div === item - 1 }]"
              @click="__stub('此操作')"
              data-v-8643e214=""
            >
              <span data-v-8643e214=""></span
              ><el-input
                :model-value="props?.cfg?.fallbackReplies?.[item - 1]"
                @update:modelValue="__stub('此操作')"
                maxlength="80"
                :disabled="!applies?.applies"
                placeholder="点这一条，再用上面的模板替换"
                @focus="__stub('此操作')"
                @input="__stub('此操作')"
                data-v-8643e214=""
              ></el-input></div
          ></template>
          <p class="auto-fallback-tip" data-v-8643e214="">
            <b data-v-8643e214=""></b
            ><span data-v-8643e214=""
              >勾了生效时间才限时段。客服手动回复后会取消这位买家的兜底；AI
              晚到的那条不再发给顾客。</span
            >
          </p>
        </div></template
      ><template
        v-else-if="applies?.key === 'invite' && applies?.applies && props?.cfg?.inviteReviewOn"
        ><div class="auto-form" data-v-8643e214="">
          <label data-v-8643e214="">静默多久后催好评</label>
          <div class="auto-inline" data-v-8643e214="">
            <el-input
              class="auto-num"
              type="number"
              :min="1"
              :max="60"
              :disabled="!applies?.editable"
              :model-value="props?.cfg?.inviteReviewIdleMin ?? 5"
              @update:modelValue="__stub('此操作')"
              @blur="__stub('此操作')"
              data-v-8643e214=""
            ></el-input
            ><span data-v-8643e214="">分钟仍无新消息，且最近一笔订单已签收，则发邀评话术</span>
          </div>
          <label data-v-8643e214="">邀评话术</label
          ><el-input
            :model-value="props?.cfg?.inviteReviewText"
            @update:modelValue="__stub('此操作')"
            type="textarea"
            rows="2"
            maxlength="200"
            :disabled="!applies?.editable"
            @input="__stub('此操作')"
            data-v-8643e214=""
          ></el-input>
          <ul class="auto-rules" data-v-8643e214="">
            <li data-v-8643e214="">从顾客最后一条消息开始计时。顾客又发了消息，重新计时。</li>
            <li data-v-8643e214="">
              到点只查一次：已签收才发，未签收不补发。下次再咨询并静默满时，若已签收再发。
            </li>
            <li data-v-8643e214="">同一订单只发一次。人工接手或已经转走的会话不发。</li>
          </ul>
        </div></template
      ><template
        v-else-if="applies?.key === 'pddCoupon' && applies?.applies && props?.cfg?.pddCouponOn"
        ><div class="auto-coupon-box" data-v-8643e214="">
          <label data-v-8643e214="">优惠券完整名称</label
          ><el-input
            :model-value="props?.cfg?.pddCouponName"
            @update:modelValue="__stub('此操作')"
            maxlength="40"
            :disabled="!applies?.applies"
            placeholder="请输入优惠券名称（如：新人5元无门槛券）"
            @input="__stub('此操作')"
            data-v-8643e214=""
          ></el-input></div></template
      ><template v-else-if="applies?.key === 'urge' && applies?.applies && props?.cfg?.urgeOn"
        ><div class="auto-form auto-urge" data-v-8643e214="">
          <section class="auto-urge-block" data-v-8643e214="">
            <div class="auto-inline auto-inline--between" data-v-8643e214="">
              <div data-v-8643e214="">
                <label data-v-8643e214="">催拍</label>
                <p data-v-8643e214="">咨询后静默一段时间，查无下单则发催拍话术。</p>
              </div>
              <el-switch
                :model-value="!!props?.cfg?.urgeNudgeOn"
                :disabled="!applies?.editable"
                @change="__stub('此操作')"
                data-v-8643e214=""
              ></el-switch>
            </div>
            <template v-if="props?.cfg?.urgeNudgeOn"
              ><label data-v-8643e214="">静默多久后催拍</label>
              <div class="auto-inline" data-v-8643e214="">
                <span data-v-8643e214="">超过</span
                ><el-input
                  class="auto-num"
                  type="number"
                  :min="1"
                  :max="120"
                  :disabled="!applies?.editable"
                  :model-value="props?.cfg?.urgeNudgeIdleMin ?? 2"
                  @update:modelValue="__stub('此操作')"
                  @blur="__stub('此操作')"
                  data-v-8643e214=""
                ></el-input
                ><span data-v-8643e214="">分钟仍无新消息，且查不到下单，则发文催拍</span>
              </div>
              <label data-v-8643e214="">催拍话术（建议填满 3 条，触发时随机一条）</label
              ><template :key="entryIndex" v-for="(item, entryIndex) in 3"
                ><div class="auto-fallback-item" data-v-8643e214="">
                  <span data-v-8643e214=""></span
                  ><el-input
                    :model-value="props?.cfg?.urgeNudgeReplies?.[item - 1]"
                    maxlength="80"
                    :disabled="!applies?.editable"
                    placeholder="例如：亲亲还在看吗～喜欢的话早点拍下哦"
                    @update:modelValue="__stub('此操作')"
                    data-v-8643e214=""
                  ></el-input></div></template
            ></template>
          </section>
          <section class="auto-urge-block" data-v-8643e214="">
            <div class="auto-inline auto-inline--between" data-v-8643e214="">
              <div data-v-8643e214="">
                <label data-v-8643e214="">催付</label>
                <p data-v-8643e214="">
                  有待支付订单时按折扣改价。改价接口接通前只保存设置，不改价、不发改价话术。
                </p>
              </div>
              <el-switch
                :model-value="!!props?.cfg?.urgePayOn"
                :disabled="!applies?.editable"
                @change="__stub('此操作')"
                data-v-8643e214=""
              ></el-switch>
            </div>
            <template v-if="props?.cfg?.urgePayOn"
              ><label data-v-8643e214="">静默多久后催付</label>
              <div class="auto-inline" data-v-8643e214="">
                <span data-v-8643e214="">超过</span
                ><el-input
                  class="auto-num"
                  type="number"
                  :min="1"
                  :max="120"
                  :disabled="!applies?.editable"
                  :model-value="props?.cfg?.urgePayIdleMin ?? 1"
                  @update:modelValue="__stub('此操作')"
                  @blur="__stub('此操作')"
                  data-v-8643e214=""
                ></el-input
                ><span data-v-8643e214="">分钟仍未付款，则执行催付</span>
              </div>
              <label data-v-8643e214="">拼多多改价折扣</label>
              <div class="auto-inline" data-v-8643e214="">
                <span data-v-8643e214="">按</span
                ><el-input
                  class="auto-num"
                  type="number"
                  min="1"
                  max="10"
                  step="0.1"
                  :disabled="!applies?.editable"
                  :model-value="props?.cfg?.urgePayDiscount ?? 9.5"
                  @update:modelValue="__stub('此操作')"
                  @blur="__stub('此操作')"
                  data-v-8643e214=""
                ></el-input
                ><span data-v-8643e214="">折，且最多减</span
                ><el-input
                  class="auto-num"
                  type="number"
                  min="0"
                  step="0.01"
                  :disabled="!applies?.editable"
                  :model-value="props?.cfg?.urgePayMaxReduceYuan ?? 5"
                  @update:modelValue="__stub('此操作')"
                  @blur="__stub('此操作')"
                  data-v-8643e214=""
                ></el-input
                ><span data-v-8643e214="">元（取较小让利，且不低于 1 折）</span>
              </div>
              <p class="auto-urge-settle" data-v-8643e214=""></p>
              <el-checkbox
                :model-value="!!props?.cfg?.urgePayAlsoText"
                :disabled="!applies?.editable"
                @change="__stub('此操作')"
                data-v-8643e214=""
              >
                改价成功后附带一句催付话术 </el-checkbox
              ><template v-if="props?.cfg?.urgePayAlsoText"
                ><el-input
                  :model-value="props?.cfg?.urgePayText"
                  type="textarea"
                  rows="2"
                  maxlength="80"
                  :disabled="!applies?.editable"
                  :placeholder="'亲亲已帮您改好优惠价，尽快付款哦～'"
                  @update:modelValue="__stub('此操作')"
                  data-v-8643e214=""
                ></el-input></template
            ></template>
          </section>
          <ul class="auto-rules" data-v-8643e214="">
            <li data-v-8643e214="">同一静默窗口：有待支付单只催付，无单才催拍，避免连发。</li>
            <li data-v-8643e214="">
              已下单不再催拍；已付款、已发货或退款不再催付。顾客又发消息会重新计时。
            </li>
            <li data-v-8643e214="">
              催拍会发出话术。催付改价还没接通，待支付单只记日志，不会改价，也不会发「已改好优惠价」。
            </li>
          </ul>
        </div></template
      ><template v-else-if="applies?.preview"
        ><div class="auto-unlive" data-v-8643e214="">
          <span data-v-8643e214="">暂未上线</span><strong data-v-8643e214=""></strong>
          <p data-v-8643e214="">这项还不能设置，上线后才能保存并执行。</p>
        </div></template
      ><template v-else-if="applies?.key === 'pauseAi' && props?.cfg?.pauseAi !== '从不'"
        ><div class="ig-box" data-v-8643e214="">
          <p data-v-8643e214="">
            忽略关键词：人工须<strong data-v-8643e214="">完整发送这两个字</strong
            >，一字不少才能暂停该顾客的 AI 发送。
          </p>
          <div class="tag-editor" data-v-8643e214="">
            <template :key="index" v-for="(item, index) in props?.ignoreKw"
              ><el-tag closable="" @close="__stub('此操作')" data-v-8643e214="">{{
                item
              }}</el-tag></template
            ><el-button size="small" @click="__stub('此操作')" data-v-8643e214=""
              >+ 新增关键词</el-button
            >
          </div>
        </div></template
      >
    </div>
  </div>
</template>

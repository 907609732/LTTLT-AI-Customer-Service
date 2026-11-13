<!-- TransferSettings：保留还原样式标记，业务能力由模块服务逐步接入。 -->
<script setup lang="ts">
import { notifyUnavailable } from '@/shared/ui/feedback'
import { ref } from 'vue'
import { createTransferSettingsDemo } from '@/modules/reception/demo/TransferSettings'
const demo = createTransferSettingsDemo()
interface Props {
  cfg?: {
    enabled: boolean
    autoFavorite: string
    fallbackOnlineTransfer: string
    fallbackBusyTransfer: string
    mediaImage: string
    mediaVideo: string
    mediaCard: string
    smartTransfer: string
    maxAiTurnsOn: string
    maxAiTurns: string
    offlineFallbackOn: string
    fallbackOnce: string
  }
  csList?: Array<string>
  keywords?: Array<string>
}
const props = withDefaults(defineProps<Props>(), {
  cfg: () => ({
    enabled: false,
    autoFavorite: '',
    fallbackOnlineTransfer: '',
    fallbackBusyTransfer: '',
    mediaImage: '',
    mediaVideo: '',
    mediaCard: '',
    smartTransfer: '',
    maxAiTurnsOn: '',
    maxAiTurns: '',
    offlineFallbackOn: '',
    fallbackOnce: '',
  }),
  csList: () => [],
  keywords: () => [],
})
const __stub = notifyUnavailable

const rows = ref(demo.rows)

const emptyPreviewRowsA = demo.emptyPreviewRowsA
</script>

<template>
  <div class="tf-layout" data-v-9df66825="">
    <div class="tf-card" data-v-9df66825="">
      <div class="tf-card__hd" data-v-9df66825="">
        <div data-v-9df66825="">
          <h3 data-v-9df66825="">转接总开关</h3>
          <p data-v-9df66825="">关闭转人工后，下方触发条件不生效；可改用自动收藏重要会话。</p>
        </div>
      </div>
      <div class="switch-row" data-v-9df66825="">
        <div data-v-9df66825="">
          <strong data-v-9df66825=""
            >开启 AI 转人工 <em class="soft-badge" data-v-9df66825="">默认关闭</em></strong
          >
          <p data-v-9df66825="">默认关闭。开启后，按下方规则把会话交给人工客服处理。</p>
        </div>
        <label class="toggle" data-v-9df66825=""
          ><input
            v-show="props?.cfg?.enabled"
            @update:modelValue="__stub('此操作')"
            type="checkbox"
            @change="__stub('此操作')"
            data-v-9df66825="" /><i data-v-9df66825=""></i
        ></label>
      </div>
      <div
        :class="['switch-row', { 'switch-row--disabled': props?.cfg?.enabled }]"
        data-v-9df66825=""
      >
        <div data-v-9df66825="">
          <strong data-v-9df66825="">
            自动收藏重要会话
            <template v-if="props?.cfg?.enabled"
              ><em class="soft-badge" data-v-9df66825="">转接已开 · 已失效</em></template
            ><template v-else-if="props?.cfg?.autoFavorite"
              ><em class="soft-badge soft-badge--ok" data-v-9df66825="">生效中</em></template
            ><template v-else
              ><em class="soft-badge" data-v-9df66825="">未开启</em></template
            ></strong
          >
          <p data-v-9df66825="">
            关闭转人工后，AI 判定需人工接入时自动收藏并标星。开启转人工后本功能失效，配置仍会保存。
          </p>
        </div>
        <label class="toggle" data-v-9df66825=""
          ><input
            v-show="props?.cfg?.autoFavorite"
            @update:modelValue="__stub('此操作')"
            type="checkbox"
            :disabled="props?.cfg?.enabled"
            @change="__stub('此操作')"
            data-v-9df66825="" /><i data-v-9df66825=""></i
        ></label>
      </div>
    </div>
    <div class="tf-card" data-v-9df66825="">
      <div class="tf-card__hd" data-v-9df66825="">
        <span class="tf-step" data-v-9df66825="">1</span>
        <div data-v-9df66825="">
          <h3 data-v-9df66825="">客服接收</h3>
          <p data-v-9df66825="">
            可填模糊名称（如「小云」）；按顺序匹配。下方可开启：名单都搜不到时随机转给一名在线客服。
          </p>
        </div>
      </div>
      <div class="tag-editor" data-v-9df66825="">
        <template :key="index" v-for="(item, index) in props?.csList"
          ><span class="chip" data-v-9df66825=""
            >{{ item + ' '
            }}<button type="button" aria-label="删除" @click="__stub('此操作')" data-v-9df66825="">
              ×
            </button></span
          ></template
        ><button
          class="btn btn--soft btn--sm"
          type="button"
          @click="__stub('此操作')"
          data-v-9df66825=""
        >
          + 添加模糊名称
        </button>
      </div>
      <div class="switch-row" :style="{ 'margin-top': '12px' }" data-v-9df66825="">
        <div data-v-9df66825="">
          <strong data-v-9df66825="">
            名单的人都不在线时转其他在线客服
            <template v-if="props?.cfg?.fallbackOnlineTransfer"
              ><em class="soft-badge soft-badge--ok" data-v-9df66825="">已开启</em></template
            ><template v-else
              ><em class="soft-badge" data-v-9df66825="">默认关闭</em></template
            ></strong
          >
          <p data-v-9df66825="">
            名单里的人都不在线时，从其他在线客服里随机转一人。和拼多多一样。需先有转接名单。默认关闭。
          </p>
        </div>
        <label class="toggle" data-v-9df66825=""
          ><input
            v-show="props?.cfg?.fallbackOnlineTransfer"
            @update:modelValue="__stub('此操作')"
            type="checkbox"
            @change="__stub('此操作')"
            data-v-9df66825="" /><i data-v-9df66825=""></i
        ></label>
      </div>
      <div class="switch-row" :style="{ 'margin-top': '12px' }" data-v-9df66825="">
        <div data-v-9df66825="">
          <strong data-v-9df66825="">
            名单的人小休时仍转给他们
            <template v-if="props?.cfg?.fallbackBusyTransfer"
              ><em class="soft-badge soft-badge--ok" data-v-9df66825="">已开启</em></template
            ><template v-else
              ><em class="soft-badge" data-v-9df66825="">默认关闭</em></template
            ></strong
          >
          <p data-v-9df66825="">
            名单里的人处于小休、忙碌、挂起时，仍转给他们。两个开关都开时，先试名单小休，再试在线兜底。默认关闭。
          </p>
        </div>
        <label class="toggle" data-v-9df66825=""
          ><input
            v-show="props?.cfg?.fallbackBusyTransfer"
            @update:modelValue="__stub('此操作')"
            type="checkbox"
            @change="__stub('此操作')"
            data-v-9df66825="" /><i data-v-9df66825=""></i
        ></label>
      </div>
    </div>
    <div class="tf-card" data-v-9df66825="">
      <div class="tf-card__hd" data-v-9df66825="">
        <span class="tf-step" data-v-9df66825="">2</span>
        <div data-v-9df66825="">
          <h3 data-v-9df66825="">转接触发</h3>
          <p data-v-9df66825="">顾客发出下列消息时触发转人工。智能转接默认开启，可手动关闭。</p>
        </div>
      </div>
      <div class="tf-block" data-v-9df66825="">
        <div class="tf-block__label" data-v-9df66825="">顾客媒体消息</div>
        <div class="tf-check-grid" data-v-9df66825="">
          <label class="tf-check" data-v-9df66825=""
            ><input
              v-show="props?.cfg?.mediaImage"
              @update:modelValue="__stub('此操作')"
              type="checkbox"
              @change="__stub('此操作')"
              data-v-9df66825=""
            /><span data-v-9df66825="">图片</span><em data-v-9df66825="">顾客发图</em></label
          ><label class="tf-check" data-v-9df66825=""
            ><input
              v-show="props?.cfg?.mediaVideo"
              @update:modelValue="__stub('此操作')"
              type="checkbox"
              @change="__stub('此操作')"
              data-v-9df66825=""
            /><span data-v-9df66825="">视频</span><em data-v-9df66825="">顾客发视频</em></label
          ><label class="tf-check" data-v-9df66825=""
            ><input
              v-show="props?.cfg?.mediaCard"
              @update:modelValue="__stub('此操作')"
              type="checkbox"
              @change="__stub('此操作')"
              data-v-9df66825=""
            /><span data-v-9df66825="">订单卡</span><em data-v-9df66825="">顾客发订单卡</em></label
          >
        </div>
        <template v-if="props?.cfg?.mediaCard"
          ><div class="tf-status" data-v-9df66825="">
            <div class="tf-status__hd" data-v-9df66825="">
              <strong data-v-9df66825="">订单状态</strong><em data-v-9df66825=""></em>
            </div>
            <div class="tf-status__list" data-v-9df66825="">
              <template
                :key="entryIndex"
                v-for="(item, entryIndex) in ['待发货', '已发货', '已签收']"
                ><label :class="['tf-status__item', { 'is-on': false }]" data-v-9df66825=""
                  ><input type="checkbox" @change="__stub('此操作')" data-v-9df66825="" /><span
                    data-v-9df66825=""
                    >{{ item }}</span
                  ></label
                ></template
              >
            </div>
          </div></template
        >
      </div>
      <div class="tf-block" data-v-9df66825="">
        <div class="tf-block__label" data-v-9df66825="">AI 规则</div>
        <div class="switch-row" data-v-9df66825="">
          <div data-v-9df66825="">
            <strong data-v-9df66825="">
              智能转接
              <template v-if="props?.cfg?.smartTransfer"
                ><em class="soft-badge soft-badge--ok" data-v-9df66825="">已开启</em></template
              ><template v-else
                ><em class="soft-badge" data-v-9df66825="">已关闭</em></template
              ></strong
            >
            <p data-v-9df66825="">
              识别负面情绪、售后资金等高风险意图时自动转人工。默认开启，可关闭。
            </p>
          </div>
          <label class="toggle" data-v-9df66825=""
            ><input
              v-show="props?.cfg?.smartTransfer"
              @update:modelValue="__stub('此操作')"
              type="checkbox"
              @change="__stub('此操作')"
              data-v-9df66825="" /><i data-v-9df66825=""></i
          ></label>
        </div>
        <div class="switch-row tf-turns-row" data-v-9df66825="">
          <div data-v-9df66825="">
            <strong data-v-9df66825="">
              AI 超过接待次数转接 <em class="soft-badge" data-v-9df66825="">默认关闭</em></strong
            >
            <p data-v-9df66825=""></p>
          </div>
          <div class="tf-turns-acts" data-v-9df66825="">
            <label class="toggle" data-v-9df66825=""
              ><input
                v-show="props?.cfg?.maxAiTurnsOn"
                @update:modelValue="__stub('此操作')"
                type="checkbox"
                @change="__stub('此操作')"
                data-v-9df66825="" /><i data-v-9df66825=""></i></label
            ><select
              v-show="props?.cfg?.maxAiTurns"
              @update:modelValue="__stub('此操作')"
              class="select-mini"
              :disabled="!props?.cfg?.maxAiTurnsOn"
              @change="__stub('此操作')"
              data-v-9df66825=""
            >
              <template :key="entryIndex" v-for="(item, entryIndex) in rows"
                ><option :value="item" data-v-9df66825=""></option
              ></template>
            </select>
          </div>
        </div>
      </div>
      <div class="tf-block" data-v-9df66825="">
        <div class="tf-block__label" data-v-9df66825="">关键词触发</div>
        <p class="tf-block__tip" data-v-9df66825="">
          顾客话术里<strong data-v-9df66825="">包含该关键词</strong
          >即可转接（如消息含「人工」「五点多」）。最多 10 个字。
        </p>
        <div class="suggest" data-v-9df66825="">
          <template :key="entryIndex" v-for="(item, entryIndex) in emptyPreviewRowsA"
            ><button type="button" @click="__stub('此操作')" data-v-9df66825=""></button
          ></template>
        </div>
        <div class="tag-editor" data-v-9df66825="">
          <template :key="index" v-for="(item, index) in props?.keywords"
            ><span class="chip" data-v-9df66825=""
              >{{ item + ' '
              }}<button
                type="button"
                aria-label="删除"
                @click="__stub('此操作')"
                data-v-9df66825=""
              >
                ×
              </button></span
            ></template
          ><button
            class="btn btn--soft btn--sm"
            type="button"
            @click="__stub('此操作')"
            data-v-9df66825=""
          >
            + 新增关键词
          </button>
        </div>
      </div>
    </div>
    <div class="tf-card" data-v-9df66825="">
      <div class="tf-card__hd" data-v-9df66825="">
        <span class="tf-step" data-v-9df66825="">3</span>
        <div data-v-9df66825="">
          <h3 data-v-9df66825="">无人在线兜底</h3>
          <p data-v-9df66825="">
            所有客服都不在线时发送兜底话术；建议填满 3 条，触发时随机一条，减少重复。
          </p>
        </div>
      </div>
      <div class="switch-row" data-v-9df66825="">
        <div data-v-9df66825="">
          <strong data-v-9df66825="">
            开启无人在线兜底话术
            <template v-if="props?.cfg?.offlineFallbackOn"
              ><em class="soft-badge soft-badge--ok" data-v-9df66825="">已开启</em></template
            ><template v-else
              ><em class="soft-badge" data-v-9df66825="">默认关闭</em></template
            ></strong
          >
          <p data-v-9df66825="">
            默认关闭。开启后，转接失败且全部客服不在线时，才会发送下方兜底话术。
          </p>
        </div>
        <label class="toggle" data-v-9df66825=""
          ><input
            v-show="props?.cfg?.offlineFallbackOn"
            @update:modelValue="__stub('此操作')"
            type="checkbox"
            @change="__stub('此操作')"
            data-v-9df66825="" /><i data-v-9df66825=""></i
        ></label>
      </div>
      <template v-if="props?.cfg?.offlineFallbackOn"
        ><label class="tf-once-check" data-v-9df66825=""
          ><input
            v-show="props?.cfg?.fallbackOnce"
            @update:modelValue="__stub('此操作')"
            type="checkbox"
            @change="__stub('此操作')"
            data-v-9df66825=""
          /><span data-v-9df66825=""
            ><strong data-v-9df66825="">同一顾客仅触发一次兜底回复</strong
            ><em data-v-9df66825="">
              默认不勾选。勾选后：同一位顾客在本次对话里，遇到「全部客服不在线」时，系统只会发一次兜底话术；之后即使仍无人在线，也不再重复发送，避免刷屏。不勾选则会在每次转接失败且无人在线时都可能再发。
            </em></span
          ></label
        >
        <div class="auto-fallback-box tf-fallback-box" data-v-9df66825="">
          <label data-v-9df66825="">兜底话术（3 条）</label
          ><template :key="entryIndex" v-for="(item, entryIndex) in 3"
            ><div class="auto-fallback-item" data-v-9df66825="">
              <span data-v-9df66825=""></span
              ><input
                type="text"
                maxlength="80"
                :value="''"
                placeholder="例如：亲亲稍等，客服马上就来～"
                @input="__stub('此操作')"
                data-v-9df66825=""
              /></div></template
          ><em data-v-9df66825="">仅在「全部客服不在线」时触发，随机发送其中一条。</em>
        </div></template
      >
    </div>
  </div>
</template>

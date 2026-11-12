<!-- ShopAftersaleWarningView：保留还原样式标记，业务能力由模块服务逐步接入。 -->
<script setup lang="ts">
import { notifyUnavailable } from '@/shared/ui/feedback'
import BrandMark from '@/shared/ui/BrandMark.vue'
import { ref, computed } from 'vue'
import { createShopAftersaleWarningViewDemo } from '@/modules/quality/demo/ShopAftersaleWarningView'
const demo = createShopAftersaleWarningViewDemo()
const __stub = notifyUnavailable
const button = ref(demo.button)
const buttonState = ref(demo.buttonState)
const modelValue = ref(demo.modelValue)
const rows = computed(() => demo.rows)
const title = computed(() => demo.title)
</script>

<template>
  <div class="warn-page" data-v-f7a0918d="">
    <header class="topbar" data-v-f7a0918d="">
      <BrandMark subtitle="售后预警" data-v-f7a0918d=""></BrandMark>
      <nav class="nav" data-v-f7a0918d="">
        <a href="javascript:void(0)" @click="__stub('此操作')" data-v-f7a0918d="">店铺首页</a
        ><a class="active" href="javascript:void(0)" data-v-f7a0918d="">售后预警</a
        ><RouterLink to="/shop/manage" data-v-f7a0918d="">配置中心</RouterLink>
      </nav>
    </header>
    <main class="main" data-v-f7a0918d="">
      <div class="tabs" data-v-f7a0918d="">
        <span class="active" data-v-f7a0918d=""
          >售后预警
          <b data-v-f7a0918d="">{{
            [
              {
                id: 'w1',
                level: 'urgent',
                levelLabel: '紧急',
                icon: '!',
                title: '物流停滞超 72 小时 · 买家多次催派',
                platform: '拼多多',
                type: '物流异常',
                desc: '订单 #202607318826，买家「小雅」已连续催派 3 次，物流在郑州转运中心无更新已 76 小时。',
                shop: '陈先生家的小铺6768',
                goods: '云朵亲肤纯棉四件套',
                amount: '¥129.00',
                time: '14 分钟前',
                countdown: '剩余 4h 22m',
              },
              {
                id: 'w2',
                level: 'urgent',
                levelLabel: '紧急',
                icon: '退',
                title: '仅退款申请 · 买家声称未收到货',
                platform: '抖店',
                type: '退款纠纷',
                desc: '订单 #DY882910334，签收状态与买家反馈冲突，系统判定为高纠纷风险。',
                shop: '美妆精选旗舰店',
                goods: '氨基酸洁面乳 120ml',
                amount: '¥59.90',
                time: '32 分钟前',
                countdown: '剩余 1h 48m',
              },
              {
                id: 'w3',
                level: 'high',
                levelLabel: '高风险',
                icon: '评',
                title: '中差评倾向 · 会话情绪持续走低',
                platform: '拼多多',
                type: '情绪预警',
                desc: '买家「丽丽妈妈」连续 5 条负面措辞，AI 情绪评分 18/100，预测差评概率 73%。',
                shop: '陈先生家的小铺6768',
                goods: '—',
                amount: '—',
                time: '1 小时前',
                countdown: '建议 30 分钟内跟进',
              },
              {
                id: 'w4',
                level: 'mid',
                levelLabel: '待跟进',
                icon: '跟',
                title: '售后补发申请待确认',
                platform: '淘宝',
                type: '售后跟进',
                desc: '买家申请补发配件，仓库库存充足，等待客服确认地址与原因。',
                shop: '陈先生家的小铺6768',
                goods: '四件套枕套配件',
                amount: '¥0.00',
                time: '3 小时前',
                countdown: '今日内处理',
              },
            ]?.['length']
          }}</b></span
        ><span data-v-f7a0918d="">工单看板</span><span data-v-f7a0918d="">售后看板</span
        ><span data-v-f7a0918d="">监督AI会话</span
        ><em class="shop" data-v-f7a0918d="">店铺：陈先生家的小铺6768</em>
      </div>
      <section class="stats" data-v-f7a0918d="">
        <template
          :key="entryIndex"
          v-for="(item, entryIndex) in [
            { key: 'urgent', label: '紧急预警', value: 3, trend: '较昨日 +2', tone: 'urgent' },
            { key: 'high', label: '高风险', value: 5, trend: '较昨日 +1', tone: 'high' },
            { key: 'mid', label: '待跟进', value: 4, trend: '持平', tone: 'mid' },
            { key: 'ok', label: '今日已处理', value: 18, trend: '处理率 82%', tone: 'ok' },
            { key: 'total', label: '预警总数', value: 12, trend: '跨 3 个平台', tone: 'total' },
          ]"
          ><article :class="['stat', item?.['tone']]" data-v-f7a0918d="">
            <div class="label" data-v-f7a0918d="">{{ item?.['label'] }}</div>
            <div class="value" data-v-f7a0918d="">{{ item }}</div>
            <div class="trend" data-v-f7a0918d="">{{ item?.['trend'] }}</div>
          </article></template
        >
      </section>
      <div class="toolbar" data-v-f7a0918d="">
        <div class="filters" data-v-f7a0918d="">
          <template
            :key="entryIndex"
            v-for="(item, entryIndex) in [
              { key: 'all', label: '全部' },
              { key: 'urgent', label: '紧急' },
              { key: 'high', label: '高风险' },
              { key: 'mid', label: '待跟进' },
            ]"
            ><button
              type="button"
              :class="{ active: button === item?.['key'] }"
              @click="__stub('此操作')"
              data-v-f7a0918d=""
            >
              {{ item?.['label'] }}
            </button></template
          >
        </div>
        <div class="filters plats" data-v-f7a0918d="">
          <template
            :key="entryIndex"
            v-for="(item, entryIndex) in [
              { key: 'all', label: '全平台' },
              { key: '拼多多', label: '拼多多' },
              { key: '抖店', label: '抖店' },
              { key: '淘宝', label: '淘宝' },
            ]"
            ><button
              type="button"
              :class="{ active: buttonState === item?.['key'] }"
              @click="__stub('此操作')"
              data-v-f7a0918d=""
            >
              {{ item?.['label'] }}
            </button></template
          >
        </div>
        <el-input
          :model-value="modelValue"
          @update:modelValue="__stub('此操作')"
          clearable=""
          placeholder="订单号 / 买家 / 商品关键词"
          :style="{ width: '240px' }"
          data-v-f7a0918d=""
        ></el-input>
      </div>
      <div class="board" data-v-f7a0918d="">
        <div class="list" data-v-f7a0918d="">
          <template :key="entryIndex" v-for="(item, entryIndex) in rows"
            ><article
              :class="['card', ['level-' + item?.['level'], { active: item?.['id'] }]]"
              @click="__stub('此操作')"
              data-v-f7a0918d=""
            >
              <div class="level" data-v-f7a0918d="">
                <i data-v-f7a0918d="">{{ item?.['icon'] }}</i
                ><span data-v-f7a0918d="">{{ item?.['levelLabel'] }}</span>
              </div>
              <div class="body" data-v-f7a0918d="">
                <h3 data-v-f7a0918d="">{{ item?.['title'] }}</h3>
                <div class="tags" data-v-f7a0918d="">
                  <span data-v-f7a0918d="">{{ item?.['platform'] }}</span
                  ><span data-v-f7a0918d="">{{ item?.['type'] }}</span>
                </div>
                <p data-v-f7a0918d="">{{ item?.['desc'] }}</p>
                <div class="meta" data-v-f7a0918d="">
                  <span data-v-f7a0918d=""
                    >店铺 <b data-v-f7a0918d="">{{ item?.['shop'] }}</b></span
                  ><span data-v-f7a0918d=""
                    >商品 <b data-v-f7a0918d="">{{ item?.['goods'] }}</b></span
                  ><span data-v-f7a0918d=""
                    >金额 <b data-v-f7a0918d="">{{ item?.['amount'] }}</b></span
                  >
                </div>
              </div>
              <div class="side" data-v-f7a0918d="">
                <em data-v-f7a0918d="">{{ item?.['time'] }}</em
                ><strong data-v-f7a0918d="">{{ item?.['countdown'] }}</strong
                ><el-button type="primary" size="small" @click="__stub('此操作')" data-v-f7a0918d=""
                  >立即处理</el-button
                >
              </div>
            </article></template
          ><el-empty description="暂无匹配预警" data-v-f7a0918d=""></el-empty>
        </div>
        <template v-if="title"
          ><aside class="detail" data-v-f7a0918d="">
            <h3 data-v-f7a0918d="">预警详情</h3>
            <p class="title" data-v-f7a0918d="">{{ title?.['title'] }}</p>
            <dl data-v-f7a0918d="">
              <div data-v-f7a0918d="">
                <dt data-v-f7a0918d="">等级</dt>
                <dd data-v-f7a0918d="">{{ title?.['levelLabel'] }}</dd>
              </div>
              <div data-v-f7a0918d="">
                <dt data-v-f7a0918d="">平台</dt>
                <dd data-v-f7a0918d="">{{ title?.['platform'] }}</dd>
              </div>
              <div data-v-f7a0918d="">
                <dt data-v-f7a0918d="">类型</dt>
                <dd data-v-f7a0918d="">{{ title?.['type'] }}</dd>
              </div>
              <div data-v-f7a0918d="">
                <dt data-v-f7a0918d="">店铺</dt>
                <dd data-v-f7a0918d="">{{ title?.['shop'] }}</dd>
              </div>
              <div data-v-f7a0918d="">
                <dt data-v-f7a0918d="">倒计时</dt>
                <dd data-v-f7a0918d="">{{ title?.['countdown'] }}</dd>
              </div>
            </dl>
            <p class="desc" data-v-f7a0918d="">{{ title?.['desc'] }}</p>
            <el-button type="primary" @click="__stub('此操作')" data-v-f7a0918d=""
              >立即处理</el-button
            >
            <p class="note" data-v-f7a0918d="">演示数据 · 完整售后流程仍在旧 HTML/后续业务迁移中</p>
          </aside></template
        >
      </div>
    </main>
  </div>
</template>

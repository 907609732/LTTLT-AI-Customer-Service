<!-- ShopDeskPanel：保留还原样式标记，业务能力由模块服务逐步接入。 -->
<script setup lang="ts">
import { notifyUnavailable } from '@/shared/ui/feedback'
import { computed } from 'vue'
import { createShopDeskPanelDemo } from '@/modules/shops/demo/ShopDeskPanel'
const demo = createShopDeskPanelDemo()
interface Props {
  shop?: { id: number }
  mod?: string
  loading?: boolean
  goods?: Array<{
    id: string
    name: string
    price: string
    sales: string
    learning: boolean
    learned: string
  }>
  goodsSearch?: string
}
const props = withDefaults(defineProps<Props>(), {
  shop: () => ({ id: 0 }),
  mod: '',
  loading: false,
  goods: () => [],
  goodsSearch: '',
})
const __stub = notifyUnavailable

const src = computed(() => demo.src)
const plat = computed(() => demo.plat)
const kpi = computed(() => demo.kpi)
const kpiSummary = computed(() => demo.kpiSummary)

const emptyPreviewRowsA = demo.emptyPreviewRowsA
</script>

<template>
  <div id="viewDesk" class="view is-on" data-v-1c8a96ec="">
    <div class="desk-head" data-v-1c8a96ec="">
      <button class="btn btn--ghost" type="button" @click="__stub('此操作')" data-v-1c8a96ec="">
        ← 返回列表
      </button>
      <div class="desk-shop" data-v-1c8a96ec="">
        <img class="plat" :src="src?.icon" :alt="src?.name" data-v-1c8a96ec="" />
        <div data-v-1c8a96ec="">
          <h2 data-v-1c8a96ec="">{{ '店铺' }}</h2>
          <p data-v-1c8a96ec="">{{ plat }}</p>
        </div>
      </div>
      <div class="desk-head__acts" data-v-1c8a96ec="">
        <button class="btn btn--soft" type="button" disabled data-v-1c8a96ec="">
          {{ '未接入授权' }}</button
        ><button class="btn btn--ghost" type="button" @click="__stub('此操作')" data-v-1c8a96ec="">
          同步配置
        </button>
      </div>
    </div>
    <div class="desk" data-v-1c8a96ec="">
      <nav class="desk-nav" data-v-1c8a96ec="">
        <div class="desk-nav__label" data-v-1c8a96ec="">本店配置</div>
        <template :key="entryIndex" v-for="(item, entryIndex) in emptyPreviewRowsA"
          ><button
            type="button"
            :class="{ 'is-on': !item?.jump && props?.mod === item?.key }"
            @click="__stub('此操作')"
            data-v-1c8a96ec=""
          >
            {{ item?.label }}
          </button></template
        >
      </nav>
      <div class="desk-body" aria-busy="false" data-v-1c8a96ec="">
        <template v-if="props?.mod === 'overview'"
          ><div class="mod-title" data-v-1c8a96ec="">店铺概览</div>
          <div class="mod-desc" data-v-1c8a96ec="">
            一眼看清本店接待健康度，再从快捷入口进入对应配置。
          </div>
          <div class="kpi-row" data-v-1c8a96ec="">
            <div class="kpi" data-v-1c8a96ec="">
              <span data-v-1c8a96ec="">接待健康度</span><b data-v-1c8a96ec=""></b>
              <p data-v-1c8a96ec="">意图与规则完整度</p>
            </div>
            <div class="kpi" data-v-1c8a96ec="">
              <span data-v-1c8a96ec="">已启用意图</span><b data-v-1c8a96ec="">{{ kpi }}</b>
              <p data-v-1c8a96ec="">当前生效意图数</p>
            </div>
            <div class="kpi" data-v-1c8a96ec="">
              <span data-v-1c8a96ec="">自动回复</span><b data-v-1c8a96ec="">{{ kpiSummary }}</b>
              <p data-v-1c8a96ec="">列表开关可随时切换</p>
            </div>
            <div class="kpi" data-v-1c8a96ec="">
              <span data-v-1c8a96ec="">算力规则</span
              ><b :style="{ 'font-size': '16px' }" data-v-1c8a96ec="">1 回复=1次</b>
              <p data-v-1c8a96ec="">单客户每日最多 5 次</p>
            </div>
          </div>
          <div class="quick-row" data-v-1c8a96ec="">
            <button type="button" @click="__stub('此操作')" data-v-1c8a96ec="">转接人工</button
            ><button type="button" @click="__stub('此操作')" data-v-1c8a96ec="">自动操作</button
            ><button type="button" @click="__stub('此操作')" data-v-1c8a96ec="">进店欢迎</button
            ><button type="button" @click="__stub('此操作')" data-v-1c8a96ec="">图片识别</button
            ><button type="button" @click="__stub('此操作')" data-v-1c8a96ec="">学习商品</button>
          </div>
          <div class="section" data-v-1c8a96ec="">
            <h4 data-v-1c8a96ec="">推荐配置顺序</h4>
            <p class="section__tip" data-v-1c8a96ec="">
              1）设好转接人工 → 2）配好自动操作 → 3）开启进店欢迎 → 4）学习热销商品。
            </p>
          </div></template
        ><template v-else-if="props?.mod === 'goods'"
          ><div class="mod-title" data-v-1c8a96ec="">商品学习</div>
          <div class="mod-desc" data-v-1c8a96ec="">
            本店商品列表：可查询详情；学习走统一自动学习（入库 + 特征分析，约消耗 5 条/商品）。
          </div>
          <div class="section" data-v-1c8a96ec="">
            <p class="section__tip" data-v-1c8a96ec="">
              建议优先学习高销量、高咨询商品；学习完成后 AI 回答规格 / 卖点更准。
            </p>
            <div class="goods-bar" data-v-1c8a96ec="">
              <strong data-v-1c8a96ec=""
                >{{ ' 「' + '' + '」商品 '
                }}<b data-v-1c8a96ec="">{{ props?.goods?.length }}</b></strong
              >
              <div class="goods-bar__tools" data-v-1c8a96ec="">
                <button
                  class="btn btn--primary btn--sm"
                  type="button"
                  @click="__stub('此操作')"
                  data-v-1c8a96ec=""
                >
                  打开商品查询</button
                ><input
                  class="search"
                  :value="props?.goodsSearch"
                  placeholder="商品名称 / 编号"
                  @input="__stub('此操作')"
                  data-v-1c8a96ec=""
                />
              </div>
            </div>
            <div class="table-wrap" data-v-1c8a96ec="">
              <table data-v-1c8a96ec="">
                <thead data-v-1c8a96ec="">
                  <tr data-v-1c8a96ec="">
                    <th data-v-1c8a96ec="">商品编号</th>
                    <th data-v-1c8a96ec="">商品名称</th>
                    <th data-v-1c8a96ec="">价格</th>
                    <th data-v-1c8a96ec="">销量</th>
                    <th data-v-1c8a96ec="">学习状态</th>
                    <th data-v-1c8a96ec="">操作</th>
                  </tr>
                </thead>
                <tbody data-v-1c8a96ec="">
                  <template :key="entryIndex" v-for="(item, entryIndex) in props?.goods"
                    ><tr data-v-1c8a96ec="">
                      <td data-v-1c8a96ec="">{{ item?.id }}</td>
                      <td data-v-1c8a96ec="">{{ item?.name }}</td>
                      <td data-v-1c8a96ec="">{{ item?.price ?? '—' }}</td>
                      <td data-v-1c8a96ec="">{{ item?.sales ?? '—' }}</td>
                      <td data-v-1c8a96ec="">
                        <span
                          :class="['tag', item?.learning ? 'warn' : item?.learned ? 'on' : 'off']"
                          data-v-1c8a96ec=""
                          >{{
                            item?.learning ? '学习中' : item?.learned ? '已学习' : '未学习'
                          }}</span
                        >
                      </td>
                      <td data-v-1c8a96ec="">
                        <div class="row-acts" data-v-1c8a96ec="">
                          <button
                            class="btn btn--ghost btn--sm"
                            type="button"
                            @click="__stub('此操作')"
                            data-v-1c8a96ec=""
                          >
                            查询详情</button
                          ><button
                            class="btn btn--primary btn--sm"
                            type="button"
                            :disabled="item?.learning"
                            @click="__stub('此操作')"
                            data-v-1c8a96ec=""
                          >
                            {{ item?.learned && !item?.learning ? '重新学习' : '学习' }}
                          </button>
                        </div>
                      </td>
                    </tr></template
                  >
                  <tr data-v-1c8a96ec="">
                    <td class="table-empty" colspan="6" data-v-1c8a96ec="">
                      暂无商品，请先同步店铺商品
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div></template
        >
      </div>
    </div>
  </div>
</template>

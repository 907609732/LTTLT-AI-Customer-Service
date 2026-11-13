<!-- ShopSyncConfigDialog：保留还原样式标记，业务能力由模块服务逐步接入。 -->
<script setup lang="ts">
import { notifyUnavailable } from '@/shared/ui/feedback'
import { ref, computed } from 'vue'
import { createShopSyncConfigDialogDemo } from '@/modules/shops/demo/ShopSyncConfigDialog'
const demo = createShopSyncConfigDialogDemo()
interface Props {
  modelValue?: boolean
  sourceShop?: { id: number }
  shops?: { length: number }
  presetItems?: string
}
const props = withDefaults(defineProps<Props>(), {
  modelValue: false,
  sourceShop: () => ({ id: 0 }),
  shops: () => ({ length: 0 }),
  presetItems: '',
})
const __stub = notifyUnavailable

const label = ref(demo.label)
const isInput = ref(demo.isInput)
const input = ref(demo.input)
const isDisabled = ref(demo.isDisabled)
const plat = computed(() => demo.plat)
const src = computed(() => demo.src)
const syncEmpty = computed(() => demo.syncEmpty)
const rows = computed(() => demo.rows)
const isDisabledSummary = computed(() => demo.isDisabledSummary)
const syncFt = computed(() => demo.syncFt)

const emit = defineEmits<{
  'update:modelValue': [visible: boolean]
  'update:enterToSend': [enabled: boolean]
  'update:clearAfterSend': [enabled: boolean]
}>()

const emptyPreviewRowsA = demo.emptyPreviewRowsA
</script>

<template>
  <Teleport to="body" data-v-3f7e9045=""
    ><template v-if="props.modelValue"
      ><div class="shop-manage shop-portal-root" data-v-3f7e9045="">
        <div class="mask" @click="emit('update:modelValue', false)" data-v-3f7e9045=""></div>
        <div
          class="modal modal--sync"
          role="dialog"
          aria-modal="true"
          aria-labelledby="shopSyncTitle"
          @click="__stub('此操作')"
          data-v-3f7e9045=""
        >
          <div class="sync-hd" data-v-3f7e9045="">
            <div class="sync-hd__main" data-v-3f7e9045="">
              <h3 id="shopSyncTitle" data-v-3f7e9045="">同步他店</h3>
              <p data-v-3f7e9045="">
                将 <img class="plat" :src="src?.icon" :alt="src?.name" data-v-3f7e9045="" /><b
                  data-v-3f7e9045=""
                  >{{ plat }}</b
                >
                的接待配置同步到其他店铺 <em data-v-3f7e9045="">会覆盖目标店已有对应项</em>
              </p>
            </div>
            <button
              type="button"
              class="sync-close"
              aria-label="关闭"
              @click="emit('update:modelValue', false)"
              data-v-3f7e9045=""
            >
              ×
            </button>
          </div>
          <div class="sync-split" data-v-3f7e9045="">
            <aside class="sync-pane sync-pane--left" data-v-3f7e9045="">
              <div class="sync-pane__hd" data-v-3f7e9045="">
                <strong data-v-3f7e9045="">同步内容</strong><span data-v-3f7e9045=""></span>
              </div>
              <div class="sync-pane__body" data-v-3f7e9045="">
                <template :key="entryIndex" v-for="(item, entryIndex) in emptyPreviewRowsA"
                  ><label
                    :class="['sync-check', { 'is-on': label?.[item?.key] }]"
                    data-v-3f7e9045=""
                    ><input
                      v-show="label?.[item?.key]"
                      @update:modelValue="emit('update:modelValue', $event)"
                      type="checkbox"
                      data-v-3f7e9045=""
                    /><span data-v-3f7e9045=""
                      ><em data-v-3f7e9045="">{{ item?.label }}</em
                      ><small data-v-3f7e9045="">{{ item?.tip }}</small></span
                    ></label
                  ></template
                >
              </div>
              <p class="sync-hint" data-v-3f7e9045="">勾选后将同步到右侧所选店铺</p>
            </aside>
            <div class="sync-link" aria-hidden="true" data-v-3f7e9045="">
              <span data-v-3f7e9045="">→</span>
            </div>
            <section class="sync-pane sync-pane--right" data-v-3f7e9045="">
              <div class="sync-pane__hd" data-v-3f7e9045="">
                <strong data-v-3f7e9045="">目标店铺</strong><span data-v-3f7e9045=""></span>
              </div>
              <div class="sync-filter" data-v-3f7e9045="">
                <label class="sync-search" data-v-3f7e9045=""
                  ><span data-v-3f7e9045="">⌕</span
                  ><input
                    v-show="input"
                    @update:modelValue="__stub('此操作')"
                    type="search"
                    placeholder="搜索店铺名称"
                    autocomplete="off"
                    data-v-3f7e9045="" /></label
                ><label class="sync-online" data-v-3f7e9045=""
                  ><input
                    v-show="isInput"
                    @update:modelValue="__stub('此操作')"
                    type="checkbox"
                    data-v-3f7e9045=""
                  />
                  只看在线
                </label>
              </div>
              <div class="sync-acts" data-v-3f7e9045="">
                <button type="button" @click="__stub('此操作')" data-v-3f7e9045="">全选</button
                ><button type="button" @click="__stub('此操作')" data-v-3f7e9045="">清空</button
                ><button type="button" @click="__stub('此操作')" data-v-3f7e9045="">反选</button>
              </div>
              <div class="sync-shop-list" data-v-3f7e9045="">
                <template :key="entryIndex" v-for="(item, entryIndex) in rows"
                  ><label :class="['sync-shop', { 'is-on': false }]" data-v-3f7e9045=""
                    ><input type="checkbox" @change="__stub('此操作')" data-v-3f7e9045="" /><img
                      class="plat"
                      :src="''"
                      :alt="''"
                      data-v-3f7e9045=""
                    /><span class="sync-shop__name" :title="item?.name" data-v-3f7e9045="">{{
                      item?.name
                    }}</span
                    ><em :class="item?.online ? 'is-online' : ''" data-v-3f7e9045="">{{
                      item?.online ? '在线' : '离线'
                    }}</em></label
                  ></template
                >
                <p class="sync-empty" data-v-3f7e9045="">
                  {{ syncEmpty?.length ? '没有符合筛选条件的店铺' : '暂无其它可同步的店铺' }}
                </p>
              </div>
            </section>
          </div>
          <div class="sync-ft" data-v-3f7e9045="">
            <p class="sync-summary" data-v-3f7e9045="">{{ syncFt }}</p>
            <div class="sync-ft__acts" data-v-3f7e9045="">
              <button
                class="btn btn--ghost"
                type="button"
                :disabled="isDisabled"
                @click="emit('update:modelValue', false)"
                data-v-3f7e9045=""
              >
                取消</button
              ><button
                class="btn btn--primary"
                type="button"
                :disabled="!isDisabledSummary"
                @click="__stub('此操作')"
                data-v-3f7e9045=""
              >
                {{ isDisabled ? '同步中…' : '确认同步' }}
              </button>
            </div>
          </div>
        </div>
      </div></template
    ></Teleport
  >
</template>

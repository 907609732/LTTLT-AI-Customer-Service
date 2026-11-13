<!-- ShopPicker：保留还原样式标记，业务能力由模块服务逐步接入。 -->
<script setup lang="ts">
import { notifyUnavailable } from '@/shared/ui/feedback'
import { ref, computed } from 'vue'
import { createShopPickerDemo } from '@/modules/shops/demo/ShopPicker'
const demo = createShopPickerDemo()
interface Props {
  modelValue?: string
  shops?: { length: number }
  disabled?: boolean
  placeholder?: string
}
const props = withDefaults(defineProps<Props>(), {
  modelValue: '',
  shops: () => ({ length: 0 }),
  disabled: false,
  placeholder: '',
})
const __stub = notifyUnavailable

const isDiv = ref(demo.isDiv)
const input = ref(demo.input)
const style = ref(demo.style)
const online = computed(() => demo.online)
const src = computed(() => demo.src)
const rows = computed(() => demo.rows)
</script>

<template>
  <div :class="['shop-picker', { 'is-open': isDiv, 'is-off': props?.disabled }]" data-v-c9398f55="">
    <button
      type="button"
      class="shop-picker__btn"
      :disabled="props?.disabled"
      :title="props?.placeholder"
      aria-expanded="false"
      aria-haspopup="listbox"
      @click="__stub('此操作')"
      data-v-c9398f55=""
    >
      <template v-if="true"
        ><img
          class="shop-picker__plat"
          :src="src?.icon"
          :alt="src?.name"
          data-v-c9398f55="" /></template
      ><template v-else
        ><span class="shop-picker__plat shop-picker__plat--empty" data-v-c9398f55=""
          >店</span
        ></template
      ><span class="shop-picker__copy" data-v-c9398f55=""
        ><strong data-v-c9398f55="">{{ props?.placeholder }}</strong
        ><template v-if="online"><em data-v-c9398f55=""></em></template></span
      ><span class="shop-picker__caret" data-v-c9398f55="">▾</span></button
    ><Teleport to="body" data-v-c9398f55=""
      ><template v-if="isDiv"
        ><div class="shop-picker__drop" role="listbox" :style="style" data-v-c9398f55="">
          <label class="shop-picker__search" data-v-c9398f55=""
            ><span data-v-c9398f55="">⌕</span
            ><input
              v-show="input"
              @update:modelValue="__stub('此操作')"
              type="search"
              placeholder="搜索店铺或平台"
              autocomplete="off"
              data-v-c9398f55=""
          /></label>
          <div class="shop-picker__list" data-v-c9398f55="">
            <template :key="entryIndex" v-for="(item, entryIndex) in rows"
              ><button
                type="button"
                :class="[
                  'shop-picker__item',
                  { 'is-on': String(item?.id) === String(props?.modelValue || '') },
                ]"
                role="option"
                aria-selected="false"
                @click="__stub('此操作')"
                data-v-c9398f55=""
              >
                <template v-if="false"
                  ><img
                    class="shop-picker__plat"
                    :src="''"
                    :alt="''"
                    data-v-c9398f55="" /></template
                ><template v-else
                  ><span
                    class="shop-picker__plat shop-picker__plat--empty"
                    data-v-c9398f55=""
                  ></span></template
                ><span class="shop-picker__copy" data-v-c9398f55=""
                  ><strong data-v-c9398f55="">{{ item?.name }}</strong
                  ><em data-v-c9398f55=""></em></span
                ><span
                  :class="['shop-picker__status', item?.online ? 'is-on' : 'is-off']"
                  data-v-c9398f55=""
                  >{{ item?.online ? '已登录' : '未登录' }}</span
                >
              </button></template
            >
            <p class="shop-picker__empty" data-v-c9398f55="">没有符合条件的店铺</p>
          </div>
        </div></template
      ></Teleport
    >
  </div>
</template>

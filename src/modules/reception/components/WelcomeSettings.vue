<!-- WelcomeSettings：保留还原样式标记，业务能力由模块服务逐步接入。 -->
<script setup lang="ts">
import { notifyUnavailable } from '@/shared/ui/feedback'
import { ref, computed } from 'vue'
import { createWelcomeSettingsDemo } from '@/modules/reception/demo/WelcomeSettings'
const demo = createWelcomeSettingsDemo()
interface Props {
  cfg?: {
    enabled: boolean
    text: string
    media: Array<{ pddUrl: string; path: string; url: string; type: string }>
  }
  isPdd?: boolean
}
const props = withDefaults(defineProps<Props>(), {
  cfg: () => ({ enabled: false, text: '', media: [] }),
  isPdd: false,
})
const __stub = notifyUnavailable
const isTemplate = ref(demo.isTemplate)
const inputValue = ref(demo.modelValue)
const panel__bar = computed(() => demo.panel__bar)
const isDisabled = computed(() => demo.isDisabled)
const div = ref(demo.div)
const templateItems = computed(() => demo.templateItems)
</script>

<template>
  <div class="welcome-layout" data-v-4ec93796="">
    <div class="welcome-editor" data-v-4ec93796="">
      <div class="panel__bar" data-v-4ec93796="">
        <div class="panel__title" data-v-4ec93796="">编辑进店欢迎</div>
        <span class="media-tag" data-v-4ec93796=""
          >媒体 <b data-v-4ec93796="">{{ panel__bar }}</b
          >{{ ' / ' + 4 }}</span
        >
      </div>
      <div class="switch-row" data-v-4ec93796="">
        <div data-v-4ec93796="">
          <strong data-v-4ec93796="">开启进店欢迎（本店）</strong>
          <p data-v-4ec93796="">默认关闭。开启后仅对本店生效，进店按下方顺序发送文字与媒体。</p>
        </div>
        <el-switch
          :model-value="props?.cfg?.enabled"
          @update:modelValue="__stub('此操作')"
          @change="__stub('此操作')"
          data-v-4ec93796=""
        ></el-switch>
      </div>
      <div class="field" data-v-4ec93796="">
        <label data-v-4ec93796="">文字欢迎语</label
        ><el-input
          type="textarea"
          rows="4"
          :model-value="props?.cfg?.text"
          :maxlength="200"
          show-word-limit=""
          placeholder="例如：亲亲您好，欢迎光临本店～"
          @update:modelValue="__stub('此操作')"
          data-v-4ec93796=""
        ></el-input
        ><span class="field-hint" data-v-4ec93796=""> 进店问候语 · <b data-v-4ec93796=""></b></span>
      </div>
      <div class="field" data-v-4ec93796="">
        <label data-v-4ec93796=""></label>
        <div class="media-tools" data-v-4ec93796="">
          <el-button
            size="small"
            :disabled="isDisabled"
            @click="__stub('此操作')"
            data-v-4ec93796=""
            >+ 添加图片</el-button
          ><template v-if="props?.isPdd"
            ><el-button
              size="small"
              :disabled="isDisabled"
              @click="__stub('此操作')"
              data-v-4ec93796=""
            >
              + 添加拼多多视频链接
            </el-button></template
          ><template v-else
            ><el-button
              size="small"
              :disabled="isDisabled"
              @click="__stub('此操作')"
              data-v-4ec93796=""
              >+ 添加视频</el-button
            ></template
          ><input
            type="file"
            accept="image/*"
            hidden=""
            @change="__stub('此操作')"
            data-v-4ec93796=""
          /><input
            type="file"
            accept="video/*"
            hidden=""
            @change="__stub('此操作')"
            data-v-4ec93796=""
          />
        </div>
        <template v-if="props?.isPdd"
          ><p class="tip" data-v-4ec93796="">
            拼多多视频需填「素材库 / 上传存放链接」（https://…mp4），不能发本地文件。
          </p></template
        ><template v-if="props?.isPdd && isTemplate"
          ><div class="pdd-row" data-v-4ec93796="">
            <el-input
              :model-value="inputValue"
              @update:modelValue="__stub('此操作')"
              placeholder="粘贴拼多多视频上传存放链接，例如 https://…mp4"
              data-v-4ec93796=""
            ></el-input
            ><el-button type="primary" size="small" @click="__stub('此操作')" data-v-4ec93796=""
              >添加</el-button
            >
          </div></template
        >
        <div class="media-list" data-v-4ec93796="">
          <div class="media-empty" data-v-4ec93796="">尚未添加图片或视频</div>
          <template :key="index" v-for="(item, index) in props?.cfg?.media"
            ><div
              :class="['media-item', { 'is-video': item?.type === 'video' }]"
              data-v-4ec93796=""
            >
              <template v-if="item?.type === 'video' && props.isPdd"
                ><span class="badge" data-v-4ec93796="">拼多多视频链接</span
                ><a
                  :href="item?.pddUrl || item?.path"
                  target="_blank"
                  rel="noreferrer"
                  data-v-4ec93796=""
                  >{{ item?.pddUrl || item?.path }}</a
                ></template
              ><template v-else-if="item?.type === 'video'"
                ><video :src="item?.url" muted preload="metadata" data-v-4ec93796=""></video
                ><span class="badge" data-v-4ec93796="">视频</span></template
              ><template v-else
                ><img :src="item?.url" alt="" data-v-4ec93796="" /><span
                  class="badge"
                  data-v-4ec93796=""
                  >图片</span
                ></template
              ><button
                type="button"
                class="del"
                title="移除"
                @click="__stub('此操作')"
                data-v-4ec93796=""
              >
                ×
              </button>
            </div></template
          >
        </div>
      </div>
    </div>
    <aside class="welcome-preview" data-v-4ec93796="">
      <div class="panel__bar" data-v-4ec93796="">
        <div class="panel__title" data-v-4ec93796="">发送预览</div>
        <span
          :class="['preview-status', props?.cfg?.enabled ? 'is-on' : 'is-off']"
          data-v-4ec93796=""
          >{{ props?.cfg?.enabled ? '已开启 · 进店发送' : '未开启 · 仅预览' }}</span
        >
      </div>
      <div :class="['welcome-chat', { 'is-pulse': div > 0 }]" data-v-4ec93796="">
        <p class="sys" data-v-4ec93796="">买家进入店铺</p>
        <template v-if="templateItems?.length"
          ><p class="tip" data-v-4ec93796=""></p>
          <template :key="index" v-for="(item, index) in templateItems"
            ><div :class="['bubble', { media: item?.type !== 'text' }]" data-v-4ec93796="">
              <template v-if="item?.type === 'text'">{{ item?.text }}</template
              ><template v-else-if="item?.type === 'pdd'"
                ><span data-v-4ec93796="">拼多多视频</span
                ><a :href="item?.url" target="_blank" rel="noreferrer" data-v-4ec93796="">{{
                  item?.url
                }}</a></template
              ><template v-else-if="item?.type === 'video'"
                ><video
                  :src="item?.src"
                  controls
                  muted
                  preload="metadata"
                  data-v-4ec93796=""
                ></video></template
              ><template v-else
                ><img :src="item?.src" alt="" data-v-4ec93796=""
              /></template></div></template></template
        ><template v-else
          ><p class="tip" data-v-4ec93796="">请先填写文字或添加图片 / 视频</p></template
        ><template v-if="!props?.cfg?.enabled && templateItems?.length"
          ><p class="tip tip--warn" data-v-4ec93796="">
            当前未开启，进店不会自动发送。打开左侧开关并保存后才会生效。
          </p></template
        >
      </div>
    </aside>
  </div>
</template>

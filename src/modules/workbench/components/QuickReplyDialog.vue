<!-- Keep legacy data-v markers; local styles only adapt the built-in phrase cards. -->
<script setup lang="ts">
import { computed, ref } from 'vue'
import { ElMessage } from 'element-plus'
import IconSearch from '@/shared/icons/IconSearch.vue'
import {
  browseGenericPhrases,
  genericPhrases,
  genericScenes,
  type GenericPhrase,
} from '@/shared/customer-service/library'
import { copyGenericPhrase } from '../services/generic-phrases'
import QuickReplyCustomLibrary from './QuickReplyCustomLibrary.vue'

const props = withDefaults(defineProps<{ modelValue?: boolean }>(), { modelValue: false })
const emit = defineEmits<{ 'update:modelValue': [visible: boolean] }>()
const query = ref('')
const tab = ref('builtin')
const scene = ref('')
const copying = ref('')
const rows = computed(() => browseGenericPhrases(query.value, scene.value))
const categories = genericScenes.map((name) => ({
  name,
  count: genericPhrases.filter((row) => row.scene === name).length,
}))

function resetFilters() {
  query.value = ''
  scene.value = ''
}

async function copy(row: GenericPhrase) {
  if (copying.value) return
  copying.value = row.id
  try {
    await copyGenericPhrase(row)
    ElMessage.success('话术已复制，请结合当前会话核对后使用')
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '复制失败，请选中话术手动复制')
  } finally {
    copying.value = ''
  }
}
</script>

<template>
  <el-dialog
    :model-value="props.modelValue"
    title="快捷回复"
    width="min(860px, calc(100vw - 40px))"
    append-to-body
    align-center
    :close-on-click-modal="false"
    class="quick-reply-dialog"
    data-v-7dfc4df5=""
    @update:model-value="emit('update:modelValue', $event)"
  >
    <div class="phrase-tabs">
      <el-button :type="tab === 'builtin' ? 'primary' : 'default'" @click="tab = 'builtin'"
        >内置通用话术（80）</el-button
      >
      <el-button :type="tab === 'custom' ? 'primary' : 'default'" @click="tab = 'custom'"
        >我的店铺话术</el-button
      >
    </div>
    <QuickReplyCustomLibrary v-if="tab === 'custom' && props.modelValue" />
    <div
      v-show="tab === 'builtin'"
      class="qr-body"
      data-v-7dfc4df5=""
      data-testid="generic-phrases"
    >
      <div class="qr-hint" data-v-7dfc4df5="">
        <strong data-v-7dfc4df5=""
          >内置 {{ genericPhrases.length }} 条通用话术 · {{ categories.length }} 个场景</strong
        >
        <p data-v-7dfc4df5="">
          用于询问需求、安抚情绪和引导核实。AI
          回复会参考相关表达；商品、订单和售后结论以本店资料为准。
          点击复制后可自行修改，不会直接发送给买家。
        </p>
      </div>
      <el-input
        v-model="query"
        clearable
        aria-label="搜索通用话术"
        placeholder="搜索场景、问题或回复，例如：物流、着急、退货"
        :prefix-icon="IconSearch"
        class="phrase-search"
      />
      <div class="qr-cats" data-v-7dfc4df5="" aria-label="话术场景">
        <button
          type="button"
          :class="['qr-cat', { active: !scene }]"
          :aria-pressed="!scene"
          data-v-7dfc4df5=""
          @click="scene = ''"
        >
          全部 <em data-v-7dfc4df5="">{{ genericPhrases.length }}</em>
        </button>
        <button
          v-for="category in categories"
          :key="category.name"
          type="button"
          :class="['qr-cat', { active: scene === category.name }]"
          :aria-pressed="scene === category.name"
          data-v-7dfc4df5=""
          @click="scene = category.name"
        >
          {{ category.name }} <em data-v-7dfc4df5="">{{ category.count }}</em>
        </button>
      </div>
      <p class="phrase-count" aria-live="polite">
        找到 {{ rows.length }} 条话术 · 使用前请核对适用条件
      </p>
      <div class="qr-list" data-v-7dfc4df5="">
        <article
          v-for="row in rows"
          :key="row.id"
          class="qr-item phrase-card"
          data-v-7dfc4df5=""
          :data-phrase-id="row.id"
        >
          <div class="phrase-heading">
            <span class="qr-tag" data-v-7dfc4df5="">{{ row.scene }}</span>
            <strong>{{ row.intent }}</strong>
            <el-button
              size="small"
              :loading="copying === row.id"
              :disabled="Boolean(copying)"
              :aria-label="'复制：' + row.intent"
              @click="copy(row)"
              >复制话术</el-button
            >
          </div>
          <p class="phrase-reply">{{ row.reply }}</p>
          <p class="phrase-triggers">常见问法：{{ row.triggers.join(' / ') }}</p>
          <details class="phrase-conditions">
            <summary>适用条件与注意事项</summary>
            <p>{{ row.context_required.join('；') || '阅读当前会话后使用，避免重复追问。' }}</p>
            <p>{{ row.avoid }}</p>
          </details>
        </article>
        <div v-if="!rows.length" class="qr-empty" data-v-7dfc4df5="">
          <p>没有匹配的话术，可以换个词或查看全部场景。</p>
          <el-button size="small" @click="resetFilters">查看全部</el-button>
        </div>
      </div>
    </div>
  </el-dialog>
</template>

<style scoped>
.phrase-tabs {
  margin-bottom: 14px;
}
.phrase-search {
  margin-bottom: 12px;
}
.phrase-count {
  margin: 10px 0;
  color: #6b7c93;
  font-size: 12px;
}
.qr-list[data-v-7dfc4df5] {
  max-height: min(48vh, 480px);
  gap: 10px;
}
.qr-item.phrase-card {
  display: block;
  /* The list scrolls; cards must not shrink and clip their reply/usage conditions. */
  flex: 0 0 auto;
  padding: 14px 16px;
  border: 1px solid #e2ebf7;
  background: #f8fbff;
}
.phrase-heading {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: #243656;
}
.phrase-heading strong {
  flex: 1;
}
.phrase-heading .qr-tag {
  max-width: 140px;
  flex-shrink: 0;
}
.phrase-reply {
  margin: 12px 0 8px;
  color: #1f2a37;
  font-size: 14px;
  line-height: 1.7;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  user-select: text;
}
.phrase-triggers,
.phrase-conditions {
  margin: 8px 0 0;
  color: #6b7c93;
  font-size: 12px;
  line-height: 1.6;
}
.phrase-conditions summary {
  cursor: pointer;
  color: #376db1;
}
.phrase-conditions p {
  margin: 6px 0 0;
}
</style>

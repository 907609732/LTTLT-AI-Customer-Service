<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { sourceLabel } from '../manager-labels'
import type {
  KnowledgeProductProfile,
  KnowledgeProductProfileForm,
  KnowledgeStagedProductImage,
} from '@/shared/contracts/knowledge-product-profile'
import KnowledgeProductImage from './KnowledgeProductImage.vue'
const props = withDefaults(
  defineProps<{
    profile: KnowledgeProductProfile
    staged: KnowledgeStagedProductImage[]
    saving: boolean
    staging: boolean
    error: string
    loadAsset: (id: string) => Promise<string>
    returnFocus?: HTMLElement
  }>(),
  { returnFocus: undefined },
)
const emit = defineEmits<{
  change: [form: KnowledgeProductProfileForm]
  'add-images': []
  'remove-staged': [token: string]
  cancel: []
  save: []
  'manage-knowledge': [create: boolean]
}>()
const form = ref<KnowledgeProductProfileForm>({
  title: props.profile.title,
  manualPrice: props.profile.manualPrice,
  notes: props.profile.notes,
  copy: props.profile.copy,
})
const dialog = ref<HTMLElement>(),
  titleInput = ref<HTMLInputElement>(),
  selected = ref(0),
  previousFocus = ref<HTMLElement>()
const gallery = computed(() => [
  ...props.profile.images.map((image) => ({
    key: image.assetId,
    name: image.name,
    assetId: image.assetId,
    preview: '',
    stagedToken: '',
  })),
  ...props.staged.map((image) => ({
    key: image.token,
    name: image.name,
    assetId: '',
    preview: image.preview,
    stagedToken: image.token,
  })),
])
const currentImage = computed(
  () => gallery.value[Math.min(selected.value, gallery.value.length - 1)],
)
const sourceNames = computed(() =>
  props.profile.sources.kinds.map((kind) => sourceLabel(kind)).join(' / '),
)
const platformPrice = computed(() => {
  const value = props.profile.platformPrice
  return {
    text: value.prices.length ? value.prices.join(' / ') : '尚无平台采集价',
    capturedAt: value.capturedAt ? new Date(value.capturedAt).toLocaleString() : '未取得动态快照',
    expiresAt: value.expiresAt
      ? value.expired
        ? `${new Date(value.expiresAt).toLocaleString()} 已过期`
        : `有效至 ${new Date(value.expiresAt).toLocaleString()}`
      : '无动态有效期',
    expired: value.expired,
  }
})
watch(form, (value) => emit('change', { ...value }), { deep: true, immediate: true })
watch(
  () => props.staged.length,
  () => {
    if (selected.value >= gallery.value.length)
      selected.value = Math.max(gallery.value.length - 1, 0)
  },
)
function requestClose() {
  if (!props.saving) emit('cancel')
}
function removeCurrentStaged() {
  if (currentImage.value?.stagedToken) emit('remove-staged', currentImage.value.stagedToken)
}
function focusables() {
  return [
    ...(dialog.value?.querySelectorAll<HTMLElement>(
      'button:not([disabled]),input:not([disabled]),textarea:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])',
    ) || []),
  ].filter((node) => node.getClientRects().length > 0 || node === document.activeElement)
}
function keydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    requestClose()
    return
  }
  if (event.key !== 'Tab') return
  const nodes = focusables()
  if (!nodes.length) return
  const first = nodes[0]!,
    last = nodes.at(-1)!
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault()
    first.focus()
  }
}
onMounted(async () => {
  previousFocus.value =
    props.returnFocus ||
    (document.activeElement instanceof HTMLElement ? document.activeElement : undefined)
  document.addEventListener('keydown', keydown, true)
  await nextTick()
  titleInput.value?.focus({ preventScroll: true })
})
onBeforeUnmount(() => {
  document.removeEventListener('keydown', keydown, true)
  const target = props.returnFocus || previousFocus.value
  if (target?.isConnected) target.focus()
})
</script>
<template>
  <div class="knowledge-product-profile-backdrop" @mousedown.self="requestClose">
    <section
      ref="dialog"
      class="knowledge-product-profile"
      role="dialog"
      aria-modal="true"
      aria-label="编辑商品资料"
    >
      <header class="knowledge-product-profile-header">
        <span class="knowledge-product-profile-head-thumb">
          <KnowledgeProductImage
            v-if="gallery.length"
            :key="gallery[0]!.key"
            :asset-id="gallery[0]!.assetId || undefined"
            :src="gallery[0]!.preview || undefined"
            :alt="`${profile.title}商品图片`"
            :load-asset="loadAsset"
          />
          <span v-else class="knowledge-product-profile-empty">暂无图片</span>
        </span>
        <div class="knowledge-product-profile-heading">
          <h2>{{ form.title.trim() || profile.title || '未命名商品' }}</h2>
          <p>{{ profile.productId }} · {{ sourceNames || '手工录入' }}</p>
        </div>
        <button
          type="button"
          class="knowledge-product-profile-close"
          aria-label="关闭商品编辑"
          :disabled="saving"
          @click="requestClose"
        >
          ×
        </button>
      </header>
      <div class="knowledge-product-profile-body">
        <div class="knowledge-product-profile-grid">
          <section class="knowledge-product-profile-gallery" aria-label="商品图集">
            <div class="knowledge-product-profile-main-image">
              <KnowledgeProductImage
                v-if="currentImage"
                :key="currentImage.key"
                :asset-id="currentImage.assetId || undefined"
                :src="currentImage.preview || undefined"
                :alt="`${currentImage.name}主图`"
                :load-asset="loadAsset"
              />
              <span v-else class="knowledge-product-profile-empty">
                暂无图片<br /><small>从本地选择图片后保存</small>
              </span>
            </div>
            <div
              v-if="gallery.length"
              class="knowledge-product-profile-thumbs"
              aria-label="切换商品图片"
            >
              <button
                v-for="(image, index) in gallery"
                :key="image.key"
                type="button"
                :class="{ active: index === selected }"
                :aria-label="`查看图片 ${image.name}`"
                @click="selected = index"
              >
                <KnowledgeProductImage
                  :asset-id="image.assetId || undefined"
                  :src="image.preview || undefined"
                  :alt="image.name"
                  :load-asset="loadAsset"
                />
              </button>
            </div>
            <div class="knowledge-product-profile-gallery-actions">
              <button
                type="button"
                data-testid="add-product-images"
                :disabled="saving || staging"
                @click="emit('add-images')"
              >
                {{ staging ? '正在选择…' : '从本地加图' }}
              </button>
              <button
                v-if="currentImage?.stagedToken"
                type="button"
                data-testid="remove-staged-image"
                :disabled="saving"
                @click="removeCurrentStaged"
              >
                移除这张
              </button>
              <small>最多 8 张；选择时只暂存，不写知识库</small>
            </div>
          </section>
          <section class="knowledge-product-profile-fields">
            <label>
              商品标题
              <input
                ref="titleInput"
                v-model="form.title"
                aria-label="商品标题"
                maxlength="500"
                :disabled="saving"
              />
              <small>仅保存到当前店铺根商品；共享名称/编码仍在知识点工作区维护</small>
            </label>
            <label>
              商品 ID
              <input :value="profile.productId" aria-label="商品 ID" readonly tabindex="-1" />
            </label>
            <label>
              手工价格
              <input
                v-model="form.manualPrice"
                data-testid="product-manual-price"
                aria-label="手工价格"
                maxlength="60"
                placeholder="未填写"
                :disabled="saving"
              />
              <small>手工价与平台采集价分开保存；留空显示“未填写”</small>
            </label>
            <div class="knowledge-product-profile-platform" aria-label="平台采集价格">
              <div>
                <span>平台采集价</span>
                <strong :class="{ expired: platformPrice.expired }">{{
                  platformPrice.text
                }}</strong>
              </div>
              <small>{{ platformPrice.capturedAt }} · {{ platformPrice.expiresAt }}</small>
            </div>
            <label>
              备注
              <textarea
                v-model="form.notes"
                aria-label="备注"
                rows="4"
                maxlength="4000"
                :disabled="saving"
              />
            </label>
          </section>
        </div>
        <label class="knowledge-product-profile-copy">
          <span
            >商品文案
            <small data-testid="product-copy-count">{{ form.copy.length }} 字</small></span
          >
          <textarea
            v-model="form.copy"
            aria-label="商品文案"
            rows="8"
            maxlength="20000"
            :disabled="saving"
          />
        </label>
        <section class="knowledge-product-profile-knowledge" aria-label="商品知识点">
          <div>
            <b>知识点</b>
            <span>{{ profile.knowledge.approved }} 条已审核</span>
            <span>{{ profile.knowledge.drafts }} 条草稿</span>
          </div>
          <div>
            <button type="button" @click="emit('manage-knowledge', false)">管理知识点</button>
            <button type="button" class="primary" @click="emit('manage-knowledge', true)">
              ＋ 增加一个知识点
            </button>
          </div>
        </section>
        <p v-if="error" class="knowledge-product-profile-error" role="alert">{{ error }}</p>
      </div>
      <footer class="knowledge-product-profile-footer">
        <span v-if="saving">正在保存商品资料…</span>
        <span v-else-if="staging">正在暂存本地图片…</span>
        <button type="button" :disabled="saving" @click="requestClose">取消</button>
        <button type="button" class="primary" :disabled="saving || staging" @click="emit('save')">
          保存
        </button>
      </footer>
    </section>
  </div>
</template>
<style scoped>
.knowledge-product-profile-backdrop {
  position: fixed;
  inset: 0;
  z-index: 32;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: #090807b8;
  color-scheme: dark;
}
.knowledge-product-profile {
  display: flex;
  flex-direction: column;
  width: min(980px, calc(100vw - 48px));
  max-height: min(88vh, 900px);
  min-height: 0;
  overflow: hidden;
  color: #f7f3ea;
  background: #211e1a;
  border: 1px solid #302b26;
  border-radius: 14px;
  box-shadow: 0 28px 90px #00000073;
}
.knowledge-product-profile button,
.knowledge-product-profile input,
.knowledge-product-profile textarea {
  font: inherit;
}
.knowledge-product-profile button {
  min-height: 34px;
  padding: 6px 12px;
  color: #f7f3ea;
  background: #2a2520;
  border: 1px solid #3a342d;
  border-radius: 8px;
  cursor: pointer;
}
.knowledge-product-profile button:hover:not(:disabled) {
  background: #342e28;
}
.knowledge-product-profile button:disabled {
  cursor: not-allowed;
  opacity: 0.45;
}
.knowledge-product-profile button.primary {
  color: #fff;
  background: #2563eb;
  border-color: #2563eb;
}
.knowledge-product-profile button.primary:hover:not(:disabled) {
  background: #1d4ed8;
}
.knowledge-product-profile input:not([type='checkbox']),
.knowledge-product-profile textarea {
  width: 100%;
  color: #f7f3ea;
  background: #191714;
  border: 1px solid #3a342d;
  border-radius: 8px;
  padding: 9px 11px;
}
.knowledge-product-profile input[readonly]:not([type='checkbox']) {
  color: #b8aea1;
  background: #1d1a17;
}
.knowledge-product-profile textarea {
  resize: vertical;
  line-height: 1.6;
}
.knowledge-product-profile input:focus-visible,
.knowledge-product-profile textarea:focus-visible,
.knowledge-product-profile button:focus-visible {
  outline: 2px solid #60a5fa;
  outline-offset: 2px;
}
.knowledge-product-profile-header {
  display: flex;
  align-items: center;
  gap: 14px;
  flex: none;
  padding: 18px;
  border-bottom: 1px solid #302b26;
}
.knowledge-product-profile-head-thumb {
  width: 64px;
  height: 64px;
  flex: none;
  overflow: hidden;
  border: 1px solid #3a342d;
  border-radius: 10px;
}
.knowledge-product-profile-heading {
  flex: 1;
  min-width: 0;
}
.knowledge-product-profile-heading h2 {
  margin: 0;
  overflow: hidden;
  font-size: 20px;
  line-height: 1.4;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.knowledge-product-profile-heading p {
  margin: 4px 0 0;
  overflow: hidden;
  color: #b8aea1;
  font-size: 13px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.knowledge-product-profile-close {
  width: 38px;
  height: 38px;
  padding: 0 !important;
  font-size: 24px;
  line-height: 1;
}
.knowledge-product-profile-body {
  min-height: 0;
  padding: 18px;
  overflow: auto;
}
.knowledge-product-profile-grid {
  display: grid;
  grid-template-columns: 260px minmax(0, 1fr);
  gap: 22px;
}
.knowledge-product-profile-gallery {
  min-width: 0;
}
.knowledge-product-profile-main-image {
  width: 260px;
  height: 260px;
  overflow: hidden;
  border: 1px solid #3a342d;
  border-radius: 12px;
}
.knowledge-product-profile-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  color: #a99f93;
  font-size: 13px;
  text-align: center;
}
.knowledge-product-profile-thumbs {
  display: flex;
  gap: 8px;
  margin-top: 10px;
  padding-bottom: 4px;
  overflow-x: auto;
}
.knowledge-product-profile-thumbs button {
  width: 56px;
  height: 56px;
  flex: none;
  padding: 2px;
  overflow: hidden;
}
.knowledge-product-profile-thumbs button.active {
  border-color: #60a5fa;
  box-shadow: 0 0 0 1px #60a5fa;
}
.knowledge-product-profile-gallery-actions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 10px;
}
.knowledge-product-profile-gallery-actions small {
  flex-basis: 100%;
  color: #8f8579;
  font-size: 12px;
}
.knowledge-product-profile-fields {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
}
.knowledge-product-profile-fields label,
.knowledge-product-profile-copy {
  display: flex;
  flex-direction: column;
  gap: 5px;
  color: #d8d0c5;
  font-size: 13px;
}
.knowledge-product-profile-fields small {
  color: #8f8579;
  font-size: 12px;
}
.knowledge-product-profile-platform {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 11px 12px;
  background: #1d1a17;
  border: 1px solid #3a342d;
  border-radius: 8px;
}
.knowledge-product-profile-platform > div {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.knowledge-product-profile-platform span {
  color: #b8aea1;
  font-size: 13px;
}
.knowledge-product-profile-platform strong {
  color: #f7f3ea;
  font-weight: 600;
}
.knowledge-product-profile-platform strong.expired {
  color: #fbbf24;
}
.knowledge-product-profile-platform small {
  color: #8f8579;
  font-size: 12px;
}
.knowledge-product-profile-copy {
  margin-top: 18px;
}
.knowledge-product-profile-copy > span {
  display: flex;
  justify-content: space-between;
  color: #d8d0c5;
}
.knowledge-product-profile-copy small {
  color: #8f8579;
  font-size: 12px;
}
.knowledge-product-profile-knowledge {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-top: 18px;
  padding: 12px;
  background: #1d1a17;
  border: 1px solid #302b26;
  border-radius: 10px;
}
.knowledge-product-profile-knowledge > div {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
}
.knowledge-product-profile-knowledge span {
  color: #b8aea1;
  font-size: 13px;
}
.knowledge-product-profile-error {
  margin: 14px 0 0;
  padding: 9px 11px;
  color: #fecaca;
  background: #3b1f1f;
  border: 1px solid #6b2e2e;
  border-radius: 8px;
}
.knowledge-product-profile-footer {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 10px;
  flex: none;
  padding: 14px 18px;
  border-top: 1px solid #302b26;
}
.knowledge-product-profile-footer span {
  margin-right: auto;
  color: #8f8579;
  font-size: 12px;
}
@media (max-width: 760px) {
  .knowledge-product-profile-backdrop {
    padding: 10px;
  }
  .knowledge-product-profile {
    width: calc(100vw - 20px);
    max-height: calc(100vh - 20px);
  }
  .knowledge-product-profile-header,
  .knowledge-product-profile-body,
  .knowledge-product-profile-footer {
    padding: 12px;
  }
  .knowledge-product-profile-grid {
    grid-template-columns: 1fr;
    gap: 18px;
  }
  .knowledge-product-profile-main-image {
    width: min(100%, 260px);
    height: auto;
    aspect-ratio: 1 / 1;
    margin: 0 auto;
  }
  .knowledge-product-profile-knowledge {
    align-items: flex-start;
    flex-direction: column;
  }
  .knowledge-product-profile-footer {
    flex-wrap: wrap;
  }
  .knowledge-product-profile-footer span {
    flex-basis: 100%;
  }
}
</style>

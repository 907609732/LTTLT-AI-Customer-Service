<script setup lang="ts">
import { computed, defineAsyncComponent, nextTick, onMounted, ref, watch } from 'vue'
import { useRuntimeStore } from '@/shared/state/runtime'
import { getDesktop } from '@/shared/platform/desktop'
import { useTask } from '@/shared/ui/use-task'
import { getDeveloperDebugBridge } from '@/modules/auxiliary/services/developer-debug'
import { selectReplyMonitor } from '../reply-monitor'

const DeveloperConsolePanel = defineAsyncComponent(
  () => import('@/modules/auxiliary/components/DeveloperConsolePanel.vue'),
)
const runtime = useRuntimeStore(),
  task = useTask(),
  desktop = getDesktop(),
  developerDebug = getDeveloperDebugBridge()
const expanded = ref(false),
  debugLoaded = ref(false),
  bubbleZone = ref<HTMLElement>()
const monitor = computed(() => selectReplyMonitor(runtime.snapshot))
const status = computed(() => monitor.value.status),
  pendingCount = computed(() => monitor.value.pendingCount)
const storeName = computed(
  () =>
    monitor.value.store?.storeName ||
    monitor.value.reply?.storeName ||
    monitor.value.log?.storeName ||
    '暂无店铺',
)
const buyerName = computed(
  () =>
    monitor.value.conversation?.name ||
    monitor.value.reply?.buyerName ||
    monitor.value.log?.buyerName ||
    '等待买家消息',
)
const mode = computed(() => (monitor.value.store?.sendMode === 'auto' ? '自动发送' : '审核发送'))
const canReview = computed(() => monitor.value.reply?.status === 'pending')
const product = computed(() => monitor.value.product)
const productImage = computed(() => {
  const value = product.value?.imageUrl
  if (!value) return ''
  try {
    return new URL(value).protocol === 'https:' ? value : ''
  } catch {
    return ''
  }
})
const productTitle = computed(() => product.value?.title || '商品标题未识别')
const productId = computed(() =>
  product.value?.productId ? `商品 ID ${product.value.productId}` : '商品 ID 未识别',
)
const reason = computed(() => {
  const value =
    task.error.value ||
    runtime.error ||
    monitor.value.reason ||
    (runtime.available ? '开启店铺 AI 后显示回复进度' : '浏览器仅预览，操作需要桌面版')
  // 状态行已经展示同一句 AI 原因时不再重复；气泡正文也不在原因区复述。
  return value === monitor.value.status ? '' : value
})
const failed = computed(() => Boolean(task.error.value || runtime.error))
async function scrollLatest() {
  await nextTick()
  const element = bubbleZone.value
  if (element) element.scrollTop = element.scrollHeight
}
watch(() => monitor.value.bubbles, scrollLatest, { flush: 'post' })
onMounted(scrollLatest)
async function decide(approve: boolean) {
  const id = monitor.value.reply?.id
  if (!id || !canReview.value) return
  await task.run(async () => {
    await runtime.run({ action: 'review-reply', values: { id, approve } })
  })
}
async function openLogs() {
  await task.run(async () => {
    await runtime.run({ action: 'open-runtime-logs' })
  })
}
async function toggleDebug() {
  if (!developerDebug) return
  await task.run(async () => {
    const next = !expanded.value
    if (next) debugLoaded.value = true
    const result = await developerDebug.expand({
      workspaceId: runtime.snapshot.workspaceId,
      expanded: next,
    })
    expanded.value = result.expanded
    if (result.expanded) debugLoaded.value = true
  })
}
async function close() {
  await task.run(async () => {
    await desktop.close()
  })
}
</script>

<template>
  <main :class="['reply-monitor', { expanded }]">
    <header data-window-drag>
      <b>回复监控</b>
      <span class="mode">{{ mode }}</span>
      <button data-no-drag class="close" aria-label="关闭监控" @click="close">×</button>
    </header>
    <div class="monitor-body">
      <section class="monitor-pane">
        <div class="monitor-content">
          <div class="identity">
            <strong :title="storeName">{{ storeName }}</strong
            ><span :title="buyerName">{{ buyerName }}</span>
          </div>
          <section
            class="product-summary"
            :class="{ missing: !product }"
            data-product
            aria-label="当前咨询商品"
          >
            <img
              v-if="productImage"
              data-product-image
              :src="productImage"
              alt=""
              loading="lazy"
              referrerpolicy="no-referrer"
            />
            <div class="product-copy">
              <strong :title="product ? productTitle : '当前咨询商品未识别'">{{
                product ? productTitle : '当前咨询商品未识别'
              }}</strong>
              <small :title="product ? productId : '未取得可靠编号或标题'">{{
                product ? productId : '未取得可靠编号或标题'
              }}</small>
            </div>
          </section>
          <div
            ref="bubbleZone"
            class="bubbles"
            data-zone="bubbles"
            role="log"
            aria-label="当前会话消息"
            aria-live="polite"
          >
            <article
              v-for="bubble in monitor.bubbles"
              :key="bubble.key"
              class="bubble"
              :class="[`from-${bubble.side}`, bubble.status ? `candidate-${bubble.status}` : '']"
              :data-side="bubble.side"
            >
              <span class="bubble-label">{{ bubble.label }}</span>
              <p>{{ bubble.text }}</p>
            </article>
            <p v-if="!monitor.bubbles.length" class="bubble-empty">
              {{ monitor.conversation ? '本会话暂无消息' : '等待买家消息' }}
            </p>
          </div>
          <div class="state" aria-live="polite">
            <i :class="{ failed: monitor.reply?.status === 'failed' }" />{{ status
            }}<span v-if="pendingCount > 1"> · {{ pendingCount }} 条待确认</span>
          </div>
          <p v-if="reason" class="detail" :class="{ error: failed }" :title="reason">
            {{ reason }}
          </p>
        </div>
        <footer>
          <button data-action="logs" class="logs" :disabled="task.pending.value" @click="openLogs">
            高级日志
          </button>
          <button
            v-if="developerDebug"
            data-action="developer-toggle"
            class="developer-toggle"
            :disabled="task.pending.value"
            @click="toggleDebug"
          >
            {{ expanded ? '收起调试' : '开发调试' }}
          </button>
          <template v-if="canReview">
            <button data-action="cancel" :disabled="task.pending.value" @click="decide(false)">
              取消
            </button>
            <button
              data-action="approve"
              class="primary"
              :disabled="task.pending.value"
              @click="decide(true)"
            >
              确认发送
            </button>
          </template>
        </footer>
      </section>
      <section v-if="developerDebug && debugLoaded" v-show="expanded" class="debug-pane">
        <DeveloperConsolePanel
          :expanded="expanded"
          :workspace-id="runtime.snapshot.workspaceId"
          :stores="runtime.snapshot.stores"
          :selected-store-id="monitor.store?.id || runtime.snapshot.stores[0]?.id || ''"
        />
      </section>
    </div>
  </main>
</template>

<style scoped>
.reply-monitor {
  box-sizing: border-box;
  height: 100vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: #fff;
  color: #263248;
  font:
    12px/1.5 -apple-system,
    BlinkMacSystemFont,
    'Segoe UI',
    sans-serif;
}
header {
  display: flex;
  align-items: center;
  gap: 10px;
  height: 38px;
  flex-shrink: 0;
  padding: 0 12px;
  border-bottom: 1px solid #edf0f4;
}
header b {
  font-size: 13px;
}
.mode {
  border-radius: 4px;
  padding: 1px 5px;
  background: #f1f5fa;
  color: #61718a;
  font-size: 10px;
}
button {
  border: 1px solid #e1e6ed;
  border-radius: 5px;
  padding: 4px 10px;
  background: #fff;
  color: #58677c;
  cursor: pointer;
  font: inherit;
}
button:disabled {
  opacity: 0.5;
  cursor: wait;
}
.close {
  margin-left: auto;
  border: 0;
  padding: 0 3px;
  font-size: 20px;
  line-height: 24px;
}
.monitor-body {
  flex: 1;
  min-height: 0;
  display: flex;
}
.monitor-pane {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.monitor-content {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 5px;
  overflow: hidden;
  padding: 8px 10px 3px;
}
.identity {
  display: flex;
  gap: 10px;
  flex: 0 0 auto;
}
.identity strong,
.identity span {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.identity strong {
  max-width: 55%;
}
.identity span {
  color: #6b788b;
}
.product-summary {
  display: flex;
  align-items: center;
  gap: 7px;
  flex: 0 0 auto;
  min-height: 36px;
  border: 1px solid #e9edf3;
  border-radius: 6px;
  padding: 4px 7px;
  background: #fbfcfe;
}
.product-summary img {
  width: 30px;
  height: 30px;
  flex: 0 0 auto;
  border-radius: 4px;
  object-fit: cover;
}
.product-summary.missing {
  border-style: dashed;
  background: #fff;
  color: #8a95a5;
}
.product-copy {
  min-width: 0;
  display: flex;
  flex-direction: column;
}
.product-copy strong,
.product-copy small {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.product-copy strong {
  color: #33435a;
  font-size: 11px;
  font-weight: 600;
}
.product-copy small {
  color: #8a95a5;
  font-size: 10px;
}
.bubbles {
  flex: 1 1 64px;
  min-height: 46px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  overflow-x: hidden;
  overflow-y: auto;
  padding: 1px 2px 2px;
}
.bubble {
  max-width: 84%;
  border-radius: 8px;
  padding: 4px 7px 5px;
  border: 1px solid transparent;
  line-height: 1.45;
}
.bubble p {
  margin: 1px 0 0;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.bubble-label {
  display: block;
  color: #8a95a5;
  font-size: 9px;
}
.from-buyer {
  align-self: flex-start;
  border-color: #e6ebf2;
  background: #f3f6fa;
}
.from-seller {
  align-self: flex-end;
  border-color: #d8e5fb;
  background: #eaf1fd;
}
.from-system {
  align-self: center;
  max-width: 92%;
  border-style: dashed;
  border-color: #e3e7ee;
  background: #f7f8fa;
  color: #7d8797;
}
.from-candidate {
  align-self: flex-end;
  border-style: dashed;
  border-color: #e5b96a;
  background: #fffaf0;
}
.from-candidate.candidate-sending {
  border-color: #8fb7ee;
  background: #f5f9ff;
}
.from-candidate.candidate-sent {
  border-color: #a8ceb4;
  background: #f1f8f3;
}
.from-candidate.candidate-failed {
  border-color: #dc705c;
  background: #fff4f2;
}
.bubble-empty {
  margin: auto;
  color: #9aa4b2;
  font-size: 11px;
}
.state {
  display: flex;
  align-items: center;
  flex: 0 0 auto;
  color: #76849a;
  font-size: 11px;
}
i {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  margin-right: 5px;
  background: #6298ec;
}
i.failed {
  background: #dc705c;
}
.detail {
  margin: 0;
  flex: 0 1 auto;
  color: #8a95a5;
  font-size: 11px;
  max-height: 30px;
  overflow: auto;
  overflow-wrap: anywhere;
}
.detail.error {
  color: #c65746;
}
footer {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 7px;
  flex: 0 0 auto;
  padding: 8px 12px;
  border-top: 1px solid #f0f2f5;
}
.logs {
  margin-right: auto;
  padding-left: 0;
  border: 0;
  color: #758399;
}
.developer-toggle {
  color: #2563b8;
}
.primary {
  background: #397ff2;
  border-color: #397ff2;
  color: white;
}
.reply-monitor.expanded .monitor-body {
  display: grid;
  grid-template-columns: 340px minmax(0, 1fr);
}
.reply-monitor.expanded .monitor-pane {
  width: 340px;
  border-right: 1px solid #e7ecf3;
}
.debug-pane {
  flex: 1;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}
@media (max-width: 719px) {
  .reply-monitor.expanded .monitor-body {
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: minmax(220px, 42%) minmax(0, 1fr);
  }
  .reply-monitor.expanded .monitor-pane {
    width: auto;
    border-right: 0;
    border-bottom: 1px solid #e7ecf3;
  }
}
</style>

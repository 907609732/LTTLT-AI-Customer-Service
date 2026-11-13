<script setup lang="ts">
import { computed, ref, watch, nextTick } from 'vue'
import { useRuntimeStore } from '@/shared/state/runtime'
import { useTask } from '@/shared/ui/use-task'
import { getDesktop } from '@/shared/platform/desktop'
const runtime = useRuntimeStore(),
  task = useTask(),
  desktop = getDesktop()
const tab = ref('pending'),
  storeId = ref(''),
  query = ref(''),
  traceId = ref('')
const follow = ref(true),
  logEnd = ref<HTMLElement>()
watch(
  () => [runtime.snapshot.review.logs.at(-1)?.id, tab.value],
  async () => {
    if (follow.value && tab.value === 'logs') {
      await nextTick()
      logEnd.value?.scrollIntoView({ block: 'end' })
    }
  },
)
const matches = (row: { storeId: string; buyerName: string; uid: string }) =>
  (!storeId.value || row.storeId === storeId.value) &&
  (!query.value || `${row.buyerName} ${row.uid}`.includes(query.value))
const replies = computed(() =>
  runtime.snapshot.review.replies
    .filter(matches)
    .slice()
    .sort((a, b) => a.at - b.at),
)
const pendingCount = computed(
  () => runtime.snapshot.review.replies.filter((r) => r.status === 'pending').length,
)
const logs = computed(() =>
  runtime.snapshot.review.logs
    .filter(matches)
    .slice()
    .sort((a, b) => a.at - b.at),
)
const traces = computed(() =>
  runtime.snapshot.review.traces
    .filter(matches)
    .slice()
    .sort((a, b) => b.at - a.at),
)
const selectedTrace = computed(() =>
  runtime.snapshot.review.traces.find((t) => t.id === traceId.value),
)
const labels = {
  pending: '等待确认',
  sending: '发送中',
  sent: '已发送',
  rejected: '已取消',
  expired: '已失效',
  failed: '需核对发送',
}
const time = (at: number) => new Date(at).toLocaleString('zh-CN', { hour12: false })
const duration = (milliseconds: number) =>
  milliseconds < 1000
    ? `${Math.round(milliseconds)} 毫秒`
    : `${(milliseconds / 1000).toFixed(2)} 秒`
async function decide(id: string, approve: boolean) {
  await task.run(async () => {
    await runtime.run({ action: 'review-reply', values: { id, approve } })
  })
}
function showTrace(id: string) {
  traceId.value = id
  tab.value = 'traces'
}
async function resume(storeId: string, uid: string) {
  await task.run(async () => {
    await runtime.run({ action: 'resume-conversation', storeId, conversationId: uid })
  })
}
</script>
<template>
  <main class="logs-window">
    <header data-window-drag class="logs-header">
      <div><b>实时日志与 AI 发送确认</b><small>消息按时间排列 · AI 回复经你确认后发送</small></div>
      <div class="runtime-actions" data-no-drag>
        <el-button @click="desktop.minimize()">最小化</el-button
        ><el-button @click="desktop.close()">关闭</el-button>
      </div>
    </header>
    <section class="logs-body">
      <el-alert
        v-if="!runtime.available"
        title="浏览器仅预览；实时消息和确认发送需要桌面版。"
        type="info"
        :closable="false"
      />
      <el-alert
        v-if="task.error.value || runtime.error"
        :title="task.error.value || runtime.error"
        type="error"
        :closable="false"
      />
      <p class="logs-note">
        仅本次运行保留最近 500 条日志、40 次 AI
        请求及最近确认记录。调试含买家消息，请勿随意分享。关闭此窗不会发送；候选 10
        分钟过期，新消息或人工回复会使旧候选失效。
      </p>
      <div class="runtime-actions">
        <el-select v-model="storeId" placeholder="所有店铺" clearable style="width: 240px"
          ><el-option
            v-for="shop in runtime.snapshot.stores"
            :key="shop.id"
            :label="shop.storeName"
            :value="shop.id" /></el-select
        ><el-input
          v-model="query"
          placeholder="按买家名称 / 用户 ID 筛选"
          clearable
          style="width: 300px"
        />
        <el-checkbox v-model="follow">跟随最新日志</el-checkbox>
      </div>
      <el-tabs v-model="tab">
        <el-tab-pane :label="`发送确认（${pendingCount}）`" name="pending">
          <p v-if="!replies.length">
            暂无候选。开启店铺 AI 并收到买家消息后，生成结果会在这里等待确认。
          </p>
          <article v-for="row in replies" :key="row.id" class="logs-card" :data-review-id="row.id">
            <div class="logs-meta">
              <b>{{ row.storeName }} / {{ row.buyerName }}</b
              ><span>用户 {{ row.uid }} · {{ time(row.at) }} · {{ labels[row.status] }}</span>
            </div>
            <pre>{{ row.text }}</pre>
            <p>{{ row.reason }}</p>
            <div class="runtime-actions">
              <el-button v-if="row.traceId" @click="showTrace(row.traceId)"
                >查看发给 AI 的上下文</el-button
              ><template v-if="row.status === 'pending'"
                ><el-button
                  type="primary"
                  :disabled="task.pending.value"
                  @click="decide(row.id, true)"
                  >确定发送这条消息</el-button
                ><el-button :disabled="task.pending.value" @click="decide(row.id, false)"
                  >取消，不发送</el-button
                ></template
              ><el-button
                v-if="['expired', 'rejected', 'failed'].includes(row.status)"
                :disabled="task.pending.value"
                @click="resume(row.storeId, row.uid)"
                >恢复本会话 AI</el-button
              >
            </div>
          </article>
        </el-tab-pane>
        <el-tab-pane label="消息与运行日志" name="logs">
          <p v-if="!logs.length">尚未采集到消息。连接店铺后会实时更新。</p>
          <article v-for="row in logs" :key="row.id" class="logs-card">
            <div class="logs-meta">
              <b>{{ row.kind }} · {{ row.storeName }} / {{ row.buyerName }}</b
              ><span>{{ time(row.at) }} · 用户 {{ row.uid || '—' }}</span>
            </div>
            <pre>{{ row.text }}</pre>
            <div v-if="row.ai" class="message-ai-state">
              <b>{{
                row.ai.submitted === true
                  ? '已发起 AI 请求'
                  : row.ai.submitted === false
                    ? '尚未交给 AI'
                    : '当时是否交给 AI：未知'
              }}</b>
              <p>{{ row.ai.reason }}</p>
              <div class="runtime-actions">
                <el-button v-if="row.ai.traceId" size="small" @click="showTrace(row.ai.traceId)"
                  >查看对应 AI 请求</el-button
                >
                <el-button
                  v-if="row.ai.code.startsWith('suppressed_')"
                  size="small"
                  :disabled="task.pending.value"
                  @click="resume(row.storeId, row.uid)"
                  >恢复本会话 AI</el-button
                >
              </div>
            </div>
          </article>
          <div ref="logEnd"></div>
        </el-tab-pane>
        <el-tab-pane label="AI 上下文调试" name="traces">
          <p>
            AI
            回复耗时：从收到本次生成请求到正文生成完成，包含上下文准备及压缩，不含人工确认、逐字输入和发送时间。
          </p>
          <p>
            这里显示实际发给模型的
            messages：系统规则、输出协议、检索到的知识、时间排序的最近对话和图片输入。未记录请求头和密钥。候选区展示经禁用词过滤及欢迎语处理后的最终正文。
          </p>
          <p v-if="!traces.length">暂无模型请求。</p>
          <article
            v-for="row in traces"
            :key="row.id"
            class="logs-card"
            :class="{ selected: row.id === traceId }"
          >
            <div class="logs-meta">
              <b
                >{{ row.purpose === 'compression' ? '上下文摘要' : '回复生成' }} ·
                {{ row.storeName }} / {{ row.buyerName }} · {{ row.model }}</b
              ><span>{{ time(row.startedAt ?? row.at) }} · 用户 {{ row.uid || '训练' }}</span>
            </div>
            <p class="trace-timing">
              {{ row.purpose === 'compression' ? '摘要耗时' : 'AI 回复耗时' }}：{{
                row.durationMs !== undefined
                  ? duration(row.durationMs)
                  : row.error
                    ? '失败，暂无计时'
                    : row.reply
                      ? '旧记录未计时'
                      : '生成中…'
              }}<span v-if="row.error && row.durationMs !== undefined">（失败）</span>
            </p>
            <p v-if="row.compression">
              {{ row.compression.triggered ? '已压缩' : '未达到压缩阈值' }}：{{
                row.compression.beforeTokens
              }}
              → {{ row.compression.afterTokens }} 估算 token；16K 触发 / 8K 目标。{{
                row.compression.tokenizer
              }}
            </p>
            <details v-if="row.compression?.triggered">
              <summary>压缩摘要（保留 {{ row.compression.keptMessages }} 条最近原始消息）</summary>
              <pre>{{ row.compression.summary }}</pre>
              <p v-if="row.compression.clipped">
                模型摘要超过预算，已收紧摘要；可能有信息遗漏，请核对。
              </p>
            </details>
            <details :open="row.id === traceId">
              <summary>实际模型请求 messages</summary>
              <pre>{{ row.messages }}</pre>
            </details>
            <details>
              <summary>排序后的原始对话（含时间）</summary>
              <pre>{{ row.thread }}</pre>
            </details>
            <pre v-if="row.reply"
              >{{ row.purpose === 'compression' ? '模型摘要' : 'AI 生成正文' }}：{{
                row.reply
              }}</pre
            >
            <p v-if="row.error">模型失败：{{ row.error }}</p>
          </article>
          <p v-if="traceId && !selectedTrace">该请求已超出最近 40 次的内存保留范围。</p>
        </el-tab-pane>
      </el-tabs>
    </section>
  </main>
</template>
<style scoped>
.logs-window {
  height: 100vh;
  display: flex;
  flex-direction: column;
  background: #f4f7fc;
  color: #263958;
}
.logs-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 18px 24px;
  background: #e9f2ff;
  border-bottom: 1px solid #ccdcf4;
}
.logs-header b {
  font-size: 18px;
}
.logs-header small {
  display: block;
  margin-top: 6px;
  color: #647a9c;
}
.logs-body {
  padding: 20px 24px;
  overflow: auto;
  flex: 1;
}
.logs-note {
  font-size: 13px;
  line-height: 1.7;
  color: #687e9e;
}
.logs-card {
  padding: 18px;
  margin: 14px 0;
  background: #fff;
  border: 1px solid #dce5f2;
  border-radius: 12px;
}
.logs-card.selected {
  border-color: #3985ff;
}
.logs-meta {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
  font-size: 13px;
}
.logs-meta span {
  color: #7486a0;
}
pre {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font:
    13px/1.7 Consolas,
    monospace;
  background: #f6f8fc;
  padding: 12px;
  border-radius: 6px;
}
summary {
  cursor: pointer;
  padding: 12px 0;
  color: #2679ef;
}
p {
  font-size: 13px;
  line-height: 1.7;
}
</style>

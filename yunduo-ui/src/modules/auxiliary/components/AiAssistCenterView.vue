<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import { useRouter } from 'vue-router'
import { getDesktop } from '@/shared/platform/desktop'
import RuntimePanel from '@/shared/ui/RuntimePanel.vue'
import StoreSelect from '@/shared/ui/StoreSelect.vue'
import { useRuntimeStore } from '@/shared/state/runtime'
import { useTask } from '@/shared/ui/use-task'
import type { Conversation } from '@/shared/contracts/backend'
const runtime = useRuntimeStore(),
  task = useTask()
const router = useRouter()
async function closeWindow() {
  await task.run(async () => {
    const desktop = getDesktop()
    if (!desktop.isElectron) throw new Error('浏览器预览请返回工作台')
    await desktop.close()
  })
}
const chosen = ref(''),
  text = ref(''),
  drafts = new Map<string, string>()
const conversations = computed(() =>
  runtime.snapshot.conversations.filter(
    (x) => !runtime.selectedStoreId || x.storeId === runtime.selectedStoreId,
  ),
)
const key = (row: Conversation) => JSON.stringify([row.storeId, row.uid])
const current = computed(() => conversations.value.find((x) => key(x) === chosen.value))
async function select(row: Conversation) {
  if (current.value) drafts.set(key(current.value), text.value)
  const ok = await task.run(async () => {
    await runtime.run({
      action: 'select-conversation',
      storeId: row.storeId,
      conversationId: row.uid,
    })
  })
  if (ok) {
    chosen.value = key(row)
    text.value =
      drafts.get(key(row)) ??
      runtime.snapshot.auxiliary.drafts.find((x) => x.storeId === row.storeId && x.uid === row.uid)
        ?.text ??
      ''
  }
}
async function saveDraft() {
  const row = current.value
  if (!row) return
  drafts.set(key(row), text.value)
  await task.run(async () => {
    await runtime.run({
      action: 'save-auxiliary-draft',
      storeId: row.storeId,
      conversationId: row.uid,
      values: { text: text.value },
    })
    task.message.value = '草稿已保存在本机。'
  })
}
async function send() {
  const row = current.value,
    reply = text.value.trim()
  await task.run(async () => {
    if (!row || !reply) throw new Error('请选择会话并填写回复')
    drafts.set(key(row), reply)
    await runtime.run({
      action: 'save-auxiliary-draft',
      storeId: row.storeId,
      conversationId: row.uid,
      values: { text: reply },
    })
    const result = await runtime.run({
      action: 'send-reply',
      storeId: row.storeId,
      conversationId: row.uid,
      values: { reply },
    })
    if (result.data.confirmed !== true) throw new Error('发送未确认，请在平台核对；草稿已保留')
    drafts.delete(key(row))
    if (chosen.value === key(row) && text.value.trim() === reply) text.value = ''
    task.message.value = result.message
  })
}
onBeforeUnmount(() => {
  if (current.value) drafts.set(key(current.value), text.value)
})
</script>
<template>
  <RuntimePanel
    title="AI 辅助中心"
    description="查看已采集会话、人工回复与本会话 AI 状态。发送未确认时保留草稿，先去平台核对。"
    :error="task.error.value"
    :message="task.message.value"
    ><template #actions
      ><el-button @click="router.push('/')">返回工作台</el-button
      ><el-button @click="closeWindow">关闭窗口</el-button></template
    ><StoreSelect :disabled="task.pending.value" />
    <div class="runtime-two-columns">
      <div>
        <p v-if="!conversations.length">暂无已采集会话。请在工作台打开店铺并完成平台登录。</p>
        <button
          v-for="row in conversations"
          :key="key(row)"
          class="runtime-entry"
          :class="{ active: chosen === key(row) }"
          :disabled="task.pending.value"
          @click="select(row)"
        >
          <b>{{ row.name || row.uid }}</b>
          <p>{{ row.status }} · {{ row.messages.at(-1)?.content.slice(0, 60) }}</p>
        </button>
      </div>
      <div v-if="current">
        <h2>{{ current.name || current.uid }}</h2>
        <div class="runtime-actions">
          <el-button
            :disabled="task.pending.value"
            @click="
              task.run(async () => {
                await runtime.run({
                  action: 'focus-conversation',
                  storeId: current?.storeId,
                  conversationId: current?.uid,
                })
              })
            "
            >定位平台会话</el-button
          ><el-button
            :disabled="task.pending.value"
            @click="
              task.run(async () => {
                await runtime.run({
                  action: 'resume-conversation',
                  storeId: current?.storeId,
                  conversationId: current?.uid,
                })
              })
            "
            >恢复本会话 AI</el-button
          >
        </div>
        <div role="log" aria-label="真实会话">
          <div
            v-for="(message, index) in current.messages"
            :key="message.msgId || index"
            :class="['runtime-message', message.from]"
          >
            <b>{{
              message.from === 'buyer' ? '顾客' : message.from === 'seller' ? '客服' : '系统'
            }}</b>
            <div v-if="message.type === 'image'">[图片] {{ message.content }}</div>
            <div v-else>{{ message.content }}</div>
          </div>
        </div>
        <form class="runtime-form" @submit.prevent="send">
          <el-input
            v-model="text"
            type="textarea"
            :rows="4"
            maxlength="2000"
            aria-label="人工回复内容"
            :disabled="task.pending.value"
          />
          <div class="runtime-actions">
            <el-button
              type="primary"
              native-type="submit"
              :disabled="!text.trim() || !runtime.currentStore?.runtime.online"
              :loading="task.pending.value"
              >发送给当前顾客</el-button
            ><el-button :disabled="task.pending.value" @click="saveDraft">保存草稿</el-button>
          </div>
        </form>
      </div>
      <p v-else>选择一条已采集会话查看详情。</p>
    </div></RuntimePanel
  >
</template>

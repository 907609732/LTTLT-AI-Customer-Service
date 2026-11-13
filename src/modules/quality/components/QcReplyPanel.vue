<script setup lang="ts">
import { computed, ref } from 'vue'
import RuntimePanel from '@/shared/ui/RuntimePanel.vue'
import StoreSelect from '@/shared/ui/StoreSelect.vue'
import { useRuntimeStore } from '@/shared/state/runtime'
import { useTask } from '@/shared/ui/use-task'
import { qualitySchema, type QualityRecord } from '@/shared/contracts/backend'
const runtime = useRuntimeStore(),
  task = useTask()
const selected = ref<QualityRecord | null>(null),
  status = ref<'pending' | 'passed' | 'problem'>('pending'),
  note = ref(''),
  messageTs = ref(0),
  answer = ref(''),
  confirmed = ref(false)
const records = computed(() =>
  runtime.snapshot.quality.filter(
    (x) => !runtime.selectedStoreId || x.storeId === runtime.selectedStoreId,
  ),
)
const messages = computed(
  () =>
    runtime.snapshot.conversations
      .find((x) => x.storeId === selected.value?.storeId && x.uid === selected.value?.uid)
      ?.messages.filter((x) => x.from === 'buyer' && (x.type || 'text') === 'text') || [],
)
function edit(row: QualityRecord) {
  selected.value = qualitySchema.parse(row)
  status.value = row.status
  note.value = row.note
  messageTs.value = 0
  answer.value = ''
  confirmed.value = false
}
async function review() {
  await task.run(async () => {
    if (!selected.value) throw new Error('请选择质检记录')
    const row = selected.value
    const result = await runtime.run({
      action: 'review-conversation',
      values: { id: row.id, version: row.version, status: status.value, note: note.value },
    })
    selected.value = null
    task.message.value = result.message
  })
}
async function correct() {
  await task.run(async () => {
    const row = selected.value,
      message = messages.value.find((x) => x.ts === messageTs.value)
    if (!row || !message) throw new Error('请选择保留的买家原始文字消息')
    const result = await runtime.run({
      action: 'learn-conversation-correction',
      storeId: row.storeId,
      conversationId: row.uid,
      values: {
        recordId: row.id,
        version: row.version,
        question: message.content,
        messageTs: message.ts,
        answer: answer.value,
        confirmed: confirmed.value,
      },
    })
    task.message.value = result.message
    confirmed.value = false
    answer.value = ''
  })
}
</script>
<template>
  <RuntimePanel
    title="客服质检与纠错学习"
    description="质检与纠错都需要明确保存；保存标准答案不会发送给买家或自动恢复 AI。"
    :error="task.error.value"
    :message="task.message.value"
    ><StoreSelect :disabled="task.pending.value" /><el-table
      :data="records"
      row-key="id"
      empty-text="采集到真实会话后显示质检记录"
      ><el-table-column prop="storeName" label="店铺" /><el-table-column
        prop="name"
        label="顾客"
      /><el-table-column prop="status" label="质检状态" /><el-table-column label="操作"
        ><template #default="{ row }"
          ><el-button link @click="edit(row)">查看与纠错</el-button></template
        ></el-table-column
      ></el-table
    >
    <el-dialog
      :model-value="Boolean(selected)"
      title="质检与标准答案"
      width="720px"
      append-to-body
      @update:model-value="$event || (selected = null)"
      ><template v-if="selected"
        ><el-alert
          v-if="task.error.value"
          :title="task.error.value"
          type="error"
          :closable="false"
        />
        <div
          v-for="event in selected.events"
          :key="event.code + event.buyerMessage"
          class="runtime-card"
        >
          <b>{{ event.code }} · {{ event.delivery }}</b>
          <p>{{ event.buyerMessage }}</p>
          <p>{{ event.reply }}</p>
        </div>
        <form class="runtime-form" @submit.prevent="review">
          <label
            >质检状态<el-select v-model="status"
              ><el-option value="pending" label="待检查" /><el-option
                value="passed"
                label="通过" /><el-option value="problem" label="存在问题" /></el-select></label
          ><label>质检备注<el-input v-model="note" type="textarea" maxlength="2000" /></label
          ><el-button native-type="submit" :loading="task.pending.value">保存质检</el-button>
        </form>
        <form class="runtime-form" @submit.prevent="correct">
          <h2>保存为本店知识</h2>
          <label
            >买家原始问题<el-select v-model="messageTs" placeholder="选择原始消息"
              ><el-option
                v-for="message in messages"
                :key="message.ts"
                :value="message.ts"
                :label="message.content" /></el-select></label
          ><label
            >标准答案<el-input v-model="answer" type="textarea" :rows="4" maxlength="4000" /></label
          ><el-checkbox v-model="confirmed">确认保存为本店纠错知识，不发送消息</el-checkbox
          ><el-button
            type="primary"
            native-type="submit"
            :disabled="!confirmed || !messageTs || !answer.trim()"
            :loading="task.pending.value"
            >保存标准答案</el-button
          >
        </form></template
      ></el-dialog
    >
  </RuntimePanel>
</template>

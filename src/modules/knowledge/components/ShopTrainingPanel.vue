<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'
import RuntimePanel from '@/shared/ui/RuntimePanel.vue'
import StoreSelect from '@/shared/ui/StoreSelect.vue'
import { useRuntimeStore } from '@/shared/state/runtime'
import { useTask } from '@/shared/ui/use-task'
const runtime = useRuntimeStore(),
  task = useTask()
const question = ref(''),
  productId = ref(''),
  images = ref('')
const history = ref<{ from: 'buyer' | 'seller'; content: string }[]>([])
let generation = 0
watch(
  () => runtime.selectedStoreId,
  () => {
    generation++
    history.value = []
    productId.value = ''
    task.error.value = ''
  },
)
onBeforeUnmount(() => {
  generation++
})
async function send() {
  const ticket = generation,
    storeId = runtime.selectedStoreId,
    text = question.value.trim()
  await task.run(async () => {
    const imageUrls = images.value
      .split(/\r?\n/)
      .map((x) => x.trim())
      .filter(Boolean)
    const result = await runtime.run({
      action: 'start-training',
      ...(storeId ? { storeId } : {}),
      values: {
        question: text,
        history: history.value.slice(-20),
        ...(productId.value.trim() ? { productId: productId.value.trim() } : {}),
        ...(imageUrls.length ? { images: imageUrls } : {}),
      },
    })
    if (ticket !== generation || storeId !== runtime.selectedStoreId) return
    if (typeof result.data.reply !== 'string') throw new Error('模型未返回有效回复')
    history.value.push(
      { from: 'buyer', content: text },
      { from: 'seller', content: result.data.reply },
    )
    history.value = history.value.slice(-20)
    question.value = ''
    images.value = ''
  })
}
</script>
<template>
  <RuntimePanel
    title="AI 训练场"
    description="使用当前模型、分店规则、商品及意图知识生成模拟回复，不向买家发送。"
    :error="task.error.value"
  >
    <StoreSelect :disabled="task.pending.value" label="测试店铺" />
    <p v-if="!runtime.snapshot.stores.length">
      尚未添加店铺，文字测试使用全局模型规则；添加店铺后可以测试本店知识。
    </p>
    <div class="runtime-card" role="log" aria-label="模拟对话">
      <p v-if="!history.length">输入问题，验证模型和回复规则。</p>
      <div v-for="(item, index) in history" :key="index" :class="['runtime-message', item.from]">
        <b>{{ item.from === 'buyer' ? '模拟买家' : 'AI' }}</b>
        <div>{{ item.content }}</div>
      </div>
    </div>
    <form class="runtime-form" @submit.prevent="send">
      <label
        >商品编号（可选）<el-input
          v-model="productId"
          aria-label="训练商品编号"
          placeholder="当前店铺已启用商品的 productId"
          :disabled="task.pending.value" /></label
      ><label
        >模拟买家问题<el-input
          v-model="question"
          type="textarea"
          :rows="3"
          aria-label="模拟买家问题"
          maxlength="2000"
          :disabled="task.pending.value" /></label
      ><label
        >测试图片地址（可选，每行一个）<el-input
          v-model="images"
          type="textarea"
          :rows="2"
          aria-label="测试图片地址"
          placeholder="最多 4 张公网 HTTPS 图片，需本店启用识图及模型支持"
          :disabled="task.pending.value"
      /></label>
      <div class="runtime-actions">
        <el-button
          type="primary"
          native-type="submit"
          :loading="task.pending.value"
          :disabled="!runtime.available || !question.trim()"
          >发送测试</el-button
        ><el-button :disabled="task.pending.value" @click="history = []">清空模拟对话</el-button>
      </div>
    </form>
  </RuntimePanel>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useRuntimeStore } from '@/shared/state/runtime'
import { useTask } from '@/shared/ui/use-task'
withDefaults(defineProps<{ modelValue?: boolean }>(), { modelValue: false })
const emit = defineEmits<{ 'update:modelValue': [visible: boolean] }>()
const runtime = useRuntimeStore(),
  task = useTask()
const name = ref(''),
  platform = ref('pdd-web')
async function save() {
  const ok = await task.run(async () => {
    const result = await runtime.run({
      action: 'add-store',
      values: {
        platform: platform.value,
        ...(name.value.trim() ? { storeName: name.value.trim() } : {}),
      },
    })
    if (typeof result.data.id === 'string') runtime.selectedStoreId = result.data.id
  })
  if (ok) {
    name.value = ''
    emit('update:modelValue', false)
  }
}
</script>
<template>
  <el-dialog
    :model-value="modelValue"
    title="添加店铺"
    width="560px"
    append-to-body
    :close-on-click-modal="!task.pending.value"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <p>店铺资料保存在本机。添加后 AI 默认关闭，打开平台工作台后由你完成店铺登录。</p>
    <el-alert v-if="task.error.value" :title="task.error.value" type="error" :closable="false" />
    <form class="runtime-form" @submit.prevent="save">
      <label
        >平台<el-select v-model="platform" aria-label="店铺平台" :disabled="task.pending.value"
          ><el-option
            v-for="item in runtime.snapshot.capabilities.platforms"
            :key="item.id"
            :value="item.id"
            :label="item.label" /></el-select
      ></label>
      <label
        >店铺名称<el-input
          v-model="name"
          aria-label="店铺名称"
          maxlength="60"
          :placeholder="platform === 'pdd-web' ? '可留空，平台登录后识别' : '请输入店铺名称'"
          :disabled="task.pending.value"
      /></label>
      <p v-if="platform === 'doudian-client'" class="runtime-muted">
        抖店需要本机客户端与桥接连接；保存此记录不会自动登录客户端。
      </p>
      <el-button
        type="primary"
        native-type="submit"
        :loading="task.pending.value"
        :disabled="!runtime.available"
        >添加店铺</el-button
      >
    </form>
    <template #footer
      ><el-button :disabled="task.pending.value" @click="emit('update:modelValue', false)"
        >关闭</el-button
      ></template
    >
  </el-dialog>
</template>

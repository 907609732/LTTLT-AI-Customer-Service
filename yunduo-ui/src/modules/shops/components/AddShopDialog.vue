<script setup lang="ts">
import { computed, ref } from 'vue'
import { SIM_PLATFORM_ID, SIM_PLATFORM_LABEL } from '@/shared/contracts/simulation'
import { useRuntimeStore } from '@/shared/state/runtime'
import { useTask } from '@/shared/ui/use-task'
withDefaults(defineProps<{ modelValue?: boolean }>(), { modelValue: false })
const emit = defineEmits<{ 'update:modelValue': [visible: boolean] }>()
const runtime = useRuntimeStore(),
  task = useTask()
const name = ref(''),
  platform = ref('pdd-web')
/** 本机模拟店铺与真实平台店铺的约束不同，文案和校验都不能共用一套。 */
const isSim = computed(() => platform.value === SIM_PLATFORM_ID)
// 模拟店铺的说明必须写清“本机、不对接真实平台”，避免用户误以为这是真实店铺。
const simNote = `${SIM_PLATFORM_LABEL}只在本机运行：没有真实平台登录、没有真实买家，消息只写在本机记录里，适合先演练回复流程。`
async function save() {
  const ok = await task.run(async () => {
    // 模拟店铺必须自己起名：真实平台登录后会识别店名，模拟店铺没有这一步，空名字会在会话列表里无法区分。
    if (platform.value === SIM_PLATFORM_ID && !name.value.trim())
      throw new Error('本机模拟店铺需要一个名字，方便在会话列表里区分')
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
    <p v-if="isSim">
      模拟店铺不需要登录任何平台：添加后到「模拟客服台」打开它，再用模拟顾客页发消息。
    </p>
    <p v-else>店铺资料保存在本机。添加后 AI 默认关闭，打开平台工作台后由你完成店铺登录。</p>
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
          :placeholder="
            isSim
              ? '必填，例如：本机演练店'
              : platform === 'pdd-web'
                ? '可留空，平台登录后识别'
                : '请输入店铺名称'
          "
          :disabled="task.pending.value"
      /></label>
      <p v-if="isSim" class="runtime-muted">{{ simNote }}</p>
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

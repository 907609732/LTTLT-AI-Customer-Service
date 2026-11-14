<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { SIM_PLATFORM_ID, SIM_PLATFORM_LABEL } from '@/shared/contracts/simulation'
import { useRuntimeStore } from '@/shared/state/runtime'
import { useShopSetupStore } from '../setup-store'
import { useTask } from '@/shared/ui/use-task'
import pddWeb from '@/assets/figma-add-img00.png'
import pddClient from '@/assets/figma-add-img01.png'
import douyinWeb from '@/assets/figma-add-img1.png'
import douyinClient from '@/assets/figma-add-img5.png'
import dewu from '@/assets/figma-add-img2.png'
import qianniu from '@/assets/figma-add-img3.png'
import qianfan from '@/assets/figma-add-img4.png'
import kuaishou from '@/assets/figma-add-img6.png'
import jd from '@/assets/figma-add-img7.png'
import wechat from '@/assets/figma-add-img30.png'
import xianyu from '@/assets/figma-add-img31.png'
const props = withDefaults(defineProps<{ modelValue?: boolean }>(), { modelValue: false })
const emit = defineEmits<{ 'update:modelValue': [visible: boolean] }>()
const runtime = useRuntimeStore(),
  task = useTask(),
  router = useRouter()
const setup = useShopSetupStore()
const name = ref(''),
  platform = ref(''),
  simulation = ref(false),
  createdId = ref('')
const catalog = [
  { id: 'pdd-web', label: '多多店铺', mode: '网页', icon: pddWeb },
  { id: 'pdd-client', label: '多多店铺', mode: '客户端', icon: pddClient },
  { id: 'doudian-web', label: '抖店店铺', mode: '网页', icon: douyinWeb },
  { id: 'doudian-client', label: '抖店店铺', mode: '客户端', icon: douyinClient },
  { id: 'kuaishou', label: '快手店铺', mode: '网页', icon: kuaishou },
  { id: 'jd', label: '京麦店铺', mode: '客户端', icon: jd },
  { id: 'dewu', label: '得物店铺', mode: '客户端', icon: dewu },
  { id: 'qianniu', label: '千牛店铺', mode: '客户端', icon: qianniu },
  { id: 'qianfan', label: '千帆店铺', mode: '客户端', icon: qianfan },
  { id: 'wechat', label: '微信店铺', mode: '网页', icon: wechat },
  { id: 'xianyu', label: '闲鱼店铺', mode: '网页', icon: xianyu },
]
const platforms = computed(() =>
  catalog.map((item) => ({
    ...item,
    available:
      ['pdd-web', 'doudian-client'].includes(item.id) &&
      runtime.snapshot.capabilities.platforms.some((p) => p.id === item.id),
  })),
)
const simulatorAvailable = computed(() =>
  runtime.snapshot.capabilities.platforms.some((p) => p.id === SIM_PLATFORM_ID),
)
const isSim = computed(() => simulation.value && platform.value === SIM_PLATFORM_ID)
const selected = computed(() => platforms.value.find((item) => item.id === platform.value))
const canSubmit = computed(
  () =>
    runtime.available &&
    Boolean(runtime.snapshot.workspaceId) &&
    ((isSim.value && simulatorAvailable.value) || Boolean(selected.value?.available)),
)
const simNote = `${SIM_PLATFORM_LABEL}只在本机运行：没有真实平台登录、没有真实买家，消息只写在本机记录里，适合先演练回复流程。`
let draftVersion = 0
function reset() {
  draftVersion++
  name.value = ''
  platform.value = ''
  simulation.value = false
  createdId.value = ''
  task.error.value = ''
}
watch(
  () => props.modelValue,
  (visible) => {
    if (visible) reset()
  },
)
watch(() => runtime.snapshot.workspaceId, reset)
function choose(id: string) {
  if (
    task.pending.value ||
    createdId.value ||
    !platforms.value.some((item) => item.id === id && item.available)
  )
    return
  simulation.value = false
  platform.value = id
  task.error.value = ''
}
function toggleSimulation() {
  if (task.pending.value || createdId.value) return
  simulation.value = !simulation.value
  platform.value = simulation.value ? SIM_PLATFORM_ID : ''
  task.error.value = ''
}
function close() {
  if (!task.pending.value) emit('update:modelValue', false)
}
async function save() {
  if (!canSubmit.value || task.pending.value) return
  const version = draftVersion,
    workspace = runtime.snapshot.workspaceId,
    simulated = isSim.value
  const current = () => version === draftVersion && workspace === runtime.snapshot.workspaceId
  const ok = await task.run(async () => {
    if (simulated && !name.value.trim())
      throw new Error('本机模拟店铺需要一个名字，方便在会话列表里区分')
    if (!createdId.value) {
      const result = await runtime.run({
        action: 'add-store',
        values: {
          platform: platform.value,
          ...(simulated ? { storeName: name.value.trim() } : {}),
        },
      })
      if (!current()) throw new Error('工作区已切换，请重新选择平台')
      if (typeof result.data.id !== 'string' || !result.data.id)
        throw new Error('添加店铺未返回有效店铺编号')
      // 创建成功后保留编号，打开失败只重试打开，不重复建立店铺记录。
      createdId.value = result.data.id
    }
    runtime.selectedStoreId = createdId.value
    if (!simulated) {
      try {
        await runtime.run({ action: 'open-store', storeId: createdId.value })
      } catch (error) {
        throw new Error(
          `店铺已添加，登录界面打开失败：${error instanceof Error ? error.message : String(error)}。可重试或从左侧店铺继续打开。`,
        )
      }
      if (!current()) throw new Error('工作区已切换，请在当前工作区重新打开店铺')
      await router.push('/')
      if (!current()) return
      // 先收起弹窗，再让主布局的呈现监听器显示平台，避免登录页覆盖弹窗。
      emit('update:modelValue', false)
      runtime.platformStoreId = createdId.value
    }
  })
  if (ok && current()) {
    if (simulated) emit('update:modelValue', false)
    setup.open(createdId.value)
  }
}
</script>
<template>
  <el-dialog
    :model-value="modelValue"
    class="add-platform-dialog"
    width="630px"
    align-center
    append-to-body
    :show-close="!task.pending.value"
    :close-on-click-modal="!task.pending.value"
    :close-on-press-escape="!task.pending.value"
    @update:model-value="close"
  >
    <template #header
      ><strong>添加店铺</strong
      ><span class="add-platform-subtitle">每次选择一个平台</span></template
    >
    <form class="add-platform-form" @submit.prevent="save">
      <div class="add-platform-scroll">
        <div class="add-platform-guide">
          <strong>选择平台后，添加店铺即可进入登录。</strong>
          <div><span>网页：独立登录</span><span>客户端：在对应客户端完成登录</span></div>
        </div>
        <h3>平台选择</h3>
        <div class="add-platform-grid" role="group" aria-label="店铺平台选择">
          <button
            v-for="item in platforms"
            :key="item.id"
            type="button"
            :data-platform="item.id"
            :class="['add-platform-card', { selected: !simulation && platform === item.id }]"
            :aria-pressed="!simulation && platform === item.id"
            :disabled="!item.available || task.pending.value || Boolean(createdId)"
            @click="choose(item.id)"
          >
            <img :src="item.icon" alt="" /><span class="add-platform-name">{{ item.label }}</span>
            <span :class="['add-platform-mode', { client: item.mode === '客户端' }]">{{
              item.mode
            }}</span>
            <span
              :class="[
                'add-platform-status',
                { available: item.available, developing: item.id === 'qianniu' },
              ]"
              >{{ item.available ? '已开通' : item.id === 'qianniu' ? '开发中' : '未开通' }}</span
            >
          </button>
        </div>
        <p v-if="platform === 'doudian-client'" class="add-platform-hint">
          将在抖店客户端完成登录；需已安装客户端并连接本机桥接，打开不代表已登录。
        </p>
        <button
          v-if="simulatorAvailable"
          type="button"
          class="add-platform-simulator"
          aria-label="本机模拟店铺入口"
          :disabled="task.pending.value || Boolean(createdId)"
          @click="toggleSimulation"
        >
          {{ simulation ? '返回平台选择' : '本机模拟店铺（仅供演练）' }}
        </button>
        <div v-if="simulation" class="runtime-form add-platform-simform">
          <label
            >平台<el-select
              v-model="platform"
              aria-label="店铺平台"
              :disabled="task.pending.value || Boolean(createdId)"
              ><el-option :value="SIM_PLATFORM_ID" :label="SIM_PLATFORM_LABEL" /></el-select
          ></label>
          <label
            >店铺名称<el-input
              v-model="name"
              aria-label="店铺名称"
              maxlength="60"
              placeholder="必填，例如：本机演练店"
              :disabled="task.pending.value"
          /></label>
          <p>{{ simNote }}</p>
        </div>
      </div>
      <div class="add-platform-bottom">
        <el-alert
          v-if="task.error.value"
          :title="task.error.value"
          type="error"
          :closable="false"
        />
        <div class="add-platform-actions">
          <span class="add-platform-selection">{{
            isSim
              ? SIM_PLATFORM_LABEL
              : selected
                ? `${selected.label} · ${selected.mode}`
                : '请选择一个平台'
          }}</span
          ><span class="add-platform-count">启动数 1</span
          ><el-button aria-label="取消添加店铺" :disabled="task.pending.value" @click="close"
            >取消</el-button
          ><el-button
            type="primary"
            native-type="submit"
            :loading="task.pending.value"
            :disabled="!canSubmit"
            >{{ createdId && !isSim ? '重试打开' : '添加店铺' }}</el-button
          >
        </div>
      </div>
    </form>
  </el-dialog>
</template>
<style src="../add-platform.css"></style>

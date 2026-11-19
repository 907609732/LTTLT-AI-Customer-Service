<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
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
const platform = ref(''),
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
      ['pdd-web', 'doudian-client', 'xianyu'].includes(item.id) &&
      runtime.snapshot.capabilities.platforms.some((p) => p.id === item.id),
  })),
)
const selected = computed(() => platforms.value.find((item) => item.id === platform.value))
const canSubmit = computed(
  () =>
    runtime.available &&
    Boolean(runtime.snapshot.workspaceId) &&
    Boolean(selected.value?.available),
)
let draftVersion = 0
function reset() {
  draftVersion++
  platform.value = ''
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
  platform.value = id
  task.error.value = ''
}
function close() {
  if (!task.pending.value) emit('update:modelValue', false)
}
async function save() {
  if (!canSubmit.value || task.pending.value) return
  const version = draftVersion,
    workspace = runtime.snapshot.workspaceId
  const current = () => version === draftVersion && workspace === runtime.snapshot.workspaceId
  const ok = await task.run(async () => {
    if (!createdId.value) {
      const result = await runtime.run({
        action: 'add-store',
        values: {
          platform: platform.value,
          // 注册表要求闲鱼有非空名称；登录后由身份同步替换该占位名。
          ...(platform.value === 'xianyu' ? { storeName: '闲鱼店铺' } : {}),
        },
      })
      if (!current()) throw new Error('工作区已切换，请重新选择平台')
      if (typeof result.data.id !== 'string' || !result.data.id)
        throw new Error('添加店铺未返回有效店铺编号')
      // 创建成功后保留编号，打开失败只重试打开，不重复建立店铺记录。
      createdId.value = result.data.id
    }
    runtime.selectedStoreId = createdId.value
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
  })
  if (ok && current()) {
    setup.queueAfterLogin(createdId.value)
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
            :class="['add-platform-card', { selected: platform === item.id }]"
            :aria-pressed="platform === item.id"
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
            selected ? `${selected.label} · ${selected.mode}` : '请选择一个平台'
          }}</span
          ><span class="add-platform-count">启动数 1</span
          ><el-button aria-label="取消添加店铺" :disabled="task.pending.value" @click="close"
            >取消</el-button
          ><el-button
            type="primary"
            native-type="submit"
            :loading="task.pending.value"
            :disabled="!canSubmit"
            >{{ createdId ? '重试打开' : '添加店铺' }}</el-button
          >
        </div>
      </div>
    </form>
  </el-dialog>
</template>
<style src="../add-platform.css"></style>

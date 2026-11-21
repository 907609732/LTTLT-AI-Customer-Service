<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ElMessageBox } from 'element-plus'
import { useRuntimeStore } from '@/shared/state/runtime'
import { useTask } from '@/shared/ui/use-task'
import type { LocalStore } from '@/shared/contracts/backend'

const props = defineProps<{ modelValue: boolean; shop: LocalStore | null }>()
const emit = defineEmits<{
  'update:modelValue': [visible: boolean]
  done: [storeId: string, message: string]
}>()
const runtime = useRuntimeStore()
const task = useTask()
const purge = ref(false)
const visible = computed(() => props.modelValue && Boolean(props.shop))

watch(
  () => props.modelValue,
  (open) => {
    if (!open) return
    purge.value = false
    task.error.value = ''
    task.message.value = ''
  },
)
watch(
  () => runtime.snapshot.workspaceId,
  () => {
    if (!task.pending.value) emit('update:modelValue', false)
  },
)

function close() {
  if (!task.pending.value) emit('update:modelValue', false)
}

async function confirmPurge(name: string) {
  try {
    await ElMessageBox.confirm(
      `不可恢复：将永久删除“${name}”的本机知识、待审核草稿和任务、资料附件、商品与尺码绑定、平台学习/订单/接待记录、自定义话术、欢迎语与识别/模型绑定、发送方式、AI 恢复偏好、本店登录分区（Cookie/缓存）及本机移除备份。\n\n共享商品 和其他店铺的引用、全局规则、账号/计费/密钥、平台店铺及已有历史备份会保留；历史备份中可能仍包含本店资料。`,
      '最终确认：彻底删除本店数据',
      {
        type: 'warning',
        confirmButtonText: '确认彻底删除',
        cancelButtonText: '取消',
        distinguishCancelAndClose: true,
      },
    )
    return true
  } catch {
    return false
  }
}

async function remove() {
  const shop = props.shop
  if (!shop || task.pending.value) return
  if (!runtime.available) {
    task.error.value = '浏览器仅提供界面预览，请在桌面版移除店铺。'
    return
  }
  const workspace = runtime.snapshot.workspaceId
  const storeId = shop.id
  const shouldPurge = purge.value
  const name = shop.storeName || '待识别店铺'
  if (shouldPurge && !(await confirmPurge(name))) return
  if (!props.modelValue || props.shop?.id !== storeId || workspace !== runtime.snapshot.workspaceId)
    return
  const ok = await task.run(async () => {
    if (workspace !== runtime.snapshot.workspaceId) throw new Error('工作区已切换，请重新操作')
    const result = await runtime.run({
      action: 'remove-store',
      storeId,
      values: { confirmed: true, purge: shouldPurge },
    })
    if (workspace !== runtime.snapshot.workspaceId)
      throw new Error('工作区已切换，结果未应用到当前页面')
    emit('done', storeId, result.message)
    emit('update:modelValue', false)
  })
  if (!ok) return
}
</script>

<template>
  <div v-if="visible" class="remove-shop-backdrop" role="presentation" @keydown.esc="close">
    <section
      class="remove-shop-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="remove-shop-title"
      @click.stop
    >
      <header>
        <h2 id="remove-shop-title">移除店铺</h2>
        <button
          type="button"
          class="remove-shop-close"
          :disabled="task.pending.value"
          @click="close"
        >
          关闭
        </button>
      </header>
      <p>
        从本机移除“{{
          shop?.storeName || '待识别店铺'
        }}”。平台上的店铺不会被删除，勾选彻底删除时也会清除本店的平台登录缓存。
      </p>
      <label class="remove-shop-check">
        <input v-model="purge" type="checkbox" :disabled="task.pending.value" />
        <span>
          <strong>同时彻底删除本店知识库和配置</strong>
          <small>默认不勾选；不勾选时沿用原移除方式并保留移除备份。</small>
        </span>
      </label>
      <div v-if="purge" class="remove-shop-warning" role="alert">
        <strong>不可恢复</strong>
        <p>
          删除本店专属知识、草稿与任务、资料附件、商品/尺码绑定、平台学习与订单存档、接待规则/待办、自定义话术、欢迎语/识别开关/模型绑定、发送方式、AI
          恢复偏好、本店登录分区（Cookie/缓存）及本机移除备份。
        </p>
        <p>
          共享商品和其他店铺的引用、全局规则、账号/计费/密钥、平台店铺、本机日志中的混合记录及已有历史备份独立保留；历史备份中可能仍有本店资料。
        </p>
      </div>
      <p v-if="!runtime.available" class="remove-shop-hint">
        浏览器仅提供界面预览，请在桌面版执行。
      </p>
      <p v-if="task.error.value" class="remove-shop-error" role="alert">{{ task.error.value }}</p>
      <footer>
        <button type="button" :disabled="task.pending.value" @click="close">取消</button>
        <button
          type="button"
          class="remove-shop-danger"
          :disabled="task.pending.value || !runtime.available"
          @click="remove"
        >
          {{ task.pending.value ? '正在移除…' : purge ? '彻底删除并移除' : '移除店铺' }}
        </button>
      </footer>
    </section>
  </div>
</template>

<style scoped>
.remove-shop-backdrop {
  position: fixed;
  inset: 0;
  z-index: 3000;
  display: grid;
  place-items: center;
  padding: 24px;
  background: #1c2b4466;
}
.remove-shop-dialog {
  width: min(560px, 100%);
  border: 1px solid #d7e2f4;
  border-radius: 18px;
  background: white;
  color: #263550;
  box-shadow: 0 18px 48px #16345c33;
  padding: 20px 22px;
}
.remove-shop-dialog header,
.remove-shop-dialog footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.remove-shop-dialog h2 {
  margin: 0;
  font-size: 18px;
}
.remove-shop-dialog p {
  margin: 12px 0;
  color: #5d708d;
  font-size: 13px;
  line-height: 1.6;
}
.remove-shop-close,
.remove-shop-dialog footer button {
  border: 1px solid #b9d2ff;
  border-radius: 18px;
  background: white;
  color: #426088;
  padding: 6px 14px;
  font: inherit;
  cursor: pointer;
}
.remove-shop-close:disabled,
.remove-shop-dialog footer button:disabled {
  opacity: 0.55;
  cursor: default;
}
.remove-shop-check {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 12px;
  border: 1px solid #d7e2f4;
  border-radius: 12px;
  background: #f8fbff;
  cursor: pointer;
}
.remove-shop-check input {
  margin-top: 3px;
}
.remove-shop-check span {
  display: grid;
  gap: 4px;
}
.remove-shop-check small {
  color: #8394af;
  font-size: 12px;
}
.remove-shop-warning {
  margin-top: 12px;
  padding: 12px;
  border: 1px solid #f1b5b5;
  border-radius: 12px;
  background: #fff6f6;
  color: #8a2f2f;
}
.remove-shop-warning p {
  color: #8a2f2f;
  margin: 6px 0 0;
}
.remove-shop-hint {
  color: #9a6b00 !important;
}
.remove-shop-error {
  color: #c43c3c !important;
}
.remove-shop-dialog footer {
  justify-content: flex-end;
  margin-top: 16px;
}
.remove-shop-danger {
  border-color: #d14a4a !important;
  color: white !important;
  background: #d14a4a !important;
}
</style>

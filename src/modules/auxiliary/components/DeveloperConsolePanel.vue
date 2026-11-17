<script setup lang="ts">
import { computed, defineAsyncComponent, nextTick, ref, watch } from 'vue'
import type { LocalStore } from '@/shared/contracts/backend'
import { getDeveloperDebugBridge } from '@/modules/auxiliary/services/developer-debug'

const DeveloperTerminal = defineAsyncComponent(
  () => import('@/modules/auxiliary/components/DeveloperTerminal.vue'),
)

const props = defineProps<{
  expanded: boolean
  workspaceId: string
  stores: LocalStore[]
  selectedStoreId: string
}>()
const bridge = getDeveloperDebugBridge()
const tab = ref<'gm' | 'cmd'>('gm')
const terminalOpened = ref(false)
const gmInput = ref('')
const gmBusy = ref(false)
const gmError = ref('')
const gmOutput = ref('输入 help 查看可用的只读诊断命令。GM 成功不代表买家消息已发送。')
const history = ref<string[]>([])
const historyIndex = ref(-1)
const storeId = ref(props.selectedStoreId || props.stores[0]?.id || '')
watch(
  () => [props.selectedStoreId, props.stores.map((store) => store.id).join('|')],
  () => {
    if (props.stores.some((store) => store.id === storeId.value)) return
    storeId.value = props.selectedStoreId || props.stores[0]?.id || ''
  },
)
const selectedStore = computed(() => props.stores.find((store) => store.id === storeId.value))
const appendOutput = (value: string) => {
  const next = `${gmOutput.value}\n\n${value}`
  gmOutput.value = next.length > 12000 ? `[较早输出已截断]\n${next.slice(-12000)}` : next
}
async function runGm() {
  const input = gmInput.value.trim()
  if (!input || gmBusy.value) return
  if (!bridge) {
    gmError.value = '当前窗口没有源码调试能力'
    return
  }
  if (!props.workspaceId) {
    gmError.value = '本地工作区尚未就绪'
    return
  }
  gmBusy.value = true
  gmError.value = ''
  history.value = [...history.value.filter((row) => row !== input).slice(-49), input]
  historyIndex.value = -1
  gmInput.value = ''
  try {
    const result = await bridge.gm({
      workspaceId: props.workspaceId,
      storeId: storeId.value || undefined,
      input,
    })
    appendOutput(`> ${input}\n${result.text}`)
    if (!result.ok) gmError.value = result.text
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause)
    gmError.value = message
    appendOutput(`> ${input}\n错误：${message}`)
  } finally {
    gmBusy.value = false
  }
}
function recall(direction: -1 | 1) {
  if (!history.value.length) return
  const current =
    historyIndex.value < 0 ? (direction === -1 ? history.value.length : -1) : historyIndex.value
  const next = Math.min(history.value.length - 1, Math.max(0, current + direction))
  historyIndex.value = next
  gmInput.value = history.value[next] ?? ''
}
function selectTab(value: 'gm' | 'cmd') {
  tab.value = value
  if (value === 'cmd') terminalOpened.value = true
}
async function showTerminal() {
  terminalOpened.value = true
  tab.value = 'cmd'
  await nextTick()
}
defineExpose({ showTerminal })
</script>

<template>
  <section class="developer-console" data-panel="debug">
    <div class="debug-tabs" role="tablist" aria-label="开发调试工具">
      <button
        data-debug-tab="gm"
        role="tab"
        :aria-selected="tab === 'gm'"
        :class="{ active: tab === 'gm' }"
        @click="selectTab('gm')"
      >
        GM 指令
      </button>
      <button
        data-debug-tab="cmd"
        role="tab"
        :aria-selected="tab === 'cmd'"
        :class="{ active: tab === 'cmd' }"
        @click="selectTab('cmd')"
      >
        CMD 终端
      </button>
      <span class="scope">{{ selectedStore?.storeName || '未选择店铺' }}</span>
    </div>
    <div v-show="tab === 'gm'" class="gm-panel" data-debug-panel="gm">
      <label class="store-select">
        目标店铺
        <select v-model="storeId" data-gm-store :disabled="gmBusy">
          <option v-if="!stores.length" value="">暂无店铺</option>
          <option v-for="store in stores" :key="store.id" :value="store.id">
            {{ store.storeName }} ({{ store.platform }})
          </option>
        </select>
      </label>
      <p v-if="gmError" class="gm-error" role="alert">{{ gmError }}</p>
      <pre class="gm-output" data-gm-output aria-live="polite">{{ gmOutput }}</pre>
      <form class="gm-input-row" @submit.prevent="runGm">
        <input
          v-model="gmInput"
          data-gm-input
          :disabled="gmBusy"
          maxlength="500"
          autocomplete="off"
          spellcheck="false"
          placeholder="help / status / stores / logs 20 / pdd-popup status"
          aria-label="GM 指令"
          @keydown.enter.prevent.stop="runGm"
          @keydown.up.prevent.stop="recall(-1)"
          @keydown.down.prevent.stop="recall(1)"
        />
        <button type="submit" :disabled="gmBusy || !gmInput.trim()">执行</button>
      </form>
    </div>
    <div v-show="tab === 'cmd'" class="cmd-panel" data-debug-panel="cmd">
      <DeveloperTerminal v-if="terminalOpened" :expanded="expanded" :workspace-id="workspaceId" />
      <p v-else class="cmd-placeholder">选择 CMD 终端后，点击连接才会启动 cmd.exe。</p>
    </div>
  </section>
</template>

<style scoped>
.developer-console {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  height: 100%;
  background: #f8fafc;
}
.debug-tabs {
  display: flex;
  align-items: center;
  gap: 4px;
  flex: 0 0 auto;
  padding: 6px 8px;
  border-bottom: 1px solid #e3e9f0;
  background: #fff;
}
.debug-tabs button {
  border: 1px solid transparent;
  border-radius: 5px;
  padding: 4px 9px;
  background: transparent;
  color: #64748b;
  font: inherit;
  cursor: pointer;
}
.debug-tabs button.active {
  border-color: #d7e4f7;
  background: #eef5ff;
  color: #2563b8;
}
.scope {
  margin-left: auto;
  overflow: hidden;
  max-width: 220px;
  color: #8a96a8;
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.gm-panel,
.cmd-panel {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
  padding: 8px;
}
.store-select {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 0 0 auto;
  color: #64748b;
  font-size: 11px;
}
.store-select select {
  min-width: 0;
  max-width: 260px;
  border: 1px solid #dbe3ed;
  border-radius: 5px;
  padding: 3px 6px;
  background: #fff;
  color: #334155;
  font: inherit;
}
.gm-error {
  margin: 6px 0 0;
  color: #c2410c;
  font-size: 11px;
}
.gm-output {
  flex: 1;
  min-height: 0;
  margin: 7px 0;
  padding: 8px;
  overflow: auto;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  background: #0f172a;
  color: #dbeafe;
  font:
    12px/1.5 Consolas,
    'Cascadia Mono',
    monospace;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.gm-input-row {
  display: flex;
  gap: 6px;
  flex: 0 0 auto;
}
.gm-input-row input {
  flex: 1;
  min-width: 0;
  border: 1px solid #dbe3ed;
  border-radius: 5px;
  padding: 6px 8px;
  background: #fff;
  color: #1e293b;
  font:
    12px/1.4 Consolas,
    'Cascadia Mono',
    monospace;
}
.gm-input-row button,
.cmd-panel button {
  border: 1px solid #397ff2;
  border-radius: 5px;
  padding: 4px 10px;
  background: #397ff2;
  color: #fff;
  font: inherit;
  cursor: pointer;
}
.gm-input-row button:disabled,
.cmd-panel button:disabled {
  opacity: 0.5;
  cursor: wait;
}
.cmd-panel {
  padding: 0;
}
.cmd-placeholder {
  padding: 12px;
  color: #7b8798;
}
@media (max-width: 719px) {
  .gm-output {
    min-height: 120px;
  }
}
</style>

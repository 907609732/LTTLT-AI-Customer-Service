<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { getDeveloperDebugBridge } from '@/modules/auxiliary/services/developer-debug'

const props = defineProps<{ expanded: boolean; workspaceId: string }>()
const bridge = getDeveloperDebugBridge()
const host = ref<HTMLElement>()
const status = ref<'idle' | 'connecting' | 'connected' | 'disconnected' | 'exited' | 'error'>(
  'idle',
)
const message = ref('终端尚未连接；点击“连接 CMD”才会启动 cmd.exe。')
const cwd = ref('')
const sessionId = ref('')
let terminal: Terminal | undefined
let fit: FitAddon | undefined
let offData = () => {}
let offExit = () => {}
let observer: ResizeObserver | undefined
let resizeFrame = 0
let mounted = false
let attempt = 0
const earlyData = new Map<string, string>()
const earlyExit = new Map<string, { exitCode?: number }>()
function resetPending() {
  attempt++
  earlyData.clear()
  earlyExit.clear()
}
function showExit(event: { exitCode?: number }) {
  sessionId.value = ''
  status.value = 'exited'
  message.value = `cmd.exe 已退出${event.exitCode === undefined ? '' : `（代码 ${event.exitCode}）`}。`
  terminal?.write('\r\n[cmd.exe 已退出]\r\n')
}

function fitTerminal() {
  if (!terminal || !fit || !host.value || host.value.clientWidth < 20) return
  try {
    fit.fit()
  } catch {
    return
  }
  if (!sessionId.value || status.value !== 'connected' || !bridge) return
  const cols = terminal.cols,
    rows = terminal.rows
  if (cols < 1 || rows < 1) return
  void bridge
    .ptyResize({ workspaceId: props.workspaceId, sessionId: sessionId.value, cols, rows })
    .catch(() => {})
}
function scheduleFit() {
  cancelAnimationFrame(resizeFrame)
  resizeFrame = requestAnimationFrame(fitTerminal)
}
async function connect() {
  if (status.value === 'connecting') return
  if (!bridge) {
    status.value = 'error'
    message.value = '当前窗口没有源码调试能力'
    return
  }
  if (!terminal) return
  if (!props.workspaceId) {
    status.value = 'error'
    message.value = '本地工作区尚未就绪'
    return
  }
  status.value = 'connecting'
  resetPending()
  const lease = attempt
  const workspaceId = props.workspaceId
  const target = terminal
  message.value = '正在启动 cmd.exe…'
  try {
    fitTerminal()
    const result = await bridge.ptyConnect({
      workspaceId,
      cols: Math.max(1, terminal.cols || 80),
      rows: Math.max(1, terminal.rows || 24),
    })
    if (!mounted || lease !== attempt || workspaceId !== props.workspaceId || terminal !== target)
      return
    if (sessionId.value !== result.sessionId) target.reset()
    sessionId.value = result.sessionId
    cwd.value = result.cwd
    status.value = 'connected'
    message.value = result.reconnected ? '已重新连接当前 CMD 会话。' : 'CMD 会话已连接。'
    if (result.buffer) target.write(result.buffer)
    const queued = earlyData.get(result.sessionId)
    if (queued) target.write(queued)
    const exited = earlyExit.get(result.sessionId)
    earlyData.clear()
    earlyExit.clear()
    if (exited) {
      showExit(exited)
      return
    }
    fitTerminal()
    target.focus()
  } catch (cause) {
    if (!mounted || lease !== attempt || workspaceId !== props.workspaceId) return
    status.value = 'error'
    sessionId.value = ''
    message.value = cause instanceof Error ? cause.message : String(cause)
  }
}
async function disconnect() {
  const id = sessionId.value
  const workspaceId = props.workspaceId
  const lease = attempt
  if (!bridge || !id) return
  try {
    await bridge.ptyDisconnect({ workspaceId, sessionId: id })
  } catch (cause) {
    if (!mounted || lease !== attempt || workspaceId !== props.workspaceId) return
    message.value = cause instanceof Error ? cause.message : String(cause)
    return
  }
  if (!mounted || lease !== attempt || workspaceId !== props.workspaceId) return
  sessionId.value = ''
  status.value = 'disconnected'
  message.value = '已断开并结束本次 cmd.exe 进程树。'
}
function clear() {
  // 只清 xterm 显示/滚动缓冲，不结束 shell，也不删除主进程有限回放缓冲。
  terminal?.clear()
  terminal?.focus()
}
onMounted(async () => {
  mounted = true
  if (!host.value) return
  terminal = new Terminal({
    fontFamily: "Consolas, 'Cascadia Mono', 'Microsoft YaHei Mono', monospace",
    fontSize: 12,
    cursorBlink: true,
    convertEol: false,
    scrollback: 3000,
    theme: {
      background: '#0f172a',
      foreground: '#dbeafe',
      cursor: '#93c5fd',
      selectionBackground: '#334155',
    },
  })
  fit = new FitAddon()
  terminal.loadAddon(fit)
  terminal.open(host.value)
  await nextTick()
  if (!mounted) return
  fitTerminal()
  if (bridge) {
    offData = bridge.onPtyData((event) => {
      if (status.value === 'connecting') {
        if (earlyData.size < 8 || earlyData.has(event.sessionId))
          earlyData.set(
            event.sessionId,
            ((earlyData.get(event.sessionId) || '') + event.data).slice(-65536),
          )
        return
      }
      if (event.sessionId !== sessionId.value) return
      terminal?.write(event.data)
    })
    offExit = bridge.onPtyExit((event) => {
      if (status.value === 'connecting') {
        if (earlyExit.size < 8) earlyExit.set(event.sessionId, event)
        return
      }
      if (event.sessionId !== sessionId.value) return
      showExit(event)
    })
  }
  terminal.onData((data) => {
    if (!sessionId.value || status.value !== 'connected' || !bridge) return
    const lease = attempt
    const workspaceId = props.workspaceId
    const id = sessionId.value
    void bridge
      .ptyWrite({
        workspaceId,
        sessionId: id,
        data,
      })
      .catch((cause: unknown) => {
        if (
          !mounted ||
          lease !== attempt ||
          workspaceId !== props.workspaceId ||
          id !== sessionId.value
        )
          return
        status.value = 'error'
        message.value = cause instanceof Error ? cause.message : String(cause)
      })
  })
  if (typeof ResizeObserver !== 'undefined') {
    observer = new ResizeObserver(scheduleFit)
    observer.observe(host.value)
  }
  window.addEventListener('resize', scheduleFit)
})
watch(
  () => props.workspaceId,
  () => {
    resetPending()
    sessionId.value = ''
    cwd.value = ''
    status.value = 'idle'
    message.value = '工作区已变化；点击“连接 CMD”建立当前工作区会话。'
    terminal?.reset()
  },
)
watch(
  () => props.expanded,
  async () => {
    await nextTick()
    scheduleFit()
  },
)
onBeforeUnmount(() => {
  mounted = false
  resetPending()
  cancelAnimationFrame(resizeFrame)
  observer?.disconnect()
  window.removeEventListener('resize', scheduleFit)
  offData()
  offExit()
  terminal?.dispose()
  terminal = undefined
})
</script>

<template>
  <div class="terminal-shell" :data-terminal-status="status">
    <div class="terminal-toolbar">
      <span class="terminal-state">{{
        status === 'connected'
          ? '已连接'
          : status === 'connecting'
            ? '连接中'
            : status === 'exited'
              ? '已退出'
              : status === 'error'
                ? '启动失败'
                : status === 'disconnected'
                  ? '已断开'
                  : '未连接'
      }}</span>
      <span class="terminal-cwd" :title="cwd">{{ cwd || '源码项目根' }}</span>
      <button v-if="status !== 'connected'" :disabled="status === 'connecting'" @click="connect">
        连接 CMD
      </button>
      <button v-else @click="disconnect">断开</button>
      <button :disabled="status !== 'connected'" @click="clear">清屏</button>
    </div>
    <p class="terminal-message">{{ message }}</p>
    <div ref="host" class="terminal-host" data-terminal-host></div>
  </div>
</template>

<style scoped>
.terminal-shell {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  background: #0f172a;
}
.terminal-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 0 0 auto;
  padding: 6px 8px;
  border-bottom: 1px solid #26364d;
  background: #172033;
  color: #cbd5e1;
}
.terminal-state {
  color: #93c5fd;
  font-size: 11px;
}
.terminal-cwd {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  color: #94a3b8;
  font:
    11px/1.4 Consolas,
    monospace;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.terminal-toolbar button {
  border: 1px solid #3d5a80;
  border-radius: 4px;
  padding: 3px 8px;
  background: #1e3a5f;
  color: #e2e8f0;
  font: inherit;
  cursor: pointer;
}
.terminal-toolbar button:disabled {
  opacity: 0.45;
  cursor: wait;
}
.terminal-message {
  flex: 0 0 auto;
  margin: 0;
  padding: 4px 9px;
  overflow: hidden;
  background: #0f172a;
  color: #94a3b8;
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.terminal-host {
  flex: 1;
  min-height: 0;
  padding: 4px 6px 6px;
  overflow: hidden;
}
</style>

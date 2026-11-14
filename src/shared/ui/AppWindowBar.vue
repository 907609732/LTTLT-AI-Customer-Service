<script setup lang="ts">
import { ref } from 'vue'
import BrandMark from './BrandMark.vue'
import IconMinus from '@/shared/icons/IconMinus.vue'
import IconFullScreen from '@/shared/icons/IconFullScreen.vue'
import IconClose from '@/shared/icons/IconClose.vue'
import { getDesktop } from '@/shared/platform/desktop'

const desktop = getDesktop()
const error = ref('')
async function windowAction(action: 'minimize' | 'toggleMaximize' | 'close') {
  if (!desktop.isElectron) return
  error.value = ''
  try {
    await desktop[action]()
  } catch {
    error.value = '窗口操作失败，请重试。'
  }
}
</script>
<template>
  <div class="app-window-bar-shell">
    <header class="app-window-bar" data-window-drag @dblclick.self="windowAction('toggleMaximize')">
      <BrandMark size="md" />
      <nav data-no-drag aria-label="页面导航"><slot /></nav>
      <div class="app-window-drag" aria-hidden="true" @dblclick="windowAction('toggleMaximize')" />
      <div v-if="desktop.isElectron" class="app-native-controls" data-no-drag>
        <button aria-label="最小化" title="最小化" @click="windowAction('minimize')">
          <IconMinus />
        </button>
        <button
          aria-label="最大化或还原"
          title="最大化或还原"
          @click="windowAction('toggleMaximize')"
        >
          <IconFullScreen />
        </button>
        <button class="close" aria-label="关闭" title="关闭" @click="windowAction('close')">
          <IconClose />
        </button>
      </div>
    </header>
    <p v-if="error" role="alert" class="app-window-error">{{ error }}</p>
  </div>
</template>
<style scoped>
.app-window-bar-shell {
  position: sticky;
  top: 0;
  z-index: 10;
  background: #fff;
}
.app-window-bar {
  min-height: 64px;
  display: flex;
  align-items: center;
  gap: 24px;
  padding-left: 24px;
  border-bottom: 1px solid #dce8fb;
}
nav {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  -webkit-app-region: no-drag;
}
.app-window-drag {
  flex: 1;
  align-self: stretch;
}
.app-native-controls {
  display: flex;
  align-self: stretch;
  -webkit-app-region: no-drag;
}
.app-native-controls button {
  width: 46px;
  border: 0;
  background: none;
  cursor: pointer;
  color: #60738d;
}
.app-native-controls svg {
  width: 16px;
  height: 16px;
}
.app-native-controls button:hover {
  background: #edf5ff;
}
.app-native-controls .close:hover {
  color: #fff;
  background: #dd4a4a;
}
.app-window-error {
  margin: 0;
  padding: 8px 24px;
  color: #b42318;
}
@media (max-width: 700px) {
  .app-window-bar {
    gap: 12px;
    padding-left: 12px;
  }
}
</style>

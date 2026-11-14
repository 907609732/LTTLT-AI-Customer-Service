<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { ElDropdown, ElDropdownItem, ElDropdownMenu } from 'element-plus'
import type { DropdownInstance } from 'element-plus'
import type { LocalStore } from '@/shared/contracts/backend'
import pdd from '@/assets/figma-add-img00.png'
import pddClient from '@/assets/figma-add-img01.png'
import douyin from '@/assets/figma-add-img1.png'
import douyinClient from '@/assets/figma-add-img5.png'
import dewu from '@/assets/figma-add-img2.png'
import qianniu from '@/assets/figma-add-img3.png'
import qianfan from '@/assets/figma-add-img4.png'
import kuaishou from '@/assets/figma-add-img6.png'
import jd from '@/assets/figma-add-img7.png'
import wechat from '@/assets/figma-add-img30.png'
import xianyu from '@/assets/figma-add-img31.png'

const props = defineProps<{ shop: LocalStore; selected?: boolean; busy?: boolean }>()
const emit = defineEmits<{
  open: []
  toggleAi: []
  setup: []
  importKnowledge: []
  settings: []
  backend: []
  close: []
}>()
const dropdown = ref<DropdownInstance>()
const platforms: Record<string, { label: string; icon?: string }> = {
  'pdd-web': { label: '拼多多', icon: pdd },
  'pdd-client': { label: '拼多多客户端', icon: pddClient },
  'doudian-web': { label: '抖店', icon: douyin },
  'doudian-client': { label: '抖店客户端', icon: douyinClient },
  dewu: { label: '得物', icon: dewu },
  qianniu: { label: '千牛', icon: qianniu },
  qianfan: { label: '千帆', icon: qianfan },
  kuaishou: { label: '快手', icon: kuaishou },
  jd: { label: '京麦', icon: jd },
  wechat: { label: '微信', icon: wechat },
  xianyu: { label: '闲鱼', icon: xianyu },
  'sim-local': { label: '本机模拟' },
}
const platform = computed(() => platforms[props.shop.platform] ?? { label: props.shop.platform })
const online = computed(() => props.shop.runtime.online)
const status = computed(() =>
  online.value ? '在线' : props.shop.runtime.open ? '等待登录' : '未打开',
)
const error = computed(
  () =>
    props.shop.runtime.identityError ||
    props.shop.runtime.lastError ||
    props.shop.runtime.collectionError ||
    '',
)
type MenuCommand = 'setup' | 'importKnowledge' | 'settings' | 'backend' | 'close'
const menu: { command: MenuCommand; label: string; glyph: string }[] = [
  { command: 'setup', label: '基础设置', glyph: '☰' },
  { command: 'importKnowledge', label: '导入知识', glyph: '↥' },
  { command: 'settings', label: '店铺设置', glyph: '⚙' },
  { command: 'backend', label: '店铺后台', glyph: '▦' },
  { command: 'close', label: '关闭', glyph: '×' },
]
function closeMenu() {
  dropdown.value?.handleClose()
}
function openShop() {
  if (!props.busy) emit('open')
}
function command(value: MenuCommand) {
  if (props.busy) return
  switch (value) {
    case 'setup':
      emit('setup')
      break
    case 'importKnowledge':
      emit('importKnowledge')
      break
    case 'settings':
      emit('settings')
      break
    case 'backend':
      emit('backend')
      break
    case 'close':
      emit('close')
      break
  }
}
function keyboard(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    event.stopPropagation()
    closeMenu()
  } else if (event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey)) {
    event.preventDefault()
    event.stopPropagation()
    if (!props.busy) dropdown.value?.handleOpen()
  } else if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault()
    event.stopPropagation()
    openShop()
  }
}
watch(() => [props.shop.id, props.selected, props.busy], closeMenu)
onBeforeUnmount(closeMenu)
</script>

<template>
  <ElDropdown
    ref="dropdown"
    class="store-sidebar-dropdown"
    trigger="contextmenu"
    placement="bottom-end"
    :disabled="busy"
    :show-timeout="0"
    :hide-timeout="0"
    :popper-options="{
      modifiers: [{ name: 'flip', options: { fallbackPlacements: ['top-end'] } }],
    }"
    @command="command"
  >
    <div class="store-sidebar-trigger" tabindex="-1">
      <article
        class="store-sidebar-card"
        :class="{ selected, busy }"
        :data-store="shop.id"
        role="button"
        tabindex="0"
        :aria-label="`打开${shop.storeName}工作台`"
        :aria-pressed="Boolean(selected)"
        :aria-disabled="Boolean(busy)"
        @click="openShop"
        @keydown="keyboard"
      >
        <img
          v-if="platform.icon"
          class="platform-logo"
          :src="platform.icon"
          :alt="platform.label"
        />
        <span v-else class="platform-placeholder" aria-hidden="true">店</span>
        <div class="store-information">
          <div class="store-title-row">
            <span class="store-name" :title="shop.storeName">{{ shop.storeName }}</span>
            <button
              type="button"
              class="store-ai-switch"
              :class="{ enabled: shop.aiEnabled }"
              role="switch"
              :aria-checked="shop.aiEnabled"
              :aria-label="`${shop.aiEnabled ? '关闭' : '开启'}${shop.storeName} AI`"
              :disabled="busy"
              @click.stop="!busy && emit('toggleAi')"
              @keydown.stop
            >
              <span class="switch-thumb" /><span class="switch-label">AI</span>
            </button>
          </div>
          <div class="store-status-row">
            <span class="store-status" :class="{ online }"><i />{{ status }}</span>
            <span class="platform-label" :title="platform.label">{{ platform.label }}</span>
          </div>
          <span v-if="error" class="store-error" :title="error">{{ error }}</span>
        </div>
      </article>
    </div>
    <template #dropdown>
      <ElDropdownMenu class="store-sidebar-menu" @keydown.esc="closeMenu">
        <ElDropdownItem
          v-for="item in menu"
          :key="item.command"
          :command="item.command"
          :disabled="busy"
          :divided="item.command === 'close'"
          :class="{ 'close-item': item.command === 'close' }"
          ><span class="menu-icon" aria-hidden="true">{{ item.glyph }}</span
          >{{ item.label }}</ElDropdownItem
        >
      </ElDropdownMenu>
    </template>
  </ElDropdown>
</template>

<style scoped>
.store-sidebar-dropdown,
.store-sidebar-trigger {
  display: block;
  width: 100%;
  min-width: 0;
}
.store-sidebar-card {
  box-sizing: border-box;
  position: relative;
  display: flex;
  align-items: center;
  gap: 9px;
  min-height: 72px;
  padding: 11px 10px 11px 12px;
  border: 1px solid transparent;
  border-left: 3px solid transparent;
  border-radius: 7px;
  color: #25344c;
  cursor: pointer;
  text-align: left;
  background: transparent;
}
.store-sidebar-card:hover {
  background: #f1f5ff;
}
.store-sidebar-card.selected {
  border-color: #e0e8fc;
  border-left-color: #3478fa;
  background: #eaf0fd;
}
.store-sidebar-card:focus-visible {
  outline: 2px solid #3478fa;
  outline-offset: -2px;
}
.store-sidebar-card.busy {
  cursor: progress;
  opacity: 0.65;
}
.platform-logo,
.platform-placeholder {
  width: 43px;
  height: 43px;
  flex: 0 0 43px;
  object-fit: contain;
  border-radius: 9px;
}
.platform-placeholder {
  display: grid;
  place-items: center;
  background: #dfeaff;
  color: #3478fa;
  font-size: 22px;
}
.store-information {
  flex: 1;
  min-width: 0;
}
.store-title-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 5px;
}
.store-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
  font-weight: 600;
  line-height: 22px;
}
.store-ai-switch {
  display: flex;
  flex: 0 0 30px;
  align-items: center;
  justify-content: space-between;
  width: 30px;
  height: 16px;
  padding: 1px 3px 1px 1px;
  border: 0;
  border-radius: 9px;
  background: #dce2ec;
  color: #8493a9;
  cursor: pointer;
}
.switch-thumb {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: white;
  box-shadow: 0 1px 3px #9aabc4;
}
.switch-label {
  font-size: 8px;
  line-height: 1;
}
.store-ai-switch.enabled {
  background: #3478fa;
  color: white;
  flex-direction: row-reverse;
  padding: 1px 1px 1px 3px;
}
.store-ai-switch:disabled {
  cursor: progress;
}
.store-status-row {
  display: flex;
  align-items: center;
  gap: 10px;
  color: #8a9ab2;
  font-size: 11px;
  line-height: 19px;
}
.store-status {
  display: inline-flex;
  flex-shrink: 0;
  align-items: center;
  gap: 4px;
  color: #8a9ab2;
}
.store-status i {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: #a9b4c5;
}
.store-status.online {
  color: #3478fa;
}
.store-status.online i {
  background: #3478fa;
}
.platform-label,
.store-error {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.store-error {
  display: block;
  color: #c15e46;
  font-size: 10px;
  line-height: 13px;
  max-width: 100%;
}
.store-sidebar-menu {
  box-sizing: border-box;
  width: 154px;
  padding: 6px 0;
}
.store-sidebar-menu :deep(.el-dropdown-menu__item) {
  gap: 10px;
  min-height: 31px;
  padding: 0 15px;
  font-size: 13px;
}
.menu-icon {
  width: 16px;
  text-align: center;
  font-size: 16px;
}
.store-sidebar-menu :deep(.close-item:not(.is-disabled)) {
  color: #f04f4f;
}
</style>

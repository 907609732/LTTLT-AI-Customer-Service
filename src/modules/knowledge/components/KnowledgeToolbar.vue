<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'
import { ElDropdown, ElDropdownMenu, ElDropdownItem, type DropdownInstance } from 'element-plus'
const props = defineProps<{
  busy: boolean
  storeId: string
  tab: string
  contextKey: string
  readOnly?: boolean
  capabilities?: { catalog?: boolean; import?: boolean; learn?: boolean }
}>()
const emit = defineEmits<{
  catalog: []
  archive: []
  learn: []
  sources: []
  write: []
  exportJson: []
  exportCsv: []
  backup: []
  restore: []
}>()
const importMenu = ref<DropdownInstance>(),
  exportMenu = ref<DropdownInstance>(),
  backupMenu = ref<DropdownInstance>()
const menus = () => [importMenu.value, exportMenu.value, backupMenu.value]
function closeMenus() {
  for (const menu of menus()) menu?.handleClose()
}
function visible(index: number, open: boolean) {
  if (open)
    menus().forEach((menu, i) => {
      if (i !== index) menu?.handleClose()
    })
}
function importCommand(command: string) {
  if (props.busy) return
  if (command === 'catalog' && props.capabilities?.catalog) emit('catalog')
  else if (command === 'archive' && props.capabilities?.import) emit('archive')
  else if (command === 'learn' && props.capabilities?.learn) emit('learn')
  else if (command === 'sources' && props.capabilities?.import) emit('sources')
}
function exportCommand(command: string) {
  if (command === 'json') emit('exportJson')
  else if (command === 'csv') emit('exportCsv')
}
function backupCommand(command: string) {
  if (command === 'backup') emit('backup')
  else if (command === 'restore') emit('restore')
}
watch(() => props.contextKey, closeMenus)
onBeforeUnmount(closeMenus)
</script>
<template>
  <div class="knowledge-toolbar-actions" @keydown.esc="closeMenus">
    <ElDropdown
      ref="importMenu"
      trigger="click"
      placement="bottom-start"
      popper-class="knowledge-toolbar-menu"
      @visible-change="visible(0, $event)"
      @command="importCommand"
    >
      <button type="button" class="primary">
        {{ tab === 'products' ? '导入商品' : '导入资料' }} <span aria-hidden="true">⌄</span>
      </button>
      <template #dropdown
        ><ElDropdownMenu @keydown.esc="closeMenus">
          <ElDropdownItem command="catalog" :disabled="busy || !capabilities?.catalog"
            >导入平台商品</ElDropdownItem
          >
          <ElDropdownItem command="archive" :disabled="busy || !capabilities?.import"
            >导入本机归档聊天</ElDropdownItem
          >
          <ElDropdownItem command="learn" :disabled="busy || !capabilities?.learn"
            >学习本店通用资料</ElDropdownItem
          >
          <ElDropdownItem command="sources" :disabled="busy || !capabilities?.import">{{
            tab === 'products' ? '导入商品CSV / 通用资料' : '导入本店通用资料'
          }}</ElDropdownItem>
        </ElDropdownMenu></template
      >
    </ElDropdown>
    <button
      type="button"
      data-testid="write-one"
      :disabled="busy || readOnly || !storeId"
      @click="emit('write')"
    >
      ＋ 自己写一件
    </button>
    <ElDropdown
      ref="exportMenu"
      trigger="click"
      placement="bottom-start"
      popper-class="knowledge-toolbar-menu"
      @visible-change="visible(1, $event)"
      @command="exportCommand"
    >
      <button type="button">导出 <span aria-hidden="true">⌄</span></button>
      <template #dropdown
        ><ElDropdownMenu @keydown.esc="closeMenus">
          <ElDropdownItem command="json">导出JSON</ElDropdownItem>
          <ElDropdownItem command="csv">导出CSV</ElDropdownItem>
        </ElDropdownMenu></template
      >
    </ElDropdown>
    <ElDropdown
      ref="backupMenu"
      trigger="click"
      placement="bottom-start"
      popper-class="knowledge-toolbar-menu"
      @visible-change="visible(2, $event)"
      @command="backupCommand"
    >
      <button type="button">备份 <span aria-hidden="true">⌄</span></button>
      <template #dropdown
        ><ElDropdownMenu @keydown.esc="closeMenus">
          <ElDropdownItem command="backup">全库备份</ElDropdownItem>
          <ElDropdownItem command="restore">恢复全库备份</ElDropdownItem>
        </ElDropdownMenu></template
      >
    </ElDropdown>
  </div>
</template>

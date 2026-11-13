import { getDesktop } from './desktop'

const interactive =
  'button, a, input, textarea, select, [contenteditable], .el-select, .el-dropdown, .el-switch, .el-slider, [data-no-drag]'

/** 等待主进程确认后才移动；清理函数同时用于热更新和测试卸载。 */
export function installWindowDrag(): () => void {
  const api = getDesktop()
  if (!api.isElectron) return () => {}
  let active = false
  let sequence = 0
  let pending = false
  const end = () => {
    sequence++
    pending = false
    if (active) api.endMove()
    active = false
  }
  const down = async (event: PointerEvent) => {
    if (event.button !== 0 || !(event.target instanceof Element)) return
    if (!event.target.closest('[data-window-drag]') || event.target.closest(interactive)) return
    const current = ++sequence
    pending = true
    event.preventDefault()
    try {
      const accepted = await api.beginMove({ screenX: event.screenX, screenY: event.screenY })
      if (current !== sequence) {
        if (accepted && !pending && !active) api.endMove()
        return
      }
      pending = false
      active = accepted
    } catch {
      if (current === sequence) end()
    }
  }
  const move = (event: PointerEvent) => {
    if (active) api.move({ screenX: event.screenX, screenY: event.screenY })
  }
  document.addEventListener('pointerdown', down, true)
  document.addEventListener('pointermove', move, true)
  document.addEventListener('pointerup', end, true)
  document.addEventListener('pointercancel', end, true)
  window.addEventListener('blur', end)
  return () => {
    end()
    document.removeEventListener('pointerdown', down, true)
    document.removeEventListener('pointermove', move, true)
    document.removeEventListener('pointerup', end, true)
    document.removeEventListener('pointercancel', end, true)
    window.removeEventListener('blur', end)
  }
}

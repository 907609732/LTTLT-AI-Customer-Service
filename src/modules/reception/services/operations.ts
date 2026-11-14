import { computed, onUnmounted, ref, watch } from 'vue'
import { getDesktop } from '@/shared/platform/desktop'
import type {
  ReceptionBridge,
  ReceptionCommand,
  ReceptionSnapshot,
} from '@/shared/contracts/platform-operations'

export function getReceptionService(): ReceptionBridge | undefined {
  const desktop = getDesktop()
  if (
    !desktop.isElectron ||
    !('receptionSnapshot' in desktop) ||
    !('receptionExecute' in desktop) ||
    typeof desktop.receptionSnapshot !== 'function' ||
    typeof desktop.receptionExecute !== 'function'
  )
    return undefined
  return desktop as typeof desktop & ReceptionBridge
}

/** All late replies are discarded when workspace or command generation changes. */
export function useReceptionOperations(
  workspaceId: () => string,
  provided?: () => ReceptionBridge | undefined,
) {
  const snapshot = ref<ReceptionSnapshot>(),
    error = ref(''),
    busy = ref(false)
  const service = computed(() => provided?.() ?? getReceptionService())
  let generation = 0,
    sequence = 0,
    timer: ReturnType<typeof setInterval> | undefined
  const message = (cause: unknown) =>
    cause instanceof Error
      ? cause.message.replace(/^Error invoking remote method '[^']+':(?: Error:)?\s*/, '')
      : '平台操作服务暂时不可用'
  async function refresh() {
    const bridge = service.value,
      workspace = workspaceId(),
      expected = generation,
      request = ++sequence
    if (!bridge || !workspace || busy.value) return
    try {
      const next = await bridge.receptionSnapshot(workspace)
      if (expected !== generation || request !== sequence || next.workspaceId !== workspaceId())
        return
      snapshot.value = next
      error.value = ''
    } catch (cause) {
      if (expected === generation && request === sequence) error.value = message(cause)
    }
  }
  async function execute(command: ReceptionCommand) {
    if (!service.value || busy.value || command.workspaceId !== workspaceId()) return false
    busy.value = true
    error.value = ''
    const expected = generation,
      request = ++sequence
    try {
      const next = await service.value.receptionExecute(command)
      if (expected !== generation || request !== sequence || next.workspaceId !== workspaceId())
        return false
      snapshot.value = next
      return true
    } catch (cause) {
      if (expected === generation && request === sequence) error.value = message(cause)
      return false
    } finally {
      if (expected === generation) busy.value = false
    }
  }
  watch(
    workspaceId,
    () => {
      generation++
      sequence++
      snapshot.value = undefined
      error.value = ''
      busy.value = false
      if (timer) clearInterval(timer)
      timer = undefined
      void refresh()
      if (workspaceId())
        timer = setInterval(() => {
          if (!busy.value) void refresh()
        }, 5000)
    },
    { immediate: true },
  )
  onUnmounted(() => {
    generation++
    if (timer) clearInterval(timer)
  })
  return { snapshot, error, busy, service, refresh, execute }
}

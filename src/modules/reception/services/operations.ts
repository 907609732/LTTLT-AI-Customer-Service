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
    timer: ReturnType<typeof setInterval> | undefined,
    acknowledgedTail: Promise<unknown> = Promise.resolve()
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
  /** Shared send path; returns only the snapshot actually received for this command. */
  async function send(command: ReceptionCommand): Promise<ReceptionSnapshot | undefined> {
    const bridge = service.value
    if (!bridge || command.workspaceId !== workspaceId()) return undefined
    busy.value = true
    error.value = ''
    const expected = generation,
      request = ++sequence
    try {
      const next = await bridge.receptionExecute(command)
      if (expected !== generation || request !== sequence || next.workspaceId !== workspaceId())
        return undefined
      snapshot.value = next
      return next
    } catch (cause) {
      if (expected === generation && request === sequence) error.value = message(cause)
      return undefined
    } finally {
      if (expected === generation) busy.value = false
    }
  }
  async function execute(command: ReceptionCommand) {
    if (!service.value || busy.value || command.workspaceId !== workspaceId()) return false
    return Boolean(await send(command))
  }
  /**
   * Autosave entry: waits for a manual command already in flight instead of
   * dropping the edit, and resolves only when this command has its own
   * confirmed snapshot. Callers must not show success on undefined.
   */
  async function executeConfirmed(
    command: ReceptionCommand,
  ): Promise<ReceptionSnapshot | undefined> {
    if (!service.value || !workspaceId() || command.workspaceId !== workspaceId()) return undefined
    const expected = generation
    const bridge = service.value
    const isCurrent = () =>
      generation === expected && service.value === bridge && command.workspaceId === workspaceId()
    const run = acknowledgedTail.then(async () => {
      while (busy.value) {
        if (!isCurrent()) return undefined
        await new Promise((resolve) => setTimeout(resolve, 25))
      }
      if (!isCurrent()) return undefined
      return send(command)
    })
    acknowledgedTail = run.then(
      () => undefined,
      () => undefined,
    )
    return run
  }
  watch(
    workspaceId,
    () => {
      generation++
      sequence++
      acknowledgedTail = Promise.resolve()
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
  return { snapshot, error, busy, service, refresh, execute, executeConfirmed }
}

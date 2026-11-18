import { defineComponent, ref } from 'vue'
import { mount, flushPromises } from '@vue/test-utils'
import { expect, it, vi } from 'vitest'
import { useReceptionOperations } from '../src/modules/reception/services/operations'
import type {
  ReceptionBridge,
  ReceptionSnapshot,
} from '../src/shared/contracts/platform-operations'

const snapshot = (workspaceId = 'a'): ReceptionSnapshot => ({
  workspaceId,
  rules: [],
  facts: [],
  runs: [],
})
async function fixture() {
  const workspace = ref('a')
  let release!: (value: ReceptionSnapshot) => void
  const inFlight = new Promise<ReceptionSnapshot>((resolve) => {
    release = resolve
  })
  const execute = vi
    .fn<ReceptionBridge['receptionExecute']>()
    .mockReturnValueOnce(inFlight)
    .mockResolvedValue(snapshot())
  const bridge: ReceptionBridge = {
    receptionSnapshot: vi.fn(async () => snapshot(workspace.value)),
    receptionExecute: execute,
  }
  let operations!: ReturnType<typeof useReceptionOperations>
  const wrapper = mount(
    defineComponent({
      setup() {
        operations = useReceptionOperations(
          () => workspace.value,
          () => bridge,
        )
        return () => null
      },
    }),
  )
  await flushPromises()
  const manual = operations.execute({ type: 'refresh', workspaceId: 'a' })
  const queued = operations.executeConfirmed({
    type: 'remove-rule',
    workspaceId: 'a',
    id: 'existing',
    revision: 1,
  })
  await flushPromises()
  return { wrapper, workspace, execute, release, manual, queued }
}
it('discards a queued media write after workspace A to B to A', async () => {
  const f = await fixture()
  try {
    f.workspace.value = 'b'
    await flushPromises()
    f.workspace.value = 'a'
    await flushPromises()
    f.release(snapshot())
    await f.manual
    expect(await f.queued).toBeUndefined()
    expect(f.execute).toHaveBeenCalledTimes(1)
  } finally {
    f.wrapper.unmount()
  }
})
it('discards a queued media write after its owner unmounts', async () => {
  const f = await fixture()
  f.wrapper.unmount()
  f.release(snapshot())
  await f.manual
  expect(await f.queued).toBeUndefined()
  expect(f.execute).toHaveBeenCalledTimes(1)
})

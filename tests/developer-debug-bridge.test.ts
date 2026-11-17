import { describe, expect, it, vi } from 'vitest'
import { createDeveloperDebugBridge } from '../electron/developer-debug/preload'
import { developerDebugChannels } from '../src/shared/contracts/developer-debug'

describe('developer debug preload capability', () => {
  it('is absent unless the main process explicitly marks this source renderer', () => {
    const invoke = vi.fn(async () => ({}))
    expect(
      createDeveloperDebugBridge({
        requested: false,
        probe: () => true,
        invoke,
        on: vi.fn(() => () => {}),
      }),
    ).toBeUndefined()
    expect(
      createDeveloperDebugBridge({
        requested: true,
        probe: () => false,
        invoke,
        on: vi.fn(() => () => {}),
      }),
    ).toBeUndefined()
    expect(invoke).not.toHaveBeenCalled()
  })

  it('exposes only fixed channels after the main-process probe succeeds', async () => {
    const invoke = vi.fn(async (_channel: string, _input: unknown) => ({ ok: true, text: 'ok' }))
    const off = vi.fn()
    const on = vi.fn(() => off)
    const bridge = createDeveloperDebugBridge({
      requested: true,
      probe: () => true,
      invoke,
      on,
    })
    expect(bridge).toBeDefined()
    await bridge!.gm({ workspaceId: 'w', storeId: 's', input: 'help' })
    expect(invoke).toHaveBeenLastCalledWith(developerDebugChannels.gm, {
      workspaceId: 'w',
      storeId: 's',
      input: 'help',
    })
    const listener = vi.fn()
    const unsubscribe = bridge!.onPtyData(listener)
    expect(on).toHaveBeenCalledWith(developerDebugChannels.ptyData, expect.any(Function))
    unsubscribe()
    expect(off).toHaveBeenCalled()
  })
})

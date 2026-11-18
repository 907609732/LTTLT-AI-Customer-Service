// @vitest-environment node
import { expect, it } from 'vitest'
import { z } from 'zod'
import { createAgentService } from '../electron/agent/service'
import { createAgentSettingsFixture } from './agent-settings-fixture'

it('does not return a successful first-write result after account identity becomes stale', async () => {
  const fixture = createAgentSettingsFixture()
  const service = createAgentService({
    version: 'fixture',
    runtime: () => ({
      snapshot: () => structuredClone(fixture.state),
      knowledge: () => {
        throw Error('not needed')
      },
      execute: async (command) => {
        const result = await fixture.execute(command)
        fixture.state.managed.restartRequired = true
        return result
      },
    }),
  })
  try {
    const current = z.object({ version: z.string() }).parse(
      await service.call({
        tool: 'lingtu_get_config',
        args: { workspaceId: 'w', group: 'reply-pacing' },
      }),
    )
    await expect(
      service.call({
        tool: 'lingtu_apply_config',
        args: {
          workspaceId: 'w',
          group: 'reply-pacing',
          requestId: 'late-auth',
          expectedVersion: current.version,
          patch: { mode: 'fixed-1' },
        },
      }),
    ).rejects.toThrow(/账号工作区|重启/)
  } finally {
    fixture.dispose()
  }
})

it('preview refuses to enable vision when the native capability check would reject it', async () => {
  const fixture = createAgentSettingsFixture()
  try {
    fixture.state.capabilities.vision.supported = false
    fixture.state.capabilities.vision.reason = '当前模型尚未支持图片识别'
    await expect(
      fixture.service.call({
        tool: 'lingtu_preview_config',
        args: { workspaceId: 'w', group: 'vision', storeId: 'a', patch: { enabled: true } },
      }),
    ).rejects.toThrow(/图片|识图/)
    expect(fixture.writes).toHaveLength(0)
  } finally {
    fixture.dispose()
  }
})

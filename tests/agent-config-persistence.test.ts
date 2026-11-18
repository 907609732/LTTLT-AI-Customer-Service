// @vitest-environment node
import { createRequire } from 'node:module'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { z } from 'zod'
import { createAgentService } from '../electron/agent/service'
import { ReplyPacingStore } from '../electron/reply-pacing'
import { resultSchema, snapshotSchema, type BackendCommand } from '../src/shared/contracts/backend'

const require = createRequire(import.meta.url)
interface Backend {
  snapshot(): unknown
  execute(input: unknown): Promise<unknown>
  dispose(): void
}
const { createBackend } = require('../vendor/lingtu-runtime/electron/backend.cjs') as {
  createBackend(options: Record<string, unknown>): Backend
}
const configResult = z.object({
  version: z.string(),
  settings: z.record(z.string(), z.unknown()),
})

it('persists all three AI config groups through real native stores and reloads across restarts', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'lingtu-agent-native-'))
  const workspaceId = '00000000-0000-4000-8000-000000000001'
  const makeBackend = () =>
    createBackend({
      dataDir: directory,
      localVisionSupport: () => ({ supported: true, model: 'fixture', maxImages: 4, reason: '' }),
    })
  let backend = makeBackend()
  let pacing = new ReplyPacingStore(directory, 60000)
  let race: (() => Promise<void>) | undefined
  const snapshot = () => {
    const state = snapshotSchema.parse({
      ...(backend.snapshot() as Record<string, unknown>),
      workspaceId,
    })
    state.config.reply.pacing = pacing.snapshot()
    return state
  }
  const execute = async (command: BackendCommand) => {
    if (race) {
      const action = race
      race = undefined
      await action()
    }
    if (command.action === 'save-config' && command.screenId === 'REPLY_PACING') {
      const saved = pacing.save(command.values)
      return { status: 'ok' as const, message: 'saved', data: { pacing: saved } }
    }
    return resultSchema.parse(await backend.execute(command))
  }
  const makeService = () =>
    createAgentService({
      version: 'fixture',
      runtime: () => ({
        snapshot,
        execute,
        knowledge: () => {
          throw Error('not used')
        },
      }),
    })
  let service = makeService()
  try {
    await backend.execute({
      action: 'add-store',
      values: { storeName: 'offline fixture', platform: 'pdd-web' },
    })
    const storeId = snapshot().stores[0]!.id
    const get = async (group: string) =>
      configResult.parse(
        await service.call({
          tool: 'lingtu_get_config',
          args: { workspaceId, group, ...(group === 'reply-pacing' ? {} : { storeId }) },
        }),
      )
    const apply = async (group: string, patch: Record<string, unknown>, requestId: string) => {
      const before = await get(group)
      return configResult.parse(
        await service.call({
          tool: 'lingtu_apply_config',
          args: {
            workspaceId,
            group,
            ...(group === 'reply-pacing' ? {} : { storeId }),
            patch,
            requestId,
            expectedVersion: before.version,
          },
        }),
      )
    }
    const welcome = await apply(
      'welcome',
      { text: '本机隔离测试', enabled: true, delayMinSeconds: 2, delayMaxSeconds: 4 },
      'native-welcome',
    )
    const vision = await apply('vision', { enabled: true }, 'native-vision')
    const interval = await apply(
      'reply-pacing',
      { mode: 'custom', customMinSeconds: 5, customMaxSeconds: 6 },
      'native-pacing',
    )
    expect(snapshot().stores[0]!.aiEnabled).toBe(false)
    backend.dispose()
    backend = makeBackend()
    pacing = new ReplyPacingStore(directory, 60000)
    service = makeService()
    expect((await get('welcome')).settings).toEqual(welcome.settings)
    expect((await get('vision')).settings).toEqual(vision.settings)
    expect((await get('reply-pacing')).settings).toEqual(interval.settings)
    expect(snapshot().stores[0]!.aiEnabled).toBe(false)

    race = async () => {
      const current = snapshot().welcomeByStore[storeId]!
      await backend.execute({
        action: 'save-welcome',
        storeId,
        values: {
          text: '界面刚保存的内容',
          enabled: current.enabled,
          version: current.version,
          delayMinSeconds: current.delayMinSeconds,
          delayMaxSeconds: current.delayMaxSeconds,
        },
      })
    }
    await expect(apply('welcome', { text: '过时的AI修改' }, 'native-race')).rejects.toThrow(/更新/)
    expect((await get('welcome')).settings.text).toBe('界面刚保存的内容')
    race = async () => {
      const current = snapshot().visionByStore[storeId]!
      await backend.execute({
        action: 'save-vision-settings',
        storeId,
        values: { enabled: false, version: current.version },
      })
    }
    await expect(apply('vision', { enabled: false }, 'native-vision-race')).rejects.toThrow(/更新/)
    expect((await get('vision')).settings.enabled).toBe(false)
    race = async () => {
      pacing.save({ ...pacing.snapshot(), mode: 'fixed-1', expected: pacing.snapshot() })
    }
    await expect(
      apply('reply-pacing', { mode: 'random-2-3' }, 'native-pacing-race'),
    ).rejects.toThrow(/更新/)
    expect((await get('reply-pacing')).settings.mode).toBe('fixed-1')
  } finally {
    backend.dispose()
    rmSync(directory, { recursive: true, force: true })
  }
})

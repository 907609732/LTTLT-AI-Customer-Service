// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest'
import { createAgentSettingsFixture } from './agent-settings-fixture'

interface ConfigField {
  type: string
  min?: number
  max?: number
  default?: unknown
  values?: string[]
}
interface SchemaResult {
  groups: {
    group: string
    scope: string
    fields: Record<string, ConfigField>
  }[]
}
interface GetResult {
  group: string
  scope: string
  workspaceId: string
  storeId?: string
  version: string
  settings: Record<string, unknown>
}
interface PreviewResult extends GetResult {
  effective: Record<string, unknown>
  changes: Record<string, { from: unknown; to: unknown }>
}
interface ApplyResult extends GetResult {
  requestId: string
}

const fixtures: ReturnType<typeof createAgentSettingsFixture>[] = []
afterEach(() => {
  for (const fixture of fixtures.splice(0)) fixture.dispose()
})
function fixture() {
  const value = createAgentSettingsFixture()
  fixtures.push(value)
  return value
}
const get = (f: ReturnType<typeof fixture>, group: string, storeId?: string): Promise<GetResult> =>
  f.service.call({
    tool: 'lingtu_get_config',
    args: { workspaceId: 'w', group, ...(storeId ? { storeId } : {}) },
  }) as Promise<GetResult>
const preview = (
  f: ReturnType<typeof fixture>,
  group: string,
  patch: Record<string, unknown>,
  storeId?: string,
): Promise<PreviewResult> =>
  f.service.call({
    tool: 'lingtu_preview_config',
    args: { workspaceId: 'w', group, ...(storeId ? { storeId } : {}), patch },
  }) as Promise<PreviewResult>
const apply = (
  f: ReturnType<typeof fixture>,
  input: {
    group: string
    storeId?: string
    requestId: string
    expectedVersion: string
    patch: Record<string, unknown>
  },
): Promise<ApplyResult> =>
  f.service.call({
    tool: 'lingtu_apply_config',
    args: { workspaceId: 'w', ...input },
  }) as Promise<ApplyResult>

describe('configuration discovery', () => {
  it('lists exactly the three approved groups and field constraints without credentials', async () => {
    const f = fixture()
    const schema = (await f.service.call({
      tool: 'lingtu_config_schema',
      args: {},
    })) as SchemaResult
    expect(schema.groups.map((group) => group.group)).toEqual(['reply-pacing', 'welcome', 'vision'])
    expect(schema.groups.map((group) => group.scope)).toEqual(['global', 'store', 'store'])
    expect(schema.groups[0]!.fields).toMatchObject({
      mode: { type: 'enum', values: ['random-1-3', 'random-2-3', 'custom', 'fixed-1'] },
      customMinSeconds: { type: 'integer', min: 1, max: 3600 },
      customMaxSeconds: { type: 'integer', min: 1, max: 3600 },
    })
    expect(schema.groups[1]!.fields).toMatchObject({
      text: { type: 'string', maxLength: 200 },
      enabled: { type: 'boolean' },
      delayMinSeconds: { type: 'integer', min: 1, max: 3600, default: 1 },
      delayMaxSeconds: { type: 'integer', min: 1, max: 3600, default: 3 },
    })
    expect(schema.groups[2]!.fields).toEqual({
      enabled: { type: 'boolean', default: false },
    })
    expect(JSON.stringify(schema)).not.toMatch(
      /apiKey|credential|connection\.json|systemPrompt|Bearer|token/i,
    )
  })

  it('reads global pacing and store welcome/vision with stable content versions', async () => {
    const f = fixture()
    const pacing = await get(f, 'reply-pacing')
    expect(pacing).toMatchObject({
      group: 'reply-pacing',
      scope: 'global',
      workspaceId: 'w',
      settings: { mode: 'random-1-3', customMinSeconds: 1, customMaxSeconds: 3 },
    })
    expect(pacing.version).toMatch(/^[a-f0-9]{64}$/)
    const welcome = await get(f, 'welcome', 'a')
    expect(welcome).toMatchObject({
      group: 'welcome',
      scope: 'store',
      storeId: 'a',
      settings: { text: '旧欢迎', enabled: true, delayMinSeconds: 2, delayMaxSeconds: 5 },
    })
    const absent = await get(f, 'welcome', 'b')
    expect(absent.settings).toEqual({
      text: '',
      enabled: false,
      delayMinSeconds: 1,
      delayMaxSeconds: 3,
    })
    const vision = await get(f, 'vision', 'a')
    expect(vision).toMatchObject({ storeId: 'a', settings: { enabled: false } })
    expect(await get(f, 'vision', 'b')).toMatchObject({
      settings: { enabled: false },
    })
    expect((await get(f, 'welcome', 'a')).version).toBe(welcome.version)
    expect((await get(f, 'reply-pacing')).version).toBe(pacing.version)
  })

  it('rejects unknown groups, missing or extra store scope, and unknown/empty patches', async () => {
    const f = fixture()
    for (const call of [
      { tool: 'lingtu_get_config', args: { workspaceId: 'w', group: 'model' } },
      { tool: 'lingtu_get_config', args: { workspaceId: 'w', group: 'welcome' } },
      {
        tool: 'lingtu_get_config',
        args: { workspaceId: 'w', group: 'reply-pacing', storeId: 'a' },
      },
      {
        tool: 'lingtu_preview_config',
        args: { workspaceId: 'w', group: 'vision', storeId: 'a', patch: {} },
      },
      {
        tool: 'lingtu_preview_config',
        args: {
          workspaceId: 'w',
          group: 'vision',
          storeId: 'a',
          patch: { enabled: true, profiles: {} },
        },
      },
      {
        tool: 'lingtu_preview_config',
        args: {
          workspaceId: 'w',
          group: 'welcome',
          storeId: 'a',
          patch: { text: 'x', credentials: 'secret' },
        },
      },
      {
        tool: 'lingtu_preview_config',
        args: {
          workspaceId: 'w',
          group: 'reply-pacing',
          patch: { mode: 'random-1-3', apiKey: 'secret' },
        },
      },
    ])
      await expect(f.service.call(call)).rejects.toThrow()
    expect(f.writes).toHaveLength(0)
  })
})

describe('preview', () => {
  it('shows field changes without executing or mutating any stored setting', async () => {
    const f = fixture()
    const before = structuredClone(f.state)
    const result = await preview(f, 'welcome', { text: ' 新欢迎 ', delayMaxSeconds: 8 }, 'a')
    expect(result).toMatchObject({
      group: 'welcome',
      scope: 'store',
      storeId: 'a',
      settings: { text: '旧欢迎', enabled: true, delayMinSeconds: 2, delayMaxSeconds: 5 },
      effective: { text: '新欢迎', enabled: true, delayMinSeconds: 2, delayMaxSeconds: 8 },
      changes: {
        text: { from: '旧欢迎', to: '新欢迎' },
        delayMaxSeconds: { from: 5, to: 8 },
      },
    })
    expect(f.writes).toHaveLength(0)
    expect(f.state).toEqual(before)
  })

  it('validates the merged range, not just individual fields', async () => {
    const f = fixture()
    await expect(
      preview(f, 'reply-pacing', { mode: 'custom', customMinSeconds: 9, customMaxSeconds: 4 }),
    ).rejects.toThrow(/下限不能大于上限/)
    await expect(preview(f, 'welcome', { enabled: true, text: '' }, 'a')).rejects.toThrow(/欢迎/)
    expect(f.writes).toHaveLength(0)
  })
})

describe('apply', () => {
  it('saves reply pacing through save-config with the native full expected value and reads back', async () => {
    const f = fixture()
    const before = await get(f, 'reply-pacing')
    const result = await apply(f, {
      group: 'reply-pacing',
      requestId: 'pacing-1',
      expectedVersion: before.version,
      patch: { mode: 'custom', customMinSeconds: 5, customMaxSeconds: 9 },
    })
    expect(result).toMatchObject({
      group: 'reply-pacing',
      settings: { mode: 'custom', customMinSeconds: 5, customMaxSeconds: 9 },
      requestId: 'pacing-1',
    })
    expect(result.version).not.toBe(before.version)
    expect(f.writes).toHaveLength(1)
    expect(f.writes[0]).toMatchObject({
      workspaceId: 'w',
      action: 'save-config',
      screenId: 'REPLY_PACING',
      values: {
        mode: 'custom',
        customMinSeconds: 5,
        customMaxSeconds: 9,
        expected: { mode: 'random-1-3', customMinSeconds: 1, customMaxSeconds: 3 },
      },
    })
    expect((await get(f, 'reply-pacing')).settings).toEqual(result.settings)
  })

  it('saves welcome on an absent record without replacing other fields or neighboring stores', async () => {
    const f = fixture()
    const other = structuredClone(f.state.welcomeByStore.a)
    const before = await get(f, 'welcome', 'b')
    const result = await apply(f, {
      group: 'welcome',
      storeId: 'b',
      requestId: 'welcome-b',
      expectedVersion: before.version,
      patch: { text: '  欢迎光临  ' },
    })
    expect(result.settings).toEqual({
      text: '欢迎光临',
      enabled: false,
      delayMinSeconds: 1,
      delayMaxSeconds: 3,
    })
    expect(f.writes[0]).toMatchObject({
      action: 'save-welcome',
      storeId: 'b',
      values: {
        text: '欢迎光临',
        enabled: false,
        version: 0,
        delayMinSeconds: 1,
        delayMaxSeconds: 3,
      },
    })
    expect(f.state.welcomeByStore.a).toEqual(other)
  })

  it('preserves unpatched welcome fields and uses the native version CAS', async () => {
    const f = fixture()
    const before = await get(f, 'welcome', 'a')
    const result = await apply(f, {
      group: 'welcome',
      storeId: 'a',
      requestId: 'welcome-a',
      expectedVersion: before.version,
      patch: { enabled: false },
    })
    expect(result.settings).toEqual({
      text: '旧欢迎',
      enabled: false,
      delayMinSeconds: 2,
      delayMaxSeconds: 5,
    })
    expect(f.writes[0]).toMatchObject({ values: { version: 4, text: '旧欢迎' } })
  })

  it('saves vision enabled through save-vision-settings and never exposes profiles', async () => {
    const f = fixture()
    const before = await get(f, 'vision', 'a')
    const result = await apply(f, {
      group: 'vision',
      storeId: 'a',
      requestId: 'vision-a',
      expectedVersion: before.version,
      patch: { enabled: true },
    })
    expect(result.settings).toEqual({ enabled: true })
    expect(f.writes[0]).toMatchObject({
      action: 'save-vision-settings',
      storeId: 'a',
      values: { enabled: true, version: 2 },
    })
    expect(JSON.stringify(result)).not.toMatch(/model|profile|apiKey|token/i)
  })

  it('rejects stale workspace, stale store and stale version without writing', async () => {
    const f = fixture()
    const before = await get(f, 'welcome', 'a')
    await expect(
      f.service.call({
        tool: 'lingtu_apply_config',
        args: {
          workspaceId: 'old',
          group: 'welcome',
          storeId: 'a',
          requestId: 'stale-workspace',
          expectedVersion: before.version,
          patch: { text: 'x' },
        },
      }),
    ).rejects.toThrow()
    await expect(
      f.service.call({
        tool: 'lingtu_apply_config',
        args: {
          workspaceId: 'w',
          group: 'welcome',
          storeId: 'missing',
          requestId: 'stale-store',
          expectedVersion: before.version,
          patch: { text: 'x' },
        },
      }),
    ).rejects.toThrow()
    await expect(
      apply(f, {
        group: 'welcome',
        storeId: 'a',
        requestId: 'stale-version',
        expectedVersion: '0'.repeat(64),
        patch: { text: 'x' },
      }),
    ).rejects.toThrow(/更新/)
    expect(f.writes).toHaveLength(0)
    expect(f.state.welcomeByStore.a?.text).toBe('旧欢迎')
  })

  it('does not lose a concurrent UI save between preview and apply', async () => {
    const f = fixture()
    const shown = await preview(f, 'vision', { enabled: true }, 'a')
    // The user saves in the desktop UI after the preview was produced.
    f.state.visionByStore.a = { enabled: true, version: 3 }
    await expect(
      apply(f, {
        group: 'vision',
        storeId: 'a',
        requestId: 'concurrent',
        expectedVersion: shown.version,
        patch: { enabled: false },
      }),
    ).rejects.toThrow(/更新/)
    expect(f.writes).toHaveLength(0)
    expect(f.state.visionByStore.a).toEqual({ enabled: true, version: 3 })
  })

  it('deduplicates request IDs and refuses reusing one for different content', async () => {
    const f = fixture()
    const before = await get(f, 'reply-pacing')
    const input = {
      group: 'reply-pacing',
      requestId: 'repeat',
      expectedVersion: before.version,
      patch: { mode: 'fixed-1' },
    }
    const first = await apply(f, input)
    expect(await apply(f, input)).toEqual(first)
    expect(f.writes).toHaveLength(1)
    await expect(apply(f, { ...input, patch: { mode: 'random-2-3' } })).rejects.toThrow(/requestId/)
    expect(f.writes).toHaveLength(1)
  })

  it('reports native capability rejection and leaves the record unchanged', async () => {
    const f = fixture()
    f.state.capabilities.vision.supported = false
    f.state.capabilities.vision.reason = '当前模型不支持图片识别'
    const before = await get(f, 'vision', 'a')
    await expect(
      apply(f, {
        group: 'vision',
        storeId: 'a',
        requestId: 'unsupported',
        expectedVersion: before.version,
        patch: { enabled: true },
      }),
    ).rejects.toThrow(/图片识别|识图/)
    expect(f.state.visionByStore.a).toEqual({ enabled: false, version: 2 })
  })

  it('never includes credentials or model prompts in read, preview or apply output', async () => {
    const f = fixture()
    const before = await get(f, 'welcome', 'a')
    const shown = await preview(f, 'welcome', { text: '公开欢迎' }, 'a')
    const saved = await apply(f, {
      group: 'welcome',
      storeId: 'a',
      requestId: 'public-output',
      expectedVersion: shown.version,
      patch: { text: '公开欢迎' },
    })
    expect(before.version).not.toBe(saved.version)
    expect(JSON.stringify([before, shown, saved])).not.toMatch(
      /apiKey|credential|connection\.json|systemPrompt|Bearer|token/i,
    )
  })
})

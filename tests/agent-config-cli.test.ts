// @vitest-environment node
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { build } from 'esbuild'
import { createAgentSettingsFixture } from './agent-settings-fixture'
import { createAgentGateway } from '../electron/agent/gateway'

interface CliResult {
  status: number | null
  stdout: string
  stderr: string
  json: { ok?: boolean; data?: unknown; error?: string }
}
interface GetData {
  group: string
  scope: string
  storeId?: string
  version: string
  settings: Record<string, unknown>
}
interface PreviewData extends GetData {
  effective: Record<string, unknown>
  changes: Record<string, unknown>
}
interface SchemaData {
  groups: { group: string }[]
}

let cliPath = ''
let buildDirectory = ''
const disposals: (() => Promise<unknown> | unknown)[] = []
afterEach(async () => {
  for (const dispose of disposals.splice(0).reverse()) await dispose()
})
beforeAll(async () => {
  buildDirectory = mkdtempSync(join(tmpdir(), 'lingtu-cli-build-'))
  cliPath = join(buildDirectory, 'lingtu-cli.cjs')
  await build({
    entryPoints: ['electron/agent/cli.ts'],
    outfile: cliPath,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node20',
    define: { __APP_VERSION__: JSON.stringify('test') },
  })
}, 15000)
afterAll(() => {
  if (buildDirectory) rmSync(buildDirectory, { recursive: true, force: true })
})

async function setup() {
  const f = createAgentSettingsFixture()
  const gateway = await createAgentGateway({ directory: f.directory, call: f.service.call })
  disposals.push(async () => {
    await gateway.close()
    f.dispose()
  })
  return { f, gateway }
}
async function run(args: string[], input?: string): Promise<CliResult> {
  const result = await new Promise<{ status: number | null; stdout: string; stderr: string }>(
    (resolve, reject) => {
      const child = spawn(process.execPath, [cliPath, ...args], {
        env: {
          ...process.env,
          HTTP_PROXY: 'http://127.0.0.1:1',
          HTTPS_PROXY: 'http://127.0.0.1:1',
          ALL_PROXY: 'http://127.0.0.1:1',
          NO_PROXY: '',
          NODE_USE_ENV_PROXY: '1',
        },
      })
      let stdout = ''
      let stderr = ''
      child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
        stdout += chunk
      })
      child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
        stderr += chunk
      })
      child.once('error', reject)
      child.once('close', (status) => resolve({ status, stdout, stderr }))
      child.stdin.end(input ?? '')
    },
  )
  const stdout = result.stdout.trim()
  let json: CliResult['json'] = {}
  try {
    json = stdout ? JSON.parse(stdout) : {}
  } catch {
    json = {}
  }
  return { status: result.status, stdout, stderr: result.stderr, json }
}
const connection = (gateway: { connectionFile: string }) => [
  '--connection-file',
  gateway.connectionFile,
]

describe('lingtu-cli', () => {
  it('discovers store IDs needed for store configuration through the existing stores tool', async () => {
    const { gateway } = await setup()
    const result = await run([
      'stores',
      '--json',
      JSON.stringify({ workspaceId: 'w' }),
      ...connection(gateway),
    ])
    expect(result.status).toBe(0)
    expect(result.json.data).toMatchObject({ workspaceId: 'w', stores: [{ id: 'a' }, { id: 'b' }] })
  })
  it('does not echo malformed private connection descriptor contents', async () => {
    const file = join(buildDirectory, 'corrupted-connection.json')
    writeFileSync(file, '{"token":SYNTHETIC_PRIVATE_DESCRIPTOR}', { mode: 0o600 })
    const result = await run(['status', '--connection-file', file])
    expect(result.status).not.toBe(0)
    expect(result.json.ok).toBe(false)
    expect(result.stdout).not.toMatch(/SYNTHETIC|PRIVATE_DESCRIPTOR|token/i)
  })
  it('prints help without requiring a running app and documents JSON input modes', async () => {
    const help = await run(['--help'])
    expect(help.status).toBe(0)
    expect(help.stdout).toContain('config schema')
    expect(help.stdout).toContain('config get')
    expect(help.stdout).toContain('config preview')
    expect(help.stdout).toContain('config apply')
    expect(help.stdout).toContain('--json')
    expect(help.stdout).toContain('--connection-file')
    expect(help.stdout).toContain('stdin')
  })

  it('reads status through the instance connection file', async () => {
    const { gateway } = await setup()
    const result = await run(['status', ...connection(gateway)])
    expect(result.status).toBe(0)
    expect(result.json).toMatchObject({ ok: true, data: { workspaceId: 'w', version: 'test' } })
  })

  it('discovers configuration fields through config schema', async () => {
    const { gateway } = await setup()
    const result = await run(['config', 'schema', ...connection(gateway)])
    expect(result.status).toBe(0)
    expect((result.json.data as SchemaData).groups.map((group) => group.group)).toEqual([
      'reply-pacing',
      'welcome',
      'vision',
    ])
  })

  it('gets a config group from a JSON argument and from stdin', async () => {
    const { gateway, f } = await setup()
    const argument = await run([
      'config',
      'get',
      '--json',
      JSON.stringify({ workspaceId: 'w', group: 'welcome', storeId: 'a' }),
      ...connection(gateway),
    ])
    expect(argument.status).toBe(0)
    expect(argument.json.data).toMatchObject({
      group: 'welcome',
      settings: { text: '旧欢迎', enabled: true },
    })
    const stdin = await run(
      ['config', 'get', ...connection(gateway)],
      JSON.stringify({ workspaceId: 'w', group: 'reply-pacing' }),
    )
    expect(stdin.status).toBe(0)
    expect(stdin.json.data).toMatchObject({
      group: 'reply-pacing',
      settings: { mode: 'random-1-3' },
    })
    expect(f.writes).toHaveLength(0)
  })

  it('previews without writing and applies with the returned version exactly once', async () => {
    const { gateway, f } = await setup()
    const shown = await run([
      'config',
      'preview',
      '--json',
      JSON.stringify({
        workspaceId: 'w',
        group: 'welcome',
        storeId: 'a',
        patch: { text: 'CLI欢迎' },
      }),
      ...connection(gateway),
    ])
    expect(shown.status).toBe(0)
    expect(shown.json.data).toMatchObject({ effective: { text: 'CLI欢迎' } })
    expect(f.writes).toHaveLength(0)
    const version = (shown.json.data as PreviewData).version
    const input = {
      workspaceId: 'w',
      group: 'welcome',
      storeId: 'a',
      requestId: 'cli-write',
      expectedVersion: version,
      patch: { text: 'CLI欢迎' },
    }
    const applied = await run([
      'config',
      'apply',
      '--json',
      JSON.stringify(input),
      ...connection(gateway),
    ])
    expect(applied.status).toBe(0)
    expect(applied.json.data).toMatchObject({
      requestId: 'cli-write',
      settings: { text: 'CLI欢迎' },
    })
    const repeated = await run([
      'config',
      'apply',
      '--json',
      JSON.stringify(input),
      ...connection(gateway),
    ])
    expect(repeated.status).toBe(0)
    expect(repeated.json).toEqual(applied.json)
    expect(f.writes).toHaveLength(1)
    expect(f.state.welcomeByStore.a?.text).toBe('CLI欢迎')
  })

  it('returns nonzero and does not retry when the expected version is stale', async () => {
    const { gateway, f } = await setup()
    const result = await run([
      'config',
      'apply',
      '--json',
      JSON.stringify({
        workspaceId: 'w',
        group: 'welcome',
        storeId: 'a',
        requestId: 'cli-stale',
        expectedVersion: '0'.repeat(64),
        patch: { text: '不应保存' },
      }),
      ...connection(gateway),
    ])
    expect(result.status).not.toBe(0)
    expect(result.json).toMatchObject({ ok: false })
    expect(result.json.error).toMatch(/更新/)
    expect(f.writes).toHaveLength(0)
    expect(f.state.welcomeByStore.a?.text).toBe('旧欢迎')
  })

  it('fails malformed JSON, missing JSON and unknown options without a call', async () => {
    const { gateway, f } = await setup()
    for (const args of [
      ['config', 'get', '--json', '{bad', ...connection(gateway)],
      ['config', 'preview', ...connection(gateway)],
      ['config', 'apply', '--json', JSON.stringify({ workspaceId: 'w' })],
      ['config', 'destroy', ...connection(gateway)],
      ['status', '--unknown-option', ...connection(gateway)],
    ]) {
      const result = await run(args, '')
      expect(result.status).not.toBe(0)
      expect(result.json).toMatchObject({ ok: false })
    }
    expect(f.writes).toHaveLength(0)
  })

  it('reports a missing connection file as structured failure without leaking credentials', async () => {
    const result = await run([
      'status',
      '--connection-file',
      join(tmpdir(), 'lingtu-missing-connection.json'),
    ])
    expect(result.status).not.toBe(0)
    expect(result.json).toMatchObject({ ok: false })
    expect(result.stdout).not.toMatch(/Bearer|token/i)
  })
})

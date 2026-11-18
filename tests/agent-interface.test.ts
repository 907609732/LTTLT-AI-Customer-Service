// @vitest-environment node
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { emptySnapshot } from '../src/shared/contracts/backend'
import { createKnowledgeRepository } from '../electron/knowledge'
import { createKnowledgeRuntime } from '../electron/knowledge-runtime'
import { createAgentService } from '../electron/agent/service'
import { createAgentGateway } from '../electron/agent/gateway'
import { Client } from '@modelcontextprotocol/client'
import { StdioClientTransport, getDefaultEnvironment } from '@modelcontextprotocol/client/stdio'
import { build } from 'esbuild'
import { agentConnectionSchema } from '../src/shared/contracts/agent'
import { callLocalAgent } from '../electron/agent/http-client'
import { request as httpRequest } from 'node:http'
import { createKnowledgePipelineCoordinator } from '../electron/knowledge/pipeline'
import { createConfigExecute } from './agent-settings-fixture'

const disposals: (() => unknown)[] = []
afterEach(async () => {
  for (const f of disposals.splice(0).reverse()) await f()
})
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'lingtu-agent-'))
  disposals.push(() => rmSync(directory, { recursive: true, force: true }))
  const repository = createKnowledgeRepository({ directory, workspaceId: 'w' })
  disposals.push(() => repository.dispose())
  const state = emptySnapshot()
  state.workspaceId = 'w'
  state.stores = [
    {
      id: 'a',
      storeName: 'A',
      platform: 'sim-local',
      group: '',
      aiEnabled: false,
      runtime: { open: false, online: false },
    },
  ]
  const knowledge = createKnowledgeRuntime({
    repository,
    workspaceId: 'w',
    stores: () => state.stores,
    assertActive() {
      if (state.workspaceId !== 'w') throw Error('stale')
    },
    changed() {},
  })
  const execute = vi.fn(createConfigExecute(state))
  const service = createAgentService({
    version: 'test',
    runtime: () => ({
      snapshot: () => structuredClone(state),
      knowledge: () => knowledge,
      execute,
    }),
  })
  return { directory, repository, state, knowledge, execute, service }
}
it('exposes filtered status/stores and rejects generic execute, sends, publishing and clearing', async () => {
  const f = fixture()
  const status = await f.service.call({ tool: 'lingtu_status', args: {} })
  expect(JSON.stringify(status)).not.toMatch(/apiKey|credential|connection.json/)
  expect(
    await f.service.call({ tool: 'lingtu_list_stores', args: { workspaceId: 'w' } }),
  ).toMatchObject({ workspaceId: 'w', stores: [{ id: 'a', storeName: 'A' }] })
  for (const tool of ['business_execute', 'lingtu_clear', 'lingtu_publish', 'lingtu_send'])
    await expect(f.service.call({ tool, args: { workspaceId: 'w' } })).rejects.toThrow()
  await expect(
    f.service.call({ tool: 'lingtu_summary', args: { workspaceId: 'old', storeId: 'a' } }),
  ).rejects.toThrow()
  await expect(
    f.service.call({ tool: 'lingtu_summary', args: { workspaceId: 'w', storeId: 'phantom' } }),
  ).rejects.toThrow()
})
it('saves only a local unapproved draft, enforces revisions and deduplicates request IDs', async () => {
  const f = fixture()
  const call = {
    tool: 'lingtu_save_draft',
    args: {
      workspaceId: 'w',
      storeId: 'a',
      requestId: 'one',
      question: '多久发货',
      answer: '48小时',
      field: 'fact',
    },
  }
  const first = await f.service.call(call)
  expect(await f.service.call(call)).toEqual(first)
  expect(f.repository.rows('entries')).toHaveLength(1)
  expect(f.repository.rows<{ approved: unknown; status: string }>('entries')[0]).toMatchObject({
    approved: null,
    status: 'draft',
  })
  await expect(
    f.service.call({ ...call, args: { ...call.args, answer: 'different' } }),
  ).rejects.toThrow()
  const b = f.repository.bindProduct({
    canonicalId: f.repository.saveCanonical({ title: 'other' }).id,
    storeId: 'b',
    productId: 'p',
  })
  await expect(
    f.service.call({ ...call, args: { ...call.args, requestId: 'two', bindingId: b.id } }),
  ).rejects.toThrow()
})
it('discards late catalog results after account replacement and accepts only explicit verified collection scope', async () => {
  const f = fixture()
  let finish!: (value: never) => void
  f.knowledge.setPipeline({
    request: () =>
      new Promise((done) => {
        finish = done
      }),
    dispose() {},
    removeStore() {},
  })
  const pending = f.service.call({
    tool: 'lingtu_read_catalog',
    args: { workspaceId: 'w', storeId: 'a' },
  })
  await Promise.resolve()
  f.state.workspaceId = 'next'
  finish({} as never)
  await expect(pending).rejects.toThrow()
  await expect(
    f.service.call({
      tool: 'lingtu_start_collection',
      args: { workspaceId: 'next', storeId: 'a', requestId: 'x', productIds: [] },
    }),
  ).rejects.toThrow()
})
it('rejects results after a managed logout without relying on workspace replacement', async () => {
  const f = fixture()
  f.state.managed.active.mode = 'managed'
  f.state.managed.configured.mode = 'managed'
  f.state.managed.session.status = 'signed_in'
  f.state.managed.session.account = {
    userId: 77,
    displayName: 'fixture',
    trial: { limit: 20, used: 0, reserved: 0, remaining: 20, expiresAt: 9999999999 },
  }
  let finish!: (value: never) => void
  f.knowledge.setPipeline({
    request: () =>
      new Promise((done) => {
        finish = done
      }),
    dispose() {},
    removeStore() {},
  })
  const pending = f.service.call({
    tool: 'lingtu_read_catalog',
    args: { workspaceId: 'w', storeId: 'a' },
  })
  await Promise.resolve()
  f.state.managed.session.account = null
  f.state.managed.session.status = 'signed_out'
  finish({} as never)
  await expect(pending).rejects.toThrow()
})
it('starts collection only for explicit catalog selections and returns the same job for a repeated write ID', async () => {
  const f = fixture(),
    worker = vi.fn(async () => ({ jobId: 'collection-job' }))
  const pipeline = createKnowledgePipelineCoordinator()
  pipeline.register({
    handles: () => true,
    capabilities: async () => ({}),
    request: worker,
    dispose() {},
    removeStore() {},
  })
  f.knowledge.setPipeline(pipeline)
  const input = {
    tool: 'lingtu_start_collection',
    args: {
      workspaceId: 'w',
      storeId: 'a',
      requestId: 'collect-once',
      identityVersion: 'identity',
      scopeToken: 'scope',
      productIds: ['p1'],
      total: 1,
    },
  }
  expect(await f.service.call(input)).toEqual({
    workspaceId: 'w',
    result: { jobId: 'collection-job' },
  })
  expect(await f.service.call(input)).toEqual({
    workspaceId: 'w',
    result: { jobId: 'collection-job' },
  })
  expect(worker).toHaveBeenCalledTimes(1)
  expect(worker).toHaveBeenCalledWith(
    expect.objectContaining({
      kind: 'collect',
      catalog: {
        identityVersion: 'identity',
        scopeToken: 'scope',
        productIds: ['p1'],
        total: 1,
        allMatching: false,
      },
    }),
  )
})
it('requires a process token, refuses browser origins/hosts/oversize input and removes the connection descriptor on shutdown', async () => {
  const f = fixture()
  const gateway = await createAgentGateway({ directory: f.directory, call: f.service.call })
  disposals.push(() => gateway.close())
  const descriptor = JSON.parse(readFileSync(gateway.connectionFile, 'utf8')) as {
    url: string
    token: string
  }
  const request = (
    headers: Record<string, string> = {},
    body = JSON.stringify({ tool: 'lingtu_status', args: {} }),
  ) =>
    fetch(descriptor.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body,
    })
  expect((await request()).status).toBe(401)
  expect((await request({ authorization: 'Bearer incorrect' })).status).toBe(401)
  const wrongHost = await new Promise<number>((resolve, reject) => {
    const req = httpRequest(
      descriptor.url,
      {
        method: 'POST',
        agent: false,
        headers: { host: 'evil.example', authorization: 'Bearer ' + descriptor.token },
      },
      (res) => {
        res.resume()
        res.on('end', () => resolve(res.statusCode ?? 0))
      },
    )
    req.on('error', reject)
    req.end()
  })
  expect(wrongHost).toBe(403)
  expect(
    (await request({ authorization: 'Bearer ' + descriptor.token, origin: 'https://evil.example' }))
      .status,
  ).toBe(403)
  const good = await request({ authorization: 'Bearer ' + descriptor.token })
  expect(good.status).toBe(200)
  expect(await good.text()).not.toContain(descriptor.token)
  expect(
    (await request({ authorization: 'Bearer ' + descriptor.token }, 'x'.repeat(1024 * 1024 + 1)))
      .status,
  ).toBe(413)
  await gateway.close()
  expect(() => readFileSync(gateway.connectionFile)).toThrow()
})
it('validates loopback discovery, uses the private direct transport and generates a token-free MCP configuration', async () => {
  const f = fixture(),
    gateway = await createAgentGateway({
      directory: f.directory,
      call: f.service.call,
      connectorPath: 'example.cjs',
    })
  disposals.push(() => gateway.close())
  const connection = agentConnectionSchema.parse(
    JSON.parse(readFileSync(gateway.connectionFile, 'utf8')),
  )
  expect(() =>
    agentConnectionSchema.parse({ ...connection, url: 'https://evil.example/' }),
  ).toThrow()
  const response = await callLocalAgent(connection, { tool: 'lingtu_status', args: {} })
  expect(response.status).toBe(200)
  const config = JSON.parse(
    readFileSync(join(f.directory, 'ai-interface', 'mcp-config.json'), 'utf8'),
  )
  expect(config.mcpServers['lingtu-ai'].args).toEqual([
    'example.cjs',
    '--connection-file',
    gateway.connectionFile,
  ])
  expect(JSON.stringify(config)).not.toContain(connection.token)
})
it('connects a real standard MCP client to the built stdio connector and saves a review-only draft through the authenticated gateway', async () => {
  const f = fixture()
  const gateway = await createAgentGateway({ directory: f.directory, call: f.service.call })
  disposals.push(() => gateway.close())
  const outfile = join(f.directory, 'mcp.cjs')
  await build({
    entryPoints: ['electron/agent/mcp-server.ts'],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node20',
    define: { __APP_VERSION__: JSON.stringify('test') },
  })
  const client = new Client({ name: 'lingtu-test', version: '1' })
  disposals.push(() => client.close())
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [outfile, '--connection-file', gateway.connectionFile],
      env: {
        ...getDefaultEnvironment(),
        HTTP_PROXY: 'http://127.0.0.1:1',
        HTTPS_PROXY: 'http://127.0.0.1:1',
        ALL_PROXY: 'http://127.0.0.1:1',
        NO_PROXY: '',
        NODE_USE_ENV_PROXY: '1',
      },
    }),
  )
  const list = await client.listTools()
  expect(list.tools).toHaveLength(14)
  expect(list.tools.some((t) => /clear|publish|send/.test(t.name))).toBe(false)
  for (const name of [
    'lingtu_config_schema',
    'lingtu_get_config',
    'lingtu_preview_config',
    'lingtu_apply_config',
  ])
    expect(list.tools.some((tool) => tool.name === name)).toBe(true)
  expect(
    list.tools.find((tool) => tool.name === 'lingtu_config_schema')?.annotations,
  ).toMatchObject({ readOnlyHint: true, destructiveHint: false })
  expect(
    list.tools.find((tool) => tool.name === 'lingtu_preview_config')?.annotations,
  ).toMatchObject({ readOnlyHint: true, destructiveHint: false })
  expect(list.tools.find((tool) => tool.name === 'lingtu_apply_config')?.annotations).toMatchObject(
    { readOnlyHint: false, destructiveHint: true },
  )
  const status = await client.callTool({ name: 'lingtu_status', arguments: {} })
  expect(status.isError).not.toBe(true)
  expect(status.structuredContent).toMatchObject({ data: { workspaceId: 'w' } })
  const save = {
    name: 'lingtu_save_draft',
    arguments: {
      workspaceId: 'w',
      storeId: 'a',
      requestId: 'mcp-write',
      question: 'MCP问题',
      answer: 'MCP草稿',
    },
  }
  expect((await client.callTool(save)).isError).not.toBe(true)
  expect((await client.callTool(save)).isError).not.toBe(true)
  expect(f.repository.rows('entries')).toHaveLength(1)
  expect(f.repository.rows<{ approved: unknown }>('entries')[0].approved).toBeNull()

  const schema = await client.callTool({ name: 'lingtu_config_schema', arguments: {} })
  expect(schema.isError).not.toBe(true)
  expect(schema.structuredContent).toMatchObject({
    data: {
      groups: [{ group: 'reply-pacing' }, { group: 'welcome' }, { group: 'vision' }],
    },
  })
  const welcome = await client.callTool({
    name: 'lingtu_get_config',
    arguments: { workspaceId: 'w', group: 'welcome', storeId: 'a' },
  })
  expect(welcome.isError).not.toBe(true)
  const version = (welcome.structuredContent as { data: { version: string } }).data.version
  const callsBefore = f.execute.mock.calls.length
  const preview = await client.callTool({
    name: 'lingtu_preview_config',
    arguments: {
      workspaceId: 'w',
      group: 'welcome',
      storeId: 'a',
      patch: { text: 'MCP欢迎' },
    },
  })
  expect(preview.isError).not.toBe(true)
  expect(preview.structuredContent).toMatchObject({
    data: { effective: { text: 'MCP欢迎', enabled: false } },
  })
  expect(f.execute.mock.calls.length).toBe(callsBefore)
  const applied = await client.callTool({
    name: 'lingtu_apply_config',
    arguments: {
      workspaceId: 'w',
      group: 'welcome',
      storeId: 'a',
      requestId: 'mcp-config-write',
      expectedVersion: version,
      patch: { text: 'MCP欢迎' },
    },
  })
  expect(applied.isError).not.toBe(true)
  expect(applied.structuredContent).toMatchObject({
    data: { group: 'welcome', storeId: 'a', settings: { text: 'MCP欢迎' } },
  })
  expect(f.state.welcomeByStore.a?.text).toBe('MCP欢迎')
  expect(f.execute.mock.calls.length).toBe(callsBefore + 1)
}, 15000)

import { type BrowserWindow, safeStorage } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { createLocalRuntime, type LocalRuntime } from './local-runtime'
import { createWorkspaceRuntime } from './workspace-runtime'
import type { CommandInput } from '../src/shared/contracts/backend'

/** Actual Electron runtime + encrypted session + loopback HTTP contract fixture, never production. */
export async function managedChecks(options: {
  win: BrowserWindow
  dataDir: string
  original: LocalRuntime
  bind(runtime: LocalRuntime): void
  load(route: string): Promise<void>
  check(name: string, route: string, run: () => Promise<void>): Promise<void>
}) {
  const { win, check, load } = options
  const root = path.join(options.dataDir, 'managed-contract-fixture')
  const api = 'https://api.managed.test'
  const portal = 'https://account.managed.test'
  fs.mkdirSync(root, { recursive: true })
  fs.writeFileSync(
    path.join(root, 'model-source.json'),
    JSON.stringify({ mode: 'managed', apiOrigin: api, portalOrigin: portal }),
  )
  const expires = Math.floor(Date.now() / 1000) + 3600
  let uncertain = false
  const chatCalls: Record<string, unknown>[] = []
  const browserUrls: string[] = []
  const server = createServer(async (request, response) => {
    let text = ''
    for await (const chunk of request) text += chunk
    response.setHeader('content-type', 'application/json')
    const endpoint = request.url || ''
    if (
      !endpoint.includes('/auth/device/') &&
      endpoint !== '/api/client/auth/refresh' &&
      request.headers.authorization !== 'Bearer fixture-managed-access'
    ) {
      response.writeHead(401)
      response.end(JSON.stringify({ error: 'session_expired' }))
      return
    }
    let result: unknown
    if (endpoint === '/api/client/auth/device/authorize')
      result = {
        device_code: 'fixture-device',
        user_code: 'ABCD-EFGH',
        expires_in: 600,
        interval: 1,
        verification_uri: portal + '/lingtu/device',
        verification_uri_complete: portal + '/lingtu/device?user_code=ABCD-EFGH',
      }
    else if (
      endpoint === '/api/client/auth/device/token' ||
      endpoint === '/api/client/auth/refresh'
    )
      result = {
        access_token: 'fixture-managed-access',
        refresh_token: 'fixture-managed-refresh',
        user_id: 77,
        session_id: 'fixture-session',
        token_type: 'Bearer',
        expires_at: expires,
        access_expires_at: Math.floor(Date.now() / 1000) + 900,
      }
    else if (endpoint === '/api/client/me')
      result = {
        user_id: 77,
        display_name: '托管夹具账号',
        status: 'enabled',
        trial: {
          limit: 20,
          used: chatCalls.length,
          reserved: 0,
          remaining: 20 - chatCalls.length,
          expires_at: expires,
        },
        capabilities: { model: 'managed-fixture', vision: false, max_images: 4 },
      }
    else if (endpoint === '/api/client/chat/completions') {
      chatCalls.push(JSON.parse(text) as Record<string, unknown>)
      if (uncertain) {
        response.writeHead(409)
        result = { error: 'request_uncertain' }
      } else result = { choices: [{ message: { content: '{"reply":"托管夹具回答"}' } }] }
    } else if (endpoint === '/api/client/auth/logout') result = { revoked: true }
    else {
      response.writeHead(404)
      result = { error: 'invalid_request' }
    }
    response.end(JSON.stringify(result))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Loopback fixture unavailable')
  let runtime: LocalRuntime | undefined
  const make = () =>
    createWorkspaceRuntime({
      factory: () =>
        createLocalRuntime({
          dataDir: root,
          getWindow: () => win,
          managedTransport: {
            openExternal: async (url) => {
              browserUrls.push(url)
            },
            fetchImpl: (url, init) => {
              const parsed = new URL(String(url))
              assert.equal(parsed.origin, api)
              return fetch(`http://127.0.0.1:${address.port}${parsed.pathname}`, init)
            },
          },
        }),
    })
  const execute = (command: CommandInput) => {
    if (!runtime) throw new Error('Fixture runtime not ready')
    return runtime.execute({
      ...command,
      values: command.values ?? {},
      workspaceId: runtime.snapshot().workspaceId,
    })
  }
  try {
    await check(
      'managed:device-login-encrypted-restore-and-account-workspace',
      '/settings',
      async () => {
        assert.ok(safeStorage.isEncryptionAvailable(), '托管测试要求真实系统加密可用')
        runtime = make()
        await runtime.start()
        assert.equal(runtime.snapshot().managed.session.status, 'signed_out')
        await assert.rejects(
          execute({
            action: 'add-store',
            values: { platform: 'sim-local', storeName: '禁止未登录写入' },
          }),
          /登录/,
        )
        await execute({ action: 'managed-login' })
        for (
          let attempt = 0;
          attempt < 60 && runtime.snapshot().managed.session.status !== 'signed_in';
          attempt++
        )
          await new Promise((resolve) => setTimeout(resolve, 50))
        assert.equal(runtime.snapshot().managed.session.account?.userId, 77)
        assert.equal(runtime.snapshot().managed.restartRequired, true)
        assert.deepEqual(browserUrls, [portal + '/lingtu/device?user_code=ABCD-EFGH'])
        await assert.rejects(
          execute({ action: 'start-training', values: { question: '物流不动了' } }),
          /重启/,
        )
        const oldWorkspace = runtime.snapshot().workspaceId
        await execute({ action: 'activate-model-source', values: { mode: 'managed' } })
        assert.notEqual(runtime.snapshot().workspaceId, oldWorkspace)
        await assert.rejects(
          runtime.execute({ workspaceId: oldWorkspace, action: 'refresh', values: {} }),
          /重启/,
        )
        assert.equal(runtime.snapshot().managed.restartRequired, false)
        assert.equal(runtime.snapshot().capabilities.modelMode, 'managed')
        assert.ok(!JSON.stringify(runtime.snapshot()).includes('fixture-managed-refresh'))
        assert.ok(!JSON.stringify(runtime.snapshot()).includes('fixture-managed-access'))
        assert.equal(runtime.snapshot().stores.length, 0)
      },
    )
    await check('managed:actual-training-trace-and-settings-ui', '/settings', async () => {
      assert.ok(runtime)
      const result = await execute({
        action: 'start-training',
        values: { question: '物流不动了', history: [] },
      })
      assert.equal(result.data.reply, '托管夹具回答')
      assert.equal(chatCalls.length, 1)
      assert.ok(JSON.stringify(chatCalls[0]).includes('[通用客服表达参考]'))
      const trace = runtime.snapshot().review.traces.at(-1)!
      assert.equal(trace.model, 'managed-fixture')
      assert.ok(trace.submittedAt && trace.submittedAt > 0, '提交状态必须来自真实 chat fetch')
      await execute({ action: 'managed-refresh' })
      assert.equal(runtime.snapshot().managed.session.account?.trial.used, 1)
      assert.equal(runtime.snapshot().managed.session.account?.trial.remaining, 19)
      options.bind(runtime)
      await load('/settings')
      await win.webContents.executeJavaScript(`document.querySelector('.login-trigger').click()`)
      for (let attempt = 0; attempt < 50; attempt++) {
        if (
          await win.webContents.executeJavaScript(
            `document.body.innerText.includes('托管夹具账号')`,
          )
        )
          break
        await new Promise((resolve) => setTimeout(resolve, 50))
      }
      assert.ok(
        await win.webContents.executeJavaScript(
          `document.body.innerText.includes('托管夹具账号')&&document.body.innerText.includes('剩余')`,
        ),
      )
      await win.webContents.executeJavaScript(
        `document.querySelector('.service-option').scrollIntoView({block:'center'});new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`,
      )
      const screenshot = await win.webContents.capturePage()
      fs.writeFileSync(
        path.resolve('artifacts/desktop/managed-account-settings.png'),
        screenshot.toPNG(),
      )
    })
    await check(
      'managed:uncertain-request-stops-retry-until-explicit-review',
      '/settings',
      async () => {
        assert.ok(runtime)
        uncertain = true
        await assert.rejects(
          execute({ action: 'start-training', values: { question: '退款进度', history: [] } }),
        )
        const issue = runtime.snapshot().modelIssue!
        assert.equal(issue.code, 'request_uncertain')
        assert.equal(
          issue.context?.requestId,
          chatCalls.at(-1)?.client_request_id,
          '界面应提供对应服务端账本的原请求编号',
        )
        assert.equal(chatCalls.length, 2)
        await assert.rejects(
          execute({ action: 'start-training', values: { question: '退款进度', history: [] } }),
          /核对/,
        )
        assert.equal(chatCalls.length, 2, '未知结果不应自动重发')
        await load('/settings')
        for (let attempt = 0; attempt < 50; attempt++) {
          if (
            await win.webContents.executeJavaScript(`document.body.innerText.includes('请求编号')`)
          )
            break
          await new Promise((resolve) => setTimeout(resolve, 50))
        }
        assert.ok(
          await win.webContents.executeJavaScript(`document.body.innerText.includes('请求编号')`),
        )
        await win.webContents.executeJavaScript(
          `document.querySelector('.managed-issue').scrollIntoView({block:'center'});new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`,
        )
        const issueScreenshot = await win.webContents.capturePage()
        fs.writeFileSync(
          path.resolve('artifacts/desktop/managed-request-review.png'),
          issueScreenshot.toPNG(),
        )
        await assert.rejects(
          execute({
            action: 'acknowledge-model-issue',
            values: { confirmed: false, code: issue.code, at: issue.at },
          }),
        )
        await execute({
          action: 'acknowledge-model-issue',
          values: { confirmed: true, code: issue.code, at: issue.at },
        })
        assert.equal(runtime.snapshot().modelIssue, null)
        assert.equal(chatCalls.length, 2)
        await execute({ action: 'managed-logout' })
        assert.equal(runtime.snapshot().managed.session.status, 'signed_out')
        assert.equal(
          runtime.snapshot().review.traces.length,
          0,
          '退出后不得继续返回账号的模型上下文',
        )
      },
    )
  } finally {
    options.bind(options.original)
    if (runtime) await runtime.dispose()
    await load('/')
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
}

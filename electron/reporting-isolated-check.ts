import { app, BrowserWindow, safeStorage, session } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createLocalRuntime, type LocalRuntime } from './local-runtime'
import { registerBusinessIpc } from './business-ipc'
import { createWindow, loadRenderer } from './windows'
import { createReportingPipeline } from './reporting-pipeline'
import { buildDashboard, dashboardExport } from '../src/modules/shops/dashboard'

// Only the dedicated runner supplies these absolute temporary paths. No production entry reads them.
const root = process.env.LINGTU_REPORTING_CHECK_ROOT
const output = process.env.LINGTU_REPORTING_CHECK_OUTPUT
const stage = process.env.LINGTU_REPORTING_CHECK_STAGE
if (
  !root ||
  !output ||
  !path.isAbsolute(root) ||
  !path.isAbsolute(output) ||
  !['a-first', 'b', 'a-restart'].includes(stage || '')
)
  throw Error('Missing isolated reporting check arguments')
app.setPath('userData', path.join(root, `electron-${stage}`))
delete process.env.VITE_DEV_SERVER_URL
app.on('window-all-closed', () => {})
const hash = (text: string) => createHash('sha256').update(text).digest('hex')
const origin = 'https://reporting-fixture.invalid'
const userId = stage === 'b' ? 902 : 901
const expected = stage === 'b' ? 2 : 1
const dataRoot = path.join(root, 'runtime')
const auth = path.join(dataRoot, 'managed-auth', hash(origin))
const dataDir = path.join(
  dataRoot,
  'managed-workspaces',
  hash(origin),
  hash(JSON.stringify(userId)),
)
const checks: string[] = []
let runtime: LocalRuntime | undefined, win: BrowserWindow | undefined, off: (() => void) | undefined
let networkAttempts = 0
const wait = async (probe: () => boolean) => {
  for (let index = 0; index < 100; index++) {
    if (probe()) return
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  throw Error('Reporting observation timed out')
}
app.on('session-created', (value) =>
  value.webRequest.onBeforeRequest(
    { urls: ['http://*/*', 'https://*/*'] },
    (_details, callback) => {
      networkAttempts++
      callback({ cancel: true })
    },
  ),
)
void app
  .whenReady()
  .then(async () => {
    session.defaultSession.webRequest.onBeforeRequest(
      { urls: ['http://*/*', 'https://*/*'] },
      (_details, callback) => {
        networkAttempts++
        callback({ cancel: true })
      },
    )
    assert(safeStorage.isEncryptionAvailable(), 'Native OS encryption unavailable')
    fs.mkdirSync(auth, { recursive: true })
    fs.mkdirSync(dataDir, { recursive: true })
    fs.writeFileSync(
      path.join(dataRoot, 'model-source.json'),
      JSON.stringify({ mode: 'managed', apiOrigin: origin, portalOrigin: origin }),
    )
    fs.writeFileSync(path.join(auth, 'last-account.json'), JSON.stringify({ userId }))
    const expiresAt = Math.floor(Date.now() / 1000) + 3600
    fs.writeFileSync(
      path.join(auth, 'session.enc'),
      safeStorage.encryptString(
        JSON.stringify({
          version: 1,
          origin,
          userId,
          sessionId: `fixture-${userId}`,
          expiresAt,
          refreshToken: 'ISOLATED_REFRESH_SECRET',
          pendingOperationId: null,
        }),
      ),
    )
    if (stage !== 'a-restart') {
      const now = Date.now()
      fs.writeFileSync(
        path.join(dataDir, 'stores.json'),
        JSON.stringify({
          stores: [
            {
              id: 'fixture-store',
              platform: 'pdd-web',
              storeName: '隔离验证，非实店',
              createdAt: now,
              aiEnabled: false,
            },
          ],
        }),
      )
      fs.writeFileSync(
        path.join(dataDir, 'conversations.json'),
        JSON.stringify([
          {
            storeId: 'fixture-store',
            uid: 'PRIVATE_BUYER_UID',
            name: 'PRIVATE_BUYER_NAME',
            status: 'pending',
            messages: Array.from({ length: expected }, (_, index) => ({
              from: 'buyer',
              content: `PRIVATE_CUSTOMER_BODY_${index}`,
              ts: now - 1000 + index,
            })),
          },
        ]),
      )
    }
    runtime = createLocalRuntime({
      dataDir: dataRoot,
      getWindow: () => win,
      managedTransport: {
        // Validate the protocol URL inside managed-session without opening a real browser.
        openExternal: async () => {},
        fetchImpl: async (input) => {
          const url = new URL(String(input))
          assert.equal(url.origin, origin)
          if (url.pathname === '/api/client/auth/device/authorize')
            return new Response(
              JSON.stringify({
                device_code: 'fixture-device',
                user_code: 'ABCD-EFGH',
                expires_in: 60,
                interval: 1,
                verification_uri: origin + '/lingtu/device',
                verification_uri_complete: origin + '/lingtu/device?user_code=ABCD-EFGH',
              }),
            )
          if (url.pathname === '/api/client/auth/logout')
            return new Response(JSON.stringify({ revoked: true }))
          if (
            url.pathname === '/api/client/auth/refresh' ||
            url.pathname === '/api/client/auth/device/token'
          )
            return new Response(
              JSON.stringify({
                access_token: 'ISOLATED_ACCESS_SECRET',
                refresh_token: 'ISOLATED_REFRESH_SECRET',
                user_id: userId,
                session_id: `fixture-${userId}`,
                token_type: 'Bearer',
                expires_at: expiresAt,
                access_expires_at: expiresAt - 60,
              }),
              { status: 200 },
            )
          if (url.pathname === '/api/client/me')
            return new Response(
              JSON.stringify({
                user_id: userId,
                display_name: `夹具账号${userId}`,
                status: 'enabled',
                trial: { limit: 1, used: 0, reserved: 0, remaining: 1, expires_at: expiresAt },
                capabilities: { model: 'fixture-no-model-request', vision: false, max_images: 0 },
              }),
              { status: 200 },
            )
          throw Error(`Unexpected request path: ${url.pathname}`)
        },
      },
    })
    if (stage === 'a-first') fs.unlinkSync(path.join(auth, 'session.enc'))
    await runtime.start()
    if (stage === 'a-first') {
      assert.equal(runtime.snapshot().managed.session.status, 'signed_out')
      await runtime.execute({
        workspaceId: runtime.snapshot().workspaceId,
        action: 'managed-login',
        values: {},
      })
      await wait(() => runtime?.snapshot().managed.session.status === 'signed_in')
      assert.equal(runtime.snapshot().managed.restartRequired, false)
      assert.equal(runtime.scheduler().snapshot().running, true)
      checks.push(
        'known-account startup without credentials resumes scheduler after same-account login',
      )
    }
    // A startup observation must be scheduled after managed.init makes the workspace accessible.
    await wait(() => runtime?.snapshot().reporting?.today.real['buyer-message'] === expected)
    checks.push('real runtime observes archive after managed session initialization')
    assert.equal(runtime.dataDirectory(), dataDir)
    assert.equal(runtime.snapshot().managed.session.account?.userId, userId)
    checks.push('actual managed account selects its stable isolated directory')
    win = createWindow({ smoke: true })
    off = registerBusinessIpc(runtime)
    await loadRenderer(win, '/shop/manage?panel=home')
    const dto = await win.webContents.executeJavaScript('window.yunduoDesktop.backendSnapshot()')
    assert.equal(dto.reporting.today.real['buyer-message'], expected)
    assert.equal(dto.managed.session.account.userId, userId)
    checks.push('real sandboxed preload and business IPC return reporting DTO')
    const snapshot = runtime.snapshot()
    const exported = JSON.stringify(
      dashboardExport(buildDashboard(snapshot, [], 'today', Date.now()), 'today', Date.now()),
    )
    const ledger = fs.readFileSync(path.join(dataDir, 'reporting-events-v1.json'), 'utf8')
    for (const sensitive of [
      'PRIVATE_BUYER_UID',
      'PRIVATE_BUYER_NAME',
      'PRIVATE_CUSTOMER_BODY',
      'ISOLATED_ACCESS_SECRET',
      'ISOLATED_REFRESH_SECRET',
    ]) {
      assert(!exported.includes(sensitive))
      assert(!ledger.includes(sensitive))
    }
    checks.push('native runtime export and durable ledger exclude buyer details and credentials')
    const pipe = createReportingPipeline(path.join(root, `aftersale-${stage}`))
    const source = {
      storeId: 'fixture-store',
      storeName: '隔离',
      platform: 'pdd-web',
      kind: 'aftersale' as const,
      status: 'success' as const,
      complete: true,
      total: 2,
      message: '',
      lastSyncedAt: Date.now(),
      items: [],
    }
    const aftersaleSnapshot = {
      ...snapshot,
      reporting: pipe.snapshot({ workspaceId: snapshot.workspaceId, stores: [source] }),
    }
    const summary = buildDashboard(aftersaleSnapshot, [], 'today', Date.now())
    assert.equal(summary.aftersales.total, 2)
    assert.equal(summary.aftersales.sources[0]?.scope, 'current-merchant-pending')
    const stale = buildDashboard(
      {
        ...snapshot,
        reporting: pipe.snapshot({
          workspaceId: snapshot.workspaceId,
          stores: [{ ...source, status: 'stale' }],
        }),
      },
      [],
      'today',
      Date.now(),
    )
    assert.equal(stale.aftersales.total, null)
    checks.push('synthetic aftersale pending scope is explicit and stale totals are unavailable')
    const schedulerBeforeLogout = runtime.scheduler()
    await runtime.execute({
      workspaceId: snapshot.workspaceId,
      action: 'managed-logout',
      values: {},
    })
    assert.equal(runtime.snapshot().reporting, null)
    checks.push('logout masks old account reporting immediately')
    assert.equal(schedulerBeforeLogout.snapshot().running, false, 'logout must pause scheduler')
    await runtime.execute({
      workspaceId: snapshot.workspaceId,
      action: 'managed-login',
      values: {},
    })
    await wait(() => runtime?.snapshot().managed.session.status === 'signed_in')
    assert.equal(runtime.snapshot().managed.restartRequired, false)
    assert.equal(
      runtime.scheduler().snapshot().running,
      true,
      'same-account login must restart scheduler',
    )
    checks.push('same-account reauthentication resumes scheduler without workspace replacement')
    fs.mkdirSync(output, { recursive: true })
    fs.writeFileSync(
      path.join(output, `${stage}.json`),
      JSON.stringify(
        {
          stage,
          passed: true,
          expectedBuyerEvents: expected,
          ledgerFingerprint: hash(ledger),
          checks,
          blockedBrowserNetworkAttempts: networkAttempts,
          scope:
            'isolated Electron, actual runtime/preload/IPC, synthetic account and archive, no live platform or model calls',
        },
        null,
        2,
      ),
    )
  })
  .catch((error: unknown) => {
    fs.mkdirSync(output, { recursive: true })
    fs.writeFileSync(
      path.join(output, `${stage}-failure.txt`),
      error instanceof Error ? error.stack || error.message : String(error),
    )
    process.exitCode = 1
  })
  .finally(async () => {
    off?.()
    win?.destroy()
    await runtime?.dispose()
    app.exit(Number(process.exitCode || 0))
  })

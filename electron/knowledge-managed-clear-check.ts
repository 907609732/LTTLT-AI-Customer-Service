import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { safeStorage, type BrowserWindow } from 'electron'
import { createLocalRuntime } from './local-runtime'
import { createWorkspaceRuntime } from './workspace-runtime'
import type { KnowledgeClearPreview } from '../src/shared/contracts/knowledge-client'

/** Real encrypted managed-session startup and knowledge replacement, entirely synthetic transport/data. */
export async function knowledgeManagedClearCheck(root: string, parent: BrowserWindow) {
  assert(safeStorage.isEncryptionAvailable())
  const directory = path.join(root, 'managed-knowledge-clear')
  const origin = 'https://knowledge-clear.managed.test'
  fs.mkdirSync(directory, { recursive: true })
  fs.writeFileSync(
    path.join(directory, 'model-source.json'),
    JSON.stringify({ mode: 'managed', apiOrigin: origin, portalOrigin: origin }),
  )
  let refreshes = 0
  const expiresAt = Math.floor(Date.now() / 1000) + 3600
  const runtime = createWorkspaceRuntime({
    factory: () =>
      createLocalRuntime({
        dataDir: directory,
        getWindow: () => parent,
        managedTransport: {
          openExternal: async () => {},
          fetchImpl: async (url) => {
            const parsed = new URL(String(url))
            assert.equal(parsed.origin, origin)
            let body: unknown
            if (parsed.pathname === '/api/client/auth/device/authorize')
              body = {
                device_code: 'clear-fixture-device',
                user_code: 'TEST-CLEAR',
                expires_in: 600,
                interval: 1,
                verification_uri: origin + '/lingtu/device',
                verification_uri_complete: origin + '/lingtu/device?user_code=TEST-CLEAR',
              }
            else if (
              ['/api/client/auth/device/token', '/api/client/auth/refresh'].includes(
                parsed.pathname,
              )
            ) {
              if (parsed.pathname.endsWith('/refresh')) refreshes++
              body = {
                access_token: 'clear-fixture-access',
                refresh_token: 'clear-fixture-refresh',
                user_id: 77,
                session_id: 'clear-fixture-session',
                token_type: 'Bearer',
                expires_at: expiresAt,
                access_expires_at: Math.floor(Date.now() / 1000) + 900,
              }
            } else if (parsed.pathname === '/api/client/me')
              body = {
                user_id: 77,
                display_name: '知识清除隔离账号',
                status: 'enabled',
                trial: {
                  limit: 20,
                  used: 0,
                  reserved: 0,
                  remaining: 20,
                  expires_at: expiresAt,
                },
                capabilities: { model: 'fixture', vision: false, max_images: 4 },
              }
            else throw Error('Unexpected managed fixture request: ' + parsed.pathname)
            return new Response(JSON.stringify(body), {
              status: 200,
              headers: { 'content-type': 'application/json' },
            })
          },
        },
      }),
  })
  try {
    await runtime.start()
    await runtime.execute({
      workspaceId: runtime.snapshot().workspaceId,
      action: 'managed-login',
      values: {},
    })
    for (let i = 0; i < 100 && runtime.snapshot().managed.session.status !== 'signed_in'; i++)
      await new Promise((done) => setTimeout(done, 50))
    assert.equal(runtime.snapshot().managed.session.account?.userId, 77)
    await runtime.execute({
      workspaceId: runtime.snapshot().workspaceId,
      action: 'activate-model-source',
      values: { mode: 'managed' },
    })
    const added = await runtime.execute({
      workspaceId: runtime.snapshot().workspaceId,
      action: 'add-store',
      values: { platform: 'sim-local', storeName: '清除后必须保留的店铺' },
    })
    const storeId = String(added.data.id)
    const dataDirectory = runtime.dataDirectory()
    for (const kind of ['store', 'account'] as const) {
      const workspaceId = runtime.snapshot().workspaceId
      const knowledge = runtime.knowledge()
      knowledge.repository.saveDraft({
        scope: { kind: 'store', storeId },
        question: 'clear?',
        answer: 'synthetic',
      })
      const preview = (await knowledge.request({
        workspaceId,
        operation: 'clear-preview',
        scope: kind === 'store' ? { kind, storeId } : { kind },
      })) as KnowledgeClearPreview
      const result = await runtime.clearKnowledge(workspaceId, preview.token, preview.confirmation)
      assert.equal(result.recovered, false)
      assert.notEqual(result.workspaceId, workspaceId)
      assert.equal(runtime.dataDirectory(), dataDirectory)
      assert.equal(runtime.snapshot().managed.session.status, 'signed_in')
      assert.equal(runtime.snapshot().managed.session.account?.userId, 77)
      assert.deepEqual(
        runtime.snapshot().stores.map((s) => s.id),
        [storeId],
      )
      assert(runtime.snapshot().stores.every((s) => !s.aiEnabled))
      assert(fs.existsSync(path.join(dataDirectory, 'stores.json')))
      assert.equal(
        runtime
          .knowledge()
          .repository.rows('entries')
          .filter((e) => (e as { status: string }).status !== 'withdrawn').length,
        0,
      )
    }
    assert(
      refreshes >= 3,
      'each replacement must restore the encrypted managed session before checking account access',
    )
  } finally {
    await runtime.dispose()
  }
}

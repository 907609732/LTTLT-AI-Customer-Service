import { app, session } from 'electron'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import { z } from 'zod'
import { createWindow } from './windows'
import { createLocalRuntime } from './local-runtime'
import type { CommandInput } from '../src/shared/contracts/backend'

// Exercise the sidebar's existing send/draft commands against an actual isolated simulator.
// No production profile, platform login, model or real buyer is used.
const isolated = fs.mkdtempSync(path.join(os.tmpdir(), 'lingtu-assist-send-'))
app.setPath('userData', isolated)
const output = path.resolve('artifacts/assist-send')
const report: { name: string; pass: boolean; error?: string }[] = []
app
  .whenReady()
  .then(async () => {
    session.defaultSession.webRequest.onBeforeRequest(
      { urls: ['http://*/*', 'https://*/*'] },
      (_details, callback) => callback({ cancel: true }),
    )
    const primary = createWindow({ smoke: true })
    const runtime = createLocalRuntime({
      dataDir: path.join(isolated, 'backend'),
      getWindow: () => primary,
    })
    try {
      await runtime.start()
      const run = (command: CommandInput) =>
        runtime.execute({
          ...command,
          workspaceId: runtime.snapshot().workspaceId,
          values: command.values ?? {},
        })
      await run({
        action: 'add-store',
        values: { platform: 'sim-local', storeName: '辅助中心隔离发送验收' },
      })
      const store = runtime.snapshot().stores[0]
      assert.ok(store)
      assert.equal(store.platform, 'sim-local')
      assert.equal(store.aiEnabled, false)
      assert.equal((await runtime.openSimulatorPage()).ok, true)
      const status = runtime.simulatorStatus()
      assert.ok(status.url)
      const base = new URL(status.url)
      assert.equal(base.hostname, '127.0.0.1')
      const request = async (route: string, body?: Record<string, string>) => {
        const url = new URL(route, base)
        url.searchParams.set('token', base.searchParams.get('token') ?? '')
        url.searchParams.set('storeId', store.id)
        const response = await fetch(
          url,
          body
            ? {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify(body),
                signal: AbortSignal.timeout(5000),
              }
            : { signal: AbortSignal.timeout(5000) },
        )
        assert.equal(response.status, 200)
        return response.json() as Promise<unknown>
      }
      const state = z
        .object({ personas: z.array(z.object({ uid: z.string() })).min(1) })
        .parse(await request('/api/state'))
      const uid = state.personas[0]!.uid
      await request('/api/send', { storeId: store.id, uid, text: '隔离顾客问题' })
      for (let attempt = 0; attempt < 150; attempt++) {
        if (
          runtime
            .snapshot()
            .conversations.some((row) => row.storeId === store.id && row.uid === uid)
        )
          break
        await new Promise((resolve) => setTimeout(resolve, 100))
      }
      assert.ok(
        runtime.snapshot().conversations.some((row) => row.storeId === store.id && row.uid === uid),
        '模拟顾客消息未进入真实会话采集链路',
      )
      await run({ action: 'select-conversation', storeId: store.id, conversationId: uid })
      await run({
        action: 'save-auxiliary-draft',
        storeId: store.id,
        conversationId: uid,
        values: { text: '隔离人工回复' },
      })
      assert.equal(
        runtime
          .snapshot()
          .auxiliary.drafts.find((row) => row.storeId === store.id && row.uid === uid)?.text,
        '隔离人工回复',
      )
      const sent = await run({
        action: 'send-reply',
        storeId: store.id,
        conversationId: uid,
        values: { reply: '隔离人工回复' },
      })
      assert.equal(z.object({ confirmed: z.literal(true) }).parse(sent.data).confirmed, true)
      const thread = z
        .object({ messages: z.array(z.object({ from: z.string(), content: z.string() })) })
        .parse(await request(`/api/thread?uid=${encodeURIComponent(uid)}`))
      assert.equal(
        thread.messages.filter((row) => row.from === 'seller' && row.content === '隔离人工回复')
          .length,
        1,
      )
      assert.equal(
        runtime
          .snapshot()
          .auxiliary.drafts.some((row) => row.storeId === store.id && row.uid === uid),
        false,
      )
      assert.equal(runtime.snapshot().stores[0]?.aiEnabled, false)
      report.push({ name: 'real-simulator-collection-draft-manual-send-confirmation', pass: true })
      await assert.rejects(
        run({
          action: 'send-reply',
          storeId: store.id,
          conversationId: 'not-selected',
          values: { reply: '不得发送' },
        }),
        /重新选择/,
      )
      report.push({ name: 'wrong-recipient-rejected-before-send', pass: true })
    } catch (error) {
      report.push({ name: 'isolated-assist-send', pass: false, error: String(error) })
    } finally {
      await runtime.dispose()
      primary.destroy()
      fs.mkdirSync(output, { recursive: true })
      fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2))
      console.log(
        `辅助中心隔离模拟发送：${report.filter((row) => row.pass).length}/${report.length}`,
      )
      app.exit(report.every((row) => row.pass) ? 0 : 1)
    }
  })
  .catch((error) => {
    console.error(error)
    app.exit(1)
  })

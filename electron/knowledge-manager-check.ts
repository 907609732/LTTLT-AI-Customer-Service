/** Hidden/offscreen native acceptance. Temporary account, synthetic knowledge, loopback model only. */
import { app, ipcMain, dialog, type BrowserWindow } from 'electron'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { BackendCommand } from '../src/shared/contracts/backend'
import { createServer } from 'node:http'
import { createWindow, loadRenderer } from './windows'
import { createLocalRuntime, requireAppFrame } from './local-runtime'
import { registerBusinessIpc } from './business-ipc'
import { createKnowledgeWindow } from './knowledge-window'
import { registerKnowledgeIpc } from './knowledge-ipc'
import { createWorkspaceRuntime } from './workspace-runtime'
import { knowledgeTypingCheck } from './knowledge-typing-check'
import { knowledgeManagedClearCheck } from './knowledge-managed-clear-check'
import { createCollectorMaterials } from './knowledge/collector-materials'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'knowledge-manager-check-'))
const output = path.resolve('artifacts/knowledge-manager-check/evidence')
fs.mkdirSync(output, { recursive: true })
if (fs.existsSync(path.join(output, 'failure.txt')))
  fs.renameSync(
    path.join(output, 'failure.txt'),
    path.join(output, `previous-failure-${Date.now()}.txt`),
  )
fs.writeFileSync(path.join(output, 'cleanup.json'), JSON.stringify({ directory: root }))
app.setPath('userData', path.join(root, 'electron'))
let runtime: ReturnType<typeof createWorkspaceRuntime> | undefined,
  parent: BrowserWindow | undefined,
  win: BrowserWindow | undefined
const calls: unknown[] = [],
  checks: string[] = []
const disposals: (() => void)[] = []
const model = createServer(async (req, res) => {
  let text = ''
  for await (const chunk of req) text += chunk
  calls.push(JSON.parse(text))
  res.setHeader('content-type', 'application/json')
  res.end(
    JSON.stringify({
      choices: [{ message: { content: '隔离模型：依据已审核资料，支持七天退换。' } }],
    }),
  )
})
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
async function evaluate<T>(script: string): Promise<T> {
  return win!.webContents.executeJavaScript(script, true)
}
async function until(script: string) {
  for (let i = 0; i < 150; i++) {
    if (await evaluate<boolean>(script)) return
    await delay(50)
  }
  throw Error('页面等待超时 ' + script + '\n' + (await evaluate<string>('document.body.innerText')))
}
async function click(text: string) {
  await evaluate(
    `(()=>{const node=[...document.querySelectorAll('button')].find(n=>n.textContent.trim()===${JSON.stringify(text)});if(!node)throw Error('missing button');node.click()})()`,
  )
  await delay(90)
}
async function input(selector: string, value: string) {
  await evaluate(
    `(()=>{const n=document.querySelector(${JSON.stringify(selector)});n.value=${JSON.stringify(value)};n.dispatchEvent(new Event('input',{bubbles:true}))})()`,
  )
}
async function screenshot(name: string) {
  await delay(150)
  const image = await win!.webContents.capturePage()
  assert(!image.isEmpty())
  fs.writeFileSync(path.join(output, name), image.toPNG())
}
const deadline = setTimeout(() => {
  console.error('native manager timeout')
  app.exit(1)
}, 120000)
app
  .whenReady()
  .then(async () => {
    await new Promise<void>((resolve) => model.listen(0, '127.0.0.1', resolve))
    const address = model.address()
    assert(address && typeof address !== 'string')
    parent = createWindow({ smoke: true })
    runtime = createWorkspaceRuntime({
      factory: () =>
        createLocalRuntime({ dataDir: path.join(root, 'account'), getWindow: () => parent }),
    })
    disposals.push(registerBusinessIpc(runtime))
    await runtime.start()
    const w = runtime.snapshot().workspaceId
    const command = (
      action: BackendCommand['action'],
      values: Record<string, unknown> = {},
      storeId?: string,
    ) => runtime!.execute({ workspaceId: w, action, values, storeId })
    const a = String(
      (await command('add-store', { platform: 'sim-local', storeName: '隔离验收甲店' })).data.id,
    )
    const b = String(
      (await command('add-store', { platform: 'sim-local', storeName: '隔离验收乙店' })).data.id,
    )
    await command('select-store', {}, a)
    await command('save-model-settings', {
      baseUrl: `http://127.0.0.1:${address.port}/v1`,
      model: 'local-knowledge-check',
      apiKey: '',
      testConnection: true,
    })
    let repo = runtime.knowledge().repository
    const thumbnail = repo.addAsset(
      fs.readFileSync(path.resolve('src/assets/figma-add-img00.png')),
      { name: '现有测试图标.png', mimeType: 'image/png' },
    )
    for (let i = 0; i < 8; i++) {
      const canonical = repo.saveCanonical({
        title: `隔离验收商品 ${i + 1} · 可核对来源及SKU`,
        code: `CHECK-${i + 1}`,
      })
      const binding = repo.bindProduct({
        canonicalId: canonical.id,
        storeId: a,
        productId: `product-${i + 1}`,
        title: canonical.title,
      })
      const source = repo.saveSource({
        kind: 'manual',
        storeId: a,
        bindingId: binding.id,
        label: '合成验收资料',
        text: '这是隔离验收商品资料，仅用于测试。材质为棉，支持七天退换。',
        assetIds: [thumbnail.id],
      })
      const draft = repo.saveDraft({
        scope: { kind: 'canonical', canonicalId: canonical.id },
        question: '支持退换吗',
        answer: '支持七天退换。',
        sourceRefs: [{ sourceId: source.id, revision: source.revision }],
      })
      if (i === 0) {
        repo.bindProduct({ canonicalId: canonical.id, storeId: b, productId: 'other-product' })
        repo.publish({
          entryId: draft.id,
          expectedDraftRevision: draft.revision,
          expectedSourceRevisions: { [source.id]: source.revision },
        })
      }
    }
    createCollectorMaterials(repo).write(a, {
      productId: 'product-1',
      title: '隔离验收商品 1 · 可核对来源及SKU',
      merchantCode: 'CHECK-1',
      description: '合成资料',
      attributes: [],
      images: [],
      skus: [
        {
          skuId: 'red',
          specs: [
            { name: '颜色', value: '红色' },
            { name: '尺码', value: 'L' },
          ],
          merchantCode: 'RED',
          barcode: '',
          price: '19.9',
          stock: 3,
        },
      ],
      sourceUrl: 'https://mms.pinduoduo.com/goods/goods_add/index?goods_id=product-1',
      capturedAt: Date.now() - 7200000,
      detailStatus: 'complete',
      detailNote: '',
    })
    let creations = 0
    const manager = createKnowledgeWindow({
      workspace: () => runtime!.snapshot().workspaceId,
      stores: () => runtime!.snapshot().stores.map((s) => s.id),
      workArea: () => ({ x: 0, y: 0, width: 1440, height: 1000 }),
      create: () => {
        creations++
        win = createWindow({ smoke: true, knowledge: true })
        const native = win
        return {
          isDestroyed: () => native.isDestroyed(),
          setBounds: (bounds) => native.setBounds(bounds),
          show: () => {},
          focus: () => {},
          hide: () => native.hide(),
          destroy: () => native.destroy(),
          on: (_event, listener) => native.on('close', listener),
          webContents: native.webContents,
        }
      },
      load: async () => {
        await loadRenderer(win!, '/knowledge')
      },
    })
    disposals.push(
      registerKnowledgeIpc({
        ipc: {
          handle: (name, handler) => ipcMain.handle(name, handler),
          removeHandler: (name) => ipcMain.removeHandler(name),
        },
        authorize: (event) => requireAppFrame(event as Electron.IpcMainInvokeEvent),
        resolve: () => ({
          workspaceId: runtime!.snapshot().workspaceId,
          request: (request) => runtime!.knowledge().request(request),
        }),
        window: manager,
        restore: (workspaceId, token) => runtime!.restoreKnowledge(workspaceId, token),
        clear: (workspaceId, token, confirmation) =>
          runtime!.clearKnowledge(workspaceId, token, confirmation),
      }),
    )
    await manager.open({ workspaceId: w, storeId: a })
    await until(`document.querySelectorAll('.knowledge-card').length===8`)
    checks.push('real route/preload/trusted IPC/SQLite cards loaded')
    await click('设置')
    await until(`Boolean(document.querySelector('.knowledge-settings input[type="checkbox"]'))`)
    assert.equal(
      await evaluate<boolean>(
        `document.querySelector('.knowledge-settings input[type="checkbox"]').checked`,
      ),
      false,
    )
    await input('.knowledge-settings input[type="number"]', '90')
    await evaluate(`document.querySelector('.knowledge-settings').requestSubmit()`)
    await until(`document.body.innerText.includes('知识库设置已保存')`)
    assert.equal(repo.getSettings().dynamicTtlMinutes, 90)
    assert.equal(repo.getSettings().dailyCheckEnabled, false)
    await input('.knowledge-settings input[type="number"]', '60')
    await evaluate(`document.querySelector('.knowledge-settings').requestSubmit()`)
    for (let i = 0; i < 100 && repo.getSettings().dynamicTtlMinutes !== 60; i++) await delay(20)
    assert.equal(repo.getSettings().dynamicTtlMinutes, 60)
    checks.push(
      'native reactive settings save crosses preload IPC and persists with daily checking default off',
    )
    await click('商品 8')
    await screenshot('manager-1280.png')
    await manager.open({ workspaceId: w, storeId: b })
    await until(
      `document.querySelector('[data-testid="knowledge-store"]').value===${JSON.stringify(b)}`,
    )
    assert.equal(creations, 1)
    assert.equal(runtime.snapshot().selection.storeId, a)
    checks.push('single manager window carries explicit shop without reception selection mutation')
    await manager.open({ workspaceId: w, storeId: a })
    await until(`document.querySelectorAll('.knowledge-card').length===8`)
    await click('通用问答 1').catch(async () => {
      await evaluate(`document.querySelector('[data-testid="general-tab"]').click()`)
      await delay(100)
    })
    await until(
      `document.querySelector('[data-testid="write-one"]')&&!document.querySelector('[data-testid="write-one"]').disabled`,
    )
    await evaluate(`document.querySelector('[data-testid="write-one"]').click()`)
    await until(`Boolean(document.querySelector('[data-testid="draft-question"]'))`)
    await input('[data-testid="draft-question"]', '隔离发货问题')
    await input('[data-testid="draft-answer"]', '仅限测试：48小时发货')
    await delay(850)
    const draft = repo.listEntries({ storeId: a, search: '隔离发货问题' }).items[0]
    assert(draft)
    assert.equal(draft.approved, null)
    checks.push('native editing autosaves SQLite draft without publication')
    await click('审核并发布…')
    await until(`Boolean(document.querySelector('[aria-label="审核发布"]'))`)
    assert((await evaluate<string>('document.body.innerText')).includes('隔离验收甲店'))
    await screenshot('manager-review.png')
    await click('明确审核并发布所选条目')
    await until(`!document.querySelector('[aria-label="审核发布"]')`)
    assert.equal(repo.getEntry(draft.id)?.status, 'approved')
    await click('试问')
    await input('.knowledge-trial>input', '隔离发货问题')
    await click('试问当前模型')
    await until(`document.querySelector('.knowledge-trial')?.textContent.includes('隔离模型')`)
    assert(calls.length >= 2)
    assert.equal(repo.listMisses({}).total, 0)
    checks.push('trial uses existing local model transport and produces zero real misses')
    await command('start-training', { question: '隔离发货问题', history: [] }, a)
    assert(JSON.stringify(calls.at(-1)).includes('reviewed-knowledge'))
    assert(JSON.stringify(calls.at(-1)).includes('48小时发货'))
    checks.push('existing training AiClient serializes reviewed knowledge through same resolver')
    win!.setSize(1366, 768)
    win!.webContents.setZoomFactor(1.5)
    await screenshot('manager-150-percent.png')
    assert(await evaluate<boolean>('document.documentElement.scrollWidth<=window.innerWidth+1'))
    checks.push('1366x768 at 150 percent has no document horizontal overflow')
    await click('保存并关闭')
    await manager.open({ workspaceId: w, storeId: a })
    win!.close()
    await delay(100)
    assert(!win!.isDestroyed())
    checks.push('close request retains native window and persists draft before hide')
    assert(!fs.existsSync(path.join(runtime.dataDirectory(), 'product-knowledge.json')))
    assert(!fs.existsSync(path.join(runtime.dataDirectory(), 'intent-knowledge.json')))
    checks.push('old JSON constructors performed zero writes')
    // Exact trace evidence through actual AiClient serialization, followed by the existing ReviewConsole gate.
    const legacy = await command(
      'save-product',
      {
        productId: 'legacy-test',
        title: '旧兼容测试',
        description: '未经审核不会使用',
        specifications: '',
        price: '',
        enabled: true,
      },
      a,
    )
    const entry = repo.listEntries({ storeId: a, search: '旧兼容测试' }).items[0]
    assert(entry)
    assert.equal((legacy.data as { enabled: boolean }).enabled, false)
    const knowledge = await runtime.knowledge().context({
      thread: [{ from: 'buyer', content: '隔离发货问题' }],
      reviewContext: { storeId: a, uid: 'real-check', purpose: 'reply' },
    })
    runtime.knowledge().captureTrace('exact-native-trace', knowledge)
    assert(runtime.knowledge().citationsCurrent('exact-native-trace'))
    repo.withdraw(draft.id, repo.getEntry(draft.id)!.revision)
    assert(!runtime.knowledge().citationsCurrent('exact-native-trace'))
    checks.push('compat save stays draft, exact evidence invalidates on withdrawal')
    // Actual simulator → existing collector/worker → configured loopback AiClient → review console.
    const live = repo.saveDraft({
      scope: { kind: 'store', storeId: a },
      question: '模拟验收售后',
      answer: '模拟验收售后可七天退换',
    })
    repo.publish({
      entryId: live.id,
      expectedDraftRevision: live.revision,
      expectedSourceRevisions: {},
    })
    assert((await runtime.openSimulatorPage()).ok)
    const base = new URL(runtime.simulatorStatus().url)
    const sim = async (route: string, body?: Record<string, string>) => {
      const url = new URL(route, base)
      url.searchParams.set('token', base.searchParams.get('token')!)
      url.searchParams.set('storeId', a)
      const response = await fetch(
        url,
        body
          ? {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify(body),
            }
          : {},
      )
      assert(response.ok)
      return response.json()
    }
    const state = (await sim('/api/state')) as { personas: { uid: string }[] },
      uid = state.personas[0]!.uid
    await command('set-ai', { enabled: true }, a)
    await sim('/api/send', { storeId: a, uid, text: '模拟验收售后' })
    for (
      let i = 0;
      i < 200 &&
      !runtime.snapshot().review.replies.some((r) => r.uid === uid && r.status === 'pending');
      i++
    )
      await delay(100)
    const pending = runtime
      .snapshot()
      .review.replies.find((r) => r.uid === uid && r.status === 'pending')
    assert(pending, JSON.stringify(runtime.snapshot().review))
    assert(JSON.stringify(calls.at(-1)).includes('模拟验收售后可七天退换'))
    repo.withdraw(live.id, repo.getEntry(live.id)!.revision)
    await assert.rejects(
      command('review-reply', { id: pending.id, approve: true }),
      /知识|失效|变化|过期/,
    )
    const thread = (await sim(`/api/thread?uid=${encodeURIComponent(uid)}`)) as {
      messages: { from: string }[]
    }
    assert.equal(thread.messages.filter((m) => m.from === 'seller').length, 0)
    await command('set-ai', { enabled: false }, a)
    checks.push(
      'actual simulator worker/model/review pipeline retrieves approved knowledge; withdrawal blocks approval and produces zero simulated sends',
    )
    await knowledgeTypingCheck(path.join(root, 'typing'))
    checks.push(
      'real offline PDD DOM adapter: expiry/withdraw/source/override invalidate during typing and immediately before click; eight cases zero clicks',
    )
    await click('关闭')
    // One thousand products, SQL page bounds and renderer lazy thumbnails.
    const started = performance.now()
    repo.transaction(() => {
      for (let i = 8; i < 1000; i++) {
        const c = repo.saveCanonical({ title: `容量商品${i + 1}` })
        repo.bindProduct({ canonicalId: c.id, storeId: a, productId: `capacity-${i + 1}` })
      }
    })
    const pagingStarted = performance.now(),
      page = repo.listProducts({ storeId: a, offset: 980, limit: 20 })
    assert.equal(page.total, 1001)
    assert.equal(page.items.length, 20)
    const pageMs = performance.now() - pagingStarted
    assert(pageMs < 2000)
    win!.webContents.setZoomFactor(1)
    await manager.open({ workspaceId: w, storeId: a })
    await until(`document.querySelectorAll('.knowledge-content > .knowledge-card').length===20`)
    assert(
      await evaluate<boolean>(
        `document.querySelectorAll('.knowledge-content > .knowledge-card img').length<=20`,
      ),
    )
    for (const [width, height, zoom, name] of [
      [1366, 768, 1, 'final-1366'],
      [1920, 1080, 1, 'final-1920'],
      [1350, 1050, 1.5, 'final-900-logical'],
      [1366, 768, 1.5, 'final-1366-150'],
    ] as const) {
      win!.setSize(width, height)
      win!.webContents.setZoomFactor(zoom)
      await screenshot(`${name}.png`)
      assert(await evaluate<boolean>('document.documentElement.scrollWidth<=window.innerWidth+1'))
    }
    checks.push(
      `1001 products (including legacy fixture), bounded20 cards/lazy images; page980=${Math.round(pageMs)}ms; seed=${Math.round(performance.now() - started)}ms; 1366/1920/900logical/150% native captures`,
    )
    win!.webContents.setZoomFactor(1)
    const family = repo.listProducts({ storeId: a, limit: 1 }).items[0]!.canonical
    const backup = repo.createBackup(path.join(root, 'restore-backup'), { canonicalId: family.id })
    repo.saveCanonical({
      id: family.id,
      expectedRevision: family.revision,
      title: '临时修改待恢复',
    })
    const originalPicker = dialog.showOpenDialog
    dialog.showOpenDialog = (async () => ({
      canceled: false,
      filePaths: [backup.directory],
    })) as typeof dialog.showOpenDialog
    try {
      await click('恢复备份')
      await until(`document.body.innerText.includes('确认恢复范围')`)
      await screenshot('final-restore-preview.png')
      await click('停止服务并恢复上述范围')
      await until(`document.body.innerText.includes('知识库已恢复')`)
      repo = runtime.knowledge().repository
      assert.equal(repo.getCanonical(family.id)?.title, family.title)
      assert.notEqual(runtime.snapshot().workspaceId, w)
      assert(runtime.snapshot().stores.every((s) => s.aiEnabled === false))
      assert.equal(repo.listProducts({ storeId: a }).total, 1001)
      checks.push(
        'native picker/opaque preview/IPC owner closes writer and restores family, new manager context survives; unrelated1000 retained and AI startup defaults respected',
      )
    } finally {
      dialog.showOpenDialog = originalPicker
    }
    const bBefore = repo.listProducts({ storeId: b }).total
    const beforeClearWorkspace = runtime.snapshot().workspaceId
    await click('设置')
    await until(`!!document.querySelector('.knowledge-clear-settings select')`)
    assert.equal(
      await evaluate<string>(`document.querySelector('.knowledge-clear-settings select').value`),
      'store',
    )
    await screenshot('final-clear-settings.png')
    await click('预览清除范围')
    await until(`!!document.querySelector('[aria-label="确认清除知识库"]')`)
    assert(
      await evaluate<boolean>(
        `[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='备份并清除').disabled`,
      ),
    )
    await input('[aria-label="清除确认文字"]', '清除当前店铺')
    await screenshot('final-clear-preview.png')
    await click('备份并清除')
    await until(`document.body.innerText.includes('知识库已清除')`)
    repo = runtime.knowledge().repository
    assert.notEqual(runtime.snapshot().workspaceId, beforeClearWorkspace)
    assert.equal(repo.listProducts({ storeId: a }).total, 0)
    assert.equal(repo.listProducts({ storeId: b }).total, bBefore)
    const recoveryPath = repo.getLastBackupDirectory()
    assert(recoveryPath && fs.existsSync(path.join(recoveryPath, 'manifest.json')))
    assert(
      runtime.snapshot().stores.length === 2 &&
        runtime.snapshot().stores.every((s) => !s.aiEnabled),
    )
    checks.push(
      'native Settings defaults to current shop; typed confirmation/full auto backup/owner IPC rebuild clears A and preserves B, store registry and AI startup off',
    )
    await click('设置')
    await until(`!!document.querySelector('.knowledge-clear-settings select')`)
    await evaluate(
      `(()=>{const n=document.querySelector('.knowledge-clear-settings select');n.value='account';n.dispatchEvent(new Event('change',{bubbles:true}))})()`,
    )
    await click('预览清除范围')
    await until(
      `document.body.innerText.includes('当前账号的全部店铺知识库') && !!document.querySelector('[aria-label="清除确认文字"]')`,
    )
    await input('[aria-label="清除确认文字"]', '清空当前账号')
    await click('备份并清除')
    await until(
      `document.body.innerText.includes('知识库已清除') && !document.querySelector('[aria-label="确认清除知识库"]')`,
    )
    repo = runtime.knowledge().repository
    assert.equal(repo.rows('entries').length, 0)
    assert.equal(repo.rows('bindings').length, 0)
    assert.equal(runtime.snapshot().stores.length, 2)
    assert.equal(repo.getSettings().dynamicTtlMinutes, 60)
    checks.push(
      'native account-wide clear passes real preload/IPC and empties knowledge while preserving settings and both shops',
    )
    await delay(250)
    manager.dispose()
    await knowledgeManagedClearCheck(root, parent!)
    checks.push(
      'managed encrypted-session fixture: current-shop and account clear initialize authentication first, retain logged-in account/store/configuration, rebuild successfully and leave AI off',
    )
    fs.writeFileSync(
      path.join(output, 'report.json'),
      JSON.stringify(
        {
          completedAt: new Date().toISOString(),
          checks,
          modelRequests: calls.length,
          visibleWindows: false,
        },
        null,
        2,
      ),
    )
    console.log(JSON.stringify({ checks, output }, null, 2))
  })
  .then(async () => {
    for (const dispose of disposals.reverse()) dispose()
    await runtime?.dispose()
    parent?.destroy()
    model.close()
    clearTimeout(deadline)
    app.exit(0)
  })
  .catch(async (error) => {
    console.error(error)
    fs.writeFileSync(path.join(output, 'failure.txt'), String(error))
    for (const dispose of disposals.reverse()) dispose()
    await runtime?.dispose().catch(() => {})
    model.close()
    clearTimeout(deadline)
    app.exit(1)
  })

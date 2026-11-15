/** Hidden/offscreen native acceptance. Temporary account, synthetic knowledge, loopback model only. */
import { app, ipcMain, type BrowserWindow } from 'electron'
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

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'knowledge-manager-check-'))
const output = path.resolve('artifacts/knowledge-manager-check/evidence')
fs.mkdirSync(output, { recursive: true })
fs.writeFileSync(path.join(output, 'cleanup.json'), JSON.stringify({ directory: root }))
app.setPath('userData', path.join(root, 'electron'))
let runtime: ReturnType<typeof createLocalRuntime> | undefined,
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
    runtime = createLocalRuntime({ dataDir: path.join(root, 'account'), getWindow: () => parent })
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
    const repo = runtime.knowledge().repository
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
          workspaceId: w,
          request: (request) => runtime!.knowledge().request(request),
        }),
        window: manager,
      }),
    )
    await manager.open({ workspaceId: w, storeId: a })
    await until(`document.querySelectorAll('.knowledge-card').length===8`)
    checks.push('real route/preload/trusted IPC/SQLite cards loaded')
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
    manager.dispose()
    fs.writeFileSync(
      path.join(output, 'report.json'),
      JSON.stringify({ checks, modelRequests: calls.length, visibleWindows: false }, null, 2),
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

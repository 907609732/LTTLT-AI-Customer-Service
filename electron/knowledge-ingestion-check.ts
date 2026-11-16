import { parseKnowledgeFile } from './knowledge/sources'
import { estimateContextTokens } from './context-compression'
/** Hidden/offscreen native acceptance. Temporary account, synthetic knowledge, loopback model only. */
import { app, dialog, ipcMain, type BrowserWindow } from 'electron'
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

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'knowledge-ingestion-check-'))
const output = path.resolve('artifacts/knowledge-ingestion-check/evidence')
fs.mkdirSync(output, { recursive: true })
fs.writeFileSync(path.join(output, 'cleanup.json'), JSON.stringify({ directory: root }))
app.setPath('userData', path.join(root, 'electron'))
let runtime: ReturnType<typeof createLocalRuntime> | undefined,
  parent: BrowserWindow | undefined,
  win: BrowserWindow | undefined
let uncertain = false
let fixtureOcrCalls = 0
const calls: { messages: import('./context-compression').ModelMessages }[] = [],
  checks: string[] = []
const disposals: (() => void)[] = []
const model = createServer(async (req, res) => {
  let text = ''
  for await (const chunk of req) text += chunk
  const payload = JSON.parse(text) as { messages: import('./context-compression').ModelMessages }
  calls.push(payload)
  if (uncertain) {
    req.socket.destroy()
    return
  }
  const user = payload.messages.find((m) => m.role === 'user')
  const material = Array.isArray(user?.content) ? user.content.find((p) => p.type === 'text') : null
  const parsed =
    material?.type === 'text'
      ? (JSON.parse(material.text) as { sourceId: string; untrustedMaterial: string })
      : null
  const content = parsed
    ? JSON.stringify({
        candidates: parsed.untrustedMaterial.includes('纯棉50毫米')
          ? [
              {
                question: '材质尺寸',
                answer: '纯棉50毫米',
                evidence: '纯棉50毫米',
                sourceId: parsed.sourceId,
                field: 'fact',
              },
            ]
          : [],
      })
    : 'ok'
  res.setHeader('content-type', 'application/json')
  res.end(JSON.stringify({ choices: [{ message: { content } }] }))
})
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
async function evaluate<T>(script: string): Promise<T> {
  return win!.webContents.executeJavaScript(script, true).catch((cause: unknown) => {
    throw Error('Native evaluation failed: ' + script + ' / ' + String(cause))
  })
}
async function until(script: string) {
  for (let i = 0; i < 150; i++) {
    if (await evaluate<boolean>(script)) return
    await delay(50)
  }
  throw Error('页面等待超时 ' + script + '\n' + (await evaluate<string>('document.body.innerText')))
}
async function click(text: string) {
  for (let i = 0; i < 150; i++) {
    const clicked = await evaluate<boolean>(
      `(()=>{const node=[...document.querySelectorAll('button')].find(n=>n.textContent.trim()===${JSON.stringify(text)});if(!node||node.disabled)return false;node.click();return true})()`,
    )
    if (clicked) {
      await delay(90)
      return
    }
    await delay(50)
  }
  throw Error(
    'Missing actionable button: ' +
      text +
      ' / ' +
      (await evaluate<string>('document.body.innerText')),
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
    runtime = createLocalRuntime({
      dataDir: path.join(root, 'account'),
      getWindow: () => parent,
      recognizeKnowledgeImage: async (bytes, signal) => {
        signal.throwIfAborted()
        assert.equal(Buffer.from(bytes.subarray(0, 8)).toString('hex'), '89504e470d0a1a0a')
        fixtureOcrCalls++
        // Synthetic raster fixture: exercise the real image/OCR pipeline without
        // depending on a hosted runner's optional Windows OCR language packs.
        return { text: '', lines: [], language: 'zh-Hans-CN' }
      },
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
    String(
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
    for (const file of [
      'text.pdf',
      'scan.pdf',
      'text.docx',
      'image.docx',
      'sheets.xlsx',
      'image.png',
    ]) {
      const parsed = await parseKnowledgeFile(
        file,
        fs.readFileSync(path.resolve('tests/fixtures/knowledge-ingestion', file)),
      )
      assert(parsed.parts.length > 0)
      if (file === 'scan.pdf') assert(parsed.parts.every((p) => p.image))
      if (file === 'sheets.xlsx') assert(parsed.parts.some((p) => p.locator.sheet === '第二表'))
    }
    checks.push(
      'built CJS/Electron loads modern PDF.js resources and rasterizes scan, DOCX images, all XLSX sheets and image',
    )
    const csv = path.join(root, 'products.csv')
    fs.writeFileSync(
      csv,
      'productId,title,description\n1,隔离导入衬衫,纯棉50毫米\n2,隔离导入裤子,蓝色',
    )
    const originalPicker = dialog.showOpenDialog
    let picked = [csv]
    dialog.showOpenDialog = (async () => ({
      canceled: false,
      filePaths: picked,
    })) as typeof dialog.showOpenDialog
    disposals.push(() => {
      dialog.showOpenDialog = originalPicker
    })
    const manager = createKnowledgeWindow({
      workspace: () => runtime!.snapshot().workspaceId,
      stores: () => runtime!.snapshot().stores.map((s) => s.id),
      workArea: () => ({ x: 0, y: 0, width: 1440, height: 1000 }),
      create: () => {
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
    await until(`document.body.innerText.includes('导入商品CSV / 通用资料')`)
    await click('导入商品CSV / 通用资料')
    await until(`Boolean(document.querySelector('[aria-label="导入预览"]'))`)
    assert((await evaluate<string>('document.body.innerText')).includes('商品 1'))
    await screenshot('import-preview.png')
    await click('确认导入这些资料')
    await until(`document.querySelectorAll('.knowledge-card-actions').length===2`)
    assert.equal(repo.listBindings().filter((binding) => binding.storeId === a).length, 2)
    checks.push(
      'native chooser adapter through trusted IPC previews CSV targets and imports individual products',
    )
    const before = calls.length
    await click('开始学习')
    await until(`document.body.innerText.includes('明确开始模型学习')`)
    assert.equal(calls.length, before)
    await screenshot('learning-estimate.png')
    await click('明确开始模型学习')
    for (
      let i = 0;
      i < 200 &&
      !repo.listJobs().items.some((job) => job.kind === 'learn' && job.status === 'succeeded');
      i++
    )
      await delay(20)
    assert(repo.listJobs().items.some((job) => job.kind === 'learn' && job.status === 'succeeded'))
    assert(
      repo
        .listEntries({ storeId: a })
        .items.some((entry) => entry.draft.answer === '纯棉50毫米' && entry.approved === null),
    )
    assert(calls.slice(before).every((call) => estimateContextTokens(call.messages) <= 8192))
    checks.push(
      'explicit estimate/manual start calls actual configured AiClient loopback transport with bounded input and draft-only result',
    )
    // Product cards stay mounted during progress refreshes. Their presence alone
    // does not mean run() can accept another action; wait for its existing busy gate.
    await until(
      `Boolean(document.querySelector('[data-testid="write-one"]'))&&!document.querySelector('[data-testid="write-one"]').disabled`,
    )
    await evaluate(
      `([...document.querySelectorAll('.knowledge-tabs button')].find(n=>n.textContent.trim().startsWith('商品 '))).click()`,
    )
    await until(
      `document.querySelectorAll('.knowledge-card-actions').length===2&&!document.querySelector('[data-testid="write-one"]').disabled`,
    )
    await click('编辑')
    await until(`Boolean(document.querySelector('[aria-label="知识编辑与审核"]'))`)
    await click('原始资料 / 来源版本')
    assert(
      await evaluate<boolean>(
        `(()=>{const n=[...document.querySelectorAll('button')].find(n=>n.textContent.trim()==='导入本商品资料'),r=n.getBoundingClientRect();return r.width>0&&r.height>0&&n.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))})()`,
      ),
    )
    picked = [path.resolve('tests/fixtures/knowledge-ingestion/scan.pdf')]
    await click('导入本商品资料')
    await until(`Boolean(document.querySelector('[aria-label="导入预览"]'))`)
    assert((await evaluate<string>('document.body.innerText')).includes('商品 1'))
    assert(
      await evaluate<boolean>(
        `(()=>{const n=document.querySelector('[aria-label="导入预览"]');return n.scrollWidth<=n.clientWidth+1})()`,
      ),
    )
    await screenshot('product-pdf-preview.png')
    await click('确认导入这些资料')
    await until(`document.querySelector('.knowledge-sources')?.textContent.includes('scan.pdf')`)
    const imported = repo.listSources().filter((s) => s.label === 'scan.pdf')
    assert(imported.length > 0)
    assert(imported.every((s) => repo.getBinding(s.bindingId!)?.productId === '1'))
    await click('查看资料图片')
    await until(`Boolean(document.querySelector('[aria-label="来源图片预览"] img'))`)
    await screenshot('source-page-preview.png')
    await click('关闭图片')
    await click('学习本商品资料')
    await until(`document.body.innerText.includes('明确开始模型学习')`)
    assert(fixtureOcrCalls > 0, 'must pass actual PNG tiles through the injected OCR boundary')
    const beforeVision = calls.length
    await click('明确开始模型学习')
    for (
      let i = 0;
      i < 200 &&
      !repo.listJobs().items.filter((j) => j.kind === 'learn' && j.status === 'succeeded').length;
      i++
    )
      await delay(20)
    for (
      let i = 0;
      i < 200 &&
      !calls
        .slice(beforeVision)
        .some((call) =>
          call.messages.some(
            (m) => Array.isArray(m.content) && m.content.some((p) => p.type === 'image_url'),
          ),
        );
      i++
    )
      await delay(20)
    assert(
      calls
        .slice(beforeVision)
        .some((call) =>
          call.messages.some(
            (m) =>
              Array.isArray(m.content) &&
              m.content.some(
                (p) =>
                  p.type === 'image_url' && p.image_url.url.startsWith('data:image/png;base64,'),
              ),
          ),
        ),
    )
    checks.push(
      'visible-in-hidden-renderer product-source import button binds scan PDF only to product1, previews safe raster and sends actual image bytes to configured model',
    )
    const binding = repo.listBindings().find((binding) => binding.storeId === a)!
    const source = repo.listSources({ bindingId: binding.id })[0]!
    const request = (
      input: import('../src/shared/contracts/knowledge-pipeline').KnowledgePipelineInput,
    ) => runtime!.knowledge().request({ workspaceId: w, operation: 'pipeline', input })
    const estimate = (await request({
      action: 'estimate',
      storeId: a,
      bindingIds: [binding.id],
      sourceIds: [source.id],
    })) as { estimateId: string }
    uncertain = true
    const { jobId } = (await request({
      action: 'start',
      storeId: a,
      kind: 'learn',
      bindingIds: [binding.id],
      sourceIds: [source.id],
      estimateId: estimate.estimateId,
    })) as { jobId: string }
    for (let i = 0; i < 200 && repo.getJob(jobId)?.status !== 'needs-confirmation'; i++)
      await delay(20)
    assert.equal(repo.getJob(jobId)?.status, 'needs-confirmation')
    // Recovery actions now live in the affected product's compact progress row.
    await until(
      `Boolean(document.querySelector('[data-testid="write-one"]'))&&!document.querySelector('[data-testid="write-one"]').disabled`,
    )
    await evaluate(
      `([...document.querySelectorAll('.knowledge-tabs button')].find(n=>n.textContent.trim().startsWith('商品 '))).click()`,
    )
    await until(
      `Boolean(document.querySelector('.knowledge-job-progress[data-status="needs-confirmation"] .progress-recovery > summary'))`,
    )
    await evaluate(
      `document.querySelector('.knowledge-job-progress[data-status="needs-confirmation"] .progress-recovery > summary').click()`,
    )
    await until(`document.body.innerText.includes('可能重复计费')`)
    await screenshot('uncertain-call.png')
    const count = calls.length
    await assert.rejects(request({ action: 'resume', storeId: a, jobId }), /不确定/)
    uncertain = false
    await click('跳过此调用（保留未完成提示）')
    await delay(100)
    assert.equal(calls.length, count)
    checks.push(
      'actual failed HTTP call persists uncertain result; bare resume no replay; explicit skip causes zero additional calls',
    )
    await click('导入本机归档聊天')
    await until(`Boolean(document.querySelector('[aria-label="选择归档聊天范围"]'))`)
    await screenshot('archive-range.png')
    checks.push(
      'native archived-chat range selection exposes explicit dates and bounded-history disclosure',
    )
    await click('取消')
    const secondBinding = repo.listBindings().find((b) => b.storeId === a && b.productId === '2')!
    const staleSource = repo.saveSource({
      storeId: a,
      bindingId: secondBinding.id,
      kind: 'manual',
      label: '隔离过期来源',
      text: '蓝色',
    })
    const staleDraft = repo.saveDraft({
      scope: { kind: 'binding', bindingId: secondBinding.id },
      question: '隔离冲突',
      answer: '蓝色',
      sourceRefs: [{ sourceId: staleSource.id, revision: 1 }],
    })
    await evaluate(
      `([...document.querySelectorAll('.knowledge-tabs button')].find(n=>n.textContent.trim().startsWith('待审核 '))).click()`,
    )
    await until(`document.querySelectorAll('.knowledge-content .knowledge-card').length===2`)
    await evaluate(`document.querySelector('.knowledge-selection input').click()`)
    await click('审核所选草稿')
    await until(`Boolean(document.querySelector('[aria-label="审核发布"]'))`)
    repo.saveSource({
      id: staleSource.id,
      expectedRevision: 1,
      storeId: a,
      bindingId: secondBinding.id,
      kind: 'manual',
      label: '隔离过期来源',
      text: '绿色',
    })
    await click('明确审核并发布所选条目')
    await until(`Boolean(document.querySelector('[aria-label="批量审核结果"]'))`)
    const reviewText = await evaluate<string>(
      `document.querySelector('[aria-label="批量审核结果"]').innerText`,
    )
    assert(reviewText.includes('已发布') && reviewText.includes('失败，草稿保留'))
    assert.equal(repo.getEntry(staleDraft.id)?.draft.answer, '蓝色')
    assert.equal(repo.getEntry(staleDraft.id)?.approved, null)
    assert(
      await evaluate<boolean>(
        `(()=>{const n=document.querySelector('[aria-label="批量审核结果"]');return n.scrollWidth<=n.clientWidth+1})()`,
      ),
    )
    await screenshot('batch-review-result.png')
    checks.push(
      'native batch review reports one approved and one stale failure per product, preserving stale draft text',
    )
    assert.equal(repo.listMisses({}).total, 0)
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

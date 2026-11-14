/** Targeted native acceptance: real Vue window → preload/IPC → isolated runtime → local model. */
import { app, type BrowserWindow } from 'electron'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createServer } from 'node:http'
import { createWindow, rendererPath } from './windows'
import { registerDesktopIpc } from './ipc'
import { registerBusinessIpc } from './business-ipc'
import { createLocalRuntime } from './local-runtime'
import {
  intentsSchema,
  type BackendSnapshot,
  type BackendResult,
  type CommandInput,
} from '../src/shared/contracts/backend'
import { auditQuestion } from '../src/modules/knowledge/learning'

const output = path.resolve(
  'artifacts',
  'knowledge-electron',
  new Date().toISOString().replace(/[:.]/g, '-'),
)
const isolatedRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lingtu-knowledge-electron-'))
app.setPath('userData', path.join(isolatedRoot, 'electron'))
app.commandLine.appendSwitch('disable-renderer-backgrounding')
app.commandLine.appendSwitch('force-device-scale-factor', '1')
fs.mkdirSync(output, { recursive: true })
const checks: { name: string; pass: boolean; detail?: unknown }[] = []
const requests: unknown[] = []
const errors: string[] = []
let win: BrowserWindow | undefined
let runtime: ReturnType<typeof createLocalRuntime> | undefined
let disposeBusiness = () => {}
let disposeDesktop = () => {}
let sequence = 0
const deadline = setTimeout(() => {
  fs.writeFileSync(path.join(output, 'timeout.json'), JSON.stringify(checks, null, 2))
  app.exit(1)
}, 180000)
const model = createServer(async (request, response) => {
  let body = ''
  for await (const chunk of request) body += chunk
  requests.push(JSON.parse(body) as unknown)
  response.setHeader('content-type', 'application/json')
  response.end(
    JSON.stringify({
      choices: [
        { message: { content: JSON.stringify({ reply: '本机验收模型：已收到测试请求。' }) } },
      ],
    }),
  )
})
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
async function evaluate<T>(expression: string): Promise<T> {
  try {
    return await win!.webContents.executeJavaScript(expression, true)
  } catch (error) {
    throw new Error(`${String(error)}\nExpression: ${expression}`)
  }
}
async function wait(expression: string) {
  for (let attempt = 0; attempt < 160; attempt++) {
    if (await evaluate<boolean>(expression)) return
    await sleep(75)
  }
  const text = await evaluate<string>('document.body.innerText')
  fs.writeFileSync(path.join(output, 'timeout-page.txt'), text)
  throw new Error('等待界面状态超时：' + expression)
}
async function command(input: CommandInput): Promise<BackendResult> {
  const snapshot = await evaluate<BackendSnapshot>('window.yunduoDesktop.backendSnapshot()')
  return evaluate(
    `window.yunduoDesktop.backendExecute(${JSON.stringify({ ...input, values: input.values ?? {}, workspaceId: snapshot.workspaceId })})`,
  )
}
async function packs() {
  return intentsSchema.parse((await command({ action: 'list-intent-packs' })).data).packs
}
async function click(text: string, selector = 'button') {
  await evaluate(
    `(() => { const node = Array.from(document.querySelectorAll(${JSON.stringify(selector)})).find(n => n.textContent.trim() === ${JSON.stringify(text)}); if(!node) throw Error('找不到按钮：' + ${JSON.stringify(text)}); if(node.disabled) throw Error('按钮不可用：' + ${JSON.stringify(text)}); node.scrollIntoView({block:'center'}); node.click() })()`,
  )
  await evaluate('new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))')
}
async function input(selector: string, value: string) {
  await evaluate(
    `(() => { const node = document.querySelector(${JSON.stringify(selector)}); if(!node) throw Error('找不到输入框：' + ${JSON.stringify(selector)}); node.value = ${JSON.stringify(value)}; node.dispatchEvent(new Event('input', {bubbles:true})) })()`,
  )
  await evaluate('new Promise(r => requestAnimationFrame(r))')
}
async function load(panel: string) {
  await win!.loadFile(rendererPath, {
    hash: `/shop/manage?panel=${panel}`,
    query: { knowledgeCheck: String(++sequence) },
  })
  await wait(`Boolean(document.querySelector('.runtime-page h1')) && Boolean(window.yunduoDesktop)`)
  await sleep(180)
  assert.deepEqual(await evaluate('window.__vueErrors || []'), [])
}
async function shot(name: string) {
  await sleep(200)
  fs.writeFileSync(path.join(output, `${name}.png`), (await win!.webContents.capturePage()).toPNG())
}
async function check(name: string, run: () => Promise<unknown>) {
  try {
    const detail = await run()
    checks.push({ name, pass: true, detail })
    console.log('PASS', name)
  } catch (error) {
    checks.push({ name, pass: false, detail: String(error) })
    throw error
  }
}
async function chooseCandidate(question: string) {
  await wait(
    `Array.from(document.querySelectorAll('.runtime-entry')).some(n => n.textContent.includes(${JSON.stringify(question)}))`,
  )
  await evaluate(
    `Array.from(document.querySelectorAll('.runtime-entry')).find(n => n.textContent.includes(${JSON.stringify(question)})).click()`,
  )
  await wait(`Boolean(document.querySelector('.learning-source'))`)
  await evaluate(`document.querySelector('.runtime-two-columns').scrollIntoView({block:'start'})`)
}
async function approveCandidate() {
  await evaluate(
    `document.querySelector('.runtime-two-columns form input[type="checkbox"]').click()`,
  )
  await wait(`!document.querySelector('.runtime-two-columns form button[type="submit"]').disabled`)
  await click('确认入库')
  await wait(`document.body.innerText.includes('已保存为停用知识包')`)
}
async function enable(question: string) {
  await load('intent')
  await choosePack(question)
  await evaluate(`document.querySelector('form .el-switch').click()`)
  await click('保存知识包')
  await wait(`document.body.innerText.includes('知识包已保存')`)
  const pack = (await packs()).find((p) => p.entries[0]?.question === question)!
  assert.equal(pack.enabled, true)
  assert.equal(pack.entries.find((entry) => entry.question === auditQuestion)?.enabled, false)
}
async function choosePack(question: string) {
  await wait(
    `Array.from(document.querySelectorAll('.runtime-entry')).some(n => n.textContent.includes(${JSON.stringify(question)}))`,
  )
  await evaluate(
    `Array.from(document.querySelectorAll('.runtime-entry')).find(n => n.textContent.includes(${JSON.stringify(question)})).click()`,
  )
  await wait(`Boolean(document.querySelector('form pre'))`)
}
async function train(question: string, productId = '') {
  await load('training')
  if (productId) await input('[aria-label="训练商品编号"]', productId)
  await input('[aria-label="模拟买家问题"]', question)
  const before = requests.length
  await click('发送测试')
  await wait(
    `document.querySelector('[aria-label="模拟对话"]').textContent.includes('本机验收模型')`,
  )
  assert.equal(requests.length, before + 1)
  const request = JSON.stringify(requests.at(-1))
  assert.ok(!request.includes('lingtu-learning-v1'), '审计来源不能进入模型请求')
  return request
}

app
  .whenReady()
  .then(async () => {
    let failure: unknown
    try {
      await new Promise<void>((resolve) => model.listen(0, '127.0.0.1', resolve))
      const address = model.address()
      assert.ok(address && typeof address !== 'string')
      disposeDesktop = registerDesktopIpc()
      win = createWindow()
      win.setTitle('灵兔 AI · 知识模块隔离验收')
      win.webContents.on('console-message', (_event, level, message) => {
        if (level >= 3) errors.push(message)
      })
      runtime = createLocalRuntime({
        dataDir: path.join(isolatedRoot, 'backend'),
        getWindow: () => win,
      })
      disposeBusiness = registerBusinessIpc(runtime)
      await runtime.start()
      await load('intent-doc')
      let storeA = '',
        storeB = ''
      await check('setup:isolated-stores-model-product-and-archived-chat', async () => {
        storeA = String(
          (
            await command({
              action: 'add-store',
              values: { platform: 'sim-local', storeName: '知识验收甲店（本机）' },
            })
          ).data.id,
        )
        storeB = String(
          (
            await command({
              action: 'add-store',
              values: { platform: 'sim-local', storeName: '知识验收乙店（本机）' },
            })
          ).data.id,
        )
        await command({ action: 'select-store', storeId: storeA })
        await command({
          action: 'save-model-settings',
          values: {
            baseUrl: `http://127.0.0.1:${address.port}/v1`,
            model: 'knowledge-acceptance-local',
            apiKey: '',
            testConnection: true,
          },
        })
        await command({
          action: 'save-product',
          storeId: storeA,
          values: {
            productId: 'fixture-size-1',
            title: '星梭外套',
            description: '',
            specifications: '原商品规格：M 胸围 100 cm。',
            price: '',
            enabled: true,
          },
        })
        const dataDirectory = runtime!.dataDirectory()
        disposeBusiness()
        await runtime!.dispose()
        fs.writeFileSync(
          path.join(dataDirectory, 'conversations.json'),
          JSON.stringify([
            {
              storeId: storeA,
              uid: 'fixture-buyer',
              name: '合成买家',
              status: 'replied',
              updatedAt: 2,
              messages: [
                { from: 'buyer', content: '星梭衣扣如何保养？', ts: 1, type: 'text' },
                { from: 'seller', content: 'CHAT_FACT_428：用干布擦拭衣扣。', ts: 2, type: 'text' },
              ],
            },
          ]),
        )
        runtime = createLocalRuntime({
          dataDir: path.join(isolatedRoot, 'backend'),
          getWindow: () => win,
        })
        disposeBusiness = registerBusinessIpc(runtime)
        await runtime.start()
        await load('intent-doc')
        return { stores: 2, products: 1, archivedChatPairs: 1, actualDataDirectory: dataDirectory }
      })
      await check('document:preview-no-write-explicit-confirm-and-original-audit', async () => {
        await evaluate(`document.querySelector('details.runtime-card').open = true`)
        await input('details.runtime-card input', '本机合成规则 2026-11-14.txt')
        await input(
          'details.runtime-card textarea',
          '问：星梭暗袋如何收纳？\n答：DOC_ORIGINAL_317：放入原装收纳袋。',
        )
        await click('预览文档候选')
        await chooseCandidate('星梭暗袋如何收纳？')
        assert.equal((await packs()).length, 0)
        assert.equal(
          await evaluate<boolean>(
            `document.querySelector('.runtime-two-columns form button[type="submit"]').disabled`,
          ),
          true,
        )
        await shot('01-document-preview')
        await evaluate(
          `document.querySelector('.runtime-two-columns form input[type="checkbox"]').click()`,
        )
        await input(
          '[aria-label="审核后的候选答案"]',
          'DOC_FACT_317：清洁后放入原装收纳袋，保持干燥。',
        )
        assert.equal(
          await evaluate<boolean>(
            `document.querySelector('.runtime-two-columns form button[type="submit"]').disabled`,
          ),
          true,
        )
        await approveCandidate()
        const saved = (await packs())[0]!
        assert.equal(saved.enabled, false)
        const audit = JSON.parse(saved.entries[1]!.answer) as {
          original: { answer: string }
          reviewed: { answer: string }
        }
        assert.ok(audit.original.answer.includes('DOC_ORIGINAL_317'))
        assert.ok(audit.reviewed.answer.includes('DOC_FACT_317'))
        await shot('02-document-confirmed-inactive')
      })
      await check(
        'document:inactive-excluded-enable-via-ui-and-real-training-context',
        async () => {
          assert.ok(!(await train('星梭暗袋如何收纳？')).includes('DOC_FACT_317'))
          await enable('星梭暗袋如何收纳？')
          await choosePack('星梭暗袋如何收纳？')
          await shot('03-document-enabled-audit')
          assert.ok((await train('星梭暗袋如何收纳？')).includes('DOC_FACT_317'))
          await shot('04-document-training-retrieval')
        },
      )
      await check('chat:preview-existing-archive-confirm-enable-and-retrieve', async () => {
        await load('intent-chat')
        await click('预览已采集聊天')
        await chooseCandidate('星梭衣扣如何保养？')
        assert.ok(
          await evaluate<boolean>(
            `document.querySelector('.learning-source').textContent.includes('fixture-buyer')`,
          ),
        )
        await shot('05-chat-preview')
        await approveCandidate()
        assert.equal(
          (await packs()).find((p) => p.entries[0]?.question.includes('衣扣'))?.enabled,
          false,
        )
        await enable('星梭衣扣如何保养？')
        assert.ok((await train('星梭衣扣如何保养？')).includes('CHAT_FACT_428'))
      })
      await check(
        'product:preview-version-bound-candidate-confirm-and-retrieve-reviewed-spec',
        async () => {
          await load('intent-doc')
          await click('预览本机商品规格')
          await chooseCandidate('星梭外套的尺码/规格是什么？')
          assert.ok(
            await evaluate<boolean>(
              `document.querySelector('.learning-source').textContent.includes('"version": 1')`,
            ),
          )
          await input(
            '[aria-label="审核后的候选答案"]',
            'PRODUCT_FACT_539：M 码胸围 100 cm，单位厘米。',
          )
          await shot('06-product-preview')
          await approveCandidate()
          const pack = (await packs()).find((p) => p.entries[0]?.question.includes('星梭外套'))!
          assert.deepEqual(pack.productIds, ['fixture-size-1'])
          await enable('星梭外套的尺码/规格是什么？')
          assert.ok(
            (await train('星梭外套的尺码/规格是什么？', 'fixture-size-1')).includes(
              'PRODUCT_FACT_539',
            ),
          )
        },
      )
      await check('size:manual-preview-confirm-enable-and-product-retrieval', async () => {
        await load('kb')
        await input('.runtime-page form label:nth-child(2) input', '星梭衣长表')
        await input('.runtime-page form label:nth-child(3) textarea', 'fixture-size-1')
        await input(
          '.runtime-page form label:nth-child(4) textarea',
          'SIZE_FACT_640：M 码衣长 68 cm，适用星梭外套。',
        )
        await click('预览尺码候选')
        await chooseCandidate('星梭衣长表的尺码/规格是什么？')
        await shot('07-size-preview')
        await approveCandidate()
        await enable('星梭衣长表的尺码/规格是什么？')
        assert.ok(
          (await train('星梭衣长表的尺码/规格是什么？', 'fixture-size-1')).includes(
            'SIZE_FACT_640',
          ),
        )
        assert.ok(!(await train('星梭衣长表的尺码/规格是什么？')).includes('SIZE_FACT_640'))
      })
      await check('duplicate:visible-error-keeps-draft-and-does-not-insert', async () => {
        await load('intent-doc')
        await evaluate(`document.querySelector('details.runtime-card').open = true`)
        await input('details.runtime-card input', '本机合成规则 2026-11-14.txt')
        await input(
          'details.runtime-card textarea',
          '问：星梭暗袋如何收纳？\n答：DOC_ORIGINAL_317：放入原装收纳袋。',
        )
        await click('预览文档候选')
        await chooseCandidate('星梭暗袋如何收纳？')
        await input(
          '[aria-label="审核后的候选答案"]',
          'DOC_FACT_317：清洁后放入原装收纳袋，保持干燥。',
        )
        await evaluate(
          `document.querySelector('.runtime-two-columns form input[type="checkbox"]').click()`,
        )
        await click('确认入库')
        await wait(`document.body.innerText.includes('此来源与问答已入库')`)
        assert.equal((await packs()).length, 4)
        assert.equal(
          await evaluate(`document.querySelector('[aria-label="审核后的候选答案"]').value`),
          'DOC_FACT_317：清洁后放入原装收纳袋，保持干燥。',
        )
        await shot('09-duplicate-rejected-draft-retained')
      })
      await check('isolation:other-store-no-knowledge-and-ai-remains-off', async () => {
        await command({ action: 'select-store', storeId: storeB })
        await wait(`!document.querySelector('.learning-source')`)
        const request = await train(
          '星梭暗袋如何收纳？星梭衣扣如何保养？星梭衣长表的尺码/规格是什么？',
        )
        for (const marker of ['DOC_FACT_317', 'CHAT_FACT_428', 'PRODUCT_FACT_539', 'SIZE_FACT_640'])
          assert.ok(!request.includes(marker))
        const snapshot = await evaluate<BackendSnapshot>('window.yunduoDesktop.backendSnapshot()')
        assert.ok(snapshot.stores.every((store) => !store.aiEnabled && !store.runtime.open))
        assert.equal(snapshot.review.replies.length, 0)
      })
      await check('restart:persisted-audit-enabled-packs-and-retrieval', async () => {
        await command({ action: 'select-store', storeId: storeA })
        const dataDirectory = runtime!.dataDirectory()
        disposeBusiness()
        await runtime!.dispose()
        runtime = createLocalRuntime({
          dataDir: path.join(isolatedRoot, 'backend'),
          getWindow: () => win,
        })
        disposeBusiness = registerBusinessIpc(runtime)
        await runtime.start()
        await load('intent')
        const persisted = await packs()
        assert.equal(persisted.length, 4)
        assert.ok(persisted.every((pack) => pack.enabled && pack.entries[1]?.enabled === false))
        assert.ok((await train('星梭暗袋如何收纳？')).includes('DOC_FACT_317'))
        fs.copyFileSync(
          path.join(dataDirectory, 'intent-knowledge.json'),
          path.join(output, 'isolated-intent-knowledge.json'),
        )
        await shot('08-restarted-training')
        return { persistedPacks: persisted.length }
      })
      await check('renderer:no-vue-or-console-errors', async () => {
        assert.deepEqual(await evaluate('window.__vueErrors || []'), [])
        assert.deepEqual(errors, [])
        return { modelRequests: requests.length }
      })
    } catch (error) {
      failure = error
      console.error(error)
      if (win && !win.isDestroyed()) {
        await shot('99-failure').catch(() => {})
        fs.writeFileSync(
          path.join(output, 'failure-page.txt'),
          await evaluate<string>('document.body.innerText').catch(() => 'unavailable'),
        )
      }
    } finally {
      console.log('Knowledge acceptance evidence:', output)
      fs.writeFileSync(
        path.join(output, 'report.json'),
        JSON.stringify(
          {
            at: new Date().toISOString(),
            electron: process.versions.electron,
            chrome: process.versions.chrome,
            isolatedRoot,
            checks,
            failure: failure ? String(failure) : null,
            consoleErrors: errors,
          },
          null,
          2,
        ),
      )
      fs.writeFileSync(path.join(output, 'model-requests.json'), JSON.stringify(requests, null, 2))
      disposeBusiness()
      disposeDesktop()
      await runtime?.dispose()
      await new Promise<void>((resolve) => model.close(() => resolve()))
      win?.destroy()
      clearTimeout(deadline)
      app.exit(failure ? 1 : 0)
    }
  })
  .catch((error) => {
    console.error(error)
    app.exit(1)
  })

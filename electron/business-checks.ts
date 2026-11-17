import { execFile } from 'node:child_process'
import { BrowserWindow, safeStorage } from 'electron'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import { estimateContextTokens, modelMessagesSchema } from './context-compression'
import type { BackendSnapshot, BackendResult, CommandInput } from '../src/shared/contracts/backend'
import type { KnowledgeBridge, KnowledgeDetail } from '../src/shared/contracts/knowledge-client'
import type { KnowledgePage, KnowledgeProductCard } from '../src/shared/contracts/knowledge'

type Check = (name: string, route: string, run: () => Promise<void>) => Promise<void>
/** 全部使用临时工作区、合成文字和本机 HTTP，不打开真实店铺或调用真实模型。 */
export async function businessChecks(options: {
  win: BrowserWindow
  dataDir: string
  check: Check
  load: (route: string) => Promise<void>
  restart: () => Promise<void>
  knowledge: KnowledgeBridge['request']
}) {
  const { win, dataDir, check, load } = options
  const snapshot = () =>
    win.webContents.executeJavaScript(
      'window.yunduoDesktop.backendSnapshot()',
    ) as Promise<BackendSnapshot>
  const execute = async (command: CommandInput): Promise<BackendResult> => {
    const current = await snapshot()
    return win.webContents.executeJavaScript(
      `window.yunduoDesktop.backendExecute(${JSON.stringify({ ...command, values: command.values ?? {}, workspaceId: current.workspaceId })})`,
    )
  }
  const wait = async (expression: string) => {
    for (let attempt = 0; attempt < 80; attempt++) {
      if (await win.webContents.executeJavaScript(expression)) return
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    throw new Error('等待界面状态超时：' + expression)
  }
  const setInput = (label: string, value: string) =>
    win.webContents.executeJavaScript(
      `(() => {const input = document.querySelector(${JSON.stringify(`input[aria-label="${label}"]`)}) || document.querySelector(${JSON.stringify(`textarea[aria-label="${label}"]`)}); if(!input) throw Error('input missing'); input.value=${JSON.stringify(value)}; input.dispatchEvent(new Event('input',{bubbles:true}));})()`,
    )
  let storeA = '',
    storeB = '',
    oldWorkspace = '',
    productId = ''
  const calls: Record<string, unknown>[] = []
  const server = createServer(async (request, response) => {
    let body = ''
    for await (const chunk of request) {
      body += chunk
      if (body.length > 150000) {
        response.writeHead(413)
        response.end()
        return
      }
    }
    const parsedBody = JSON.parse(body) as Record<string, unknown>
    calls.push(parsedBody)
    response.setHeader('content-type', 'application/json')
    response.end(
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify(parsedBody.messages).includes('[上下文压缩]')
                ? '历史记录摘要：买家咨询商品，尚未新增任何售后承诺。'
                : JSON.stringify({ reply: '本机模型夹具回复' }),
            },
          },
        ],
      }),
    )
  })
  try {
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    assert.ok(address && typeof address !== 'string')
    const baseUrl = `http://127.0.0.1:${address.port}/v1`
    await check('business:runtime-log-controls', '/logs', async () => {
      await load('/logs')
      const evaluate = (script: string) => win.webContents.executeJavaScript(script)
      const originalPinned = win.isAlwaysOnTop(),
        originalBounds = win.getBounds()
      await wait("Boolean(document.querySelector('.logs-header'))")
      await wait(
        "[...document.querySelectorAll('.logs-header button')].some(b => !b.disabled && (b.textContent.trim() === '置顶' || b.textContent.trim() === '取消置顶'))",
      )
      assert.equal(
        await evaluate("getComputedStyle(document.querySelector('.logs-header')).webkitAppRegion"),
        'drag',
      )
      assert.equal(
        await evaluate(
          "getComputedStyle(document.querySelector('.logs-header .runtime-actions')).webkitAppRegion",
        ),
        'no-drag',
      )
      const clickPin = () =>
        evaluate(
          "[...document.querySelectorAll('.logs-header button')].find(b=>b.textContent.trim()==='置顶'||b.textContent.trim()==='取消置顶').click()",
        )
      try {
        await clickPin()
        for (let i = 0; i < 50 && win.isAlwaysOnTop() === originalPinned; i++)
          await new Promise((r) => setTimeout(r, 20))
        assert.equal(win.isAlwaysOnTop(), !originalPinned)
        await wait(
          `document.querySelector('.logs-header [aria-pressed]').getAttribute('aria-pressed')===${JSON.stringify(String(!originalPinned))}`,
        )
        await clickPin()
        for (let i = 0; i < 50 && win.isAlwaysOnTop() !== originalPinned; i++)
          await new Promise((r) => setTimeout(r, 20))
        assert.equal(win.isAlwaysOnTop(), originalPinned)
        await wait(
          "![...document.querySelectorAll('.logs-header button')].find(b=>b.textContent.trim()==='清除日志').disabled",
        )
        await evaluate(
          "[...document.querySelectorAll('.logs-header button')].find(b=>b.textContent.trim()==='清除日志').click()",
        )
        await wait("document.body.innerText.includes('已清除')")
        assert.equal((await snapshot()).review.logs.length, 0)
        if (process.platform === 'win32' && process.env.LINGTU_NATIVE_LOG_DRAG === '1') {
          if (win.isMaximized()) win.unmaximize()
          win.setBounds({ x: 80, y: 80, width: 1200, height: 800 })
          win.setAlwaysOnTop(true)
          win.show()
          win.focus()
          await new Promise((r) => setTimeout(r, 500))
          const before = win.getPosition()
          const handle = win.getNativeWindowHandle().readUInt32LE(0).toString()
          await new Promise<void>((resolve, reject) =>
            execFile(
              'python',
              [
                '-c',
                'from pywinauto import Desktop; import sys,win32gui; w=Desktop(backend="win32").window(handle=int(sys.argv[1])).wrapper_object(); w.set_focus(); win32gui.SetWindowPos(w.handle,-1,0,0,0,0,0x43); w.drag_mouse_input(src=(500,35),dst=(580,95),absolute=False)',
                handle,
              ],
              { timeout: 20000, windowsHide: true },
              (error) => (error ? reject(error) : resolve()),
            ),
          )
          const after = win.getPosition()
          assert(
            Math.abs(after[0] - before[0]) >= 40 && Math.abs(after[1] - before[1]) >= 30,
            `native titlebar drag did not move the actual window: ${before} -> ${after}`,
          )
        }
        fs.mkdirSync(path.resolve('artifacts/runtime-log-controls'), { recursive: true })
        fs.writeFileSync(
          path.resolve('artifacts/runtime-log-controls/native.png'),
          (await win.webContents.capturePage()).toPNG(),
        )
      } finally {
        win.setAlwaysOnTop(originalPinned)
        win.setBounds(originalBounds)
      }
    })
    await check('business:ui-add-store', '/', async () => {
      await load('/')
      await win.webContents.executeJavaScript(
        `document.querySelector('[aria-label="添加店铺"]').click()`,
      )
      await wait(`Boolean(document.querySelector('[aria-label="本机模拟店铺入口"]'))`)
      await win.webContents.executeJavaScript(
        `document.querySelector('[aria-label="本机模拟店铺入口"]').click()`,
      )
      await wait(`Boolean(document.querySelector('input[aria-label="店铺名称"]'))`)
      await setInput('店铺名称', '隔离测试甲店')
      await win.webContents.executeJavaScript(
        `document.querySelector('.el-dialog form button[type="submit"]').click()`,
      )
      await wait(
        `!Array.from(document.querySelectorAll('.add-platform-dialog')).some(el => el.getBoundingClientRect().width && el.getBoundingClientRect().height)`,
      )
      await wait(`Boolean(document.querySelector('.shop-setup-page'))`)
      const bounds = await win.webContents.executeJavaScript(`(() => {
        const rect = document.querySelector('.shop-setup-page').getBoundingClientRect()
        return {x:rect.x,y:rect.y,right:rect.right,bottom:rect.bottom,width:innerWidth,height:innerHeight,
          sidebarActive:!document.querySelector('.store-sidebar').closest('[inert]'),
          headerActive:!document.querySelector('.workbench-titlebar').closest('[inert]')}
      })()`)
      assert.equal(bounds.x, 300, '引导应保留左侧店铺栏')
      assert.equal(bounds.y, 72, '引导应保留顶部导航')
      assert.equal(bounds.right, bounds.width)
      assert.equal(bounds.bottom, bounds.height)
      assert.equal(bounds.sidebarActive, true)
      assert.equal(bounds.headerActive, true)
      await win.webContents.executeJavaScript(
        `document.querySelector('.shop-setup-page [data-dismiss]').click()`,
      )
      await wait(`!document.querySelector('.shop-setup-page')`)
      const s = await snapshot()
      assert.equal(s.stores.length, 1)
      assert.equal(s.stores[0].platform, 'sim-local')
      assert.equal(s.stores[0].runtime.open, false)
      // 界面回归使用本机模拟，真实平台只建记录，不访问平台登录网站。
      await execute({
        action: 'remove-store',
        storeId: s.stores[0].id,
        values: { confirmed: true },
      })
      storeA = String(
        (
          await execute({
            action: 'add-store',
            values: { platform: 'pdd-web', storeName: '隔离测试甲店' },
          })
        ).data.id,
      )
      oldWorkspace = s.workspaceId
      assert.equal(s.stores[0].aiEnabled, false)
      storeB = String(
        (
          await execute({
            action: 'add-store',
            values: { platform: 'pdd-web', storeName: '隔离测试乙店' },
          })
        ).data.id,
      )
    })
    await check('business:ui-product-save', '/shop/manage', async () => {
      assert.ok(storeA)
      await execute({ action: 'select-store', storeId: storeA })
      await load('/shop/manage?panel=goods')
      await wait(
        `Array.from(document.querySelectorAll('button')).some(b=>b.textContent.trim()==='新增商品知识'&&!b.disabled)`,
      )
      await win.webContents.executeJavaScript(
        `Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()==='新增商品知识').click()`,
      )
      await wait(`Boolean(document.querySelector('input[aria-label="商品名称"]'))`)
      await setInput('商品编号', 'fixture-sku')
      await setInput('商品名称', '隔离测试门锁')
      await setInput('商品说明', '仅甲店知识 NFC 识别资料')
      await win.webContents.executeJavaScript(
        `document.querySelector('.el-dialog form button[type="submit"]').click()`,
      )
      await wait(
        `document.body.innerText.includes('隔离测试门锁') && document.querySelectorAll('.el-overlay:not([style*="display: none"])').length === 0`,
      )
      const result = await execute({
        action: 'list-products',
        storeId: storeA,
        values: { offset: 0, limit: 20 },
      })
      const items = result.data.items as { id: string; version: number }[]
      assert.equal(items.length, 1)
      productId = items[0].id
      assert.equal((await execute({ action: 'list-products', storeId: storeB })).data.total, 0)
      await assert.rejects(
        execute({
          action: 'remove-product',
          storeId: storeB,
          values: { id: productId, version: items[0].version, confirmed: true },
        }),
      )
    })
    await check('business:csv-preview-and-conflict', '/shop/manage', async () => {
      const csv = 'productId,title,description\nfixture-csv,CSV测试,仅用于隔离测试'
      const preview = await execute({
        action: 'preview-product-import',
        storeId: storeA,
        values: { csv },
      })
      assert.equal((await execute({ action: 'list-products', storeId: storeA })).data.total, 1)
      await execute({
        action: 'import-products',
        storeId: storeA,
        values: { csv, revision: preview.data.revision, mode: 'skip', confirmed: true },
      })
      await assert.rejects(
        execute({
          action: 'import-products',
          storeId: storeA,
          values: { csv, revision: preview.data.revision, mode: 'replace', confirmed: true },
        }),
      )
      assert.equal((await execute({ action: 'list-products', storeId: storeA })).data.total, 2)
    })
    await check('business:model-settings-and-training', '/settings', async () => {
      // 自定义本机HTTP夹具直接走正式配置命令；生产登录入口仅提供厂商预设。
      await execute({
        action: 'save-model-settings',
        values: {
          baseUrl,
          model: 'fixture-custom-multimodal',
          apiKey: safeStorage.isEncryptionAvailable() ? 'fixture-only-not-a-provider-key' : '',
          testConnection: true,
        },
      })
      assert.ok(calls.length >= 1)
      const s = await snapshot()
      assert.equal(s.config.ai.baseUrl, baseUrl)
      assert.equal(s.capabilities.vision.supported, true)
      assert.equal(s.capabilities.vision.model, 'fixture-custom-multimodal')
      assert.equal(s.capabilities.modelMode, 'local')
      assert.ok(!JSON.stringify(s).includes('fixture-only-not-a-provider-key'))
      if (safeStorage.isEncryptionAvailable())
        assert.ok(
          !fs
            .readFileSync(path.join(dataDir, 'secrets.json'), 'utf8')
            .includes('fixture-only-not-a-provider-key'),
        )
      // A legacy save is a draft. Exercise explicit review before expecting it in real model context.
      const products = (await options.knowledge({
        workspaceId: s.workspaceId,
        operation: 'query',
        query: { type: 'products', page: { storeId: storeA } },
      })) as KnowledgePage<KnowledgeProductCard>
      const product = products.items.find((item) => item.binding.productId === 'fixture-sku')
      assert.ok(product)
      const detail = (await options.knowledge({
        workspaceId: s.workspaceId,
        operation: 'query',
        query: { type: 'detail', canonicalId: product.canonical.id, storeId: storeA },
      })) as KnowledgeDetail
      const draft = detail.entries.find((entry) => entry.draft.answer.includes('仅甲店知识'))?.draft
      assert.ok(draft)
      const beforeReview = calls.length
      await assert.rejects(
        execute({
          action: 'start-training',
          storeId: storeA,
          values: { question: '门锁支持 NFC 吗', productId: 'fixture-sku', history: [] },
        }),
        /已启用的有效商品/,
      )
      assert.equal(calls.length, beforeReview, '未审核商品不能发起模型调用')
      await options.knowledge({
        workspaceId: s.workspaceId,
        operation: 'command',
        command: {
          type: 'publish',
          review: {
            entryId: draft.id,
            expectedDraftRevision: draft.revision,
            expectedSourceRevisions: Object.fromEntries(
              draft.sourceRefs.map((ref) => [ref.sourceId, ref.revision]),
            ),
          },
        },
      })
      const training = await execute({
        action: 'start-training',
        storeId: storeA,
        values: { question: '门锁支持 NFC 吗', productId: 'fixture-sku', history: [] },
      })
      assert.equal(training.data.reply, '本机模型夹具回复')
      assert.ok(JSON.stringify(calls.at(-1)).includes('仅甲店知识'))
      const debug = (await snapshot()).review.traces.at(-1)
      assert.ok(debug)
      assert.ok(debug.messages.includes('仅甲店知识'))
      assert.ok(debug.messages.includes('最近对话'))
      assert.equal(debug.model, 'fixture-custom-multimodal')
      assert.equal(debug.reply, '本机模型夹具回复')
      assert.ok(typeof debug.durationMs === 'number' && debug.durationMs >= 0)
      assert.equal(typeof debug.startedAt, 'number')
      assert.equal(typeof debug.completedAt, 'number')
      assert.ok(
        !JSON.stringify((await snapshot()).review).includes('fixture-only-not-a-provider-key'),
      )
    })
    await check('business:reply-pacing-settings', '/', async () => {
      // 单独选择本用例时前面的路由检查不会加载文档；先装载应用页面，preload 快照才可用。
      await load('/')
      const initialStores = await snapshot()
      if (!initialStores.stores.length) {
        await execute({
          action: 'add-store',
          values: { platform: 'sim-local', storeName: '间隔验证店' },
        })
      }
      await load('/shop/manage?panel=shops')
      await wait(`Boolean(document.querySelector('[data-action="basic-settings"]'))`)
      await win.webContents.executeJavaScript(
        `document.querySelector('[data-action="basic-settings"]').click()`,
      )
      await wait(`Boolean(document.querySelector('button.wizard-step:not(:disabled)'))`)
      await win.webContents.executeJavaScript(
        `document.querySelectorAll('button.wizard-step')[1].click()`,
      )
      await wait(`Boolean(document.querySelector('.reply-pacing .el-select'))`)
      const footer = await win.webContents.executeJavaScript(
        `document.querySelector('.sidebar-footer').innerText`,
      )
      assert.match(footer, /快捷回复/)
      assert.doesNotMatch(footer, /设置|定时任务/)
      // 桌面检查可能在同一数据目录重复运行，先把节奏显式恢复为默认随机模式。
      const before = (await snapshot()).config.reply.pacing
      await execute({
        action: 'save-config',
        screenId: 'REPLY_PACING',
        values: {
          mode: 'random-1-3',
          customMinSeconds: before.customMinSeconds,
          customMaxSeconds: before.customMaxSeconds,
          expected: before,
        },
      })
      const initialPacing = (await snapshot()).config.reply.pacing
      assert.equal(initialPacing.mode, 'random-1-3')
      assert.equal(initialPacing.customMinSeconds, 1)
      assert.equal(initialPacing.customMaxSeconds, 3)
      assert.match(
        await win.webContents.executeJavaScript(
          `document.querySelector('.reply-pacing .pacing-current').textContent`,
        ),
        /1～3 秒随机/,
      )
      assert.equal(
        await win.webContents.executeJavaScript(
          `Boolean(document.querySelector('[aria-label="随机间隔下限（秒）"]'))`,
        ),
        false,
      )
      // 旧版固定秒数只保留审计：设置页保存新节奏不得改写它。
      const legacyInterval = (await snapshot()).config.reply.perUidMinIntervalMs
      await execute({
        action: 'save-config',
        screenId: 'REPLY_PACING',
        values: {
          mode: 'custom',
          customMinSeconds: 5,
          customMaxSeconds: 9,
          expected: initialPacing,
        },
      })
      await wait(
        `document.querySelector('.reply-pacing .pacing-current').textContent.includes('5～9 秒随机')`,
      )
      await wait(`Boolean(document.querySelector('[aria-label="随机间隔下限（秒）"]'))`)
      assert.equal((await snapshot()).config.reply.perUidMinIntervalMs, legacyInterval)
      const savedPacing = (await snapshot()).config.reply.pacing
      await assert.rejects(
        execute({
          action: 'save-config',
          screenId: 'REPLY_PACING',
          values: {
            mode: 'custom',
            customMinSeconds: 9,
            customMaxSeconds: 5,
            expected: savedPacing,
          },
        }),
      )
      await assert.rejects(
        execute({
          action: 'save-config',
          screenId: 'REPLY_PACING',
          values: {
            mode: 'custom',
            customMinSeconds: 1,
            customMaxSeconds: 3601,
            expected: savedPacing,
          },
        }),
      )
      fs.mkdirSync(path.resolve('artifacts/desktop'), { recursive: true })
      fs.writeFileSync(
        path.resolve('artifacts/desktop/reply-pacing-settings.png'),
        (await win.webContents.capturePage()).toPNG(),
      )
      await win.webContents.executeJavaScript(`document.querySelector('[data-dismiss]').click()`)
    })
    await check('business:setup-reception-migration', '/', async () => {
      const previousStoreId = (await snapshot()).selection.storeId
      const fixture = await execute({
        action: 'add-store',
        values: { platform: 'sim-local', storeName: '接待迁移验证店' },
      })
      const storeId = String(fixture.data.id)
      try {
        await execute({ action: 'select-store', storeId })
        await load('/shop/manage?panel=shops')
        await wait(`Boolean(document.querySelector('[data-action="basic-settings"]'))`)
        await win.webContents.executeJavaScript(
          `document.querySelector(${JSON.stringify(`.shop-card[data-store="${storeId}"] [data-action="basic-settings"]`)}).click()`,
        )
        await wait(`Boolean(document.querySelector('button.wizard-step:not(:disabled)'))`)
        const labels = await win.webContents.executeJavaScript(
          `Array.from(document.querySelectorAll('.wizard-step')).map(el => el.innerText)`,
        )
        assert.equal(labels.length, 6)
        assert.match(labels[2], /物流与发货政策/)
        assert.match(labels[3], /接待设置/)
        await win.webContents.executeJavaScript(
          `document.querySelectorAll('.wizard-step')[2].click()`,
        )
        await wait(`Boolean(document.querySelector('[aria-label="发货时效"]'))`)
        for (const label of ['发货地', '常用快递', '支持指定快递', '提供运费险', '其他发货说明'])
          assert.equal(
            await win.webContents.executeJavaScript(
              `Boolean(document.querySelector('[aria-label="${label}"]'))`,
            ),
            true,
          )
        await win.webContents.executeJavaScript(
          `document.querySelectorAll('.wizard-step')[3].click()`,
        )
        await wait(`Boolean(document.querySelector('textarea[aria-label="文字欢迎语"]'))`)
        assert.equal(
          await win.webContents.executeJavaScript(
            `document.querySelectorAll('.reception-settings .runtime-page').length`,
          ),
          2,
        )
        assert.equal(
          await win.webContents.executeJavaScript(
            `document.querySelectorAll('.reception-settings .runtime-store-select').length`,
          ),
          0,
        )
        await setInput('文字欢迎语', '隔离接待欢迎语')
        await win.webContents.executeJavaScript(`document.querySelector('[data-next]').click()`)
        await wait(`Boolean(document.querySelector('[data-save]'))`)
        await win.webContents.executeJavaScript(`document.querySelector('[data-back]').click()`)
        await wait(`Boolean(document.querySelector('textarea[aria-label="文字欢迎语"]'))`)
        assert.equal(
          await win.webContents.executeJavaScript(
            `document.querySelector('textarea[aria-label="文字欢迎语"]').value`,
          ),
          '隔离接待欢迎语',
        )
        await win.webContents.executeJavaScript(
          `document.querySelectorAll('.reception-settings .runtime-form')[0].requestSubmit()`,
        )
        await wait(`!document.querySelector('[data-next]').disabled`)
        await win.webContents.executeJavaScript(
          `document.querySelectorAll('.reception-settings .runtime-page')[1].querySelector('.runtime-form').requestSubmit()`,
        )
        await wait(
          `!document.querySelector('[data-next]').disabled && document.querySelector('.reception-settings').innerText.includes('已保存')`,
        )
        assert.equal((await snapshot()).welcomeByStore[storeId]?.text, '隔离接待欢迎语')
        fs.mkdirSync(path.resolve('artifacts/desktop'), { recursive: true })
        fs.writeFileSync(
          path.resolve('artifacts/desktop/setup-reception-migration.png'),
          (await win.webContents.capturePage()).toPNG(),
        )
        await win.webContents.executeJavaScript(`document.querySelector('[data-dismiss]').click()`)
        await wait(`!document.querySelector('.shop-setup-page')`)
        await load('/shop/manage?panel=shops')
        assert.equal(
          await win.webContents.executeJavaScript(
            `Array.from(document.querySelectorAll('.sider__nav button')).some(el => ['转接人工','进店欢迎'].includes(el.textContent.trim()))`,
          ),
          false,
        )
      } finally {
        // Reception saves increment per-store revisions; isolate those writes
        // from the business fixtures whose original revisions are tested later.
        await execute({ action: 'remove-store', storeId, values: { confirmed: true } })
        const after = await snapshot()
        assert.ok(!after.stores.some((store) => store.id === storeId))
        if (previousStoreId && after.stores.some((store) => store.id === previousStoreId)) {
          await execute({ action: 'select-store', storeId: previousStoreId })
        }
      }
    })
    await check('business:shop-setup-reuse', '/', async () => {
      const log = (step: string) => console.log(`[shop-setup-reuse] ${step}`)
      await load('/')
      const previousStoreId = (await snapshot()).selection.storeId
      const created: string[] = []
      const clickText = (selector: string, text: string) =>
        win.webContents.executeJavaScript(
          `(() => {const node=Array.from(document.querySelectorAll(${JSON.stringify(selector)})).find(el=>el.textContent.trim()===${JSON.stringify(text)}); if(!node) throw Error('缺少可点击项：'+${JSON.stringify(text)}); node.click()})()`,
        )
      const chooseSelect = async (label: string, option: string) => {
        await win.webContents.executeJavaScript(
          `(() => {const field=document.querySelector(${JSON.stringify(`[aria-label="${label}"]`)}); const root=field?.closest('.el-select'); if(!root) throw Error('缺少下拉框：'+${JSON.stringify(label)}); root.querySelector('.el-select__wrapper').click()})()`,
        )
        await wait(
          `Array.from(document.querySelectorAll('.el-select-dropdown__item')).some(node => node.textContent.trim()===${JSON.stringify(option)})`,
        )
        await clickText('.el-select-dropdown__item', option)
      }
      const chooseRadio = (label: string, text: string) =>
        win.webContents.executeJavaScript(
          `(() => {const group=document.querySelector(${JSON.stringify(`[aria-label="${label}"]`)}); if(!group) throw Error('缺少选项组：'+${JSON.stringify(label)}); const node=Array.from(group.querySelectorAll('.el-radio')).find(el=>el.textContent.trim()===${JSON.stringify(text)}); if(!node) throw Error('缺少选项：'+${JSON.stringify(text)}); node.click()})()`,
        )
      try {
        const source = String(
          (
            await execute({
              action: 'add-store',
              values: { platform: 'pdd-web', storeName: '复用来源测试店' },
            })
          ).data.id,
        )
        const target = String(
          (
            await execute({
              action: 'add-store',
              values: { platform: 'sim-local', storeName: '复用目标测试店' },
            })
          ).data.id,
        )
        created.push(source, target)
        log('stores-created')
        // 目标店先有独立欢迎和自定义转人工，验证导入后统一保存与继承状态。
        await execute({
          action: 'save-welcome',
          storeId: target,
          values: { text: '目标原欢迎', enabled: true, version: 0 },
        })
        await execute({
          action: 'save-store-handoff',
          storeId: target,
          values: { mode: 'custom', keywords: ['目标人工'] },
        })
        await execute({
          action: 'save-welcome',
          storeId: source,
          values: { text: '来源欢迎语', enabled: true, version: 0 },
        })

        // 通过真实向导配置来源店：风格、物流并最终统一保存。
        log('source-welcome-saved')
        await load('/shop/manage?panel=shops')
        await wait(
          `Boolean(document.querySelector(${JSON.stringify(`.shop-card[data-store="${source}"] [data-action="basic-settings"]`)}))`,
        )
        await win.webContents.executeJavaScript(
          `document.querySelector(${JSON.stringify(`.shop-card[data-store="${source}"] [data-action="basic-settings"]`)}).click()`,
        )
        log('source-wizard-open')
        await wait(`Boolean(document.querySelector('button.wizard-step:not(:disabled)'))`)
        await win.webContents.executeJavaScript(
          `document.querySelectorAll('.wizard-step')[1].click()`,
        )
        await wait(`Boolean(document.querySelector('[data-style="cool"]'))`)
        await win.webContents.executeJavaScript(
          `document.querySelector('[data-style="cool"]').click()`,
        )
        await win.webContents.executeJavaScript(
          `document.querySelectorAll('.wizard-step')[2].click()`,
        )
        await wait(`Boolean(document.querySelector('[aria-label="发货地"]'))`)
        await chooseSelect('发货地', '浙江')
        await chooseSelect('常用快递', '顺丰速运')
        await chooseRadio('支持指定快递', '否')
        await chooseRadio('发货时效', '24小时内')
        await chooseRadio('提供运费险', '否')
        await win.webContents.executeJavaScript(
          `document.querySelectorAll('.wizard-step')[4].click()`,
        )
        await wait(`Boolean(document.querySelector('[data-save]'))`)
        log('source-save-click')
        await win.webContents.executeJavaScript(`document.querySelector('[data-save]').click()`)
        await wait(`document.body.innerText.includes('设置完成')`)
        await win.webContents.executeJavaScript(`document.querySelector('[data-dismiss]').click()`)
        await wait(`!document.querySelector('.shop-setup-page')`)
        log('source-saved')
        const sourceBefore = await snapshot()
        const profilesBefore = await execute({ action: 'list-model-profiles' })
        const sourceProfileId = (profilesBefore.data.bindings as Record<string, string>)[source]
        assert.ok(sourceProfileId)
        const sourcePrompt = (
          profilesBefore.data.profiles as { id: string; prompt: string }[]
        ).find((row) => row.id === sourceProfileId)?.prompt
        assert.ok(sourcePrompt)

        // 目标店打开复用弹窗，跨平台提醒、来源名称与四类默认全选。
        log('target-wizard-click')
        await load('/shop/manage?panel=shops')
        await wait(
          `Boolean(document.querySelector(${JSON.stringify(`.shop-card[data-store="${target}"] [data-action="basic-settings"]`)}))`,
        )
        await win.webContents.executeJavaScript(
          `document.querySelector(${JSON.stringify(`.shop-card[data-store="${target}"] [data-action="basic-settings"]`)}).click()`,
        )
        await wait(`Boolean(document.querySelector('.shop-setup-page'))`)
        // 店铺列表“基础设置”直接进入第 2 步，复用入口在引导首页。
        await win.webContents.executeJavaScript(
          `document.querySelectorAll('.wizard-step')[0].click()`,
        )
        await wait(`Boolean(document.querySelector('[data-reuse-open]'))`)
        await win.webContents.executeJavaScript(
          `document.querySelector('[data-reuse-open]').click()`,
        )
        await wait(`Boolean(document.querySelector('.reuse-dialog'))`)
        log('reuse-dialog-open')
        assert.equal(
          await win.webContents.executeJavaScript(
            `document.querySelectorAll('.reuse-options .el-checkbox').length`,
          ),
          4,
        )
        await win.webContents.executeJavaScript(
          `document.querySelector('[data-reuse-source] .el-select__wrapper').click()`,
        )
        await wait(
          `Array.from(document.querySelectorAll('.el-select-dropdown__item')).some(node => node.textContent.trim().includes('复用来源测试店'))`,
        )
        await win.webContents.executeJavaScript(
          `(() => {const node=Array.from(document.querySelectorAll('.el-select-dropdown__item')).find(el=>el.textContent.trim().includes('复用来源测试店')); if(!node) throw Error('缺少来源选项'); node.click()})()`,
        )
        log('reuse-source-clicked')
        await wait(`Boolean(document.querySelector('[data-reuse-source-name]'))`)
        fs.mkdirSync(path.resolve('artifacts/desktop'), { recursive: true })
        fs.writeFileSync(
          path.resolve('artifacts/desktop/shop-setup-reuse-dialog.png'),
          (await win.webContents.capturePage()).toPNG(),
        )
        assert.equal(
          await win.webContents.executeJavaScript(
            `document.querySelector('.reuse-dialog').innerText.includes('平台不同')`,
          ),
          true,
        )
        await win.webContents.executeJavaScript(
          `document.querySelector('[data-reuse-apply]').click()`,
        )
        // 目标店规则若已有全局提示词，则需用户明确确认替换。
        if (
          await win.webContents.executeJavaScript(
            `Boolean(document.querySelector('.reuse-dialog [data-reuse-confirm]'))`,
          )
        ) {
          await win.webContents.executeJavaScript(
            `document.querySelector('.reuse-dialog [data-reuse-confirm]').click()`,
          )
          await win.webContents.executeJavaScript(
            `document.querySelector('[data-reuse-apply]').click()`,
          )
        }
        await wait(`!document.querySelector('.reuse-dialog')`)
        log('reuse-applied')
        await wait(`Boolean(document.querySelector('[data-style="cool"]'))`)
        assert.equal(
          await win.webContents.executeJavaScript(
            `document.querySelector('[data-style="cool"]').getAttribute('aria-checked')`,
          ),
          'true',
        )
        await win.webContents.executeJavaScript(
          `document.querySelectorAll('.wizard-step')[3].click()`,
        )
        await wait(`Boolean(document.querySelector('textarea[aria-label="文字欢迎语"]'))`)
        log('target-step3')
        assert.equal(
          await win.webContents.executeJavaScript(
            `document.querySelector('textarea[aria-label="文字欢迎语"]').value`,
          ),
          '来源欢迎语',
        )
        assert.equal(
          await win.webContents.executeJavaScript(
            `document.querySelectorAll('.reception-settings .reception-deferred').length`,
          ),
          2,
        )
        assert.equal(
          await win.webContents.executeJavaScript(
            `Array.from(document.querySelectorAll('.reception-settings .runtime-page'))[1].querySelectorAll('button').length>0 && Array.from(Array.from(document.querySelectorAll('.reception-settings .runtime-page'))[1].querySelectorAll('button')).some(b=>b.textContent.trim()==='保存配置')`,
          ),
          false,
        )
        await setInput('文字欢迎语', '复用后欢迎语')
        log('target-welcome-edited')
        await win.webContents.executeJavaScript(
          `document.querySelectorAll('.wizard-step')[4].click()`,
        )
        await wait(`Boolean(document.querySelector('[data-save]'))`)
        log('target-save-click')
        const previousWelcome = (await snapshot()).welcomeByStore[target]!
        await execute({
          action: 'save-welcome',
          storeId: target,
          values: { ...previousWelcome, text: '其他入口更新的欢迎语' },
        })
        await new Promise((resolve) => setTimeout(resolve, 200))
        await win.webContents.executeJavaScript(`document.querySelector('[data-save]').click()`)
        await wait(`Boolean(document.querySelector('[data-reuse-refresh-baseline]'))`)
        await win.webContents.executeJavaScript(
          `document.querySelector('[data-reuse-refresh-baseline]').click()`,
        )
        await wait(`Boolean(document.querySelector('.el-message-box'))`)
        await new Promise((resolve) => setTimeout(resolve, 250))
        fs.writeFileSync(
          path.resolve('artifacts/desktop/shop-setup-reuse-conflict.png'),
          (await win.webContents.capturePage()).toPNG(),
        )
        console.log(
          'confirmation-layer',
          await win.webContents.executeJavaScript(
            `(() => {const dialog=document.querySelector('.el-message-box');const r=dialog.getBoundingClientRect();return JSON.stringify({rect:r.toJSON(),overlay:document.querySelector('.el-overlay-message-box')?.parentElement?.outerHTML.slice(0,240),hit:document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.outerHTML.slice(0,240)})})()`,
          ),
        )
        assert.equal(
          await win.webContents.executeJavaScript(
            `(() => {const dialog=document.querySelector('.el-message-box');const r=dialog.getBoundingClientRect();return Boolean(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.closest('.el-message-box'))})()`,
          ),
          true,
          '冲突确认框必须显示在店铺向导上方并可点击',
        )
        const cancel = `document.querySelector('.el-message-box__btns button').click()`
        await win.webContents.executeJavaScript(cancel)
        await wait(`!document.querySelector('.el-message-box')`)
        assert.equal((await snapshot()).welcomeByStore[target]?.text, '其他入口更新的欢迎语')
        await win.webContents.executeJavaScript(
          `document.querySelector('[data-reuse-refresh-baseline]').click()`,
        )
        await wait(`Boolean(document.querySelector('.el-message-box'))`)
        await win.webContents.executeJavaScript(
          `Array.from(document.querySelectorAll('.el-message-box__btns button')).at(-1).click()`,
        )
        await wait(`document.body.innerText.includes('设置完成')`)

        const after = await snapshot()
        assert.equal(after.welcomeByStore[target]?.text, '复用后欢迎语')
        assert.equal(after.welcomeByStore[target]?.enabled, true)
        assert.equal(after.welcomeByStore[target]?.version, 3)
        assert.equal(after.handoffByStore[target], undefined)
        assert.deepEqual(after.welcomeByStore[source], sourceBefore.welcomeByStore[source])
        assert.deepEqual(after.handoffByStore[source], sourceBefore.handoffByStore[source])
        const profilesAfter = await execute({ action: 'list-model-profiles' })
        assert.equal(
          (profilesAfter.data.profiles as { id: string; prompt: string }[]).find(
            (row) => row.id === sourceProfileId,
          )?.prompt,
          sourcePrompt,
        )
        const targetProfileId = (profilesAfter.data.bindings as Record<string, string>)[target]
        assert.ok(targetProfileId)
        const targetPrompt = (profilesAfter.data.profiles as { id: string; prompt: string }[]).find(
          (row) => row.id === targetProfileId,
        )?.prompt
        assert.ok(targetPrompt)
        assert.ok(targetPrompt.includes('浙江'))
        assert.ok(targetPrompt.includes('24小时内'))
        assert.ok(after.stores.every((store) => !store.aiEnabled))
        fs.mkdirSync(path.resolve('artifacts/desktop'), { recursive: true })
        fs.writeFileSync(
          path.resolve('artifacts/desktop/shop-setup-reuse.png'),
          (await win.webContents.capturePage()).toPNG(),
        )
      } finally {
        await win.webContents.executeJavaScript(
          `document.querySelector('.shop-setup-page [data-dismiss]')?.click()`,
        )
        for (const storeId of created)
          await execute({ action: 'remove-store', storeId, values: { confirmed: true } })
        const after = await snapshot()
        assert.ok(created.every((storeId) => !after.stores.some((store) => store.id === storeId)))
        if (previousStoreId && after.stores.some((store) => store.id === previousStoreId)) {
          await execute({ action: 'select-store', storeId: previousStoreId })
        }
      }
    })
    await check('business:context-compression-16k-to-8k', '/logs', async () => {
      const before = calls.length
      await execute({
        action: 'start-training',
        storeId: storeA,
        values: {
          question: '上下文压缩测试最后诉求',
          history: Array.from({ length: 16 }, (_, i) => ({
            from: i % 2 ? 'seller' : 'buyer',
            content: i < 12 ? '订单资料与未解决事项记录。'.repeat(110) : `最近原文${i}`,
          })),
        },
      })
      assert.equal(calls.length - before, 2, '应依次调用摘要与最终回复')
      const wire = modelMessagesSchema.parse(calls.at(-1)?.messages)
      assert.ok(estimateContextTokens(wire) <= 8192)
      assert.ok(JSON.stringify(wire).includes('上下文压缩测试最后诉求'))
      const traces = (await snapshot()).review.traces
      const final = traces.at(-1)
      assert.equal(final?.compression?.triggered, true)
      assert.ok((final?.compression?.beforeTokens || 0) >= 16384)
      assert.ok((final?.compression?.afterTokens || Infinity) <= 8192)
      assert.ok(traces.some((t) => t.purpose === 'compression'))
      await load('/logs')
      await win.webContents.executeJavaScript(
        `Array.from(document.querySelectorAll('[role="tab"]')).find(n=>n.textContent.includes('AI 上下文调试')).click()`,
      )
      await wait(
        `Array.from(document.querySelectorAll('[role="tab"]')).some(n=>n.textContent.includes('AI 上下文调试')&&n.getAttribute('aria-selected')==='true') && document.body.innerText.includes('已压缩')`,
      )
      assert.equal(
        await win.webContents.executeJavaScript(
          `document.querySelector('.trace-timing').textContent.includes('AI 回复耗时')`,
        ),
        true,
      )
      await win.webContents.executeJavaScript(
        `new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`,
      )
      const shot = await win.webContents.capturePage()
      fs.writeFileSync(path.resolve('artifacts/desktop/context-compression.png'), shot.toPNG())
    })
    await check('business:logs-floating-window', '/', async () => {
      await load('/')
      await win.webContents.executeJavaScript(
        `document.querySelector('[aria-label="回复监控"]').click()`,
      )
      let monitor: BrowserWindow | undefined
      for (let i = 0; i < 400; i++) {
        monitor = BrowserWindow.getAllWindows().find(
          (w) => w !== win && w.webContents.getURL().endsWith('#/reply-monitor'),
        )
        if (
          monitor &&
          !monitor.webContents.isLoading() &&
          (await monitor.webContents.executeJavaScript(
            `Boolean(document.querySelector('[data-action="logs"]'))`,
          ))
        )
          break
        await new Promise((resolve) => setTimeout(resolve, 50))
      }
      assert.ok(monitor, '回复监控没有创建')
      await monitor.webContents.executeJavaScript(
        `document.querySelector('[data-action="logs"]').click()`,
      )
      let popup: BrowserWindow | undefined
      for (let i = 0; i < 400; i++) {
        popup = BrowserWindow.getAllWindows().find(
          (w) => w !== win && w.webContents.getURL().includes('/logs'),
        )
        if (popup && !popup.webContents.isLoading()) break
        await new Promise((resolve) => setTimeout(resolve, 50))
      }
      assert.ok(popup, '日志悬浮窗没有创建')
      try {
        // Windows 隐藏窗口的置顶状态可能尚未生效；等 ready-to-show 的显示过程完成再验收。
        for (let i = 0; i < 400; i++) {
          if (popup.isVisible() && popup.isAlwaysOnTop()) break
          await new Promise((resolve) => setTimeout(resolve, 50))
        }
        if (!popup.isVisible() || !popup.isAlwaysOnTop()) {
          fs.writeFileSync(
            path.resolve('artifacts/desktop/logs-floating-not-top.png'),
            (await popup.capturePage()).toPNG(),
          )
        }
        assert.equal(popup.isVisible(), true, '日志悬浮窗应在20秒内显示')
        assert.equal(popup.isAlwaysOnTop(), true, '日志悬浮窗必须保持置顶')
        for (let i = 0; i < 400; i++) {
          if (
            await popup.webContents.executeJavaScript(
              `document.body.innerText.includes('AI 发送确认')`,
            )
          )
            break
          await new Promise((resolve) => setTimeout(resolve, 50))
        }
        assert.equal(
          await popup.webContents.executeJavaScript(
            `document.body.innerText.includes('AI 发送确认')`,
          ),
          true,
          '日志悬浮窗应在20秒内挂载AI发送确认页面',
        )
        await execute({ action: 'open-runtime-logs' })
        assert.equal(
          BrowserWindow.getAllWindows().filter((w) => w.webContents.getURL().includes('/logs'))
            .length,
          1,
        )
        const shot = await popup.webContents.capturePage()
        fs.writeFileSync(path.resolve('artifacts/desktop/logs-floating.png'), shot.toPNG())
        await assert.rejects(
          execute({ action: 'review-reply', values: { id: randomUUID(), approve: true } }),
        )
      } finally {
        popup.destroy()
      }
      assert.ok((await snapshot()).review.traces.length > 0, '关窗不应清除本次运行日志')
    })
    await check('business:generic-phrases-in-actual-model-context', '/shop/manage', async () => {
      const before = calls.length
      await execute({
        action: 'start-training',
        storeId: storeA,
        values: { question: '物流不动了', history: [] },
      })
      assert.equal(calls.length, before + 1, '短上下文不额外发起话术模型请求')
      const body = JSON.stringify(calls.at(-1))
      assert.ok(body.includes('[通用客服表达参考]'))
      assert.ok(body.includes('物流未更新'))
      assert.ok(body.includes('不是商品、订单或商家政策知识'))
      const traces = (await snapshot()).review.traces
      assert.ok(
        traces.some((trace) => JSON.stringify(trace.messages).includes('[通用客服表达参考]')),
      )
    })
    await check('business:knowledge-profiles-welcome-vision', '/shop/manage', async () => {
      const pack = await execute({
        action: 'save-intent-pack',
        values: {
          name: '隔离问答',
          enabled: true,
          storeIds: [storeA],
          productIds: [],
          entries: [
            { question: '保修多久', keywords: ['保修'], answer: '仅本店测试知识', enabled: true },
          ],
        },
      })
      assert.equal(pack.data.version, 1)
      const profile = await execute({
        action: 'save-model-profile',
        values: { name: '测试规则', prompt: 'fixture-only-system-rule', maxReplyChars: 200 },
      })
      const profiles = await execute({ action: 'list-model-profiles' })
      await execute({
        action: 'bind-model-profile',
        storeId: storeA,
        values: { profileId: profile.data.id, revision: profiles.data.revision },
      })
      await execute({
        action: 'save-welcome',
        storeId: storeA,
        values: { text: '欢迎测试', enabled: true, version: 0 },
      })
      await assert.rejects(
        execute({
          action: 'save-welcome',
          storeId: storeA,
          values: { text: '旧版本', enabled: true, version: 0 },
        }),
      )
      await execute({
        action: 'save-vision-settings',
        storeId: storeA,
        values: { enabled: true, version: 0 },
      })
      const result = await execute({
        action: 'start-training',
        storeId: storeA,
        values: {
          question: '图中是什么',
          images: ['https://images.example.com/fixture.png'],
          history: [],
        },
      })
      assert.equal(result.data.reply, '本机模型夹具回复')
      const captured = JSON.stringify(calls.at(-1))
      assert.ok(captured.includes('image_url'))
      assert.equal(calls.at(-1)?.model, 'fixture-custom-multimodal')
      assert.ok(captured.includes('fixture-only-system-rule'))
      const s = await snapshot()
      assert.equal(s.stores.find((row) => row.id === storeA)?.aiEnabled, false)
      assert.equal(s.welcomeByStore[storeA].version, 1)
      await load('/shop/manage?panel=image')
      await wait(`document.body.innerText.includes('不限制模型名称')`)
      assert.equal(
        await win.webContents.executeJavaScript(
          `document.body.innerText.includes('请在模型设置连接 Qwen3-VL')`,
        ),
        false,
      )
      const visionSwitch = await win.webContents.executeJavaScript(
        `Boolean(document.querySelector('.runtime-form .el-switch:not(.is-disabled)'))`,
      )
      assert.equal(visionSwitch, true)
      const shot = await win.webContents.capturePage()
      fs.writeFileSync(path.resolve('artifacts/desktop/image-current-model.png'), shot.toPNG())
    })
    await check('business:work-order-persistence', '/shop/manage', async () => {
      const result = await execute({
        action: 'create-work-order',
        values: {
          storeId: storeA,
          type: '其他事项',
          orderNo: 'fixture-order',
          buyer: '合成顾客',
          priority: 'normal',
          description: '隔离测试',
        },
      })
      await execute({
        action: 'add-work-order-note',
        values: { id: result.data.id, text: '本机跟进记录' },
      })
      await execute({
        action: 'set-work-order-status',
        values: { id: result.data.id, status: 'working' },
      })
      assert.equal((await snapshot()).workOrders[0].notes[0].text, '本机跟进记录')
    })
    await check('business:restart-and-offline-draft', '/', async () => {
      const storesFile = path.join(dataDir, 'stores.json')
      const stores = JSON.parse(fs.readFileSync(storesFile, 'utf8')) as {
        stores: { aiEnabled: boolean }[]
      }
      for (const row of stores.stores) row.aiEnabled = true
      fs.writeFileSync(storesFile, JSON.stringify(stores))
      fs.writeFileSync(
        path.join(dataDir, 'conversations.json'),
        JSON.stringify([
          {
            storeId: storeA,
            uid: 'fixture-buyer',
            name: '合成顾客',
            status: 'pending',
            messages: [{ from: 'buyer', type: 'text', content: '原始测试问题', ts: 100000 }],
            updatedAt: 100000,
          },
        ]),
      )
      const recordId = randomUUID()
      fs.writeFileSync(
        path.join(dataDir, 'conversation-quality.json'),
        JSON.stringify({
          version: 1,
          rows: [
            {
              id: recordId,
              storeId: storeA,
              uid: 'fixture-buyer',
              name: '合成顾客',
              storeName: '隔离测试甲店',
              platform: 'pdd-web',
              status: 'pending',
              note: '',
              version: 1,
              updatedAt: 100000,
              reviewedAt: 0,
              events: [],
            },
          ],
        }),
      )
      await options.restart()
      const s = await snapshot()
      assert.notEqual(s.workspaceId, oldWorkspace)
      assert.equal(s.stores.length, 2)
      assert.ok(s.stores.every((row) => !row.aiEnabled))
      assert.equal(s.products.total, 2)
      assert.equal(s.welcomeByStore[storeA].enabled, true)
      assert.equal(s.workOrders[0].status, 'working')
      await assert.rejects(
        win.webContents.executeJavaScript(
          `window.yunduoDesktop.backendExecute(${JSON.stringify({ workspaceId: oldWorkspace, action: 'refresh', values: {} })})`,
        ),
      )
      await execute({
        action: 'select-conversation',
        storeId: storeA,
        conversationId: 'fixture-buyer',
      })
      await execute({
        action: 'save-auxiliary-draft',
        storeId: storeA,
        conversationId: 'fixture-buyer',
        values: { text: '发送失败后应保留的草稿' },
      })
      await assert.rejects(
        execute({
          action: 'send-reply',
          storeId: storeA,
          conversationId: 'fixture-buyer',
          values: { reply: '发送失败后应保留的草稿' },
        }),
      )
      assert.equal((await snapshot()).auxiliary.drafts[0].text, '发送失败后应保留的草稿')
      await execute({
        action: 'learn-conversation-correction',
        storeId: storeA,
        conversationId: 'fixture-buyer',
        values: {
          recordId,
          version: 1,
          question: '原始测试问题',
          messageTs: 100000,
          answer: '合成标准答案',
          confirmed: true,
        },
      })
      assert.ok(
        JSON.stringify((await execute({ action: 'list-intent-packs' })).data).includes(
          '合成标准答案',
        ),
      )
    })
    await check('business:buyer-message-ai-status', '/logs', async () => {
      const buyer = (await snapshot()).review.logs.find(
        (log) => log.kind === '买家消息' && log.uid === 'fixture-buyer',
      )
      assert.ok(buyer)
      assert.equal(buyer?.ai?.submitted, null)
      assert.equal(buyer.ai?.code, 'historical_unknown')
      await load('/logs')
      await win.webContents.executeJavaScript(
        `Array.from(document.querySelectorAll('[role="tab"]')).find(n=>n.textContent.includes('消息与运行日志')).click()`,
      )
      await wait(
        `Array.from(document.querySelectorAll('[role="tab"]')).some(n=>n.textContent.includes('消息与运行日志')&&n.getAttribute('aria-selected')==='true')&&document.querySelector('.message-ai-state')?.textContent.includes('历史消息')`,
      )
      await win.webContents.executeJavaScript(
        `new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`,
      )
      const shot = await win.webContents.capturePage()
      fs.writeFileSync(path.resolve('artifacts/desktop/message-ai-diagnostics.png'), shot.toPNG())
    })
    await check('business:untrusted-window-rejected', '/', async () => {
      const outsider = new BrowserWindow({
        show: false,
        webPreferences: {
          preload: path.join(__dirname, 'preload.cjs'),
          sandbox: true,
          contextIsolation: true,
          nodeIntegration: false,
        },
      })
      try {
        await outsider.loadURL('data:text/html,<h1>untrusted</h1>')
        assert.equal(
          await outsider.webContents.executeJavaScript(
            'window.yunduoDesktop.backendSnapshot().then(()=>false,()=>true)',
          ),
          true,
        )
        assert.equal(
          await outsider.webContents.executeJavaScript(
            'window.yunduoDesktop.copyGenericPhrase("unknown").then(()=>false,()=>true)',
          ),
          true,
        )
      } finally {
        outsider.destroy()
      }
    })
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
}

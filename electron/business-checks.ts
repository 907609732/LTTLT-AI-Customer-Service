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
      if (!(await snapshot()).stores.length)
        await execute({
          action: 'add-store',
          values: { platform: 'sim-local', storeName: '间隔验证店' },
        })
      await load('/shop/manage?panel=shops')
      await wait(`Boolean(document.querySelector('[data-action="basic-settings"]'))`)
      await win.webContents.executeJavaScript(
        `document.querySelector('[data-action="basic-settings"]').click()`,
      )
      await wait(`Boolean(document.querySelector('button.wizard-step:not(:disabled)'))`)
      await win.webContents.executeJavaScript(
        `document.querySelectorAll('button.wizard-step')[1].click()`,
      )
      await wait(`Boolean(document.querySelector('.reply-pacing input'))`)
      const footer = await win.webContents.executeJavaScript(
        `document.querySelector('.sidebar-footer').innerText`,
      )
      assert.match(footer, /快捷回复/)
      assert.doesNotMatch(footer, /设置|定时任务/)
      assert.equal((await snapshot()).config.reply.perUidMinIntervalMs, 1000)
      const change = async (seconds: number) => {
        await win.webContents.executeJavaScript(
          `(()=>{const input=document.querySelector('.reply-pacing input');input.value=${seconds};input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));document.querySelector('.reply-pacing button[type="submit"]').click()})()`,
        )
        await wait(
          `document.querySelector('.reply-pacing p').textContent.includes('当前：${seconds} 秒')`,
        )
      }
      await change(15)
      await assert.rejects(
        execute({
          action: 'save-config',
          screenId: 'REPLY_PACING',
          values: { seconds: 0, expectedMs: 15000 },
        }),
      )
      await change(1)
      assert.equal((await snapshot()).config.reply.perUidMinIntervalMs, 1000)
      await assert.rejects(
        execute({
          action: 'save-config',
          screenId: 'REPLY_PACING',
          values: { seconds: 30, expectedMs: 15000 },
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
      if (!(await snapshot()).stores.length)
        await execute({
          action: 'add-store',
          values: { platform: 'sim-local', storeName: '接待迁移验证店' },
        })
      const storeId = (await snapshot()).stores[0]!.id
      await load('/shop/manage?panel=shops')
      await wait(`Boolean(document.querySelector('[data-action="basic-settings"]'))`)
      await win.webContents.executeJavaScript(
        `document.querySelector('[data-action="basic-settings"]').click()`,
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
          `Array.from(document.querySelectorAll('.manage-sidebar button, .sidebar-item')).some(el => ['转接人工','进店欢迎'].includes(el.textContent.trim()))`,
        ),
        false,
      )
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

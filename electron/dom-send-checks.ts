import { BrowserWindow } from 'electron'
import { createRequire } from 'node:module'
import path from 'node:path'
import assert from 'node:assert/strict'
import { configureDomTextAdapter } from './dom-text-adapter'
import { ReviewConsole, type SendProposal } from './review-console'
import { emptySnapshot } from '../src/shared/contracts/backend'
import { pageReviewFingerprint } from './conversation-review'
import { SendModeAuthorizations } from './send-mode-authorizations'

type Check = (name: string, route: string, run: () => Promise<void>) => Promise<void>
interface TestAdapter {
  reviewHistory(uid: string, focus?: boolean): Promise<unknown>
  ensure(): Promise<{ ok: boolean }>
  sendText(
    uid: string,
    text: string,
    options?: { isCurrent?: () => boolean },
  ): Promise<{ ok: boolean; reason?: string; method?: string }>
}
/** 本机离线 HTML 中执行真实 PDD hook 与适配器，严禁触碰真实店铺或真实发送接口。 */
export async function domSendChecks(check: Check) {
  const loader = createRequire(path.join(__dirname, 'smoke.cjs'))
  const { PddWebAdapter } = loader(
    path.join(__dirname, '..', 'vendor/lingtu-runtime/desk-v1/src/adapters/pdd-web.js'),
  ) as { PddWebAdapter: new (options: Record<string, unknown>) => unknown }
  const fixture = new BrowserWindow({
    show: false,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      offscreen: true,
    },
  })
  let nativeInputs = 0
  let sendAuthorizations: SendModeAuthorizations | undefined
  const wc = {
    executeJavaScript: (code: string, gesture?: boolean) =>
      fixture.webContents.executeJavaScript(code, gesture),
    isDestroyed: () => fixture.isDestroyed(),
    sendInputEvent: (event: Electron.MouseInputEvent) => {
      nativeInputs++
      assert.ok(['mouseDown', 'mouseUp'].includes(event.type), '禁止键盘或系统鼠标操作')
      fixture.webContents.sendInputEvent(event)
    },
    focus: () => {
      fixture.webContents.focus()
    },
  }
  const adapter = configureDomTextAdapter(
    'pdd-web',
    new PddWebAdapter({ getWebContents: () => wc }),
    1, // 仅旧逐字路径的防回归夹具；正式默认整段填写。
    (uid, text) => sendAuthorizations?.consume('fixture', uid, text),
  ) as TestAdapter
  const bulkAdapter = configureDomTextAdapter(
    'pdd-web',
    new PddWebAdapter({ getWebContents: () => wc }),
    undefined,
    (uid, text) => sendAuthorizations?.consume('fixture', uid, text),
  ) as TestAdapter
  const load = async (mode: string) => {
    nativeInputs = 0
    // 旧 DOM 夹具没有真实 MMS 的 LI#middlePanel_list_<msgId>，因此显式声明聊天消息区
    // `.chatMessage` 边界；hook v14 的 legacy 兜底只在该边界内读无 ID 气泡，绝不读左侧
    // 联系人预览。真实中间消息结构另由下方 dom-send:v14-real-middle-row 覆盖。
    const html = `<!doctype html><html><body><div class="chat-item-box active" data-random="buyer-1">测试买家</div><div class="chatMessage"><div id="buyer-history"><div class="chat-item customerMessage"><p class="chat-message-content">买家原始问题</p></div></div></div><textarea style="width:400px;height:80px"></textarea>${mode === 'no-button' ? '' : '<button>发送</button>'}<div class="chatMessage"><div id="messages"></div></div><script>
      window.clicks=0;window.keys=0;window.inputs=[];document.addEventListener('keydown',()=>window.keys++);
      const input=document.querySelector('textarea');
      input.addEventListener('input',event=>window.inputs.push({value:input.value,data:event.data}));
      ${mode === 'busy' ? "input.value='人工草稿';" : ''}
      ${mode === 'edited' ? "input.addEventListener('input',()=>{input.value='人工改写';});" : ''}
      document.querySelector('button')?.addEventListener('click',(event)=>{window.trusted=event.isTrusted;window.clicks++;const value=input.value;input.value='';${mode === 'no-echo' ? '' : "const bubble=document.createElement('div');bubble.className='chat-item merchantMessage';const p=document.createElement('p');p.className='chat-message-content';p.textContent=value;bubble.append(p);document.querySelector('#messages').append(bubble);"}});
      </script></body></html>`
    await fixture.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
    assert.equal((await adapter.ensure()).ok, true)
  }
  // 真实 1.0.62/1.0.64 中央消息结构：LI#middlePanel_list_<msgId> + 同 UID Vuex 角色，
  // 左侧只放联系人预览。用于确认 v14 发送/回显通路，不替代上面的 legacy 兼容断言。
  const loadV13 = async () => {
    nativeInputs = 0
    const html = `<!doctype html><html><body><div id="app"><div class="chat-item-box active" data-random="buyer-0-reply"><p class="chat-message-content">左侧预览旧缓存</p></div></div><div class="middlePanel"><ul class="message-list"><li id="middlePanel_list_9001" class="clearfix onemsg"><div class="merchantMessage"><div class="buyer-item"><div class="msg-content"><p class="msg-content-box">买家原始问题</p></div></div></div></li></ul></div><textarea style="width:400px;height:80px"></textarea><button>发送</button><script>
      window.clicks=0;window.keys=0;window.inputs=[];
      const input=document.querySelector('textarea');
      input.addEventListener('input',event=>window.inputs.push({value:input.value,data:event.data}));
      const conv={userInfo:{uid:'buyer'},messageList:[{msg_id:'9001',from:{role:'user'},content:'买家原始问题',ts:Date.now()}]};
      document.querySelector('#app').__vue__={$store:{state:{selectingChatUid:'buyer',currentUserInfo:conv,chatList:[conv]},getters:{}}};
      document.querySelector('button').addEventListener('click',(event)=>{window.trusted=event.isTrusted;window.clicks++;const value=input.value;input.value='';const id=String(Date.now());const row=document.createElement('li');row.id='middlePanel_list_'+id;row.className='clearfix onemsg';row.innerHTML='<div class="merchantMessage"><div class="cs-item"><div class="msg-content"><p class="msg-content-box"></p></div></div></div>';row.querySelector('.msg-content-box').textContent=value;document.querySelector('.message-list').append(row);conv.messageList.push({msg_id:id,from:{role:'mall_cs'},content:value,ts:Date.now()});});
      </script></body></html>`
    await fixture.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
    assert.equal((await adapter.ensure()).ok, true)
  }
  const stats = () =>
    fixture.webContents.executeJavaScript(
      `({clicks:window.clicks,keys:window.keys,value:document.querySelector('textarea').value,text:document.querySelector('#messages').textContent})`,
    ) as Promise<{ clicks: number; keys: number; value: string; text: string }>
  try {
    await check('dom-fill:whole-reply-single-input', '/fixture/pdd', async () => {
      await load('success')
      const text = '您好👨‍👩‍👧‍👦，这是整段回复。\n换行和规格信息也一次填入。'.repeat(20)
      assert.equal((await bulkAdapter.sendText('buyer', text)).ok, true)
      const inputs = (await fixture.webContents.executeJavaScript('window.inputs')) as {
        value: string
      }[]
      assert.equal(inputs.length, 1, '整段回复只触发一次填写')
      assert.equal(inputs[0].value, text, '第一次填写已经包含完整正文')
      assert.equal((await stats()).clicks, 1)
      assert.equal((await stats()).text, text)
    })
    for (const mode of ['busy', 'edited', 'new-message'])
      await check(`dom-fill:${mode}-no-send`, '/fixture/pdd', async () => {
        await load(mode === 'new-message' ? 'success' : mode)
        if (mode === 'new-message')
          await fixture.webContents.executeJavaScript(
            `document.querySelector('textarea').addEventListener('input',()=>{const item=document.createElement('div');item.className='chat-item customerMessage';item.innerHTML='<p class="chat-message-content">买家刚发的新消息</p>';document.querySelector('#buyer-history').append(item)},{once:true});void 0`,
          )
        assert.equal((await bulkAdapter.sendText('buyer', '不能误发的整段回复')).ok, false)
        assert.equal((await stats()).clicks, 0)
        if (mode === 'busy') assert.equal((await stats()).value, '人工草稿')
        if (mode === 'edited') assert.equal((await stats()).value, '人工改写')
      })
    await check('dom-typing:visible-character-steps', '/fixture/pdd', async () => {
      await load('success')
      const text = '您好👨‍👩‍👧‍👦，请问商品？'
      assert.equal((await adapter.sendText('buyer', text)).ok, true)
      const steps = (await fixture.webContents.executeJavaScript('window.inputs')) as {
        value: string
        data: string
      }[]
      assert.equal(steps[0].value, '您')
      assert.equal(steps[1].value, '您好')
      assert.equal(steps[2].value, '您好👨‍👩‍👧‍👦')
      assert.equal(steps.at(-1)?.value, text)
      assert.ok(steps.length > 3)
      assert.equal((await stats()).clicks, 1)
    })
    for (const mode of ['switch-buyer', 'new-message'])
      await check(`dom-typing:${mode}-stops`, '/fixture/pdd', async () => {
        await load('success')
        await fixture.webContents.executeJavaScript(
          `document.querySelector('textarea').addEventListener('input',()=>{${mode === 'switch-buyer' ? "document.querySelector('.chat-item-box').setAttribute('data-random','other-1')" : "const item=document.createElement('div');item.className='chat-item customerMessage';item.innerHTML='<p class=\"chat-message-content\">新的买家消息</p>';document.querySelector('#buyer-history').append(item)"}},{once:true})`,
        )
        assert.equal((await adapter.sendText('buyer', '正在逐字输入，不得发错买家')).ok, false)
        assert.equal((await stats()).clicks, 0)
      })
    await check('dom-typing:ai-stop-cancels', '/fixture/pdd', async () => {
      await load('success')
      let active = true
      const pending = adapter.sendText('buyer', '输入期间停止AI，不应继续发送。'.repeat(30), {
        isCurrent: () => active,
      })
      for (let i = 0; i < 80; i++) {
        if (await fixture.webContents.executeJavaScript('window.inputs.length>0')) break
        await new Promise((resolve) => setTimeout(resolve, 10))
      }
      active = false
      assert.equal((await pending).ok, false)
      assert.equal((await stats()).clicks, 0)
    })
    await check('dom-review:confirm-without-private-history', '/fixture/pdd', async () => {
      await load('success')
      const baseline = await adapter.reviewHistory('buyer', true)
      assert.ok(pageReviewFingerprint(baseline))
      await fixture.webContents.executeJavaScript(
        `document.querySelector('#buyer-history').innerHTML='<div class="chat-item customerMessage"><p class="chat-message-content">买家原始问题</p></div>'; window.fetch=()=>Promise.reject(Error('历史接口不可用')); void 0`,
      )
      assert.equal(
        pageReviewFingerprint(await adapter.reviewHistory('buyer', false)),
        pageReviewFingerprint(baseline),
        '网页重绘不应误判新消息',
      )
      const snap = emptySnapshot()
      snap.stores.push({
        id: 'fixture',
        storeName: '离线测试店',
        platform: 'pdd-web',
        group: '',
        aiEnabled: true,
        runtime: { open: true, online: true },
      })
      const review = new ReviewConsole(
        () => snap,
        () => {},
      )
      try {
        const approved = review.propose({
          storeId: 'fixture',
          uid: 'buyer',
          text: '明确确认后发送',
          thread: [{ from: 'buyer', content: '买家原始问题' }],
          isCurrent: () => true,
          getHistory: async () => ({ known: false, messages: [] }),
          pageReview: baseline,
          getPageReview: (focus) => adapter.reviewHistory('buyer', focus),
        })
        assert.equal((await stats()).clicks, 0)
        await review.decide({ id: review.snapshot().replies[0].id, approve: true })
        assert.equal(await approved, true)
        assert.equal((await bulkAdapter.sendText('buyer', '明确确认后发送')).ok, true)
        assert.equal((await stats()).clicks, 1)
      } finally {
        review.dispose()
      }
    })
    await check('dom-send:one-button-click-full-text', '/fixture/pdd', async () => {
      await load('success')
      const text = '网页内点击发送测试'.repeat(130)
      assert.ok(text.length > 900)
      const result = await adapter.sendText('buyer', text)
      assert.equal(result.ok, true)
      const s = await stats()
      assert.equal(s.clicks, 1)
      assert.equal(s.keys, 0)
      assert.equal(s.text, text)
      assert.equal(nativeInputs, 2)
      assert.equal(await fixture.webContents.executeJavaScript('window.trusted'), true)
    })
    await check('dom-send:v14-real-middle-row', '/fixture/pdd', async () => {
      await loadV13()
      const text = 'v14 真实中间消息行单次发送'
      assert.equal((await bulkAdapter.sendText('buyer', text)).ok, true)
      const s = (await fixture.webContents.executeJavaScript(
        `({clicks:window.clicks,keys:window.keys,hook:window.__PDD_WEB_VER,rows:document.querySelectorAll('[id^="middlePanel_list_"]').length,text:document.querySelector('.message-list').textContent})`,
      )) as { clicks: number; keys: number; hook: number; rows: number; text: string }
      assert.equal(s.clicks, 1)
      assert.equal(s.keys, 0)
      assert.equal(s.hook, 14)
      assert.equal(s.rows, 2, '初始消息 + 一条真实回显')
      assert.ok(s.text.includes(text))
      const history = (await adapter.reviewHistory('buyer', false)) as {
        known: boolean
        messages: Array<{ from: string; content: string }>
      }
      assert.equal(history.known, true)
      assert.ok(
        history.messages.every((m) => m.content !== '左侧预览旧缓存'),
        '联系人预览不能进入复核',
      )
    })
    await check('dom-review:auto-mode-one-verified-send', '/fixture/pdd', async () => {
      await load('success')
      const baseline = await adapter.reviewHistory('buyer', true)
      const snap = emptySnapshot()
      snap.stores.push({
        id: 'fixture',
        storeName: '隔离自动测试店',
        platform: 'pdd-web',
        group: '',
        aiEnabled: true,
        runtime: { open: true, online: true },
      })
      const review = new ReviewConsole(
        () => snap,
        () => {},
        undefined,
        {
          readMode: () => ({ mode: 'auto', revision: 1 }),
        },
      )
      try {
        const approved = await review.propose({
          storeId: 'fixture',
          uid: 'buyer',
          text: '隔离页面自动回复',
          thread: [{ from: 'buyer', content: '买家原始问题' }],
          isCurrent: () => true,
          getHistory: async () => ({ known: false, messages: [] }),
          pageReview: baseline,
          getPageReview: (focus) => adapter.reviewHistory('buyer', focus),
        })
        assert.equal(approved, true)
        assert.equal((await stats()).clicks, 0, '统一复核本身不得偷偷点击发送')
        assert.equal((await bulkAdapter.sendText('buyer', '隔离页面自动回复')).ok, true)
        assert.equal((await stats()).clicks, 1)
      } finally {
        review.dispose()
      }
    })
    await check('dom-review:auto-to-review-cancels-typing', '/fixture/pdd', async () => {
      await load('success')
      let mode: 'auto' | 'review' = 'auto'
      let revision = 1
      const readMode = () => ({ mode, revision })
      sendAuthorizations = new SendModeAuthorizations(readMode)
      const baseline = await adapter.reviewHistory('buyer', true)
      const snap = emptySnapshot()
      snap.stores.push({
        id: 'fixture',
        storeName: '隔离取消测试店',
        platform: 'pdd-web',
        group: '',
        aiEnabled: true,
        runtime: { open: true, online: true },
      })
      const review = new ReviewConsole(
        () => snap,
        () => {},
        undefined,
        { readMode },
      )
      const text = '输入期间切回审核必须停止自动点击。'.repeat(30)
      try {
        const proposal: SendProposal = {
          storeId: 'fixture',
          uid: 'buyer',
          text,
          thread: [{ from: 'buyer', content: '买家原始问题' }],
          isCurrent: () => true,
          getHistory: async () => ({ known: false, messages: [] }),
          pageReview: baseline,
          getPageReview: (focus) => adapter.reviewHistory('buyer', focus),
        }
        assert.equal(
          await sendAuthorizations.authorize(proposal, () => review.propose(proposal)),
          true,
        )
        const pending = bulkAdapter.sendText('buyer', text, { isCurrent: () => true })
        for (let i = 0; i < 100; i++) {
          if (await fixture.webContents.executeJavaScript('window.inputs.length>0')) break
          await new Promise((resolve) => setTimeout(resolve, 10))
        }
        assert.ok(await fixture.webContents.executeJavaScript('window.inputs.length>0'))
        mode = 'review'
        revision++
        assert.equal((await pending).ok, false)
        assert.equal((await stats()).clicks, 0)
      } finally {
        review.dispose()
        sendAuthorizations.dispose()
        sendAuthorizations = undefined
      }
    })
    for (const mode of ['no-button', 'busy', 'edited'])
      await check(`dom-send:${mode}-no-send`, '/fixture/pdd', async () => {
        await load(mode)
        const result = await adapter.sendText('buyer', '不得误发的文字')
        assert.equal(result.ok, false)
        const s = await stats()
        assert.equal(s.clicks, 0)
        assert.equal(s.keys, 0)
        if (mode === 'busy') assert.equal(s.value, '人工草稿')
        if (mode === 'edited') assert.equal(s.value, '人工改写')
      })
    await check('dom-send:wrong-buyer-no-send', '/fixture/pdd', async () => {
      await load('success')
      assert.equal((await adapter.sendText('other-buyer', '不能错发')).ok, false)
      const s = await stats()
      assert.equal(s.clicks, 0)
      assert.equal(s.value, '')
    })
    await check('dom-send:no-echo-no-retry', '/fixture/pdd', async () => {
      await load('no-echo')
      const result = await adapter.sendText('buyer', '只发送一次，不补回车')
      assert.equal(result.ok, false)
      assert.equal(result.reason, 'send_unconfirmed')
      const s = await stats()
      assert.equal(s.clicks, 1)
      assert.equal(s.keys, 0)
      assert.equal(nativeInputs, 2)
    })
    await check('dom-send:pdd-background-raf', '/fixture/pdd-background', async () => {
      // 真实 ShopWindowManager + 隔离 BrowserWindow + 独立临时 session：唯一网络输入是 data: HTML。
      const { ShopWindowManager } = loader(
        path.join(__dirname, '..', 'vendor/lingtu-runtime/desk-v1/src/main/shop-window.js'),
      ) as {
        ShopWindowManager: new (options: Record<string, unknown>) => {
          open(storeId: string): Promise<unknown>
          webContentsOf(storeId: string): Electron.WebContents | null
          closeAll(): void
        }
      }
      const host = new BrowserWindow({
        show: false,
        x: 300,
        y: 300,
        width: 900,
        height: 700,
        webPreferences: {
          sandbox: true,
          contextIsolation: true,
          nodeIntegration: false,
          webviewTag: false,
          backgroundThrottling: false,
        },
      })
      let cover: BrowserWindow | undefined
      const html = encodeURIComponent(
        '<!doctype html><html><body><p>pdd background rAF fixture</p></body></html>',
      )
      const stores: Record<
        string,
        { id: string; storeName: string; platform: string; url: string }
      > = {
        'bg-pdd': {
          id: 'bg-pdd',
          storeName: '合成 PDD 后台页',
          platform: 'pdd-web',
          url: `data:text/html;charset=utf-8,${html}`,
        },
        'bg-other': {
          id: 'bg-other',
          storeName: '合成其它平台页',
          platform: 'sim-local',
          url: `data:text/html;charset=utf-8,${html}`,
        },
      }
      const manager = new ShopWindowManager({
        window: host,
        registry: {
          get: (id: string) => stores[id],
          markOpened: () => {},
          markError: () => {},
        },
        logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
        resolveEntryUrl: async (store: { url: string }) => store.url,
        resolveAccessMode: async () => 'webview',
        prepareStore: async () => ({ ok: true }),
        partitionNamespace: `pdd-bg-${process.pid}-${Date.now()}`,
      })
      try {
        await manager.open('bg-pdd')
        await manager.open('bg-other')
        const pdd = manager.webContentsOf('bg-pdd')
        const other = manager.webContentsOf('bg-other')
        assert.ok(pdd, '真实 ShopWindowManager 未创建 PDD 视图')
        assert.ok(other, '真实 ShopWindowManager 未创建非 PDD 视图')
        const pddThrottling = pdd.getBackgroundThrottling()
        const otherThrottling = other.getBackgroundThrottling()
        // 用真实前台窗口覆盖两个子视图，模拟本次“窗口存在但页面在后台”的状态。
        // 同窗 frame 会联动，不能拿另一个视图的 rAF 当独立行为对照；核心是 PDD rAF
        // 真实执行，非 PDD 只断言属性仍为默认 true，证明平台范围未扩大。
        host.showInactive()
        cover = new BrowserWindow({
          show: false,
          x: 300,
          y: 300,
          width: 900,
          height: 700,
          alwaysOnTop: true,
          backgroundColor: '#ffffff',
          webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
        })
        cover.show()
        await new Promise((resolve) => setTimeout(resolve, 300))
        const race = (wc: Electron.WebContents) =>
          wc.executeJavaScript(`new Promise((resolve) => {
            const started = performance.now();
            let settled = false;
            const done = (winner) => {
              if (settled) return;
              settled = true;
              clearTimeout(timer);
              resolve({
                winner,
                elapsedMs: Math.round(performance.now() - started),
                hidden: document.hidden,
                visibilityState: document.visibilityState,
              });
            };
            const timer = setTimeout(() => done('timeout'), 1000);
            requestAnimationFrame(() => done('raf'));
          })`) as Promise<{
            winner: 'raf' | 'timeout'
            elapsedMs: number
            hidden: boolean
            visibilityState: string
          }>
        const pddRace = await race(pdd)
        // 先执行真实竞争并输出脱敏测量值，再做断言；RED 也能从 CI 日志审阅同一组值。
        console.log(
          '[smoke] background-raf',
          JSON.stringify({
            hostVisible: host.isVisible(),
            hostThrottling: host.webContents.getBackgroundThrottling(),
            pddThrottling,
            otherThrottling,
            pddRace,
          }),
        )
        assert.equal(
          pddRace.winner,
          'raf',
          `PDD 后台 rAF 被暂停：${JSON.stringify(pddRace)}（backgroundThrottling=${String(pddThrottling)}）`,
        )
        assert.ok(pddRace.elapsedMs < 1000, `PDD 后台 rAF 超时：${pddRace.elapsedMs}ms`)
        assert.equal(
          pddThrottling,
          false,
          `PDD 视图应关闭后台节流（实际 ${String(pddThrottling)}）`,
        )
        assert.equal(otherThrottling, true, '非 PDD 平台必须保留 Electron 默认后台节流')
        assert.equal(host.isVisible(), true, '对照窗口应可见但被覆盖，而不是最小化')
      } finally {
        try {
          manager.closeAll()
        } finally {
          try {
            cover?.destroy()
          } finally {
            host.destroy()
          }
        }
      }
    })
  } finally {
    fixture.destroy()
  }
}

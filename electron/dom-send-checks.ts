import { BrowserWindow } from 'electron'
import { createRequire } from 'node:module'
import path from 'node:path'
import assert from 'node:assert/strict'
import { configureDomTextAdapter } from './dom-text-adapter'
import { ReviewConsole } from './review-console'
import { emptySnapshot } from '../src/shared/contracts/backend'
import { pageReviewFingerprint } from './conversation-review'

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
    1, // 夹具加速；生产默认每个可见字符 50ms。
  ) as TestAdapter
  const load = async (mode: string) => {
    nativeInputs = 0
    const html = `<!doctype html><html><body><div class="chat-item-box active" data-random="buyer-1">测试买家</div><div id="buyer-history"><div class="chat-item customerMessage"><p class="chat-message-content">买家原始问题</p></div></div><textarea style="width:400px;height:80px"></textarea>${mode === 'no-button' ? '' : '<button>发送</button>'}<div id="messages"></div><script>
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
  const stats = () =>
    fixture.webContents.executeJavaScript(
      `({clicks:window.clicks,keys:window.keys,value:document.querySelector('textarea').value,text:document.querySelector('#messages').textContent})`,
    ) as Promise<{ clicks: number; keys: number; value: string; text: string }>
  try {
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
        assert.equal((await adapter.sendText('buyer', '明确确认后发送')).ok, true)
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
  } finally {
    fixture.destroy()
  }
}

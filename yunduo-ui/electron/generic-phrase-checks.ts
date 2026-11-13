import type { BrowserWindow } from 'electron'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

/** Exercise the real dialog without modifying the user's system clipboard. */
export async function genericPhraseChecks(options: {
  win: BrowserWindow
  load(route: string): Promise<void>
  check(name: string, route: string, run: () => Promise<void>): Promise<void>
}) {
  const { win, load, check } = options
  const ready = () =>
    win.webContents.executeJavaScript(
      'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))',
    )
  await check('generic-phrases:dialog-search-scenes-and-copy-guard', '/', async () => {
    await load('/')
    await win.webContents.executeJavaScript(
      `Array.from(document.querySelectorAll('.sidebar-footer button')).find(button => button.textContent.includes('快捷回复')).click()`,
    )
    await ready()
    assert.equal(
      await win.webContents.executeJavaScript(
        `document.querySelectorAll('[data-phrase-id]').length`,
      ),
      80,
    )
    await win.webContents.executeJavaScript(
      `Array.from(document.querySelectorAll('.qr-cat')).find(button => button.textContent.includes('情绪安抚')).click()`,
    )
    await ready()
    assert.equal(
      await win.webContents.executeJavaScript(
        `document.querySelectorAll('[data-phrase-id]').length`,
      ),
      8,
    )
    // DOM readiness precedes the dialog's CSS enter transition; capture the settled layout.
    await new Promise((resolve) => setTimeout(resolve, 350))
    await ready()
    assert.ok(
      await win.webContents.executeJavaScript(`(() => {
      const card=document.querySelector('[data-phrase-id]');
      const reply=card.querySelector('.phrase-reply').getBoundingClientRect();
      const conditions=card.querySelector('.phrase-conditions').getBoundingClientRect();
      const bounds=card.getBoundingClientRect();
      const list=document.querySelector('.qr-list');
      return bounds.height>110 && reply.bottom<=bounds.bottom && conditions.bottom<=bounds.bottom && list.scrollHeight>list.clientHeight;
    })()`),
      '多条话术卡片必须保留完整正文和适用条件，由列表滚动而非压缩卡片',
    )
    const shot = await win.webContents.capturePage()
    fs.writeFileSync(path.resolve('artifacts/desktop/generic-phrases.png'), shot.toPNG())
    await win.webContents.executeJavaScript(
      `document.querySelector('.qr-cat').click();const input=document.querySelector('input[aria-label="搜索通用话术"]');input.value='物流未更新';input.dispatchEvent(new Event('input',{bubbles:true}))`,
    )
    await ready()
    assert.equal(
      await win.webContents.executeJavaScript(
        `document.querySelectorAll('[data-phrase-id]').length`,
      ),
      1,
    )
    assert.ok(
      await win.webContents.executeJavaScript(
        `Boolean(document.querySelector('button[aria-label="复制：物流未更新"]'))`,
      ),
    )
    await win.webContents.executeJavaScript(
      `document.querySelector('.phrase-conditions').open=true`,
    )
    await ready()
    const searchShot = await win.webContents.capturePage()
    fs.writeFileSync(
      path.resolve('artifacts/desktop/generic-phrases-search.png'),
      searchShot.toPNG(),
    )
    assert.equal(
      await win.webContents.executeJavaScript(
        `window.yunduoDesktop.copyGenericPhrase('unknown').then(()=>false,()=>true)`,
      ),
      true,
    )
    await win.webContents.executeJavaScript(
      `const search=document.querySelector('input[aria-label="搜索通用话术"]');search.value='xyzzy999';search.dispatchEvent(new Event('input',{bubbles:true}))`,
    )
    await ready()
    assert.equal(
      await win.webContents.executeJavaScript(
        `document.querySelectorAll('[data-phrase-id]').length`,
      ),
      0,
    )
    assert.ok(
      await win.webContents.executeJavaScript(`document.body.innerText.includes('没有匹配的话术')`),
    )
  })
}

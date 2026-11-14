import type { BrowserWindow } from 'electron'
import assert from 'node:assert/strict'

/** UI-only checks: no real credentials, remote login, model calls or buyer messages. */
export async function simpleLoginChecks(options: {
  win: BrowserWindow
  load(route: string): Promise<void>
  check(name: string, route: string, run: () => Promise<void>): Promise<void>
}) {
  const { win, load, check } = options
  const evaluate = <T>(script: string) => win.webContents.executeJavaScript(script) as Promise<T>
  async function wait(script: string) {
    for (let attempt = 0; attempt < 80; attempt++) {
      if (await evaluate<boolean>(script)) return
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    throw new Error('等待登录界面超时')
  }
  const open = async () => {
    await evaluate(`document.querySelector('.login-trigger').click()`)
    await wait(`Boolean(document.querySelector('.simple-login-dialog input[type="password"]'))`)
  }
  await check('login:one-entry-and-two-simple-options', '/', async () => {
    await load('/')
    await open()
    const result = await evaluate<{ text: string; legacy: number; columns: string }>(`(() => {
      const dialog = document.querySelector('.simple-login-dialog');
      return {text: dialog.innerText,
        legacy: document.querySelectorAll('.model-switch-pill,.plan-badge-trigger').length,
        columns: getComputedStyle(dialog.querySelector('.login-options')).gridTemplateColumns};
    })()`)
    assert.match(result.text, /使用自己的 Key/)
    assert.match(result.text, /服务端登录/)
    assert.match(result.text, /推荐/)
    assert.match(result.text, /保存并使用/)
    assert.doesNotMatch(result.text, /托管 API 服务地址|账号网站|模型接口地址|AI 回复间隔/)
    assert.equal(result.legacy, 0)
    assert.equal(result.columns.split(' ').length, 2)
  })
  await check('login:closing-clears-unsaved-key', '/', async () => {
    await evaluate(`(() => {
      const input = document.querySelector('.simple-login-dialog input[type="password"]');
      input.value = 'isolated-unsaved-placeholder';
      input.dispatchEvent(new Event('input', {bubbles: true}));
      document.querySelector('.simple-login-dialog .el-dialog__headerbtn').click();
    })()`)
    await wait(
      `!document.querySelector('.simple-login-dialog') || document.querySelector('.simple-login-dialog').getBoundingClientRect().width === 0`,
    )
    await open()
    assert.equal(
      await evaluate(`document.querySelector('.simple-login-dialog input[type="password"]').value`),
      '',
    )
    await evaluate(`document.querySelector('.simple-login-dialog .el-dialog__headerbtn').click()`)
  })
  await check('settings:pacing-only-with-advanced-collapsed', '/settings', async () => {
    await load('/settings')
    const result = await evaluate<{ text: string; open: boolean }>(`(() => {
      const page = document.querySelector('.runtime-page');
      return {text: page.innerText, open: Boolean(page.querySelector('details[open]'))};
    })()`)
    assert.match(result.text, /AI 回复间隔/)
    assert.match(result.text, /高级模型配置/)
    assert.doesNotMatch(result.text, /托管 API 服务地址|本机工作方式/)
    assert.equal(result.open, false)
  })
}

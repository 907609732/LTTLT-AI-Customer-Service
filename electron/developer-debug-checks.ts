import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { BrowserWindow } from 'electron'
import type { BackendSnapshot, BackendCommand } from '../src/shared/contracts/backend'

interface CheckRuntime {
  snapshot(): BackendSnapshot
  execute(command: BackendCommand): Promise<unknown>
}
interface CheckOptions {
  win: BrowserWindow
  runtime: CheckRuntime
  check(name: string, route: string, run: () => Promise<void>): Promise<void>
  outputDir: string
  load(route: string): Promise<void>
}
const sleep = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds))
async function waitFor<T>(
  read: () => Promise<T> | T,
  accept: (value: T) => boolean,
  label: string,
) {
  const deadline = Date.now() + 8000
  let value = await read()
  while (!accept(value)) {
    if (Date.now() > deadline) throw new Error(`等待超时：${label}`)
    await sleep(80)
    value = await read()
  }
  return value
}
const monitors = (win: BrowserWindow) =>
  BrowserWindow.getAllWindows().filter(
    (candidate) =>
      !candidate.isDestroyed() &&
      candidate !== win &&
      candidate.webContents.getURL().endsWith('#/reply-monitor'),
  )

export async function developerDebugChecks(options: CheckOptions) {
  await options.check('business:developer-console', '/reply-monitor', async () => {
    const created: BrowserWindow[] = []
    try {
      await options.load('/')
      const mainBridge = await options.win.webContents.executeJavaScript(
        'typeof window.yunduoDesktop.developerDebug',
      )
      assert.equal(mainBridge, 'undefined', '主工作台 preload 不得暴露源码调试桥')
      const workspaceId = options.runtime.snapshot().workspaceId
      const open = () =>
        options.runtime.execute({
          workspaceId,
          action: 'open-reply-monitor',
          values: {},
        })
      await open()
      let monitor = await waitFor(
        () => monitors(options.win)[0],
        (value) => Boolean(value),
        '回复监控窗口',
      )
      created.push(monitor!)
      await waitFor(
        () =>
          monitor!.webContents.executeJavaScript(
            "document.body.innerText.includes('回复监控') && Boolean(document.querySelector('[data-action=\"developer-toggle\"]'))",
          ),
        Boolean,
        '源码监控展开入口',
      )
      let bounds = monitor!.getBounds()
      assert.equal(bounds.width, 340)
      assert.equal(bounds.height, 300)
      assert.equal(monitor!.getParentWindow(), options.win)
      assert.equal(monitor!.isAlwaysOnTop(), false)
      assert.equal(
        await monitor!.webContents.executeJavaScript('typeof window.yunduoDesktop.developerDebug'),
        'object',
        '源码监控必须获得窄调试桥',
      )
      await monitor!.webContents.executeJavaScript(
        'document.querySelector(\'[data-action="developer-toggle"]\').click()',
      )
      await waitFor(
        () => monitor!.getBounds().width,
        (value) => value === 960,
        '展开宽度',
      )
      bounds = monitor!.getBounds()
      assert.equal(bounds.height, 620)
      assert.equal(monitor!.isResizable(), true)
      await waitFor(
        () =>
          monitor!.webContents.executeJavaScript(
            "Boolean(document.querySelector('[data-gm-input]'))",
          ),
        Boolean,
        'GM 面板',
      )
      await monitor!.webContents.executeJavaScript(`(() => {
        const input = document.querySelector('[data-gm-input]');
        input.value = 'help';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
      })()`)
      await waitFor(
        () =>
          monitor!.webContents.executeJavaScript(
            "document.querySelector('[data-gm-output]').innerText.includes('pdd-popup')",
          ),
        Boolean,
        'GM help 输出',
      )
      assert.equal(
        await monitor!.webContents.executeJavaScript(
          "document.querySelector('[data-gm-output]').innerText.includes('不提供任意 JS')",
        ),
        true,
      )
      const help = await monitor!.webContents.executeJavaScript(
        "document.querySelector('[data-gm-output]').innerText",
      )
      assert.match(help, /不提供任意 JS、exec 或发送买家消息/)

      await monitor!.webContents.executeJavaScript(
        'document.querySelector(\'[data-debug-tab="cmd"]\').click()',
      )
      await waitFor(
        () =>
          monitor!.webContents.executeJavaScript(
            "Boolean(document.querySelector('[data-terminal-host]'))",
          ),
        Boolean,
        'xterm 容器',
      )
      await monitor!.webContents.executeJavaScript(
        "document.querySelector('.terminal-toolbar button').click()",
      )
      await waitFor(
        () =>
          monitor!.webContents.executeJavaScript(
            "document.querySelector('[data-terminal-status]')?.dataset.terminalStatus",
          ),
        (value) => value === 'connected',
        'CMD 连接',
      )
      // Exercise xterm's actual input -> renderer bridge -> ConPTY path, not only direct IPC.
      await monitor!.webContents.executeJavaScript(`(() => {
        window.__lingtuKeyboardText = '';
        window.__lingtuKeyboardOff = window.yunduoDesktop.developerDebug.onPtyData(
          (event) => { window.__lingtuKeyboardText += event.data; },
        );
        document.querySelector('.xterm-helper-textarea').focus();
      })()`)
      await monitor!.webContents.insertText('echo LINGTU_KEYBOARD_OK')
      monitor!.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Return' })
      monitor!.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Return' })
      await waitFor(
        () =>
          monitor!.webContents.executeJavaScript(
            "window.__lingtuKeyboardText.split('LINGTU_KEYBOARD_OK').length",
          ),
        (value) => value >= 3,
        'xterm 键盘输入与真实 CMD 回显',
      )
      await monitor!.webContents.executeJavaScript('void window.__lingtuKeyboardOff()')
      const result = await monitor!.webContents.executeJavaScript(`(async () => {
        const api = window.yunduoDesktop.developerDebug;
        const snapshot = await window.yunduoDesktop.backendSnapshot();
        const session = await api.ptyConnect({ workspaceId: snapshot.workspaceId, cols: 100, rows: 30 });
        window.__lingtuPtyText = '';
        const off = api.onPtyData((event) => {
          if (event.sessionId === session.sessionId) window.__lingtuPtyText += event.data;
        });
        await api.ptyWrite({ workspaceId: snapshot.workspaceId, sessionId: session.sessionId, data: 'chcp 65001>nul & echo LINGTU_CMD_OK & echo 中文测试\\r' });
        await new Promise((resolve) => setTimeout(resolve, 1200));
        await api.ptyWrite({ workspaceId: snapshot.workspaceId, sessionId: session.sessionId, data: 'echo arrow-one\\r' });
        await new Promise((resolve) => setTimeout(resolve, 350));
        await api.ptyWrite({ workspaceId: snapshot.workspaceId, sessionId: session.sessionId, data: '\\x1b[A\\r' });
        await new Promise((resolve) => setTimeout(resolve, 550));
        await api.ptyResize({ workspaceId: snapshot.workspaceId, sessionId: session.sessionId, cols: 120, rows: 40 });
        await api.ptyWrite({ workspaceId: snapshot.workspaceId, sessionId: session.sessionId, data: 'ping -n 20 127.0.0.1 >nul\\r' });
        await new Promise((resolve) => setTimeout(resolve, 350));
        await api.ptyWrite({ workspaceId: snapshot.workspaceId, sessionId: session.sessionId, data: '\\x03' });
        await new Promise((resolve) => setTimeout(resolve, 350));
        await api.ptyWrite({ workspaceId: snapshot.workspaceId, sessionId: session.sessionId, data: 'echo CTRL_C_OK\\r' });
        await new Promise((resolve) => setTimeout(resolve, 700));
        const text = window.__lingtuPtyText;
        off();
        return { sessionId: session.sessionId, text, cwd: session.cwd };
      })()`)
      assert.ok(result.text.includes('LINGTU_CMD_OK'), '真实 CMD 输出缺失')
      assert.ok(result.text.includes('中文测试'), '中文输出缺失')
      assert.ok(result.text.split('arrow-one').length >= 3, '方向键历史未回放')
      assert.ok(result.text.includes('CTRL_C_OK'), 'Ctrl+C 后命令未继续')
      assert.equal(
        path.resolve(result.cwd).toLowerCase(),
        path.resolve(__dirname, '..').toLowerCase(),
        'CMD 默认目录不是源码项目根',
      )
      assert.equal(
        result.cwd.toLowerCase().includes('dist-electron'),
        false,
        'CMD 默认目录不能是构建输出目录',
      )
      fs.writeFileSync(
        path.join(options.outputDir, 'developer-console.png'),
        (await monitor!.capturePage()).toPNG(),
      )
      await monitor!.webContents.executeJavaScript(
        'document.querySelector(\'[data-action="developer-toggle"]\').click()',
      )
      await waitFor(
        () => monitor!.getBounds().width,
        (value) => value === 340,
        '收起宽度',
      )
      await monitor!.webContents.executeJavaScript(
        'document.querySelector(\'[data-action="developer-toggle"]\').click()',
      )
      await waitFor(
        () => monitor!.getBounds().width,
        (value) => value === 960,
        '再次展开宽度',
      )
      const preserved = await monitor!.webContents.executeJavaScript(`(async () => {
        const api = window.yunduoDesktop.developerDebug;
        const snapshot = await window.yunduoDesktop.backendSnapshot();
        const session = await api.ptyConnect({ workspaceId: snapshot.workspaceId, cols: 100, rows: 30 });
        return session.sessionId;
      })()`)
      assert.equal(preserved, result.sessionId, '收起/展开不能重新创建 CMD shell')
      const oldSession = result.sessionId as string
      const oldId = monitor!.id
      monitor!.destroy()
      created.pop()
      await waitFor(
        () => monitors(options.win).every((window) => window.id !== oldId),
        Boolean,
        '关闭监控窗口',
      )
      await open()
      monitor = await waitFor(
        () => monitors(options.win)[0],
        (value) => Boolean(value),
        '重新打开回复监控',
      )
      created.push(monitor!)
      await waitFor(
        () =>
          monitor!.webContents.executeJavaScript(
            'Boolean(document.querySelector(\'[data-action="developer-toggle"]\'))',
          ),
        Boolean,
        '重建监控的展开入口',
      )
      const reopened = await monitor!.webContents.executeJavaScript(`(async () => {
        const api = window.yunduoDesktop.developerDebug;
        const snapshot = await window.yunduoDesktop.backendSnapshot();
        const session = await api.ptyConnect({ workspaceId: snapshot.workspaceId, cols: 80, rows: 24 });
        const stale = await api.ptyWrite({ workspaceId: snapshot.workspaceId, sessionId: ${JSON.stringify(
          oldSession,
        )}, data: 'echo stale\\r' }).then(() => 'accepted', (error) => String(error.message || error));
        return { sessionId: session.sessionId, stale };
      })()`)
      assert.notEqual(reopened.sessionId, oldSession, '新窗口不能复用旧终端会话')
      assert.match(reopened.stale, /会话/, '旧会话输入必须被拒绝')
    } finally {
      for (const window of created) if (!window.isDestroyed()) window.destroy()
      for (const window of monitors(options.win)) if (!window.isDestroyed()) window.destroy()
    }
  })
}

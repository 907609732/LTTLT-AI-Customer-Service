/** Offline WebContents only: real adapter typing and exact knowledge trace guard. */
import { BrowserWindow } from 'electron'
import { createRequire } from 'node:module'
import path from 'node:path'
import assert from 'node:assert/strict'
import { configureDomTextAdapter } from './dom-text-adapter'
import { createKnowledgeRepository } from './knowledge'
import { createKnowledgeRuntime } from './knowledge-runtime'
export async function knowledgeTypingCheck(directory: string) {
  const loader = createRequire(path.join(__dirname, 'smoke.cjs'))
  const { PddWebAdapter } = loader(
    path.join(__dirname, '..', 'vendor/lingtu-runtime/desk-v1/src/adapters/pdd-web.js'),
  ) as { PddWebAdapter: new (options: Record<string, unknown>) => unknown }
  const win = new BrowserWindow({
    show: false,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      offscreen: true,
    },
  })
  let mutateBeforeReturn: (() => void) | undefined
  const wc = {
    executeJavaScript: async (code: string, gesture?: boolean) => {
      const result: unknown = await win.webContents.executeJavaScript(code, gesture)
      if (
        code.includes('prepareNativeTextSend') &&
        result &&
        typeof result === 'object' &&
        Reflect.get(result, 'token')
      ) {
        const mutate = mutateBeforeReturn
        mutateBeforeReturn = undefined
        mutate?.()
      }
      return result
    },
    isDestroyed: () => win.isDestroyed(),
    focus: () => win.webContents.focus(),
    sendInputEvent: (event: Electron.MouseInputEvent) => {
      assert(['mouseDown', 'mouseUp'].includes(event.type))
      win.webContents.sendInputEvent(event)
    },
  }
  const adapter = configureDomTextAdapter(
    'pdd-web',
    new PddWebAdapter({ getWebContents: () => wc }),
    1,
  ) as {
    ensure(): Promise<{ ok: boolean }>
    sendText(
      uid: string,
      text: string,
      options: { isCurrent: () => boolean },
    ): Promise<{ ok: boolean }>
  }
  try {
    for (const mode of ['withdraw', 'expiry', 'source', 'override'])
      for (const phase of ['typing', 'before-click']) {
        let now = 1000
        const repository = createKnowledgeRepository({
          directory: path.join(directory, `${mode}-${phase}`),
          workspaceId: 'typing',
          now: () => now,
        })
        const runtime = createKnowledgeRuntime({
          repository,
          workspaceId: 'typing',
          assertActive: () => {},
          stores: () => [{ id: 's', storeName: 'Fixture', platform: 'sim-local' }],
          changed: () => {},
        })
        try {
          const canonical = repository.saveCanonical({ title: 'Fixture' })
          const binding = repository.bindProduct({
            canonicalId: canonical.id,
            storeId: 's',
            productId: 'p',
          })
          const source = repository.saveSource({
            storeId: 's',
            bindingId: binding.id,
            kind: 'manual',
            label: 'source',
            text: '售后支持',
          })
          const draft = repository.saveDraft({
            scope: { kind: 'canonical', canonicalId: canonical.id },
            question: '售后',
            answer: '售后支持',
            expiresAt: 2000,
            sourceRefs: [{ sourceId: source.id, revision: 1 }],
          })
          repository.publish({
            entryId: draft.id,
            expectedDraftRevision: 1,
            expectedSourceRevisions: { [source.id]: 1 },
          })
          const rows = await runtime.context({
            thread: [{ from: 'buyer', content: '售后' }],
            reviewContext: { storeId: 's', productId: 'p', uid: 'buyer' },
          })
          runtime.captureTrace('trace', rows)
          assert(runtime.citationsCurrent('trace'))
          const mutate = () => {
            if (mode === 'withdraw')
              repository.withdraw(draft.id, repository.getEntry(draft.id)!.revision)
            if (mode === 'expiry') now = 2001
            if (mode === 'source')
              repository.saveSource({
                id: source.id,
                expectedRevision: 1,
                storeId: 's',
                bindingId: binding.id,
                kind: 'manual',
                label: 'source',
                text: '售后已变',
              })
            if (mode === 'override') {
              const next = repository.saveDraft({
                scope: { kind: 'binding', bindingId: binding.id },
                question: '售后',
                answer: '本店独立售后',
              })
              repository.publish({
                entryId: next.id,
                expectedDraftRevision: 1,
                expectedSourceRevisions: {},
              })
            }
            assert.equal(runtime.citationsCurrent('trace'), false)
          }
          const html = `<!doctype html><html><body><div class="chat-item-box active" data-random="buyer-1">测试买家</div><div class="chat-item customerMessage"><p class="chat-message-content">售后</p></div><textarea style="width:400px;height:80px"></textarea><button>发送</button><script>window.clicks=0;window.inputs=0;document.querySelector('textarea').addEventListener('input',()=>window.inputs++);document.querySelector('button').addEventListener('click',()=>window.clicks++)</script></body></html>`
          await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
          assert((await adapter.ensure()).ok)
          if (phase === 'before-click') mutateBeforeReturn = mutate
          const text = '售后依据变化时应停止输入和发送。'.repeat(15)
          const pending = adapter.sendText('buyer', text, {
            isCurrent: () => runtime.citationsCurrent('trace'),
          })
          if (phase === 'typing') {
            for (let i = 0; i < 100; i++) {
              if (await win.webContents.executeJavaScript('window.inputs>0')) break
              await new Promise((resolve) => setTimeout(resolve, 5))
            }
            assert(await win.webContents.executeJavaScript('window.inputs>0'))
            mutate()
          }
          assert.equal((await pending).ok, false, `${mode}/${phase}`)
          const stats = (await win.webContents.executeJavaScript(
            '({clicks:window.clicks,value:document.querySelector("textarea").value})',
          )) as { clicks: number; value: string }
          assert.equal(stats.clicks, 0)
          if (phase === 'typing') assert(stats.value.length < text.length)
          else assert.equal(stats.value, text)
        } finally {
          await runtime.dispose()
          repository.dispose()
        }
      }
  } finally {
    win.destroy()
  }
}

import { BrowserWindow } from 'electron'
import { z } from 'zod'
import { assistPartition, isAllowedAssistUrl } from './assist-platform-host'
import { hasVisiblePddCaptcha } from './assist-platform-pdd'
import { createAssistQueryMonitor } from './assist-platform-query'
import { parsePddOrderPage } from './platform-order-parser'
import { readPddOrderDom, preparePddOrderQuery } from './pdd-order-dom'
import { configurePddOrderDate } from './pdd-order-date'
import type { PlatformOrderPort } from './platform-order-service'

interface Options {
  namespace: string
  getStore(id: string): { id: string; platform: string; mallId?: string } | undefined
  accountId(): string
  assertActive(): void
  identityScript(): string
}
const identitySchema = z.object({
  authenticated: z.literal(true),
  mallId: z.string().min(1),
  customerServiceId: z.string().optional(),
})
/** Uses native, isolated merchant order pages. Never replays undocumented HTTP or reads buyer addresses. */
export function createPddOrderProvider(options: Options): PlatformOrderPort & { dispose(): void } {
  const windows = new Map<string, BrowserWindow>()
  const queries = createAssistQueryMonitor()
  let closed = false
  const check = (storeId: string) => {
    options.assertActive()
    if (closed) throw Error('平台订单采集已关闭')
    const store = options.getStore(storeId)
    if (!store || store.platform !== 'pdd-web') throw Error('当前仅支持已登录拼多多店铺订单')
    return store
  }
  async function page(storeId: string) {
    check(storeId)
    let win = windows.get(storeId)
    if (!win || win.isDestroyed()) {
      win = new BrowserWindow({
        width: 1280,
        height: 900,
        show: false,
        autoHideMenuBar: true,
        webPreferences: {
          partition: assistPartition(options.namespace, storeId, 'pdd-web'),
          sandbox: true,
          contextIsolation: true,
          nodeIntegration: false,
          backgroundThrottling: false,
        },
      })
      windows.set(storeId, win)
      win.setTitle('拼多多订单 · 只读采集')
      win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
      const guard = (event: { preventDefault(): void }, url: string) => {
        if (!isAllowedAssistUrl('pdd-web', url)) event.preventDefault()
      }
      win.webContents.on('will-navigate', guard)
      win.webContents.on('will-redirect', guard)
      win.on('close', (event) => {
        if (!closed) {
          event.preventDefault()
          win?.hide()
        }
      })
      win.once('closed', () => windows.delete(storeId))
      await win.loadURL('https://mms.pinduoduo.com/orders/list')
    }
    const deadline = Date.now() + 15000
    while (Date.now() < deadline) {
      check(storeId)
      if (win.isDestroyed() || !isAllowedAssistUrl('pdd-web', win.webContents.getURL()))
        throw Error('平台订单窗口失效')
      if (/login|signin|passport/.test(new URL(win.webContents.getURL()).pathname)) {
        win.show()
        throw Error('请在平台后台完成登录后重试')
      }
      if (
        await win.webContents.executeJavaScript(
          'Boolean(document.querySelector("#pdd-app-skeleton-main-content input"))',
        )
      )
        return win
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    win.show()
    throw Error('平台订单页面尚未就绪，请检查登录与网络')
  }
  async function identity(storeId: string) {
    const store = check(storeId),
      win = await page(storeId)
    if (await win.webContents.executeJavaScript(`(${hasVisiblePddCaptcha.toString()})()`)) {
      win.show()
      throw Error('平台需要人工安全验证，订单采集已暂停')
    }
    const result = identitySchema.parse(
      await win.webContents.executeJavaScript(options.identityScript()),
    )
    check(storeId)
    if (!store.mallId || result.mallId !== store.mallId)
      throw Error('订单后台店铺身份尚未与当前店铺核对')
    return {
      accountId: `${options.accountId()}:${result.mallId}:${result.customerServiceId ?? ''}`,
      platformStoreId: result.mallId,
    }
  }
  return {
    assertActive: options.assertActive,
    identity,
    async readPage(input) {
      input.signal.throwIfAborted()
      const win = await page(input.storeId),
        before = await identity(input.storeId)
      if (
        before.accountId !== input.identity.accountId ||
        before.platformStoreId !== input.identity.platformStoreId
      )
        throw Error('平台账号已变化')
      const execute = async (script: string) => {
        const result: unknown = await win.webContents.executeJavaScript(
          `(async()=>{try{await (${script});return {ok:true}}catch(e){return {ok:false,error:String(e?.message??'平台页面读取失败').slice(0,500)}}})()`,
        )
        const value = z.object({ ok: z.boolean(), error: z.string().optional() }).parse(result)
        if (!value.ok) throw Error(value.error || '平台页面读取失败')
      }
      const evaluate = (stage: 'all' | 'date' | 'query' | 'next') =>
        execute(
          `(${preparePddOrderQuery.toString()})(${JSON.stringify({ range: input.range, stage })})`,
        )
      let previousOrderIds: string[] | undefined
      const raw = () =>
        win.webContents.executeJavaScript(
          `(${readPddOrderDom.toString()})(${JSON.stringify({ range: input.range, platformStoreId: before.platformStoreId, previousOrderIds })})`,
        )
      try {
        if (input.page > 1)
          previousOrderIds = parsePddOrderPage(await raw()).orders.map((row) => row.id)
        if (input.page === 1) {
          // Reset/quick-tab responses remount the date input. Drain them before opening its picker.
          await queries.run(
            win.webContents,
            () => evaluate('all'),
            async () =>
              (await win.webContents.executeJavaScript(
                'Boolean(document.querySelector("#pdd-app-skeleton-main-content [data-testid=beast-core-rangePicker-htmlInput]") && document.querySelector("#pdd-app-skeleton-main-content th"))',
              )) === true,
            input.signal,
            ['/mangkhut/mms/recentOrderList'],
            { requireRequest: false },
          )
        }
        await queries.run(
          win.webContents,
          async () => {
            if (input.page === 1) {
              input.signal.throwIfAborted()
              await execute(`(${configurePddOrderDate.toString()})(${JSON.stringify(input.range)})`)
            }
            input.signal.throwIfAborted()
            await evaluate(input.page === 1 ? 'query' : 'next')
          },
          async () => {
            try {
              return parsePddOrderPage(await raw()).page === input.page
            } catch {
              return false
            }
          },
          input.signal,
          ['/mangkhut/mms/recentOrderList'],
        )
        const result = parsePddOrderPage(await raw()),
          after = await identity(input.storeId)
        input.signal.throwIfAborted()
        if (
          after.accountId !== before.accountId ||
          after.platformStoreId !== before.platformStoreId
        )
          throw Error('平台账号在订单读取中变化')
        return result
      } catch (cause) {
        if (!win.isDestroyed() && !input.signal.aborted) win.show()
        throw cause
      }
    },
    dispose() {
      if (closed) return
      closed = true
      queries.dispose()
      for (const win of windows.values()) if (!win.isDestroyed()) win.destroy()
      windows.clear()
    },
  }
}

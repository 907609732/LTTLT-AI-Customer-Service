import { z } from 'zod'
import type { NativeHistoryDebugger } from './platform-learning-chat'

const origin = 'https://mms.pinduoduo.com'
const detailPath = '/glide/v2/mms/query/commit/on_shop/detail'
const maxBodyBytes = 2 * 1024 * 1024
const idSchema = z
  .union([z.string().trim().min(1).max(200), z.number().int().nonnegative().safe()])
  .transform(String)
const text = (max: number) => z.string().trim().max(max)
const optionalText = (max: number) =>
  text(max)
    .nullish()
    .transform((value) => value ?? '')
const decimalInput = z.union([z.string(), z.number().finite()])
const schema = z.object({
  success: z.literal(true),
  result: z.object({
    goods_id: idSchema,
    mall_id: idSchema,
    out_goods_sn: optionalText(200),
    goods_name: text(500).min(1),
    goods_desc: optionalText(20000),
    skus: z
      .array(
        z.object({
          sku_id: idSchema.nullish(),
          spec: z.array(z.object({ parent_name: text(200), spec_name: text(500) })).max(100),
          out_sku_sn: optionalText(200),
          sku69_code: optionalText(200),
          multi_price_in_yuan: decimalInput.nullish(),
          multi_price: decimalInput.nullish(),
          quantity: decimalInput.nullish(),
        }),
      )
      .max(10000),
  }),
})

export interface NativePlatformProduct {
  productId: string
  mallId: string
  merchantCode: string
  title: string
  description: string
  skus: Array<{
    skuId: string
    specs: Array<{ name: string; value: string }>
    merchantCode: string
    barcode: string
    price: string
    stock: number | null
  }>
}
export interface PlatformProductObserver {
  ready(): Promise<void>
  begin(expected: { productId: string; mallId: string }): void
  wait(signal: AbortSignal, timeoutMs?: number): Promise<NativePlatformProduct>
  dispose(): void
}
interface Page {
  debugger?: NativeHistoryDebugger
  getURL(): string
  isDestroyed(): boolean
}
function integer(value: string | number): bigint {
  if (typeof value === 'number' && !Number.isSafeInteger(value))
    throw Error('商品原生数字超出安全精度')
  const raw = String(value)
  if (!/^\d+$/.test(raw)) throw Error('商品原生整数格式未核实')
  const parsed = BigInt(raw)
  if (parsed > BigInt(Number.MAX_SAFE_INTEGER)) throw Error('商品原生数字超出安全精度')
  return parsed
}
function cents(value: string | number): bigint {
  const raw = String(value)
  if (!/^\d+(?:\.\d{1,2})?$/.test(raw)) throw Error('商品原生价格格式未核实')
  const [whole, fraction = ''] = raw.split('.')
  const amount = BigInt(whole!) * 100n + BigInt(fraction.padEnd(2, '0'))
  if (amount > BigInt(Number.MAX_SAFE_INTEGER)) throw Error('商品原生价格超出安全精度')
  return amount
}
function price(yuan: string | number | null | undefined, fen: string | number | null | undefined) {
  const yuanValue = yuan === null || yuan === undefined ? null : cents(yuan)
  const fenValue = fen === null || fen === undefined ? null : integer(fen)
  if (yuanValue !== null && fenValue !== null && yuanValue !== fenValue)
    throw Error('商品原生价格元与分不一致')
  const value = yuanValue ?? fenValue
  return value === null ? '' : `${value / 100n}.${String(value % 100n).padStart(2, '0')}`
}
function matchesSource(value: unknown) {
  try {
    const url = new URL(String(value))
    return url.origin === origin && url.pathname === detailPath
  } catch {
    return false
  }
}

/** Bounded passive projection of the owned platform page's native detail response; never replays HTTP. */
export function createPlatformProductObserver(page: Page): PlatformProductObserver {
  const api = page.debugger
  if (!api) throw Error('商品原生响应观察接口未就绪')
  if (api.isAttached()) throw Error('商品窗口原生响应观察已被占用，请关闭调试面板后重试')
  api.attach('1.3')
  let epoch = 0,
    closed = false,
    error = ''
  let expected: { productId: string; mallId: string } | undefined
  let result: NativePlatformProduct | undefined
  const requests = new Map<string, { epoch: number; ok: boolean }>()
  const ready = api.sendCommand('Network.enable').then(() => undefined)
  const checkPage = () => {
    if (page.isDestroyed()) throw Error('商品采集窗口已关闭')
    let valid = false
    try {
      valid = new URL(page.getURL()).origin === origin
    } catch {
      /* Invalid page is rejected. */
    }
    if (!valid) throw Error('商品采集页面来源已变化')
  }
  async function readBody(requestId: string, request: { epoch: number }) {
    try {
      const raw: unknown = await api!.sendCommand('Network.getResponseBody', { requestId })
      if (closed || epoch !== request.epoch || !expected) return
      checkPage()
      const response = z.object({ body: z.string(), base64Encoded: z.boolean() }).parse(raw)
      if (response.base64Encoded || Buffer.byteLength(response.body, 'utf8') > maxBodyBytes)
        throw Error('商品原生响应超出观察容量，未截断或采用部分结果')
      const parsed = schema.parse(JSON.parse(response.body)).result
      if (parsed.goods_id !== expected.productId || parsed.mall_id !== expected.mallId)
        throw Error('商品原生响应身份与当前店铺或商品不一致')
      const skus = parsed.skus.map((sku) => ({
        skuId: sku.sku_id ?? '',
        specs: sku.spec.map((spec) => ({ name: spec.parent_name, value: spec.spec_name })),
        merchantCode: sku.out_sku_sn,
        barcode: sku.sku69_code,
        price: price(sku.multi_price_in_yuan, sku.multi_price),
        stock:
          sku.quantity === null || sku.quantity === undefined
            ? null
            : Number(integer(sku.quantity)),
      }))
      const knownIds = skus.map((sku) => sku.skuId).filter(Boolean)
      if (new Set(knownIds).size !== knownIds.length) throw Error('商品原生SKU编号重复')
      result = {
        productId: parsed.goods_id,
        mallId: parsed.mall_id,
        merchantCode: parsed.out_goods_sn,
        title: parsed.goods_name,
        description: parsed.goods_desc,
        skus,
      }
    } catch (cause) {
      if (!closed && epoch === request.epoch)
        error =
          cause instanceof Error && /身份|容量|精度|价格|编号/.test(cause.message)
            ? cause.message
            : '商品原生响应字段未识别，未采用不完整结果'
    }
  }
  const onMessage = (_event: unknown, method: string, input: unknown) => {
    if (closed || !expected || !input || typeof input !== 'object') return
    const data = input as Record<string, unknown>
    if (typeof data.requestId !== 'string') return
    const requestId = data.requestId
    if (method === 'Network.requestWillBeSent') {
      const request = data.request
      if (!request || typeof request !== 'object' || !['XHR', 'Fetch'].includes(String(data.type)))
        return
      if (!matchesSource(Reflect.get(request, 'url'))) return
      if (requests.size >= 1000) {
        error = '商品原生请求观察容量已满'
        return
      }
      requests.set(requestId, { epoch, ok: false })
      return
    }
    const request = requests.get(requestId)
    if (!request || request.epoch !== epoch) return
    if (method === 'Network.responseReceived') {
      const response = data.response
      request.ok =
        !!response &&
        typeof response === 'object' &&
        matchesSource(Reflect.get(response, 'url')) &&
        Reflect.get(response, 'status') === 200 &&
        /json/i.test(String(Reflect.get(response, 'mimeType')))
    } else if (method === 'Network.loadingFinished') {
      requests.delete(requestId)
      if (
        typeof data.encodedDataLength !== 'number' ||
        !Number.isFinite(data.encodedDataLength) ||
        data.encodedDataLength < 0 ||
        data.encodedDataLength > maxBodyBytes
      ) {
        error = '商品原生响应超出观察容量，未截断'
        return
      }
      if (!request.ok) {
        error = '平台商品查询请求失败，未采用结果'
        return
      }
      void readBody(requestId, request)
    } else if (method === 'Network.loadingFailed') {
      requests.delete(requestId)
      error = '平台商品查询请求失败，未采用结果'
    }
  }
  const onDetach = () => {
    if (!closed) error = '商品原生响应观察已中断，请重新采集'
  }
  api.on('message', onMessage)
  api.on('detach', onDetach)
  return {
    ready: () => ready,
    begin(value) {
      expected = z.object({ productId: idSchema, mallId: idSchema }).strict().parse(value)
      epoch++
      result = undefined
      error = ''
      requests.clear()
    },
    async wait(signal, timeoutMs = 10000) {
      await ready
      const generation = epoch,
        until = Date.now() + timeoutMs
      do {
        signal.throwIfAborted()
        if (closed || error) throw Error(error || '商品原生响应观察已关闭')
        if (generation !== epoch) throw Error('商品原生响应观察范围已变化')
        checkPage()
        if (result) return structuredClone(result)
        await new Promise<void>((resolve) => setTimeout(resolve, 20))
      } while (Date.now() < until)
      throw Error('尚未确认平台商品详情原生响应，请检查平台后重试')
    },
    dispose() {
      if (closed) return
      closed = true
      epoch++
      expected = undefined
      result = undefined
      requests.clear()
      api.removeListener('message', onMessage)
      api.removeListener('detach', onDetach)
      try {
        if (api.isAttached()) api.detach()
      } catch {
        /* Owned window teardown detached it. */
      }
    },
  }
}

export type PlatformProductEntryResult =
  | { status: 'blocked'; reason: string }
  | { status: 'opened' }
export interface PlatformProductEntryObserver {
  ready(): Promise<void>
  begin(productId: string): void
  wait(signal: AbortSignal, timeoutMs?: number): Promise<PlatformProductEntryResult>
  dispose(): void
}
const entryPath = '/glide/v2/mms/edit/commit/create_by_sn'
const entryId = z
  .union([z.string().min(1).max(200).regex(/^\d+$/), z.number().int().positive().safe()])
  .transform(String)
const entryResponseSchema = z.object({
  success: z.boolean(),
  error_code: z.number().int().optional(),
  error_msg: z.string().max(20000).optional(),
  result: z.unknown().optional(),
})
function matchesEntrySource(value: unknown) {
  try {
    const url = new URL(String(value))
    return url.origin === origin && url.pathname === entryPath
  } catch {
    return false
  }
}

/** Observes the list page's native edit-entry result; only verified 900009 is a blocked item. */
export function createPlatformProductEntryObserver(page: Page): PlatformProductEntryObserver {
  const api = page.debugger
  if (!api) throw Error('商品编辑入口原生观察接口未就绪')
  if (api.isAttached()) throw Error('商品窗口原生响应观察已被占用，请关闭调试面板后重试')
  api.attach('1.3')
  const ready = api.sendCommand('Network.enable').then(() => undefined)
  let epoch = 0,
    closed = false,
    error = '',
    expected = ''
  let result: PlatformProductEntryResult | undefined
  const requests = new Map<string, { epoch: number; ok: boolean }>()
  const checkPage = () => {
    if (page.isDestroyed()) throw Error('商品编辑入口窗口已关闭')
    try {
      if (new URL(page.getURL()).origin === origin) return
    } catch {
      /* Reject unverified origins. */
    }
    throw Error('商品编辑入口页面来源已变化')
  }
  async function body(requestId: string, request: { epoch: number }) {
    try {
      const value: unknown = await api!.sendCommand('Network.getResponseBody', { requestId })
      if (closed || request.epoch !== epoch) return
      checkPage()
      const response = z.object({ body: z.string(), base64Encoded: z.boolean() }).parse(value)
      if (response.base64Encoded || Buffer.byteLength(response.body, 'utf8') > 65536)
        throw Error('商品编辑入口响应超出观察容量')
      const parsed = entryResponseSchema.parse(JSON.parse(response.body))
      if (parsed.result && typeof parsed.result === 'object') {
        const responseId = Reflect.get(parsed.result, 'goods_id')
        if (responseId !== undefined && entryId.parse(responseId) !== expected)
          throw Error('商品编辑入口响应商品身份不符')
      }
      if (parsed.success) {
        result = { status: 'opened' }
      } else if (parsed.error_code === 900009) {
        result = {
          status: 'blocked',
          reason: (parsed.error_msg || '商品禁售中，不可编辑')
            .replace(/\p{Cc}/gu, ' ')
            .trim()
            .slice(0, 1000),
        }
      } else {
        throw Error('平台商品编辑入口查询失败，未将验证码或权限错误当作禁售跳过')
      }
    } catch (cause) {
      if (!closed && request.epoch === epoch)
        error =
          cause instanceof Error && /身份|容量|查询失败/.test(cause.message)
            ? cause.message
            : '平台商品编辑入口查询失败，原生响应未识别'
    }
  }
  const onMessage = (_event: unknown, method: string, input: unknown) => {
    if (closed || !expected || !input || typeof input !== 'object') return
    const data = input as Record<string, unknown>
    if (typeof data.requestId !== 'string') return
    const requestId = data.requestId
    if (method === 'Network.requestWillBeSent') {
      const request = data.request
      if (
        !request ||
        typeof request !== 'object' ||
        !['XHR', 'Fetch'].includes(String(data.type)) ||
        !matchesEntrySource(Reflect.get(request, 'url'))
      )
        return
      // The observed native request is POST JSON {goods_id}; other guessed aliases are rejected.
      try {
        if (Reflect.get(request, 'method') !== 'POST') throw Error('method')
        const postData = Reflect.get(request, 'postData')
        if (typeof postData !== 'string' || Buffer.byteLength(postData, 'utf8') > 16384)
          throw Error('postData')
        const id = z.object({ goods_id: entryId }).parse(JSON.parse(postData)).goods_id
        if (id !== expected) throw Error('goods_id')
      } catch {
        error = '商品编辑入口请求商品身份尚未核实，未采用结果'
        return
      }
      if (requests.size >= 100) {
        error = '商品编辑入口观察容量已满'
        return
      }
      requests.set(requestId, { epoch, ok: false })
      return
    }
    const request = requests.get(requestId)
    if (!request || request.epoch !== epoch) return
    if (method === 'Network.responseReceived') {
      const response = data.response
      request.ok =
        !!response &&
        typeof response === 'object' &&
        matchesEntrySource(Reflect.get(response, 'url')) &&
        Reflect.get(response, 'status') === 200 &&
        /json/i.test(String(Reflect.get(response, 'mimeType')))
    } else if (method === 'Network.loadingFinished') {
      requests.delete(requestId)
      if (
        typeof data.encodedDataLength !== 'number' ||
        !Number.isFinite(data.encodedDataLength) ||
        data.encodedDataLength < 0 ||
        data.encodedDataLength > 65536
      ) {
        error = '商品编辑入口响应超出观察容量'
        return
      }
      if (!request.ok) {
        error = '平台商品编辑入口查询失败，未采用结果'
        return
      }
      void body(requestId, request)
    } else if (method === 'Network.loadingFailed') {
      requests.delete(requestId)
      error = '平台商品编辑入口查询失败，未采用结果'
    }
  }
  const onDetach = () => {
    if (!closed) error = '商品编辑入口原生观察已中断'
  }
  api.on('message', onMessage)
  api.on('detach', onDetach)
  return {
    ready: () => ready,
    begin(productId) {
      expected = entryId.parse(productId)
      epoch++
      result = undefined
      error = ''
      requests.clear()
    },
    async wait(signal, timeoutMs = 10000) {
      await ready
      const generation = epoch,
        until = Date.now() + timeoutMs
      do {
        signal.throwIfAborted()
        if (closed || error) throw Error(error || '商品编辑入口观察已关闭')
        if (generation !== epoch) throw Error('商品编辑入口观察范围已变化')
        checkPage()
        if (result) return structuredClone(result)
        await new Promise<void>((resolve) => setTimeout(resolve, 20))
      } while (Date.now() < until)
      throw Error('尚未确认平台商品编辑入口响应，请检查平台后重试')
    },
    dispose() {
      if (closed) return
      closed = true
      epoch++
      expected = ''
      result = undefined
      requests.clear()
      api.removeListener('message', onMessage)
      api.removeListener('detach', onDetach)
      try {
        if (api.isAttached()) api.detach()
      } catch {
        /* Owned page teardown detached it. */
      }
    },
  }
}

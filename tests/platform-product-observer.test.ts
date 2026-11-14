// @vitest-environment node
import { EventEmitter } from 'node:events'
import { expect, it } from 'vitest'
import {
  createPlatformProductObserver,
  createPlatformProductEntryObserver,
} from '../electron/platform-product-observer'
import type { NativeHistoryDebugger } from '../electron/platform-learning-chat'

const nativePath = '/glide/v2/mms/query/commit/on_shop/detail'
const nativeUrl = `https://mms.pinduoduo.com${nativePath}`
const record = () => ({
  success: true,
  result: {
    goods_id: 123,
    mall_id: '456',
    out_goods_sn: 'GOODS-CODE',
    goods_name: '门卡',
    goods_desc: '仅支持明确型号',
    secret: 'must-not-project',
    skus: [
      {
        sku_id: '9007199254740993',
        id: 'commit-id-not-sku-id',
        spec: [{ parent_name: '版本', spec_name: '国内版' }],
        out_sku_sn: 'CN-CODE',
        sku69_code: '6901234567892',
        multi_price_in_yuan: '32.00',
        multi_price: 3200,
        quantity: 0,
        quantity_delta: 99,
      },
    ],
  },
})
class DebuggerFixture extends EventEmitter {
  attached = false
  bodies = new Map<string, unknown>()
  calls: string[] = []
  attach() {
    this.attached = true
  }
  detach() {
    this.attached = false
  }
  isAttached() {
    return this.attached
  }
  async sendCommand(method: string, input?: { requestId?: string }) {
    this.calls.push(method)
    return method === 'Network.getResponseBody'
      ? { body: JSON.stringify(this.bodies.get(input?.requestId ?? '')), base64Encoded: false }
      : {}
  }
  request(id: string, url = nativeUrl) {
    this.emit('message', {}, 'Network.requestWillBeSent', {
      requestId: id,
      type: 'XHR',
      request: { url },
    })
  }
  finish(id: string, body: unknown, url = nativeUrl, size = 100) {
    this.bodies.set(id, body)
    this.emit('message', {}, 'Network.responseReceived', {
      requestId: id,
      response: { url, status: 200, mimeType: 'application/json' },
    })
    this.emit('message', {}, 'Network.loadingFinished', { requestId: id, encodedDataLength: size })
  }
  response(id: string, body: unknown, url = nativeUrl) {
    this.request(id, url)
    this.finish(id, body, url)
  }
}
function fixture() {
  const api = new DebuggerFixture()
  const observer = createPlatformProductObserver({
    debugger: api as unknown as NativeHistoryDebugger,
    getURL: () => 'https://mms.pinduoduo.com/goods/goods_add?goods_id=123',
    isDestroyed: () => false,
  })
  observer.begin({ productId: '123', mallId: '456' })
  return { api, observer }
}
const signal = () => new AbortController().signal
it('仅投影页面自身响应的真实商品SKU字段，编码与条码独立，零库存保留', async () => {
  const { api, observer } = fixture()
  try {
    await observer.ready()
    api.response('detail', record())
    expect(await observer.wait(signal())).toEqual({
      productId: '123',
      mallId: '456',
      merchantCode: 'GOODS-CODE',
      title: '门卡',
      description: '仅支持明确型号',
      skus: [
        {
          skuId: '9007199254740993',
          specs: [{ name: '版本', value: '国内版' }],
          merchantCode: 'CN-CODE',
          barcode: '6901234567892',
          price: '32.00',
          stock: 0,
        },
      ],
    })
    expect(api.calls).toEqual(['Network.enable', 'Network.getResponseBody'])
  } finally {
    observer.dispose()
  }
  expect(api.attached).toBe(false)
  expect(api.listenerCount('message')).toBe(0)
})
it('缺少sku_id不使用提交id，条码缺失不回填商家编码，分价格精确转元', async () => {
  const { api, observer } = fixture()
  try {
    await observer.ready()
    const value = record()
    const sku: Record<string, unknown> = { ...value.result.skus[0], multi_price: 1 }
    delete sku.sku_id
    delete sku.sku69_code
    delete sku.multi_price_in_yuan
    delete sku.quantity
    api.response('detail', { ...value, result: { ...value.result, skus: [sku] } })
    expect((await observer.wait(signal())).skus[0]).toMatchObject({
      skuId: '',
      barcode: '',
      merchantCode: 'CN-CODE',
      price: '0.01',
      stock: null,
    })
  } finally {
    observer.dispose()
  }
})
it('忽略其他路径和来源以及上轮响应，不读取它们的body', async () => {
  const { api, observer } = fixture()
  try {
    await observer.ready()
    api.response('other', { secret: true }, 'https://mms.pinduoduo.com/private/other')
    api.response('foreign', record(), `https://example.com${nativePath}`)
    api.request('old')
    observer.begin({ productId: '123', mallId: '456' })
    api.finish('old', record())
    await expect(observer.wait(signal(), 25)).rejects.toThrow('尚未')
    expect(api.calls).toEqual(['Network.enable'])
  } finally {
    observer.dispose()
  }
})
it.each(['goods_id', 'mall_id'] as const)('拒绝身份不符：%s，begin清除旧结果', async (field) => {
  const { api, observer } = fixture()
  try {
    await observer.ready()
    api.response('first', record())
    await observer.wait(signal())
    observer.begin({ productId: '123', mallId: '456' })
    const value = record()
    api.response('wrong', { ...value, result: { ...value.result, [field]: 'other' } })
    await expect(observer.wait(signal())).rejects.toThrow('身份')
  } finally {
    observer.dispose()
  }
})
it.each(['unsafe-id', 'unsafe-stock', 'price-mismatch', 'negative-price'])(
  '拒绝不可安全使用的数字：%s',
  async (kind) => {
    const { api, observer } = fixture()
    try {
      await observer.ready()
      const value = record()
      const sku: Record<string, unknown> = { ...value.result.skus[0] }
      if (kind === 'unsafe-id') sku.sku_id = 9007199254740992
      if (kind === 'unsafe-stock') sku.quantity = '9007199254740992'
      if (kind === 'price-mismatch') sku.multi_price = 3300
      if (kind === 'negative-price') sku.multi_price_in_yuan = '-1'
      api.response('bad', { ...value, result: { ...value.result, skus: [sku] } })
      await expect(observer.wait(signal())).rejects.toThrow()
    } finally {
      observer.dispose()
    }
  },
)
it('拒绝跨源重定向及超大响应，不读取body', async () => {
  const { api, observer } = fixture()
  try {
    await observer.ready()
    api.request('redirect')
    api.finish('redirect', record(), 'https://example.com/private')
    await expect(observer.wait(signal())).rejects.toThrow('请求失败')
    observer.begin({ productId: '123', mallId: '456' })
    api.request('large')
    api.finish('large', record(), nativeUrl, 2097153)
    await expect(observer.wait(signal())).rejects.toThrow('容量')
    expect(api.calls).toEqual(['Network.enable'])
  } finally {
    observer.dispose()
  }
})
it('取消、观察断开与占用明确失败，dispose幂等', async () => {
  const { api, observer } = fixture()
  try {
    await observer.ready()
    const controller = new AbortController()
    controller.abort()
    await expect(observer.wait(controller.signal)).rejects.toThrow()
    api.emit('detach', {}, 'target_closed')
    await expect(observer.wait(signal())).rejects.toThrow('中断')
    expect(() =>
      createPlatformProductObserver({
        debugger: api as unknown as NativeHistoryDebugger,
        getURL: () => nativeUrl,
        isDestroyed: () => false,
      }),
    ).toThrow('占用')
  } finally {
    observer.dispose()
    observer.dispose()
  }
})

const entryPath = '/glide/v2/mms/edit/commit/create_by_sn'
const entryUrl = `https://mms.pinduoduo.com${entryPath}`
function entryFixture() {
  const api = new DebuggerFixture()
  const observer = createPlatformProductEntryObserver({
    debugger: api as unknown as NativeHistoryDebugger,
    getURL: () => 'https://mms.pinduoduo.com/goods/goods_list',
    isDestroyed: () => false,
  })
  observer.begin('123')
  return { api, observer }
}
function entryResponse(api: DebuggerFixture, id: string, body: unknown, productId: unknown = 123) {
  api.emit('message', {}, 'Network.requestWillBeSent', {
    requestId: id,
    type: 'XHR',
    request: { url: entryUrl, method: 'POST', postData: JSON.stringify({ goods_id: productId }) },
  })
  api.finish(id, body, entryUrl)
}
it('编辑入口仅900009明确禁售可标blocked，安全截限原因而不暴露响应', async () => {
  const { api, observer } = entryFixture()
  try {
    await observer.ready()
    entryResponse(api, 'blocked', {
      success: false,
      error_code: 900009,
      error_msg: '禁售'.repeat(600),
      result: null,
      private: 'not-projected',
    })
    const result = await observer.wait(signal())
    expect(result.status).toBe('blocked')
    if (result.status === 'blocked') expect(result.reason.length).toBe(1000)
    expect(JSON.stringify(result)).not.toContain('not-projected')
    observer.begin('123')
    entryResponse(api, 'success', {
      success: true,
      result: { goods_id: '123', goods_commit_id: 'not-projected' },
    })
    expect(await observer.wait(signal())).toEqual({ status: 'opened' })
  } finally {
    observer.dispose()
  }
})
it.each([10001, 401, 900010])('编辑入口其他错误%s不得当禁售跳过', async (errorCode) => {
  const { api, observer } = entryFixture()
  try {
    await observer.ready()
    entryResponse(api, 'failed', {
      success: false,
      error_code: errorCode,
      error_msg: '验证或权限错误',
      result: null,
    })
    await expect(observer.wait(signal())).rejects.toThrow('查询失败')
  } finally {
    observer.dispose()
  }
})
it.each([12345, 'commit-sn', null])(
  '原生入口成功结果为%s时只表明受理，不拿提交ID代替商品身份',
  async (result) => {
    const { api, observer } = entryFixture()
    try {
      await observer.ready()
      entryResponse(api, 'opened', { success: true, result })
      expect(await observer.wait(signal())).toEqual({ status: 'opened' })
    } finally {
      observer.dispose()
    }
  },
)
it.each(['456', 9007199254740992])('编辑入口拒绝不匹配或不安全请求商品ID %s', async (productId) => {
  const { api, observer } = entryFixture()
  try {
    await observer.ready()
    entryResponse(api, 'mismatch', { success: false, error_code: 900009, result: null }, productId)
    await expect(observer.wait(signal())).rejects.toThrow('身份')
    expect(api.calls).toEqual(['Network.enable'])
  } finally {
    observer.dispose()
  }
})
it('编辑入口begin清除旧请求结果，取消和dispose均停止等待', async () => {
  const { api, observer } = entryFixture()
  try {
    await observer.ready()
    entryResponse(api, 'success', { success: true, result: { goods_id: 123 } }, '123')
    expect(await observer.wait(signal())).toEqual({ status: 'opened' })
    observer.begin('123')
    await expect(observer.wait(signal(), 25)).rejects.toThrow('尚未')
    const controller = new AbortController()
    controller.abort()
    await expect(observer.wait(controller.signal)).rejects.toThrow()
    observer.dispose()
    await expect(observer.wait(signal())).rejects.toThrow('关闭')
  } finally {
    observer.dispose()
  }
  expect(api.attached).toBe(false)
})
it('编辑入口没有可核验的请求商品身份时不将禁售错误记到当前商品', async () => {
  const { api, observer } = entryFixture()
  try {
    await observer.ready()
    api.response(
      'entry',
      { success: false, error_code: 900009, error_msg: '商品禁售中，不可编辑', result: null },
      entryUrl,
    )
    await expect(observer.wait(signal(), 30)).rejects.toThrow('身份')
  } finally {
    observer.dispose()
  }
})
it('编辑入口观察忽略其他路径和来源，不读取无关响应', async () => {
  const { api, observer } = entryFixture()
  try {
    await observer.ready()
    api.response('foreign', { private: true }, `https://example.com${entryPath}`)
    api.response('different', { private: true }, nativeUrl)
    await expect(observer.wait(signal(), 25)).rejects.toThrow('尚未')
    expect(api.calls).toEqual(['Network.enable'])
  } finally {
    observer.dispose()
  }
})

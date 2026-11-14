import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import {
  advancePddProductSkuViewport,
  readPddProductDetail,
} from '../electron/platform-product-dom'

function fixture() {
  document.body.innerHTML = `<div>无关导航政策与推荐商品</div><main id="goods_create">
    <h1>编辑商品 商品ID: 12345678</h1>
    <div id="basic.goods_name"><input value="纯棉上衣"></div>
    <div id="property"><div id="basic.propertys.0.value"><label>材质</label><input value="纯棉"></div></div>
    <div id="detail_pic"><div>上传图片 查看教程</div><div contenteditable="true">实际商品说明</div><img src="https://img.example.com/detail.png"><i style="background-image:url('https://img.example.com/background.png')"></i><img src="http://unsafe.example.com/x"></div>
    <div id="sku.out_goods_sn"><input value="TOP-01"></div>
    <section id="sku"><table><thead><tr><th>颜色</th><th>尺码</th><th>当前库存</th><th>库存增减</th><th>改后库存</th><th>*拼单价(元)</th><th>单买价(元)</th><th>规格编码</th><th>商品条形码</th></tr></thead>
    <tbody><tr><td rowspan="2">红色</td><td>M</td><td>0</td><td><input value="900"></td><td><input value="900"></td><td><input value="19.90"></td><td><input value="22"></td><td><input value="RED-M"></td><td><input value="0691234567890"></td></tr>
    <tr><td>L</td><td>12</td><td><input value="3"></td><td><input value="15"></td><td><input value="20.90"></td><td><input value="24"></td><td><input value="RED-L"></td><td><input value=""></td></tr></tbody></table></section>
    <button id="submit_button">提交</button><button>保存草稿</button></main>`
}
beforeEach(() => {
  vi.stubGlobal(
    'location',
    new URL('https://mms.pinduoduo.com/goods/goods_add/index?goods_id=12345678&type=edit'),
  )
  fixture()
})
afterEach(() => vi.unstubAllGlobals())

it('reads only product fields, preserves SKU dimensions and distinct barcode, and never edits fields', () => {
  const clicked = vi.fn()
  document.querySelector('#submit_button')?.addEventListener('click', clicked)
  const data = readPddProductDetail('12345678')
  expect(data).toMatchObject({
    productId: '12345678',
    title: '纯棉上衣',
    merchantCode: 'TOP-01',
    description: '实际商品说明',
    attributes: [{ name: '材质', value: '纯棉' }],
    detailStatus: 'partial',
  })
  expect(data.skus).toEqual([
    {
      skuId: '',
      specs: [
        { name: '颜色', value: '红色' },
        { name: '尺码', value: 'M' },
      ],
      merchantCode: 'RED-M',
      barcode: '0691234567890',
      price: '19.90',
      stock: 0,
    },
    {
      skuId: '',
      specs: [
        { name: '颜色', value: '红色' },
        { name: '尺码', value: 'L' },
      ],
      merchantCode: 'RED-L',
      barcode: '',
      price: '20.90',
      stock: 12,
    },
  ])
  expect(data.images).toEqual([
    'https://img.example.com/detail.png',
    'https://img.example.com/background.png',
  ])
  expect(JSON.stringify(data)).not.toMatch(/无关导航|查看教程|库存增减/)
  expect(clicked).not.toHaveBeenCalled()
})
it('does not invent SKU identifiers or use merchant codes as barcodes when columns are absent', () => {
  document.querySelectorAll('tr').forEach((row) => row.lastElementChild?.remove())
  const data = readPddProductDetail('12345678')
  expect(data.skus.map((sku) => [sku.skuId, sku.barcode])).toEqual([
    ['', ''],
    ['', ''],
  ])
})
it('requires exact expected product in URL and visible editor identity', () => {
  expect(() => readPddProductDetail('other')).toThrow('商品身份')
  document.querySelector('h1')!.textContent = '商品ID: 87654321'
  expect(() => readPddProductDetail('12345678')).toThrow('商品身份')
})
it('rejects untrusted origins and missing or empty SKU tables', () => {
  vi.stubGlobal('location', new URL('https://example.com/goods?goods_id=12345678'))
  expect(() => readPddProductDetail('12345678')).toThrow('来源')
  vi.stubGlobal(
    'location',
    new URL('https://mms.pinduoduo.com/goods/goods_add/index?goods_id=12345678'),
  )
  document.querySelector('tbody')!.innerHTML = ''
  expect(() => readPddProductDetail('12345678')).toThrow('SKU')
})
it('can be serialized as a standalone page function without module dependencies', () => {
  const run = Function(`return (${readPddProductDetail.toString()})('12345678')`)
  expect(run().skus).toHaveLength(2)
})

it('reads native sticky headers and scrolling SKU body split into separate Beast tables', () => {
  const table = document.querySelector<HTMLTableElement>('#sku table')!
  const wrapper = document.createElement('div')
  wrapper.setAttribute('data-testid', 'beast-core-table')
  const header = document.createElement('div')
  header.setAttribute('data-testid', 'beast-core-table-middle-header')
  const body = document.createElement('div')
  body.setAttribute('data-testid', 'beast-core-table-middle-body')
  const headerTable = table.cloneNode(true) as HTMLTableElement
  headerTable.tBodies[0]?.remove()
  const bodyTable = table.cloneNode(true) as HTMLTableElement
  bodyTable.tHead?.remove()
  header.append(headerTable)
  body.append(bodyTable)
  wrapper.append(header, body)
  table.replaceWith(wrapper)
  const data = readPddProductDetail('12345678')
  expect(data.skus).toHaveLength(2)
  expect(data.skus[0]).toMatchObject({ merchantCode: 'RED-M', price: '19.90', stock: 0 })
  expect(data.skus[1]).toMatchObject({ merchantCode: 'RED-L', price: '20.90', stock: 12 })
  expect(data.skus[1].specs).toEqual([
    { name: '颜色', value: '红色' },
    { name: '尺码', value: 'L' },
  ])
  body.append(bodyTable.cloneNode(true))
  expect(() => readPddProductDetail('12345678')).toThrow('SKU')
})

it('advances only the native virtual SKU viewport with overlapping bounded steps', () => {
  const table = document.querySelector('#sku table')!
  table.querySelector('tbody')!.setAttribute('data-testid', 'beast-core-table-middle-tbody')
  const viewport = document.createElement('div')
  viewport.style.overflowY = 'scroll'
  table.replaceWith(viewport)
  viewport.append(table)
  Object.defineProperties(viewport, {
    clientHeight: { value: 400 },
    scrollHeight: { value: 1000 },
    scrollTop: { value: 0, writable: true },
  })
  const clicked = vi.fn()
  document.querySelector('#submit_button')!.addEventListener('click', clicked)
  expect(advancePddProductSkuViewport()).toEqual({ advanced: true, position: 300 })
  expect(advancePddProductSkuViewport()).toEqual({ advanced: true, position: 600 })
  expect(advancePddProductSkuViewport()).toEqual({ advanced: false, position: 600 })
  expect(clicked).not.toHaveBeenCalled()
  const run = Function(`return (${advancePddProductSkuViewport.toString()})()`)
  expect(run()).toEqual({ advanced: false, position: 600 })
})

it('does not scroll the whole editor or unrelated scroll areas when no virtual SKU viewport exists', () => {
  const editor = document.querySelector<HTMLElement>('#goods_create')!
  Object.defineProperties(editor, {
    clientHeight: { value: 400 },
    scrollHeight: { value: 2000 },
    scrollTop: { value: 40, writable: true },
  })
  expect(advancePddProductSkuViewport()).toEqual({ advanced: false, position: 0 })
  expect(editor.scrollTop).toBe(40)
  vi.stubGlobal('location', new URL('https://example.com/goods?goods_id=12345678'))
  expect(() => advancePddProductSkuViewport()).toThrow('来源')
})

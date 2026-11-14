import type { PlatformProductDetail } from '../src/shared/contracts/platform-product'

/** Advance just the observed native SKU virtual table; never scroll the editor or edit a form. */
export function advancePddProductSkuViewport(): { advanced: boolean; position: number } {
  const url = new URL(location.href)
  if (url.origin !== 'https://mms.pinduoduo.com' || url.username || url.password)
    throw Error('商品详情页面来源无效')
  const root = document.getElementById('goods_create')
  const expected = url.searchParams.get('goods_id')
  const text = (root as HTMLElement | null)?.innerText || root?.textContent || ''
  if (!root || !expected || text.match(/商品\s*ID\s*[:：]\s*(\d+)/i)?.[1] !== expected)
    throw Error('商品身份尚未核对，未滚动SKU')
  const tbody = root.querySelector(
    '#sku [data-testid="beast-core-table-middle-tbody"],#goods-spec-sku [data-testid="beast-core-table-middle-tbody"]',
  )
  let node = tbody?.parentElement
  while (node && node !== root && root.contains(node)) {
    if (
      node.clientHeight > 0 &&
      node.scrollHeight > node.clientHeight &&
      /^(?:auto|scroll)$/.test(getComputedStyle(node).overflowY)
    ) {
      const previous = node.scrollTop
      const maximum = node.scrollHeight - node.clientHeight
      if (previous >= maximum - 1) return { advanced: false, position: previous }
      node.scrollTop = Math.min(
        maximum,
        previous + Math.max(1, Math.floor(node.clientHeight * 0.75)),
      )
      return { advanced: node.scrollTop > previous, position: node.scrollTop }
    }
    node = node.parentElement
  }
  return { advanced: false, position: 0 }
}

/** Runs in the native editor page: only reads verified product fields, never dispatches edits. */
export function readPddProductDetail(productId: string): PlatformProductDetail {
  const url = new URL(location.href)
  if (url.origin !== 'https://mms.pinduoduo.com' || url.username || url.password)
    throw Error('商品详情页面来源无效')
  const root = document.getElementById('goods_create')
  const text = (node: Element | null | undefined) =>
    ((node as HTMLElement | null)?.innerText || node?.textContent || '').trim()
  if (
    !root ||
    url.searchParams.get('goods_id') !== productId ||
    text(root).match(/商品\s*ID\s*[:：]\s*(\d+)/i)?.[1] !== productId
  )
    throw Error('商品身份尚未核对，未采用详情')
  const byId = (id: string) => {
    const node = document.getElementById(id)
    return node && root.contains(node) ? node : null
  }
  const fieldValue = (node: Element | null | undefined) => {
    const input = node?.matches('input,textarea')
      ? (node as HTMLInputElement)
      : node?.querySelector<HTMLInputElement | HTMLTextAreaElement>('input,textarea')
    return input ? input.value.trim() : text(node)
  }
  const title = fieldValue(byId('basic.goods_name') || byId('goods_name'))
  if (!title) throw Error('商品详情标题尚未加载')
  const table = Array.from(
    root.querySelectorAll<HTMLTableElement>('#sku table, #goods-spec-sku table'),
  ).find((node) => /当前库存/.test(text(node.tHead)) && /拼单价/.test(text(node.tHead)))
  if (!table || !table.tHead) throw Error('商品SKU表格尚未加载')
  let body = table.tBodies[0]
  if (!body) {
    // Beast renders long SKU lists with a sticky header and a separate scrolling body table.
    // Pair only within the exact native table instance, never with a nearby unrelated table.
    const wrapper = table.closest('[data-testid="beast-core-table"]')
    const bodies = wrapper
      ? Array.from(
          wrapper.querySelectorAll<HTMLTableSectionElement>(
            '[data-testid="beast-core-table-middle-body"] table > tbody',
          ),
        )
      : []
    if (bodies.length !== 1) throw Error('商品SKU滚动表体尚未唯一核对')
    body = bodies[0]
  }
  const headers = Array.from(table.tHead.querySelectorAll('tr:last-child th')).map((cell) =>
    text(cell).replace(/\s+/g, '').replace(/^\*/, ''),
  )
  const stockIndex = headers.findIndex((header) => header === '当前库存')
  const priceIndex = headers.findIndex((header) => /^拼单价(?:\(元\)|（元）)$/.test(header))
  const codeIndex = headers.findIndex((header) =>
    /^(?:规格编码|SKU商家编码|商家编码)$/i.test(header),
  )
  const barcodeIndex = headers.findIndex((header) => /^(?:商品|SKU)?(?:条形码|条码)$/i.test(header))
  const skuIdIndex = headers.findIndex((header) => /^SKU(?:ID|编号)$/i.test(header))
  if (stockIndex < 1 || priceIndex < 0 || new Set(headers).size !== headers.length)
    throw Error('商品SKU字段或价格单位尚未核对')
  const dimensions = headers
    .slice(0, stockIndex)
    .map((name, index) => ({ name, index }))
    .filter(({ index }) => index !== skuIdIndex)
  if (!dimensions.length || dimensions.some(({ name }) => !name))
    throw Error('商品SKU规格维度尚未核对')
  const nativeRows = Array.from(body.rows)
  if (!nativeRows.length || nativeRows.length > 1000) throw Error('商品SKU数量尚未核对')
  const carry = new Map<number, { cell: HTMLTableCellElement; remaining: number }>()
  const skus = nativeRows.map((row) => {
    const cells: HTMLTableCellElement[] = []
    for (const [index, entry] of carry) {
      cells[index] = entry.cell
      if (--entry.remaining === 0) carry.delete(index)
    }
    let column = 0
    for (const cell of Array.from(row.cells)) {
      while (cells[column]) column++
      if (cell.colSpan !== 1 || cell.rowSpan < 1 || cell.rowSpan > nativeRows.length)
        throw Error('商品SKU合并单元格未核对')
      cells[column] = cell
      if (cell.rowSpan > 1) carry.set(column, { cell, remaining: cell.rowSpan - 1 })
      column++
    }
    if (cells.length !== headers.length || Array.from(cells).some((cell) => !cell))
      throw Error('商品SKU表格行不完整')
    const specs = dimensions.map(({ name, index }) => ({ name, value: fieldValue(cells[index]) }))
    if (specs.some((spec) => !spec.value)) throw Error('商品SKU规格值尚未加载')
    const stockText = fieldValue(cells[stockIndex]).replace(/,/g, '')
    const stock = /^\d+$/.test(stockText) ? Number(stockText) : null
    if (stock !== null && !Number.isSafeInteger(stock)) throw Error('商品SKU库存超出范围')
    const price = fieldValue(cells[priceIndex])
    if (price && !/^\d+(?:\.\d{1,2})?$/.test(price)) throw Error('商品SKU拼单价格式未核对')
    return {
      skuId:
        skuIdIndex >= 0
          ? fieldValue(cells[skuIdIndex])
          : (row.getAttribute('data-sku-id') || '').trim(),
      specs,
      merchantCode: codeIndex >= 0 ? fieldValue(cells[codeIndex]) : '',
      barcode: barcodeIndex >= 0 ? fieldValue(cells[barcodeIndex]) : '',
      price,
      stock,
    }
  })
  if (carry.size) throw Error('商品SKU合并行尚未读取完整')
  const signatures = skus.map((sku) => JSON.stringify(sku.specs))
  if (new Set(signatures).size !== signatures.length) throw Error('商品SKU规格组合重复')
  const attributes = Array.from(root.querySelectorAll('#property [id^="basic.propertys."]'))
    .filter((node) => /\.value$/.test(node.id))
    .flatMap((node) => {
      const name =
        text(node.querySelector('label,[class*="label"]')) || text(node).split(/\r?\n/)[0] || ''
      const values = Array.from(node.querySelectorAll<HTMLInputElement>('input'))
        .filter((input) => !['file', 'checkbox', 'radio'].includes(input.type))
        .map((input) => input.value.trim())
        .filter(Boolean)
      for (const input of Array.from(node.querySelectorAll<HTMLInputElement>('input:checked'))) {
        const selected = text(input.closest('label'))
        if (selected) values.push(selected)
      }
      return name && values.length
        ? [{ name: name.replace(/^\*/, '').trim(), value: [...new Set(values)].join('、') }]
        : []
    })
  const detail = byId('detail_pic')
  const images = new Set<string>()
  const addImage = (input: string) => {
    try {
      const image = new URL(input, location.href)
      if (image.protocol === 'https:' && !image.username && !image.password) images.add(image.href)
    } catch {
      /* Invalid source images are omitted, never converted into textual facts. */
    }
  }
  for (const image of Array.from(detail?.querySelectorAll<HTMLImageElement>('img[src]') || []))
    addImage(image.src)
  for (const node of Array.from(detail?.querySelectorAll<HTMLElement>('[style]') || [])) {
    for (const match of node.style.backgroundImage.matchAll(/url\(["']?([^"')]+)["']?\)/g))
      if (match[1]) addImage(match[1])
  }
  // Only actual text-editor values count as description; upload tutorials and platform hints do not.
  const description = Array.from(
    detail?.querySelectorAll('textarea,[contenteditable="true"]') || [],
  )
    .map((node) => fieldValue(node))
    .filter(Boolean)
    .join('\n')
  return {
    productId,
    title,
    merchantCode: fieldValue(byId('sku.out_goods_sn') || byId('out_goods_sn')),
    description,
    attributes,
    images: [...images],
    skus,
    capturedAt: Date.now(),
    sourceUrl: location.href,
    detailStatus: 'partial',
    detailNote:
      '已读取原生详情表单及当前SKU表格；未对详情图片进行文字识别。未展示的SKU ID或条形码保持未知，价格和库存仅为采集时快照。',
  }
}

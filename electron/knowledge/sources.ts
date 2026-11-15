import { extname, dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { z } from 'zod'
import type { KnowledgeSourceLocator } from '../../src/shared/contracts/knowledge'
import { knowledgeRequire } from './node-loader'
const mammoth = knowledgeRequire('mammoth') as typeof import('mammoth')
const readExcel = knowledgeRequire('read-excel-file/node') as typeof import('read-excel-file/node')
const Papa = knowledgeRequire('papaparse') as {
  parse(
    text: string,
    options: { header?: boolean; skipEmptyLines: string },
  ): { data: unknown[]; errors: unknown[]; meta: { fields?: string[] } }
}
const canvasLib = () => knowledgeRequire('@napi-rs/canvas') as typeof import('@napi-rs/canvas')
export interface ParsedPart {
  text: string
  locator: KnowledgeSourceLocator
  image?: { bytes: Uint8Array; mimeType: string }
  product?: { productId: string; title: string }
  intent?: { question: string; answer: string; keywords: string[]; productIds: string[] }
  chat?: boolean
}
export interface ParsedFile {
  parts: ParsedPart[]
  encoding: string
  warnings: string[]
}
export function decodeKnowledgeText(bytes: Uint8Array) {
  const b = Buffer.from(bytes)
  const encoding =
    b[0] === 255 && b[1] === 254 ? 'utf-16le' : b[0] === 254 && b[1] === 255 ? 'utf-16be' : ''
  if (encoding) return { text: new TextDecoder(encoding, { fatal: true }).decode(b), encoding }
  // BOM-less UTF16 is recognised only when alternating NUL bytes provide evidence.
  if (b.length > 3 && b.length % 2 === 0 && (b[0] === 0 || b[1] === 0)) {
    const enc = b[0] === 0 ? 'utf-16be' : 'utf-16le'
    return { text: new TextDecoder(enc, { fatal: true }).decode(b), encoding: enc }
  }
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(b), encoding: 'utf-8' }
  } catch {
    return {
      text: new TextDecoder('gb18030', { fatal: true }).decode(b),
      encoding: 'gb18030（自动识别，请核对预览）',
    }
  }
}
export async function imageParts(
  bytes: Uint8Array,
  locator: KnowledgeSourceLocator,
): Promise<ParsedPart[]> {
  const lib = canvasLib(),
    image = await lib.loadImage(Buffer.from(bytes))
  if (!image.width || !image.height || image.width * image.height > 100_000_000)
    throw Error('图片尺寸无效或超过1亿像素')
  const parts: ParsedPart[] = []
  // Preserve every region of long product charts instead of scaling the whole strip into illegibility.
  for (let y = 0; y < image.height; y += 1400)
    for (let x = 0; x < image.width; x += 1400) {
      if (parts.length >= 500) throw Error('图片分块超过500，请拆分文件')
      const width = Math.min(1400, image.width - x),
        height = Math.min(1400, image.height - y)
      const canvas = lib.createCanvas(width, height)
      canvas.getContext('2d').drawImage(image, x, y, width, height, 0, 0, width, height)
      parts.push({
        text: `图片区域 x=${x}, y=${y}, 宽=${width}, 高=${height}`,
        locator: { ...locator, tile: parts.length + 1 },
        image: { bytes: canvas.toBuffer('image/png'), mimeType: 'image/png' },
      })
    }
  return parts
}
async function parsePdf(bytes: Uint8Array): Promise<ParsedFile> {
  // Native dynamic import survives the CJS desktop bundle; PDF.js loads worker/fonts/wasm beside its package.
  const modulePath = knowledgeRequire.resolve('pdfjs-dist/legacy/build/pdf.mjs')
  const pdf = (await import(
    pathToFileURL(modulePath).href
  )) as typeof import('pdfjs-dist/legacy/build/pdf.mjs')
  const root = join(dirname(modulePath), '../..')
  const task = pdf.getDocument({
    data: Uint8Array.from(bytes),
    enableXfa: false,
    useSystemFonts: true,
    cMapUrl: join(root, 'cmaps') + '/',
    cMapPacked: true,
    standardFontDataUrl: join(root, 'standard_fonts') + '/',
    wasmUrl: join(root, 'wasm') + '/',
  })
  const parts: ParsedPart[] = []
  try {
    const doc = await task.promise
    if (doc.numPages > 500) throw Error('PDF超过500页，请拆分后导入')
    for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber++) {
      const page = await doc.getPage(pageNumber)
      const text = (await page.getTextContent()).items
        .flatMap((item) => ('str' in item ? [item.str] : []))
        .join(' ')
      if (text.trim()) parts.push({ text, locator: { page: pageNumber } })
      const viewport = page.getViewport({ scale: 1.5 })
      // Render bounded tiles directly; do not allocate an unbounded page canvas.
      let tile = 0
      for (let y = 0; y < viewport.height; y += 1400)
        for (let x = 0; x < viewport.width; x += 1400) {
          if (++tile > 500) throw Error('PDF单页尺寸过大，请拆分')
          const canvas = canvasLib().createCanvas(
            Math.ceil(Math.min(1400, viewport.width - x)),
            Math.ceil(Math.min(1400, viewport.height - y)),
          )
          await page.render({
            canvasContext: canvas.getContext('2d') as unknown as CanvasRenderingContext2D,
            canvas: canvas as unknown as HTMLCanvasElement,
            viewport,
            transform: [1, 0, 0, 1, -x, -y],
          }).promise
          parts.push({
            text: `PDF第${pageNumber}页区域 x=${x}, y=${y}`,
            locator: { page: pageNumber, tile },
            image: { bytes: canvas.toBuffer('image/png'), mimeType: 'image/png' },
          })
        }
      page.cleanup()
    }
  } finally {
    await task.destroy()
  }
  return { parts, encoding: 'PDF', warnings: [] }
}
export async function parseKnowledgeFile(name: string, bytes: Uint8Array): Promise<ParsedFile> {
  if (bytes.byteLength > 100 * 1024 * 1024) throw Error('附件超出100MB')
  const extension = extname(name).toLowerCase()
  let result: ParsedFile = { parts: [], encoding: '', warnings: [] }
  if (extension === '.pdf') result = await parsePdf(bytes)
  else if (extension === '.docx') {
    const input = { buffer: Buffer.from(bytes) }
    const raw = await mammoth.extractRawText(input)
    result.parts = raw.value
      .split(/\r?\n/)
      .flatMap((text, i) => (text.trim() ? [{ text, locator: { line: i + 1 } }] : []))
    let index = 0
    const converted = await mammoth.convertToHtml(input, {
      externalFileAccess: false,
      convertImage: mammoth.images.imgElement(async (image) => {
        const imageIndex = ++index
        const parts = await imageParts(await image.readAsBuffer(), { image: imageIndex })
        result.parts.push(...parts)
        return { src: `embedded-image-${imageIndex}` }
      }),
    })
    result.warnings = [...raw.messages, ...converted.messages].map((m) => m.message)
    result.encoding = 'DOCX（行号为提取文本，不代表Word页码）'
  } else if (extension === '.xlsx') {
    const sheets = await readExcel.default(Buffer.from(bytes))
    for (const sheet of sheets)
      sheet.data.forEach((row, i) => {
        const cells = row.flatMap((value, j) =>
          value !== null && value !== undefined && String(value).trim()
            ? [
                {
                  column: j + 1,
                  value: value instanceof Date ? value.toISOString() : String(value),
                },
              ]
            : [],
        )
        if (cells.length)
          result.parts.push({
            text: JSON.stringify({ firstRow: sheet.data[0], cells }),
            locator: { sheet: sheet.sheet, row: i + 1, column: cells[0]!.column },
          })
      })
    result.encoding = 'XLSX（所有工作表）'
  } else if (['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp'].includes(extension)) {
    result.parts = await imageParts(bytes, { image: 1 })
    result.encoding = '图片'
    if (extension === '.gif')
      result.warnings.push('GIF仅读取首帧；动画后续帧未导入，请拆分为静态图片后补充。')
  } else if (['.txt', '.md', '.csv', '.json'].includes(extension)) {
    const decoded = decodeKnowledgeText(bytes)
    result.encoding = decoded.encoding
    if (extension === '.csv') {
      const rows = Papa.parse(decoded.text, { header: true, skipEmptyLines: 'greedy' })
      if (rows.errors.length) throw Error('CSV格式错误，未导入')
      const products = rows.meta.fields?.includes('productId') && rows.meta.fields.includes('title')
      if (products)
        result.warnings.push(
          '商品CSV仅学习编号、标题、描述、规格；价格/库存/启用标记等其他列保留在原文件，不当作长期已审核事实。',
        )
      result.parts = rows.data.map((raw, i) => {
        const row = z.record(z.string(), z.string()).parse(raw)
        const product = products
          ? {
              productId: z.string().trim().min(1).max(200).parse(row.productId),
              title: z.string().trim().min(1).max(1000).parse(row.title),
            }
          : undefined
        return {
          text: JSON.stringify(
            product
              ? {
                  productId: row.productId,
                  title: row.title,
                  description: row.description ?? '',
                  specifications: row.specifications ?? '',
                }
              : row,
          ),
          locator: { row: i + 2 },
          ...(product ? { product } : {}),
        }
      })
    } else if (extension === '.json') {
      const raw: unknown = JSON.parse(decoded.text)
      const packs = z
        .array(
          z.object({
            entries: z.array(
              z.object({
                question: z.string().min(1).max(4000),
                answer: z.string().min(1).max(30000),
                keywords: z.array(z.string()).default([]),
              }),
            ),
            productIds: z.array(z.string()).default([]),
          }),
        )
        .safeParse(Array.isArray(raw) ? raw : [raw])
      if (packs.success)
        result.parts = packs.data.flatMap((pack, packIndex) =>
          pack.entries.map((entry, i) => ({
            text: JSON.stringify(entry),
            locator: { row: packIndex + 1, line: i + 1 },
            intent: { ...entry, productIds: pack.productIds },
          })),
        )
      else {
        const messages = z
          .array(
            z.object({
              from: z.enum(['buyer', 'seller']),
              content: z.string().min(1),
              msgId: z.string().optional(),
              ts: z.number().optional(),
            }),
          )
          .parse(raw)
        result.parts = messages.map((message, i) => ({
          text: JSON.stringify(message),
          locator: { messageId: message.msgId ?? `import-${i + 1}`, line: i + 1 },
          chat: true,
        }))
      }
    } else
      result.parts = decoded.text
        .split(/\r?\n/)
        .flatMap((text, i) => (text.trim() ? [{ text, locator: { line: i + 1 } }] : []))
  } else throw Error(`不支持的文件格式：${extension}`)
  if (!result.parts.length) throw Error('文件为空或没有可解析资料')
  if (result.parts.length > 50000) throw Error('资料片段超过50000，请拆分文件')
  return result
}

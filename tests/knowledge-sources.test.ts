// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { parseKnowledgeFile } from '../electron/knowledge/sources'

describe('real knowledge file parsing', () => {
  it('preserves UTF16 lines and detects legacy Chinese bytes without replacement text', async () => {
    const parsed = await parseKnowledgeFile(
      '尺寸.txt',
      Buffer.concat([Buffer.from([255, 254]), Buffer.from('型号A\n长度50毫米', 'utf16le')]),
    )
    expect(parsed.encoding).toBe('utf-16le')
    expect(parsed.parts.map((p) => [p.text, p.locator.line])).toEqual([
      ['型号A', 1],
      ['长度50毫米', 2],
    ])
    const gb = await parseKnowledgeFile('中文.txt', Buffer.from([0xd6, 0xd0, 0xce, 0xc4]))
    expect(gb.parts[0]?.text).toBe('中文')
    await expect(parseKnowledgeFile('坏.txt', Buffer.from([0x81]))).rejects.toThrow()
  })
  it('rejects unsupported and empty files rather than reporting a successful zero-source import', async () => {
    await expect(parseKnowledgeFile('x.exe', Buffer.from('test'))).rejects.toThrow(/不支持/)
    await expect(parseKnowledgeFile('x.txt', Buffer.from(' \n'))).rejects.toThrow(/空/)
  })
  it('extracts DOCX text and actual embedded pictures with separate locators', async () => {
    const text = await parseKnowledgeFile(
      'a.docx',
      readFileSync('tests/fixtures/knowledge-ingestion/text.docx'),
    )
    expect(text.parts.some((p) => p.text.includes('Walking'))).toBe(true)
    const picture = await parseKnowledgeFile(
      'a.docx',
      readFileSync('tests/fixtures/knowledge-ingestion/image.docx'),
    )
    expect(picture.parts.some((p) => p.image && p.locator.image === 1)).toBe(true)
  })
  it('reads every XLSX sheet with cell positions and renders PDF pages for visual evidence', async () => {
    const xlsx = await parseKnowledgeFile(
      'a.xlsx',
      readFileSync('tests/fixtures/knowledge-ingestion/sheets.xlsx'),
    )
    expect(
      xlsx.parts.some(
        (p) => p.text.includes('A款') && p.locator.sheet === '商品规格' && p.locator.row === 2,
      ),
    ).toBe(true)
    expect(
      xlsx.parts.some(
        (p) => p.text.includes('B款') && p.locator.sheet === '第二表' && p.locator.row === 2,
      ),
    ).toBe(true)
    const scan = await parseKnowledgeFile(
      'scan.pdf',
      readFileSync('tests/fixtures/knowledge-ingestion/scan.pdf'),
    )
    expect(scan.parts.every((p) => Boolean(p.image))).toBe(true)
    const pdf = await parseKnowledgeFile(
      'a.pdf',
      readFileSync('tests/fixtures/knowledge-ingestion/text.pdf'),
    )
    expect(pdf.parts.some((p) => p.text.includes('length 50 mm') && p.locator.page === 1)).toBe(
      true,
    )
    expect(pdf.parts.some((p) => p.image && p.locator.page === 1)).toBe(true)
  })
  it('parses quoted CSV rows as individual product targets and ignores imported approval flags', async () => {
    const csv = await parseKnowledgeFile(
      'a.csv',
      Buffer.from('productId,title,description,enabled\n1,衬衫,"纯棉,50mm",true\n2,裤子,蓝色,true'),
    )
    expect(csv.parts.map((p) => [p.product?.productId, p.locator.row])).toEqual([
      ['1', 2],
      ['2', 3],
    ])
    expect(csv.parts[0]?.text).toContain('纯棉,50mm')
    const json = await parseKnowledgeFile(
      'old.json',
      Buffer.from(
        JSON.stringify([
          {
            name: '旧包',
            enabled: true,
            storeIds: ['foreign'],
            productIds: [],
            entries: [{ question: '发货?', answer: '两日', keywords: [], enabled: true }],
          },
        ]),
      ),
    )
    expect(json.parts[0]?.intent).toMatchObject({ question: '发货?', answer: '两日' })
    expect(json.parts[0]?.intent).not.toHaveProperty('enabled')
  })
})

import { expect, it } from 'vitest'
import { parseWindowsOcrResult } from '../electron/knowledge/windows-ocr'

it('accepts bounded real OCR text and keeps empty images distinct from recognition errors', () => {
  expect(
    parseWindowsOcrResult(
      JSON.stringify({ text: '型号 XM-YSP', lines: ['型号 XM-YSP'], language: 'zh-Hans-CN' }),
    ).text,
  ).toBe('型号 XM-YSP')
  expect(
    parseWindowsOcrResult(JSON.stringify({ text: '', lines: [], language: 'zh-Hans-CN' })).text,
  ).toBe('')
  expect(() => parseWindowsOcrResult('{bad')).toThrow()
  expect(() =>
    parseWindowsOcrResult(
      JSON.stringify({ text: 'x'.repeat(30001), lines: [], language: 'zh-Hans-CN' }),
    ),
  ).toThrow()
})

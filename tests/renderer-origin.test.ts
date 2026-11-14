import { describe, expect, it } from 'vitest'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { isRendererFileUrl } from '../electron/renderer-origin'

describe('本地应用页面来源', () => {
  const renderer = path.resolve('origin-fixture', '~项目 空格', 'dist', 'index.html')
  const encoded = pathToFileURL(renderer).href

  it('接受 Chromium 将百分号编码的波浪号还原后的同一个文件', () => {
    expect(isRendererFileUrl(encoded + '#/', renderer)).toBe(true)
    expect(isRendererFileUrl(encoded.replace(/%7e/gi, '~') + '#/settings', renderer)).toBe(true)
  })

  it('拒绝其他文件、远程页面和畸形文件 URL', () => {
    for (const url of [
      pathToFileURL(path.resolve('origin-fixture', '~项目 空格', 'dist', 'other.html')).href,
      encoded + '/other.html',
      'https://example.test/index.html',
      'file:///invalid/%2f/index.html',
      'not-a-url',
    ])
      expect(isRendererFileUrl(url, renderer)).toBe(false)
  })
})

// @vitest-environment node
import { createRequire } from 'node:module'
import { createCanvas } from '@napi-rs/canvas'
import { randomFillSync } from 'node:crypto'
import { expect, it } from 'vitest'
const require = createRequire(import.meta.url)
const multimodal = require('../vendor/lingtu-runtime/shared/multimodal.cjs') as {
  validateMessages(input: unknown): unknown
  publicImageUrl(input: string): string
}
it('passes bounded genuine PNG knowledge tiles while keeping buyer URL and malformed-image guards', () => {
  const canvas = createCanvas(400, 400),
    ctx = canvas.getContext('2d'),
    pixels = ctx.createImageData(400, 400)
  randomFillSync(pixels.data)
  ctx.putImageData(pixels, 0, 0)
  const url = 'data:image/png;base64,' + canvas.toBuffer('image/png').toString('base64')
  const messages = [
    {
      role: 'user',
      content: [
        { type: 'text', text: '仅识别当前分块' },
        { type: 'image_url', image_url: { url } },
      ],
    },
  ]
  expect(url.length).toBeGreaterThan(128 * 1024)
  expect(multimodal.validateMessages(messages)).toEqual(messages)
  expect(() => multimodal.publicImageUrl(url)).toThrow()
  expect(() =>
    multimodal.validateMessages([
      {
        role: 'user',
        content: [{ type: 'image_url', image_url: { url: 'data:image/png;base64,AAA' } }],
      },
    ]),
  ).toThrow()
})

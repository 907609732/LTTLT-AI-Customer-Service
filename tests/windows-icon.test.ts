import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { inflateSync } from 'node:zlib'
import { resolveAppIconPath } from '../electron/windows'

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const EXPECTED_SIZES = [16, 24, 32, 48, 64, 128, 256]

function paeth(left: number, up: number, upLeft: number): number {
  const estimate = left + up - upLeft
  const toLeft = Math.abs(estimate - left)
  const toUp = Math.abs(estimate - up)
  const toUpLeft = Math.abs(estimate - upLeft)
  if (toLeft <= toUp && toLeft <= toUpLeft) return left
  return toUp <= toUpLeft ? up : upLeft
}

/** Decode an 8-bit RGBA non-interlaced PNG frame (Pillow writes every ICO frame this way). */
function decodePng(data: Buffer): { width: number; height: number; pixels: Buffer } {
  if (!data.subarray(0, 8).equals(PNG_SIGNATURE)) throw new Error('ICO frame is not PNG')
  let offset = 8
  let width = 0
  let height = 0
  let bitDepth = 0
  let colorType = 0
  let interlace = 0
  const idat: Buffer[] = []
  while (offset < data.length) {
    const length = data.readUInt32BE(offset)
    const type = data.toString('ascii', offset + 4, offset + 8)
    const chunk = data.subarray(offset + 8, offset + 8 + length)
    if (type === 'IHDR') {
      width = chunk.readUInt32BE(0)
      height = chunk.readUInt32BE(4)
      bitDepth = chunk[8]!
      colorType = chunk[9]!
      interlace = chunk[12]!
    } else if (type === 'IDAT') idat.push(chunk)
    else if (type === 'IEND') break
    offset += 12 + length
  }
  if (bitDepth !== 8 || colorType !== 6 || interlace !== 0)
    throw new Error(`unsupported PNG frame: depth=${bitDepth} colour=${colorType}`)
  const raw = inflateSync(Buffer.concat(idat))
  const bytesPerPixel = 4
  const stride = width * bytesPerPixel
  const pixels = Buffer.alloc(stride * height)
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)]!
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1))
    for (let x = 0; x < stride; x += 1) {
      const left = x >= bytesPerPixel ? pixels[y * stride + x - bytesPerPixel]! : 0
      const up = y > 0 ? pixels[(y - 1) * stride + x]! : 0
      const upLeft = y > 0 && x >= bytesPerPixel ? pixels[(y - 1) * stride + x - bytesPerPixel]! : 0
      const prediction =
        filter === 0
          ? 0
          : filter === 1
            ? left
            : filter === 2
              ? up
              : filter === 3
                ? Math.floor((left + up) / 2)
                : paeth(left, up, upLeft)
      pixels[y * stride + x] = (line[x]! + prediction) & 0xff
    }
  }
  return { width, height, pixels }
}

function inspectFrames(buffer: Buffer) {
  expect(buffer.readUInt16LE(0)).toBe(0)
  expect(buffer.readUInt16LE(2)).toBe(1)
  const count = buffer.readUInt16LE(4)
  const frames = []
  for (let index = 0; index < count; index += 1) {
    const entry = 6 + index * 16
    const width = buffer[entry] || 256
    const height = buffer[entry + 1] || 256
    const size = buffer.readUInt32LE(entry + 8)
    const offset = buffer.readUInt32LE(entry + 12)
    const { pixels } = decodePng(buffer.subarray(offset, offset + size))
    const stride = width * 4
    const alpha = (x: number, y: number) => pixels[y * stride + x * 4 + 3]!
    let transparent = 0
    for (let pixel = 3; pixel < pixels.length; pixel += 4) if (pixels[pixel] === 0) transparent += 1
    frames.push({
      size: width,
      height,
      corners: [
        alpha(0, 0),
        alpha(width - 1, 0),
        alpha(0, height - 1),
        alpha(width - 1, height - 1),
      ],
      centre: alpha(Math.floor(width / 2), Math.floor(height / 2)),
      transparentRatio: transparent / (width * height),
    })
  }
  return frames
}

describe('Windows 任务栏图标资源', () => {
  const icon = readFileSync(path.join('public', 'lingtu-ai.ico'))

  it('包含 Explorer 会请求的全部尺寸，且各尺寸圆形边缘的角完全透明', () => {
    const frames = inspectFrames(icon)
    expect(frames.map((frame) => frame.size)).toEqual(EXPECTED_SIZES)
    for (const frame of frames) {
      expect(frame.corners, `${frame.size}x${frame.size} corners`).toEqual([0, 0, 0, 0])
      expect(frame.centre, `${frame.size}x${frame.size} centre`).toBe(255)
      expect(frame.transparentRatio, `${frame.size}x${frame.size} alpha coverage`).toBeGreaterThan(
        0.05,
      )
    }
  })

  it('源码运行从 public 读取图标，打包后读取 app.asar 内由 Vite 复制的图标', () => {
    expect(resolveAppIconPath({ packaged: false, resourcesPath: 'R', sourceRoot: 'S' })).toBe(
      path.join('S', 'public', 'lingtu-ai.ico'),
    )
    expect(resolveAppIconPath({ packaged: true, resourcesPath: 'R', sourceRoot: 'S' })).toBe(
      path.join('R', 'app.asar', 'dist', 'lingtu-ai.ico'),
    )
  })
})

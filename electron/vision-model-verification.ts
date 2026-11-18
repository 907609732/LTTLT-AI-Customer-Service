import { deflateSync } from 'node:zlib'

/** 主进程唯一的固定图验证套件版本；settings 与 runtime 必须共用。 */
export const VISION_VERIFICATION_SUITE_VERSION = 2

export const VISION_VERIFICATION_PROMPT =
  '图中从上到下排列着两个纯色区域。请只按从上到下的顺序回答这两个区域的颜色，使用中文颜色词，两个词之间用顿号分隔；不要解释，不要补充其他内容。'

/**
 * 固定 64×64 合成 PNG：上红下蓝。仅用于显式图片能力探针，
 * 不使用客户图片，也不改变正常知识图片来源策略。
 */
function verificationPng(): Buffer {
  const width = 64
  const height = 64
  const stride = width * 4 + 1
  const pixels = Buffer.alloc(stride * height)
  for (let y = 0; y < height; y++) {
    pixels[y * stride] = 0
    for (let x = 0; x < width; x++) {
      const offset = y * stride + 1 + x * 4
      if (y < height / 2) {
        pixels[offset] = 235 + ((x * 7 + y * 11) % 21)
        pixels[offset + 1] = (x * 3 + y * 5) % 18
        pixels[offset + 2] = (x * 5 + y * 2) % 15
      } else {
        pixels[offset] = (x * 5 + y * 3) % 15
        pixels[offset + 1] = (x * 7 + y * 2) % 20
        pixels[offset + 2] = 235 + ((x * 3 + y * 11) % 21)
      }
      pixels[offset + 3] = 255
    }
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header[8] = 8
  header[9] = 6
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  return Buffer.concat([
    signature,
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(pixels, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ])
}

function pngChunk(type: string, data: Buffer): Buffer {
  const name = Buffer.from(type, 'ascii')
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length, 0)
  const checksum = Buffer.alloc(4)
  checksum.writeUInt32BE(crc32(Buffer.concat([name, data])), 0)
  return Buffer.concat([length, name, data, checksum])
}

let crcTable: Uint32Array | undefined
function crc32(value: Buffer): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256)
    for (let index = 0; index < 256; index++) {
      let current = index
      for (let bit = 0; bit < 8; bit++)
        current = current & 1 ? 0xedb88320 ^ (current >>> 1) : current >>> 1
      crcTable[index] = current >>> 0
    }
  }
  let crc = 0xffffffff
  for (const byte of value) crc = crcTable[(crc ^ byte) & 0xff]! ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

export function visionVerificationImageDataUrl(): string {
  return `data:image/png;base64,${verificationPng().toString('base64')}`
}

/** 只接受固定 fixture 的“上红下蓝”顺序；任意非空文本或单一颜色都失败。 */
export function visionVerificationAnswerMatches(value: string): boolean {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[\s，,。.!！、:：;；"'“”‘’-]/g, '')
  return normalized === '红色蓝色' || normalized === '红蓝' || normalized === 'redblue'
}

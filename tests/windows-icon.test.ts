import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { resolveAppIconPath } from '../electron/windows'

describe('Windows 任务栏图标资源', () => {
  it('包含 Windows shell 使用的七种图标尺寸', () => {
    const icon = readFileSync(path.join('public', 'lingtu-ai.ico'))
    expect(icon.readUInt16LE(2)).toBe(1)
    const count = icon.readUInt16LE(4)
    const sizes = Array.from({ length: count }, (_, index) => icon[6 + index * 16] || 256)
    expect(sizes).toEqual([16, 24, 32, 48, 64, 128, 256])
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

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { StoreSendModes } from '../electron/store-send-modes'

const folders: string[] = []
afterEach(() => {
  for (const dir of folders.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})
function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lingtu-send-modes-'))
  folders.push(dir)
  return { dir, modes: new StoreSendModes(dir) }
}
describe('按店铺保存发送模式', () => {
  it('默认审核，显式自动选择持久保存，账号与店铺隔离', () => {
    const { dir, modes } = setup()
    expect(modes.read('a')).toEqual({ mode: 'review', revision: 0 })
    expect(modes.set('a', 'auto')).toEqual({ mode: 'auto', revision: 1 })
    expect(modes.read('b').mode).toBe('review')
    expect(new StoreSendModes(dir).read('a').mode).toBe('auto')
    expect(new StoreSendModes(path.join(dir, 'other-account')).read('a').mode).toBe('review')
  })
  it('移除店铺只删除该店模式，其他店模式和审核默认保留', () => {
    const { dir, modes } = setup()
    modes.set('a', 'auto')
    modes.set('b', 'auto')
    modes.remove('a')
    expect(modes.read('a')).toEqual({ mode: 'review', revision: 0 })
    expect(modes.read('b').mode).toBe('auto')
    expect(new StoreSendModes(dir).read('a').mode).toBe('review')
    expect(new StoreSendModes(dir).read('b').mode).toBe('auto')
  })
  it('只有成功保存的模式变化递增版本，自动切审核再切自动保留变化证据', () => {
    const { modes } = setup()
    modes.set('a', 'auto')
    expect(modes.set('a', 'auto').revision).toBe(1)
    expect(modes.set('a', 'review').revision).toBe(2)
    expect(modes.set('a', 'auto').revision).toBe(3)
    expect(() => modes.set('a', 'enabled')).toThrow()
    expect(modes.read('a').revision).toBe(3)
  })
  it('保存失败不启用自动，损坏或不支持的文件按审核处理', () => {
    const { dir } = setup()
    const file = path.join(dir, 'store-send-modes.json')
    fs.writeFileSync(file, '{invalid')
    expect(new StoreSendModes(dir).read('a').mode).toBe('review')
    fs.writeFileSync(file, JSON.stringify({ version: 2, stores: { a: 'auto' } }))
    expect(new StoreSendModes(dir).read('a').mode).toBe('review')
    const blocked = path.join(dir, 'blocked')
    fs.writeFileSync(blocked, 'file blocks directory')
    const modes = new StoreSendModes(blocked)
    expect(() => modes.set('a', 'auto')).toThrow()
    expect(modes.read('a')).toEqual({ mode: 'review', revision: 0 })
  })
})

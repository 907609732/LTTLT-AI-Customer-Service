import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { ReplyPacingStore, createUidIntervalResolver } from '../electron/reply-pacing'
import {
  defaultReplyPacing,
  replyPacingSchema,
  type ReplyPacing,
} from '../src/shared/contracts/backend'
import { describeReplyPacing, replyPacingRange } from '../src/shared/reply-pacing'

const directories: string[] = []
const tempDir = () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lingtu-pacing-'))
  directories.push(directory)
  return directory
}
afterEach(() => {
  for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true })
})
const expectedOf = (pacing: ReplyPacing) => ({ ...pacing })

it('首次没有新节奏配置时迁移为1～3秒随机，并记录旧固定值', () => {
  const directory = tempDir()
  const store = new ReplyPacingStore(directory, 60000)
  expect(store.snapshot()).toEqual(defaultReplyPacing)
  const saved = JSON.parse(fs.readFileSync(path.join(directory, 'reply-pacing.json'), 'utf8'))
  expect(saved).toMatchObject({
    version: 1,
    mode: 'random-1-3',
    customMinSeconds: 1,
    customMaxSeconds: 3,
    migratedFromLegacyMs: 60000,
  })
})

it('已保存的新模式不会被再次迁移覆盖', () => {
  const directory = tempDir()
  fs.writeFileSync(
    path.join(directory, 'reply-pacing.json'),
    JSON.stringify({ version: 1, mode: 'fixed-1', customMinSeconds: 4, customMaxSeconds: 8 }),
  )
  const store = new ReplyPacingStore(directory, 60000)
  expect(store.snapshot()).toEqual({ mode: 'fixed-1', customMinSeconds: 4, customMaxSeconds: 8 })
  expect(new ReplyPacingStore(directory, 60000).snapshot().mode).toBe('fixed-1')
})

it('保存自定义范围必须为1～3600整数秒且下限不大于上限', () => {
  const store = new ReplyPacingStore(tempDir(), 60000)
  const expected = expectedOf(store.snapshot())
  expect(() =>
    store.save({ mode: 'custom', customMinSeconds: 5, customMaxSeconds: 4, expected }),
  ).toThrow('参数无效')
  expect(() =>
    store.save({ mode: 'custom', customMinSeconds: 0, customMaxSeconds: 4, expected }),
  ).toThrow('参数无效')
  expect(() =>
    store.save({ mode: 'custom', customMinSeconds: 1, customMaxSeconds: 3601, expected }),
  ).toThrow('参数无效')
  expect(() =>
    store.save({ mode: 'custom', customMinSeconds: 1.5, customMaxSeconds: 4, expected }),
  ).toThrow('参数无效')
  expect(() =>
    store.save({ mode: 'random-9-10', customMinSeconds: 1, customMaxSeconds: 4, expected }),
  ).toThrow('参数无效')
  expect(
    store.save({ mode: 'custom', customMinSeconds: 5, customMaxSeconds: 5, expected }),
  ).toEqual({ mode: 'custom', customMinSeconds: 5, customMaxSeconds: 5 })
  expect(store.snapshot()).toMatchObject({
    mode: 'custom',
    customMinSeconds: 5,
    customMaxSeconds: 5,
  })
})

it('CAS 预期值必填，旧值不一致时保留草稿且不落盘', () => {
  const store = new ReplyPacingStore(tempDir(), 60000)
  expect(() => store.save({ mode: 'fixed-1', customMinSeconds: 1, customMaxSeconds: 3 })).toThrow(
    '参数无效',
  )
  const loaded = expectedOf(store.snapshot())
  store.save({ mode: 'random-2-3', customMinSeconds: 1, customMaxSeconds: 3, expected: loaded })
  expect(() =>
    store.save({ mode: 'fixed-1', customMinSeconds: 1, customMaxSeconds: 3, expected: loaded }),
  ).toThrow('回复间隔配置已更新')
  expect(store.snapshot().mode).toBe('random-2-3')
})

it('损坏或反序的配置文件明确报错并保留原文件', () => {
  const directory = tempDir()
  const file = path.join(directory, 'reply-pacing.json')
  fs.writeFileSync(file, '{"version":1,')
  expect(() => new ReplyPacingStore(directory, 60000)).toThrow('配置损坏')
  expect(fs.readFileSync(file, 'utf8')).toBe('{"version":1,')

  fs.writeFileSync(
    file,
    JSON.stringify({ version: 1, mode: 'custom', customMinSeconds: 10, customMaxSeconds: 1 }),
  )
  expect(() => new ReplyPacingStore(directory, 60000)).toThrow('配置无效')
  expect(fs.readFileSync(file, 'utf8')).toContain('"customMinSeconds":10')

  fs.writeFileSync(file, JSON.stringify({ version: 1, mode: 'fixed-1' }))
  expect(() => new ReplyPacingStore(directory, 60000)).toThrow('配置无效')
})

it('首次迁移写入失败时明确报错，不假装已保存', () => {
  const directory = tempDir()
  const notADirectory = path.join(directory, 'reply-pacing.json')
  fs.writeFileSync(notADirectory, 'occupied')
  expect(() => new ReplyPacingStore(notADirectory, 60000)).toThrow()
  expect(fs.readFileSync(notADirectory, 'utf8')).toBe('occupied')
})

it('共享契约与保存边界都拒绝反序范围', () => {
  expect(
    replyPacingSchema.safeParse({ mode: 'custom', customMinSeconds: 10, customMaxSeconds: 1 })
      .success,
  ).toBe(false)
  expect(
    replyPacingSchema.safeParse({ mode: 'custom', customMinSeconds: 1, customMaxSeconds: 3 })
      .success,
  ).toBe(true)
})

it('同一买家每次等待只抽一次，保存新设置后当前等待立即重算', () => {
  let settings: ReplyPacing = { mode: 'random-1-3', customMinSeconds: 1, customMaxSeconds: 3 }
  const resolve = createUidIntervalResolver(() => settings)
  let draws = 0
  const random = () => {
    draws += 1
    return 0.5
  }
  const first = { storeId: 'shop', uid: 'buyer', lastSentAt: 1000 }
  expect(resolve(first, random)).toBe(2000)
  expect(resolve(first, random)).toBe(2000)
  expect(draws).toBe(1)
  // 上一次发送时间变化代表新一次等待，需重新抽取。
  expect(resolve({ ...first, lastSentAt: 2000 }, random)).toBe(2000)
  expect(draws).toBe(2)
  // 保存固定 1 秒后，同一等待立即按新策略计算（无需重启）。
  settings = { mode: 'fixed-1', customMinSeconds: 100, customMaxSeconds: 100 }
  expect(resolve(first, random)).toBe(1000)
  expect(draws).toBe(2)
  // 买家与店铺互相独立（此时策略已是固定 1 秒）。
  expect(resolve({ ...first, uid: 'buyer-2' }, random)).toBe(1000)
  expect(draws).toBe(2)
  expect(resolve({ ...first, storeId: 'shop-2' }, random)).toBe(1000)
  expect(draws).toBe(2)
  // 自定义范围反序时不再偷偷裁剪，直接拒绝解析。
  settings = { mode: 'custom', customMinSeconds: 10, customMaxSeconds: 1 }
  expect(() => resolve({ ...first, uid: 'buyer-3' }, random)).toThrow('范围无效')
})

it('随机间隔至少1秒，固定模式与范围端点按模式解析', () => {
  let current: ReplyPacing = { mode: 'random-1-3', customMinSeconds: 1, customMaxSeconds: 3 }
  const resolve = createUidIntervalResolver(() => current)
  let wait = 0
  const next = (random: () => number) => resolve({ uid: 'a', lastSentAt: ++wait }, random)
  expect(next(() => 0)).toBe(1000)
  expect(next(() => 1)).toBe(3000)
  expect(next(() => 0.5)).toBe(2000)
  current = { mode: 'fixed-1', customMinSeconds: 9, customMaxSeconds: 20 }
  expect(next(() => 0.9)).toBe(1000)
  current = { mode: 'custom', customMinSeconds: 5, customMaxSeconds: 10 }
  expect(next(() => 0)).toBe(5000)
  expect(next(() => 1)).toBe(10000)
  // 随机源越界时按边界取值，不产生小于 1 秒或超过上限的间隔。
  expect(next(() => -3)).toBe(5000)
  expect(next(() => 9)).toBe(10000)
})

it('模式范围与界面说明一致', () => {
  expect(
    replyPacingRange({ mode: 'random-2-3', customMinSeconds: 1, customMaxSeconds: 3 }),
  ).toEqual({
    minSeconds: 2,
    maxSeconds: 3,
  })
  expect(replyPacingRange({ mode: 'custom', customMinSeconds: 7, customMaxSeconds: 12 })).toEqual({
    minSeconds: 7,
    maxSeconds: 12,
  })
  expect(describeReplyPacing({ mode: 'fixed-1', customMinSeconds: 1, customMaxSeconds: 3 })).toBe(
    '固定 1 秒',
  )
  expect(
    describeReplyPacing({ mode: 'random-1-3', customMinSeconds: 1, customMaxSeconds: 3 }),
  ).toBe('1～3 秒随机')
})

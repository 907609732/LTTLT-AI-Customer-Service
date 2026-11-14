import { describe, expect, it } from 'vitest'
import { RuntimeResourceDisposer } from '../electron/runtime-disposal'
describe('工作区清理必须完成所有资源关闭', () => {
  it('持久化失败时仍关闭后续凭据、会话和平台，最后报告所有错误', async () => {
    const calls: string[] = []
    await expect(
      new RuntimeResourceDisposer([
        () => {
          calls.push('operations')
          throw Error('scheduler write failed')
        },
        async () => {
          calls.push('learning')
          throw Error('disk full')
        },
        () => {
          calls.push('managed')
        },
        async () => {
          calls.push('host')
        },
      ]).dispose(),
    ).rejects.toThrow(AggregateError)
    expect(calls).toEqual(['operations', 'learning', 'managed', 'host'])
  })
  it('重试仅执行失败资源，不重复关闭已成功清理的账号服务', async () => {
    let fail = true,
      disk = 0,
      credentials = 0
    const disposer = new RuntimeResourceDisposer([
      () => {
        disk++
        if (fail) throw Error('disk')
      },
      () => {
        credentials++
      },
    ])
    await expect(disposer.dispose()).rejects.toThrow()
    fail = false
    await disposer.dispose()
    await disposer.dispose()
    expect([disk, credentials]).toEqual([2, 1])
  })
})

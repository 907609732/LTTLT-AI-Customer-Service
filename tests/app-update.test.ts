import { expect, it, vi } from 'vitest'
import { createAppUpdateChecker } from '../electron/app-update'

function release(version = '1.0.75') {
  return {
    tag_name: `v${version}`,
    draft: false,
    prerelease: false,
    assets: [{ name: `LingtuAI-Setup-${version}-win-x64.exe` }],
  }
}
it('启动只请求一次，手动检查重新请求，并合并同时到达的请求', async () => {
  const request = vi.fn(async () => new Response(JSON.stringify(release())))
  const check = createAppUpdateChecker('1.0.74', request)
  const [first, second] = await Promise.all([check(false), check(false)])
  expect(first).toEqual(second)
  expect(first.status).toBe('available')
  expect(first.releaseUrl).toBe(
    'https://github.com/907609732/LTTLT-AI-Customer-Service/releases/tag/v1.0.75',
  )
  await check(false)
  expect(request).toHaveBeenCalledTimes(1)
  await Promise.all([check(true), check(true)])
  expect(request).toHaveBeenCalledTimes(2)
})
it.each(['1.0.74', '1.0.9'])('相同或更旧版本 %s 不提示升级', async (version) => {
  const check = createAppUpdateChecker(
    '1.0.74',
    async () => new Response(JSON.stringify(release(version))),
  )
  expect((await check(false)).status).toBe('current')
})
it('草稿、预发布或缺少安装包不冒充可更新版本', async () => {
  for (const patch of [
    { draft: true },
    { prerelease: true },
    { assets: [] },
    { tag_name: 'v1.0.75-beta' },
  ]) {
    const check = createAppUpdateChecker(
      '1.0.74',
      async () => new Response(JSON.stringify({ ...release(), ...patch })),
    )
    await expect(check(false)).rejects.toThrow()
  }
})
it('无正式版与网络失败分别处理，失败后允许手动重试', async () => {
  expect(
    (await createAppUpdateChecker('1.0.74', async () => new Response('', { status: 404 }))(false))
      .status,
  ).toBe('unpublished')
  const request = vi
    .fn()
    .mockRejectedValueOnce(Error('network'))
    .mockResolvedValue(new Response(JSON.stringify(release())))
  const check = createAppUpdateChecker('1.0.74', request)
  await expect(check(false)).rejects.toThrow()
  expect((await check(true)).status).toBe('available')
})

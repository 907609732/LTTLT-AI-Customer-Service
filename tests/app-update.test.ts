import { expect, it, vi } from 'vitest'
import { createAppUpdateChecker } from '../electron/app-update'
import type { GithubPageResponse } from '../electron/app-update'

const sourceRepository = 'https://github.com/907609732/LTTLT-AI-Customer-Service'
const latestPage = `${sourceRepository}/releases/latest`
const tagPage = (version: string) => `${sourceRepository}/releases/tag/v${version}`
const assetsPage = (version: string) => `${sourceRepository}/releases/expanded_assets/v${version}`

function release(version = '1.0.75') {
  return {
    tag_name: `v${version}`,
    draft: false,
    prerelease: false,
    assets: [{ name: `LingtuAI-Setup-${version}-win-x64.exe` }],
  }
}

function limited(
  status = 403,
  headers: Record<string, string> = {
    'x-ratelimit-resource': 'core',
    'x-ratelimit-remaining': '0',
  },
) {
  return new Response('{"message":"API rate limit exceeded"}', { status, headers })
}

function redirect(version = '1.0.74', patch: Partial<GithubPageResponse> = {}): GithubPageResponse {
  return {
    status: 302,
    location: tagPage(version),
    contentType: 'text/html; charset=utf-8',
    body: '',
    ...patch,
  }
}

function assets(version = '1.0.74', patch: Partial<GithubPageResponse> = {}): GithubPageResponse {
  const name = `LingtuAI-Setup-${version}-win-x64.exe`
  return {
    status: 200,
    location: null,
    contentType: 'text/html; charset=utf-8',
    body: `<a href="/907609732/LTTLT-AI-Customer-Service/releases/download/v${version}/${name}"><span class="text-bold">${name}</span></a>`,
    ...patch,
  }
}

/** 官方页面正常时的假响应：/releases/latest 跳到正式版标签，安装包清单含精确安装器。 */
function officialPages(version = '1.0.74') {
  return vi.fn(async (url: string) => (url === latestPage ? redirect(version) : assets(version)))
}

it('启动只请求一次，手动检查重新请求，并合并同时到达的请求', async () => {
  const request = vi.fn(async () => new Response(JSON.stringify(release())))
  const page = officialPages('1.0.75')
  const check = createAppUpdateChecker('1.0.74', request, page)
  const [first, second] = await Promise.all([check(false), check(false)])
  expect(first).toEqual(second)
  expect(first.status).toBe('available')
  expect(first.releaseUrl).toBe(`${sourceRepository}/releases/tag/v1.0.75`)
  await check(false)
  expect(request).toHaveBeenCalledTimes(1)
  await Promise.all([check(true), check(true)])
  expect(request).toHaveBeenCalledTimes(2)
  // API 正常时不接触发布页备用链。
  expect(page).not.toHaveBeenCalled()
})
it.each(['1.0.74', '1.0.9'])('相同或更旧版本 %s 不提示升级', async (version) => {
  const check = createAppUpdateChecker(
    '1.0.74',
    async () => new Response(JSON.stringify(release(version))),
    officialPages(version),
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
    const page = officialPages('1.0.75')
    const check = createAppUpdateChecker(
      '1.0.74',
      async () => new Response(JSON.stringify({ ...release(), ...patch })),
      page,
    )
    await expect(check(false)).rejects.toThrow()
    expect(page).not.toHaveBeenCalled()
  }
})
it('API 正常响应的畸形/超限内容继续失败，不启用备用页', async () => {
  const bodies = [
    '{not json',
    'x'.repeat(256 * 1024 + 1),
    JSON.stringify({ ...release(), tag_name: 'v01.0.75' }),
    JSON.stringify({ ...release(), assets: [{ name: 'LingtuAI-Setup-1.0.75-win-x64.exe.sig' }] }),
  ]
  for (const body of bodies) {
    const page = officialPages('1.0.75')
    const check = createAppUpdateChecker('1.0.74', async () => new Response(body), page)
    await expect(check(false)).rejects.toThrow()
    expect(page).not.toHaveBeenCalled()
  }
})
it('无正式版与网络失败分别处理，失败后允许手动重试', async () => {
  expect(
    (
      await createAppUpdateChecker(
        '1.0.74',
        async () => new Response('', { status: 404 }),
        officialPages(),
      )(false)
    ).status,
  ).toBe('unpublished')
  const request = vi
    .fn()
    .mockRejectedValueOnce(Error('network'))
    .mockResolvedValue(new Response(JSON.stringify(release())))
  const check = createAppUpdateChecker('1.0.74', request, officialPages('1.0.75'))
  await expect(check(false)).rejects.toThrow()
  expect((await check(true)).status).toBe('available')
  expect(request).toHaveBeenCalledTimes(2)
})

it('API 403 且 remaining=0 时经官方发布页得到较新正式版，不把限流伪装成最新', async () => {
  const page = officialPages('1.0.75')
  const check = createAppUpdateChecker('1.0.74', async () => limited(), page)
  expect(await check(false)).toEqual({
    currentVersion: '1.0.74',
    latestVersion: '1.0.75',
    status: 'available',
    releaseUrl: `${sourceRepository}/releases/tag/v1.0.75`,
  })
  expect(page.mock.calls.map(([url]) => url)).toEqual([latestPage, assetsPage('1.0.75')])
})
it('429 视为真实限流并启用官方发布页备用路径', async () => {
  const page = officialPages('1.0.75')
  const check = createAppUpdateChecker('1.0.74', async () => limited(429), page)
  expect((await check(true)).status).toBe('available')
  expect(page).toHaveBeenCalledTimes(2)
})
it('公开版比当前安装版旧时不降级、不提示升级', async () => {
  const page = officialPages('1.0.74')
  const check = createAppUpdateChecker('1.0.88', async () => limited(), page)
  const result = await check(false)
  expect(result.status).toBe('current')
  expect(result.latestVersion).toBe('1.0.74')
  expect(result.releaseUrl).toBeNull()
})
it.each([
  ['403 缺少限流头', 403, {}],
  ['403 仍有剩余额度', 403, { 'x-ratelimit-remaining': '12' }],
  ['500 服务错误', 500, { 'x-ratelimit-remaining': '0' }],
  ['401 未授权', 401, { 'x-ratelimit-remaining': '0' }],
])('%s 不启用备用路径，保持失败', async (_label, status, headers) => {
  const page = officialPages('1.0.75')
  const check = createAppUpdateChecker('1.0.74', async () => limited(status, headers), page)
  await expect(check(false)).rejects.toThrow('暂时无法检查更新，请稍后重试')
  expect(page).not.toHaveBeenCalled()
})

it('限流后官方页面跳转目标必须是固定仓库的正式版标签', async () => {
  const hostile: [string, Partial<GithubPageResponse>][] = [
    [
      '非 HTTPS',
      { location: 'http://github.com/907609732/LTTLT-AI-Customer-Service/releases/tag/v1.0.75' },
    ],
    [
      '站外主机',
      { location: 'https://evil.example/907609732/LTTLT-AI-Customer-Service/releases/tag/v1.0.75' },
    ],
    ['其他仓库', { location: 'https://github.com/907609732/another-repo/releases/tag/v1.0.75' }],
    ['预发布标签', { location: tagPage('1.0.75-beta') }],
    ['缺少 v 前缀', { location: `${sourceRepository}/releases/tag/1.0.75` }],
    ['带查询参数', { location: `${tagPage('1.0.75')}?x=1` }],
    ['带锚点', { location: `${tagPage('1.0.75')}#assets` }],
    ['末尾斜杠', { location: `${tagPage('1.0.75')}/` }],
    ['非跳转响应', { status: 200, location: null }],
    ['404 响应', { status: 404, location: null }],
  ]
  for (const [label, patch] of hostile) {
    const page = vi.fn(async (url: string) =>
      url === latestPage ? { ...redirect('1.0.75'), ...patch } : assets('1.0.75'),
    )
    const check = createAppUpdateChecker('1.0.74', async () => limited(), page)
    await expect(check(false), label).rejects.toThrow('更新信息异常，请稍后重试')
    // 只请求过 latest，注入的恶意地址从未被访问。
    expect(
      page.mock.calls.map(([url]) => url),
      label,
    ).toEqual([latestPage])
  }
})
it('限流备用路径缺少精确安装包或下载路径异常时失败，不报告最新', async () => {
  const cases: [string, GithubPageResponse | ((version: string) => GithubPageResponse)][] = [
    ['只有旧版安装包', assets('1.0.7')],
    [
      '安装包文本存在但下载路径指向其他仓库',
      assets('1.0.75', {
        body: '<a href="/907609732/other/releases/download/v1.0.75/LingtuAI-Setup-1.0.75-win-x64.exe"><span class="text-bold">LingtuAI-Setup-1.0.75-win-x64.exe</span></a>',
      }),
    ],
    [
      '安装包文本存在但下载版本不符',
      assets('1.0.75', {
        body: '<a href="/907609732/LTTLT-AI-Customer-Service/releases/download/v1.0.74/LingtuAI-Setup-1.0.75-win-x64.exe"><span class="text-bold">LingtuAI-Setup-1.0.75-win-x64.exe</span></a>',
      }),
    ],
    [
      '只有文件文本没有下载链接',
      assets('1.0.75', {
        body: '<span class="text-bold">LingtuAI-Setup-1.0.75-win-x64.exe</span>',
      }),
    ],
    ['资源清单 404', { status: 404, location: null, contentType: 'text/html', body: 'Not Found' }],
    [
      '资源清单 302 跳转',
      { status: 302, location: 'https://evil.example/assets', contentType: 'text/html', body: '' },
    ],
    ['资源清单非 HTML', assets('1.0.75', { contentType: 'application/json' })],
    ['资源清单超限', assets('1.0.75', { body: 'x'.repeat(256 * 1024 + 1) })],
  ]
  for (const [label, pageResult] of cases) {
    const page = vi.fn(async (url: string) =>
      url === latestPage
        ? redirect('1.0.75')
        : typeof pageResult === 'function'
          ? pageResult('1.0.75')
          : pageResult,
    )
    const check = createAppUpdateChecker('1.0.74', async () => limited(), page)
    await expect(check(false), label).rejects.toThrow()
    expect(page, label).toHaveBeenCalledTimes(2)
  }
})
it('官方页面本身失败时保持检查失败，不返回 current', async () => {
  for (const error of [Error('network'), new DOMException('aborted', 'AbortError')]) {
    const page = vi.fn(async () => {
      throw error
    })
    const check = createAppUpdateChecker('1.0.74', async () => limited(), page)
    await expect(check(false)).rejects.toThrow('暂时无法检查更新，请稍后重试')
    expect(page).toHaveBeenCalledTimes(1)
  }
})
it('限流备用链共用同一个15秒总超时信号，且不静默重试', async () => {
  const timeout = vi.spyOn(AbortSignal, 'timeout')
  const signals: AbortSignal[] = []
  const request = vi.fn((_input: string | URL | Request, init?: RequestInit) => {
    signals.push(init!.signal as AbortSignal)
    return Promise.resolve(limited())
  })
  const page = vi.fn(async (url: string, signal: AbortSignal) => {
    signals.push(signal)
    return url === latestPage ? redirect('1.0.75') : assets('1.0.75')
  })
  const check = createAppUpdateChecker('1.0.74', request as unknown as typeof fetch, page)
  expect((await check(true)).status).toBe('available')
  expect(timeout).toHaveBeenCalledTimes(1)
  expect(timeout).toHaveBeenCalledWith(15_000)
  expect(new Set(signals).size).toBe(1)
  expect(signals[0]).toBe(timeout.mock.results[0]!.value)
  expect(request).toHaveBeenCalledTimes(1)
  expect(page).toHaveBeenCalledTimes(2)
  timeout.mockRestore()
})
it('限流备用链进行中到达的并发检查合并为一次，之后手动检查可重新开始', async () => {
  const request = vi.fn(async () => limited())
  const page = officialPages('1.0.75')
  const check = createAppUpdateChecker('1.0.74', request, page)
  const results = await Promise.all([check(true), check(true), check(true)])
  expect(results.map((result) => result.status)).toEqual(['available', 'available', 'available'])
  expect(request).toHaveBeenCalledTimes(1)
  expect(page).toHaveBeenCalledTimes(2)
  await check(true)
  expect(request).toHaveBeenCalledTimes(2)
  expect(page).toHaveBeenCalledTimes(4)
})

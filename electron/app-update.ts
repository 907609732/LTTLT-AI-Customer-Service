import { z } from 'zod'
import type { AppUpdateResult } from '../src/shared/contracts/app-update'

const repositoryPath = '907609732/LTTLT-AI-Customer-Service'
const sourceRepository = `https://github.com/${repositoryPath}`
const endpoint = `https://api.github.com/repos/${repositoryPath}/releases/latest`
const versionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/
// 只接受官方发布页“最新正式版”跳转到本仓库的 v<三段版本> 标签；逐字符固定主机、仓库与路径。
const releaseTagPattern =
  /^https:\/\/github\.com\/907609732\/LTTLT-AI-Customer-Service\/releases\/tag\/v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/
const releaseSchema = z.object({
  tag_name: z.string().max(64),
  draft: z.literal(false),
  prerelease: z.literal(false),
  assets: z.array(z.object({ name: z.string().max(256) })).max(100),
})

const maxResponseBytes = 256 * 1024
const maxPageBytes = 256 * 1024
const unavailableMessage = '暂时无法检查更新，请稍后重试'
const invalidMessage = '更新信息异常，请稍后重试'
const missingInstallerMessage = '暂未找到可用安装包，请稍后重试'

/**
 * 官方 GitHub 发布页的一次只读响应。适配器不得自动跟随任何跳转：
 * redirect 只回传状态码与真实 Location，由本模块按固定仓库白名单校验。
 */
export interface GithubPageResponse {
  status: number
  location: string | null
  contentType: string | null
  body: string
}
export type GithubPageRequest = (url: string, signal: AbortSignal) => Promise<GithubPageResponse>

// 未注入页面适配器时闭锁：匿名 API 限流后保持检查失败，绝不复用错误数据。
const unavailablePageRequest: GithubPageRequest = async () => {
  throw Error(unavailableMessage)
}

/** GitHub 匿名 API 主限流的真实信号：403 + core 额度剩余 0，或 429（次级限流）。 */
function isRateLimited(response: Response) {
  if (response.status === 429) return true
  return response.status === 403 && response.headers.get('x-ratelimit-remaining') === '0'
}

async function readBounded(response: Response) {
  const reader = response.body?.getReader()
  if (!reader) throw Error('更新信息为空，请稍后重试')
  const chunks: Uint8Array[] = []
  let length = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      length += value.byteLength
      if (length > maxResponseBytes) throw Error(invalidMessage)
      chunks.push(value)
    }
  } finally {
    await reader.cancel()
    reader.releaseLock()
  }
  return Buffer.concat(chunks).toString('utf8')
}

/** 仅查询版本；不下载、执行安装器或携带托管账号凭据。 */
export function createAppUpdateChecker(
  currentVersion: string,
  request: typeof fetch = fetch,
  pageRequest: GithubPageRequest = unavailablePageRequest,
) {
  let startup: Promise<AppUpdateResult> | undefined
  let pending: Promise<AppUpdateResult> | undefined

  function resultFor(latestVersion: string): AppUpdateResult {
    if (!versionPattern.test(currentVersion)) throw Error(missingInstallerMessage)
    const latest = latestVersion.split('.').map(Number)
    const current = currentVersion.split('.').map(Number)
    const difference = latest.findIndex((part, index) => part !== current[index])
    const newer = difference !== -1 && latest[difference]! > current[difference]!
    return {
      currentVersion,
      latestVersion,
      status: newer ? 'available' : 'current',
      releaseUrl: newer ? `${sourceRepository}/releases/tag/v${latestVersion}` : null,
    }
  }

  /**
   * 限流备用路径：只读官方发布页，不复用 API。先取 /releases/latest 的真实 302
   * Location 并精确校验，再自行构造固定仓库的 expanded_assets 地址；不跟随
   * 任何服务器给出的跳转，也不访问站外或其他仓库。安装包缺失/页面异常继续失败。
   */
  async function queryPublicPages(signal: AbortSignal): Promise<AppUpdateResult> {
    let latestPage: GithubPageResponse
    let assetsPage: GithubPageResponse
    try {
      latestPage = await pageRequest(`${sourceRepository}/releases/latest`, signal)
    } catch {
      throw Error(unavailableMessage)
    }
    const match =
      [301, 302, 303, 307, 308].includes(latestPage.status) && latestPage.location
        ? releaseTagPattern.exec(latestPage.location)
        : null
    if (!match) throw Error(invalidMessage)
    const latestVersion = `${match[1]}.${match[2]}.${match[3]}`

    try {
      assetsPage = await pageRequest(
        `${sourceRepository}/releases/expanded_assets/v${latestVersion}`,
        signal,
      )
    } catch {
      throw Error(unavailableMessage)
    }
    if (
      assetsPage.status !== 200 ||
      !assetsPage.contentType?.toLowerCase().startsWith('text/html') ||
      // 适配器按字节流截断；纯检查器也按 UTF-8 字节复核，避免中文等多字节内容绕过。
      Buffer.byteLength(assetsPage.body, 'utf8') > maxPageBytes
    )
      throw Error(invalidMessage)

    const assetName = `LingtuAI-Setup-${latestVersion}-win-x64.exe`
    const downloadPath = `/${repositoryPath}/releases/download/v${latestVersion}/${assetName}`
    // 必须同时出现精确下载地址与精确文件条目，避免只匹配到说明文字或旧版文件。
    if (
      !assetsPage.body.includes(`href="${downloadPath}"`) ||
      !assetsPage.body.includes(`>${assetName}<`)
    )
      throw Error(missingInstallerMessage)
    return resultFor(latestVersion)
  }

  async function query(): Promise<AppUpdateResult> {
    // 备用链不额外计时：API 与两次发布页请求共用同一个 15 秒总预算。
    const signal = AbortSignal.timeout(15_000)
    const response = await request(endpoint, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'LingtuAI-Update-Check' },
      signal,
      redirect: 'error',
      credentials: 'omit',
    })
    if (response.status === 404)
      return { currentVersion, latestVersion: null, status: 'unpublished', releaseUrl: null }
    if (!response.ok) {
      // 只有真实的匿名限流信号才启用官方页面；其他 403/5xx 仍按失败处理。
      if (isRateLimited(response)) return queryPublicPages(signal)
      throw Error(unavailableMessage)
    }
    const release = releaseSchema.parse(JSON.parse(await readBounded(response)))
    const latestVersion = release.tag_name.replace(/^v/, '')
    if (
      !versionPattern.test(latestVersion) ||
      !versionPattern.test(currentVersion) ||
      !release.assets.some((asset) => asset.name === `LingtuAI-Setup-${latestVersion}-win-x64.exe`)
    ) {
      throw Error(missingInstallerMessage)
    }
    return resultFor(latestVersion)
  }

  return (manual: boolean): Promise<AppUpdateResult> => {
    // 自动检查按进程缓存（包括失败）；手动重试可刷新，重叠请求共用同一查询。
    if (!manual && startup) return startup
    if (!pending) {
      pending = query().finally(() => {
        pending = undefined
      })
    }
    if (!manual) startup = pending
    return pending
  }
}

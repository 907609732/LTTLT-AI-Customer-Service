import { z } from 'zod'
import type { AppUpdateResult } from '../src/shared/contracts/app-update'

const repository = 'https://github.com/907609732/LTTLT-AI-Customer-Service'
const endpoint = 'https://api.github.com/repos/907609732/LTTLT-AI-Customer-Service/releases/latest'
const versionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/
const releaseSchema = z.object({
  tag_name: z.string().max(64),
  draft: z.literal(false),
  prerelease: z.literal(false),
  assets: z.array(z.object({ name: z.string().max(256) })).max(100),
})

/** 固定官方正式 Release，仅查询版本；不下载、执行安装器或携带托管账号凭据。 */
export function createAppUpdateChecker(currentVersion: string, request: typeof fetch = fetch) {
  let startup: Promise<AppUpdateResult> | undefined
  let pending: Promise<AppUpdateResult> | undefined
  async function query(): Promise<AppUpdateResult> {
    const response = await request(endpoint, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'LingtuAI-Update-Check' },
      signal: AbortSignal.timeout(15_000),
      redirect: 'error',
      credentials: 'omit',
    })
    if (response.status === 404)
      return { currentVersion, latestVersion: null, status: 'unpublished', releaseUrl: null }
    if (!response.ok) throw Error('暂时无法检查更新，请稍后重试')
    const reader = response.body?.getReader()
    if (!reader) throw Error('更新信息为空，请稍后重试')
    const chunks: Uint8Array[] = []
    let length = 0
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        length += value.byteLength
        if (length > 256 * 1024) throw Error('更新信息异常，请稍后重试')
        chunks.push(value)
      }
    } finally {
      await reader.cancel()
      reader.releaseLock()
    }
    const release = releaseSchema.parse(JSON.parse(Buffer.concat(chunks).toString('utf8')))
    const latestVersion = release.tag_name.replace(/^v/, '')
    if (
      !versionPattern.test(latestVersion) ||
      !versionPattern.test(currentVersion) ||
      !release.assets.some((asset) => asset.name === `LingtuAI-Setup-${latestVersion}-win-x64.exe`)
    ) {
      throw Error('暂未找到可用安装包，请稍后重试')
    }
    const latest = latestVersion.split('.').map(Number)
    const current = currentVersion.split('.').map(Number)
    const difference = latest.findIndex((part, index) => part !== current[index])
    const newer = difference !== -1 && latest[difference]! > current[difference]!
    return {
      currentVersion,
      latestVersion,
      status: newer ? 'available' : 'current',
      releaseUrl: newer ? `${repository}/releases/tag/v${latestVersion}` : null,
    }
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

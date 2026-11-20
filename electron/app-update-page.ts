import { net } from 'electron'
import type { ClientRequest } from 'electron'
import type { GithubPageRequest, GithubPageResponse } from './app-update'

const maxPageBytes = 256 * 1024
const unavailableMessage = '暂时无法检查更新，请稍后重试'
const invalidMessage = '更新信息异常，请稍后重试'

function headerValue(headers: unknown, name: string): string | null {
  if (!headers || typeof headers !== 'object') return null
  const value = (headers as Record<string, unknown>)[name]
  if (typeof value === 'string') return value
  if (Array.isArray(value) && typeof value[0] === 'string') return value[0]
  return null
}

/**
 * 官方 GitHub 发布页的只读适配器。使用独立内存 session（不带账户 Cookie），
 * 不跟随任何跳转：redirect 事件里解析并回传真实 Location 后立即中断，由
 * app-update 按固定仓库白名单决定下一步；也不携带 Cookie、令牌或认证头。
 */
export const requestGithubPage: GithubPageRequest = (url, signal) =>
  new Promise<GithubPageResponse>((resolve, reject) => {
    if (signal.aborted) {
      reject(Error(unavailableMessage))
      return
    }
    let settled = false
    let request: ClientRequest | undefined
    const settle = (action: () => void) => {
      if (settled) return
      settled = true
      signal.removeEventListener('abort', onAbort)
      action()
    }
    const fail = (message: string) => settle(() => reject(Error(message)))
    const abortQuietly = () => {
      try {
        request?.abort()
      } catch {
        // 请求可能已结束；abort 自身的异常不影响已确定的结果。
      }
    }
    const onAbort = () => {
      abortQuietly()
      fail(unavailableMessage)
    }
    signal.addEventListener('abort', onAbort, { once: true })

    try {
      request = net.request({
        method: 'GET',
        url,
        redirect: 'manual',
        // 独立内存 session 只保证没有现存 Cookie，并不禁止会话认证；显式 omit。
        credentials: 'omit',
        useSessionCookies: false,
        // 无 persist 前缀即内存 session：不读取本机登录 Cookie 或磁盘缓存。
        partition: 'lingtu-app-update',
      })
    } catch {
      fail(unavailableMessage)
      return
    }
    try {
      request.setHeader('User-Agent', 'LingtuAI-Update-Check')
      request.setHeader('Accept', 'text/html')
    } catch {
      abortQuietly()
      fail(unavailableMessage)
      return
    }

    request.on('redirect', (status, _method, redirectUrl, responseHeaders) => {
      const location =
        (typeof redirectUrl === 'string' && redirectUrl) || headerValue(responseHeaders, 'location')
      settle(() =>
        resolve({
          status,
          location: location || null,
          contentType: headerValue(responseHeaders, 'content-type'),
          body: '',
        }),
      )
      abortQuietly()
    })

    request.on('response', (response) => {
      const chunks: Buffer[] = []
      let length = 0
      let overflow = false
      response.on('data', (chunk: Buffer) => {
        if (overflow) return
        length += chunk.length
        if (length > maxPageBytes) {
          overflow = true
          abortQuietly()
          fail(invalidMessage)
          return
        }
        chunks.push(chunk)
      })
      response.on('end', () => {
        if (overflow) return
        settle(() =>
          resolve({
            status: response.statusCode,
            location: null,
            contentType: headerValue(response.headers, 'content-type'),
            body: Buffer.concat(chunks).toString('utf8'),
          }),
        )
      })
      response.on('error', () => fail(unavailableMessage))
      response.on('aborted', () => fail(unavailableMessage))
    })
    // 不把底层网络错误直接展示给用户；内部原因由调用方的统一文案覆盖。
    request.on('error', () => fail(unavailableMessage))
    request.end()
  })

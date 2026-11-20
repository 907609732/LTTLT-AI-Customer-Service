import { EventEmitter } from 'node:events'
import { beforeEach, expect, it, vi } from 'vitest'
import type { ClientRequestConstructorOptions } from 'electron'

const electronMock = vi.hoisted(() => ({ request: vi.fn() }))
vi.mock('electron', () => ({ net: { request: electronMock.request } }))

import { requestGithubPage } from '../electron/app-update-page'

const target = 'https://github.com/907609732/LTTLT-AI-Customer-Service/releases/latest'
const tag = 'https://github.com/907609732/LTTLT-AI-Customer-Service/releases/tag/v1.0.74'
const unavailable = '暂时无法检查更新，请稍后重试'
const invalid = '更新信息异常，请稍后重试'

class FakeResponse extends EventEmitter {
  statusCode = 200
  headers: Record<string, string | string[]> = { 'content-type': 'text/html; charset=utf-8' }
}

class FakeRequest extends EventEmitter {
  readonly headers = new Map<string, string>()
  readonly end = vi.fn()
  readonly abort = vi.fn()
  readonly followRedirect = vi.fn()
  setHeader(name: string, value: string) {
    this.headers.set(name, value)
  }
}

interface Outcome {
  status: 'fulfilled' | 'rejected'
  value?: unknown
  reason?: unknown
}

function createRequest(signal: AbortSignal) {
  const request = new FakeRequest()
  electronMock.request.mockReturnValue(request)
  return { request, result: requestGithubPage(target, signal) }
}

/** 记录首次结算，用于证明迟到事件没有把失败改写成成功或反之。 */
function track(promise: Promise<unknown>) {
  const outcomes: Outcome[] = []
  void promise.then(
    (value) => outcomes.push({ status: 'fulfilled', value }),
    (reason) => outcomes.push({ status: 'rejected', reason }),
  )
  return outcomes
}

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

beforeEach(() => {
  electronMock.request.mockReset()
})

it('请求显式 omit 认证与会话 Cookie，只发送固定非凭据头', () => {
  const { request } = createRequest(new AbortController().signal)
  const options = electronMock.request.mock.calls[0]![0] as ClientRequestConstructorOptions
  expect(options).toMatchObject({
    method: 'GET',
    url: target,
    redirect: 'manual',
    credentials: 'omit',
    useSessionCookies: false,
    partition: 'lingtu-app-update',
  })
  expect(options.session).toBeUndefined()
  expect(options.partition?.startsWith('persist:')).toBe(false)
  expect([...request.headers.keys()]).toEqual(['User-Agent', 'Accept'])
  expect(request.headers.get('User-Agent')).toBe('LingtuAI-Update-Check')
  expect(request.headers.get('Accept')).toBe('text/html')
  expect(request.end).toHaveBeenCalledTimes(1)
})

it('redirect 只回传 Location 并中断，绝不调用 followRedirect', async () => {
  const { request, result } = createRequest(new AbortController().signal)
  const outcomes = track(result)
  request.emit('redirect', 302, 'GET', tag, {
    location: [tag],
    'content-type': ['text/html; charset=utf-8'],
  })
  await flush()
  expect(outcomes).toEqual([
    {
      status: 'fulfilled',
      value: { status: 302, location: tag, contentType: 'text/html; charset=utf-8', body: '' },
    },
  ])
  expect(request.followRedirect).not.toHaveBeenCalled()
  expect(request.abort).toHaveBeenCalledTimes(1)
  // abort 之后 Electron 可能补发 error；不得把已返回的 Location 改成失败。
  request.emit('error', Error('迟到的 abort 错误'))
  await flush()
  expect(outcomes).toHaveLength(1)
})

it('redirect 事件缺少地址参数时回退到响应头 Location', async () => {
  const { request, result } = createRequest(new AbortController().signal)
  request.emit('redirect', 301, 'GET', '', { location: [tag] })
  await expect(result).resolves.toMatchObject({ status: 301, location: tag, body: '' })
  expect(request.followRedirect).not.toHaveBeenCalled()
  expect(request.abort).toHaveBeenCalledTimes(1)
})

it('signal 已取消时不创建请求', async () => {
  const controller = new AbortController()
  controller.abort()
  await expect(requestGithubPage(target, controller.signal)).rejects.toThrow(unavailable)
  expect(electronMock.request).not.toHaveBeenCalled()
})

it('运行中取消会 abort 并拒绝，迟到响应不能改写结果且移除监听', async () => {
  const controller = new AbortController()
  const add = vi.spyOn(controller.signal, 'addEventListener')
  const remove = vi.spyOn(controller.signal, 'removeEventListener')
  const { request, result } = createRequest(controller.signal)
  const outcomes = track(result)
  controller.abort()
  expect(request.abort).toHaveBeenCalledTimes(1)
  const response = new FakeResponse()
  request.emit('response', response)
  response.emit('data', Buffer.from('迟到内容'))
  response.emit('end')
  request.emit('error', Error('迟到的错误'))
  await flush()
  expect(outcomes).toHaveLength(1)
  expect(outcomes[0]).toMatchObject({ status: 'rejected' })
  if (outcomes[0]?.status === 'rejected')
    expect((outcomes[0].reason as Error).message).toBe(unavailable)
  expect(add).toHaveBeenCalledWith('abort', expect.any(Function), { once: true })
  expect(remove).toHaveBeenCalledWith('abort', add.mock.calls[0]![1])
})

it('响应超过 256 KiB 会 abort 并拒绝，随后的事件不能改成成功', async () => {
  const { request, result } = createRequest(new AbortController().signal)
  const outcomes = track(result)
  const response = new FakeResponse()
  request.emit('response', response)
  response.emit('data', Buffer.alloc(256 * 1024 + 1, 0x61))
  expect(request.abort).toHaveBeenCalledTimes(1)
  response.emit('data', Buffer.from('更多内容'))
  response.emit('end')
  response.emit('error', Error('迟到的流错误'))
  request.emit('error', Error('迟到的请求错误'))
  await flush()
  expect(outcomes).toHaveLength(1)
  expect(outcomes[0]).toMatchObject({ status: 'rejected' })
  if (outcomes[0]?.status === 'rejected')
    expect((outcomes[0].reason as Error).message).toBe(invalid)
})

it('正常响应按 UTF-8 汇总并结算，结束后移除 signal 监听', async () => {
  const controller = new AbortController()
  const add = vi.spyOn(controller.signal, 'addEventListener')
  const remove = vi.spyOn(controller.signal, 'removeEventListener')
  const { request, result } = createRequest(controller.signal)
  const response = new FakeResponse()
  request.emit('response', response)
  response.emit('data', Buffer.from('hello '))
  response.emit('data', Buffer.from('世界'))
  response.emit('end')
  await expect(result).resolves.toEqual({
    status: 200,
    location: null,
    contentType: 'text/html; charset=utf-8',
    body: 'hello 世界',
  })
  expect(request.abort).not.toHaveBeenCalled()
  expect(remove).toHaveBeenCalledWith('abort', add.mock.calls[0]![1])
})

it('请求错误、响应错误与响应中断都结算为检查失败，迟到 end 不能改成成功', async () => {
  const controller = new AbortController()
  const add = vi.spyOn(controller.signal, 'addEventListener')
  const remove = vi.spyOn(controller.signal, 'removeEventListener')
  const requestFailure = createRequest(controller.signal)
  const requestOutcomes = track(requestFailure.result)
  requestFailure.request.emit('error', Error('ECONNRESET'))
  const lateResponse = new FakeResponse()
  requestFailure.request.emit('response', lateResponse)
  lateResponse.emit('data', Buffer.from('迟到内容'))
  lateResponse.emit('end')
  await flush()
  expect(requestOutcomes).toHaveLength(1)
  expect(requestOutcomes[0]).toMatchObject({ status: 'rejected' })
  if (requestOutcomes[0]?.status === 'rejected')
    expect((requestOutcomes[0].reason as Error).message).toBe(unavailable)
  expect(remove).toHaveBeenCalledWith('abort', add.mock.calls[0]![1])

  for (const event of ['error', 'aborted'] as const) {
    const streamFailure = createRequest(new AbortController().signal)
    const streamOutcomes = track(streamFailure.result)
    const response = new FakeResponse()
    streamFailure.request.emit('response', response)
    response.emit('data', Buffer.from('部分内容'))
    response.emit(event, Error('stream failed'))
    response.emit('end')
    await flush()
    expect(streamOutcomes, event).toHaveLength(1)
    expect(streamOutcomes[0], event).toMatchObject({ status: 'rejected' })
    if (streamOutcomes[0]?.status === 'rejected')
      expect((streamOutcomes[0].reason as Error).message, event).toBe(unavailable)
  }
})

import type { Session, WebContents } from 'electron'

interface QueryTrace {
  pending: Set<number>
  started: number
  failed: boolean
  settledAt: number
}
/** One observer per store Session; never changes a request or reads headers/bodies. */
export function createAssistQueryMonitor(origin = 'https://mms.pinduoduo.com') {
  const sessions = new Set<Session>()
  const traces = new Map<number, QueryTrace>()
  const relevant = (details: { webContentsId?: number; resourceType: string; url: string }) => {
    if (details.resourceType !== 'xhr' || details.webContentsId === undefined) return
    try {
      if (new URL(details.url).origin !== origin) return
      return traces.get(details.webContentsId)
    } catch {
      return
    }
  }
  function register(session: Session) {
    if (sessions.has(session)) return
    sessions.add(session)
    const filter = { urls: [`${origin}/*`] }
    session.webRequest.onSendHeaders(filter, (details) => {
      const trace = relevant(details)
      if (trace && !trace.pending.has(details.id)) {
        trace.started++
        trace.pending.add(details.id)
      }
    })
    const finish = (
      details: { id: number; webContentsId?: number; resourceType: string; url: string },
      success: boolean,
    ) => {
      const trace = relevant(details)
      if (!trace?.pending.delete(details.id)) return
      trace.failed ||= !success
      trace.settledAt = Date.now()
    }
    session.webRequest.onCompleted(filter, (details) =>
      finish(details, details.statusCode >= 200 && details.statusCode < 300),
    )
    session.webRequest.onErrorOccurred(filter, (details) => finish(details, false))
  }
  return {
    async run(
      page: Pick<WebContents, 'id' | 'session' | 'isDestroyed'>,
      action: () => Promise<void>,
      ready: () => Promise<boolean>,
      signal?: AbortSignal,
    ) {
      signal?.throwIfAborted()
      if (traces.has(page.id)) throw Error('平台查询正在进行')
      register(page.session)
      const trace: QueryTrace = {
        pending: new Set(),
        started: 0,
        failed: false,
        settledAt: Date.now(),
      }
      traces.set(page.id, trace)
      const deadline = Date.now() + 8000
      try {
        await action()
        while (Date.now() < deadline) {
          signal?.throwIfAborted()
          if (page.isDestroyed() || traces.get(page.id) !== trace) throw Error('平台查询已取消')
          const rendered = await ready()
          if (
            trace.started > 0 &&
            trace.pending.size === 0 &&
            Date.now() - trace.settledAt >= 200 &&
            rendered
          ) {
            if (trace.failed) throw Error('平台查询请求失败，保留上次结果')
            return
          }
          await new Promise((resolve) => setTimeout(resolve, 50))
        }
        throw Error('尚未确认平台查询完成，保留上次结果')
      } finally {
        if (traces.get(page.id) === trace) traces.delete(page.id)
      }
    },
    dispose() {
      traces.clear()
      for (const session of sessions) {
        session.webRequest.onSendHeaders(null)
        session.webRequest.onCompleted(null)
        session.webRequest.onErrorOccurred(null)
      }
      sessions.clear()
    },
  }
}

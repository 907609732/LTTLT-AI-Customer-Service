import type { Session, WebContents } from 'electron'

interface QueryTrace {
  pending: Set<number>
  started: number
  failed: boolean
  settledAt: number
  paths?: readonly string[]
}
type QueryDetails = { webContentsId?: number; resourceType: string; url: string }
interface SessionObserver {
  owners: Set<symbol>
  traces: Map<number, { owner: symbol; trace: QueryTrace }>
}
const observers = new WeakMap<Session, SessionObserver>()
/** One observer per store Session; never changes a request or reads headers/bodies. */
export function createAssistQueryMonitor(origin = 'https://mms.pinduoduo.com') {
  const sessions = new Set<Session>()
  const owner = Symbol('query-monitor')
  const traces = new Map<number, QueryTrace>()
  const relevant = (observer: SessionObserver, details: QueryDetails) => {
    if (details.resourceType !== 'xhr' || details.webContentsId === undefined) return
    try {
      // The observer is shared across all same-session collectors and accepts only their origin.
      const url = new URL(details.url)
      if (url.origin !== origin) return
      const trace = observer.traces.get(details.webContentsId)?.trace
      if (trace?.paths && !trace.paths.includes(url.pathname)) return
      return trace
    } catch {
      return
    }
  }
  function register(session: Session) {
    if (sessions.has(session)) return observers.get(session)!
    sessions.add(session)
    let observer = observers.get(session)
    if (observer) {
      observer.owners.add(owner)
      return observer
    }
    observer = { owners: new Set([owner]), traces: new Map() }
    observers.set(session, observer)
    const shared = observer
    const filter = { urls: [`${origin}/*`] }
    session.webRequest.onSendHeaders(filter, (details) => {
      const trace = relevant(shared, details)
      if (trace && !trace.pending.has(details.id)) {
        trace.started++
        trace.pending.add(details.id)
      }
    })
    const finish = (
      details: { id: number; webContentsId?: number; resourceType: string; url: string },
      success: boolean,
    ) => {
      const trace = relevant(shared, details)
      if (!trace?.pending.delete(details.id)) return
      trace.failed ||= !success
      trace.settledAt = Date.now()
    }
    session.webRequest.onCompleted(filter, (details) =>
      finish(details, details.statusCode >= 200 && details.statusCode < 300),
    )
    session.webRequest.onErrorOccurred(filter, (details) => finish(details, false))
    return observer
  }
  return {
    async run(
      page: Pick<WebContents, 'id' | 'session' | 'isDestroyed'>,
      action: () => Promise<void>,
      ready: () => Promise<boolean>,
      signal?: AbortSignal,
      requestPaths?: readonly string[],
      options: { requireRequest?: boolean } = {},
    ) {
      signal?.throwIfAborted()
      if (traces.has(page.id)) throw Error('平台查询正在进行')
      const observer = register(page.session)
      if (observer.traces.has(page.id)) throw Error('平台查询正在进行')
      const trace: QueryTrace = {
        pending: new Set(),
        started: 0,
        failed: false,
        settledAt: Date.now(),
        paths: requestPaths,
      }
      traces.set(page.id, trace)
      observer.traces.set(page.id, { owner, trace })
      const deadline = Date.now() + 8000
      try {
        await action()
        while (Date.now() < deadline) {
          signal?.throwIfAborted()
          if (page.isDestroyed() || traces.get(page.id) !== trace) throw Error('平台查询已取消')
          const rendered = await ready()
          if (
            (trace.started > 0 || options.requireRequest === false) &&
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
        if (observer.traces.get(page.id)?.trace === trace) observer.traces.delete(page.id)
      }
    },
    dispose() {
      traces.clear()
      for (const session of sessions) {
        const observer = observers.get(session)
        if (!observer) continue
        for (const [id, item] of observer.traces)
          if (item.owner === owner) observer.traces.delete(id)
        observer.owners.delete(owner)
        if (observer.owners.size) continue
        session.webRequest.onSendHeaders(null)
        session.webRequest.onCompleted(null)
        session.webRequest.onErrorOccurred(null)
        observers.delete(session)
      }
      sessions.clear()
    },
  }
}

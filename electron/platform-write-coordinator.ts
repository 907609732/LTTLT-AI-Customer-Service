/** Reuses the runtime promise-queue pattern, keyed by the actual shared customer-service page. */
export class PlatformWriteCoordinator {
  private tails = new Map<string, Promise<void>>()
  private closed = false
  exclusive<T>(storeId: string, operation: () => Promise<T>): Promise<T> {
    const result = (this.tails.get(storeId) ?? Promise.resolve()).then(() => {
      if (this.closed) throw Error('平台写入服务已关闭')
      return operation()
    })
    const tail = result.then(
      () => {},
      () => {},
    )
    this.tails.set(storeId, tail)
    void tail.then(() => {
      if (this.tails.get(storeId) === tail) this.tails.delete(storeId)
    })
    return result
  }
  bind(storeId: string, value: unknown): { backend: unknown; operations: unknown } {
    if (!value || typeof value !== 'object') throw Error('平台适配器不可用')
    const originals = new Map<PropertyKey, (...args: unknown[]) => Promise<unknown>>()
    for (const key of ['sendText', 'focusConversation', 'reviewHistory']) {
      const method: unknown = Reflect.get(value, key)
      if (typeof method !== 'function') {
        if (key === 'sendText') throw Error('平台文字入口不可用')
        continue
      }
      originals.set(key, (...args) => Promise.resolve(Reflect.apply(method, value, args)))
    }
    const operations = new Proxy(value, {
      get(target, key) {
        // The operation provider already holds this mutex across revalidation, write and ack.
        if (originals.has(key)) return originals.get(key)
        const member: unknown = Reflect.get(target, key)
        return typeof member === 'function' ? member.bind(target) : member
      },
    })
    for (const [key, method] of originals)
      if (
        !Reflect.set(value, key, (...args: unknown[]) =>
          this.exclusive(storeId, () => method(...args)),
        )
      )
        throw Error('平台会话入口无法加入统一互斥')
    return { backend: value, operations }
  }
  dispose() {
    this.closed = true
    this.tails.clear()
  }
}

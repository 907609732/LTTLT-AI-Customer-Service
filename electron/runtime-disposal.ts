/** Drain every resource even after a disk error, then retain failed disposers for an explicit retry. */
export class RuntimeResourceDisposer {
  private pending: (() => unknown | Promise<unknown>)[]
  private running?: Promise<void>
  constructor(resources: (() => unknown | Promise<unknown>)[]) {
    this.pending = [...resources]
  }
  dispose(): Promise<void> {
    if (this.running) return this.running
    const operation = this.drain()
    this.running = operation
    void operation
      .finally(() => {
        if (this.running === operation) this.running = undefined
      })
      .catch(() => {})
    return operation
  }
  private async drain(): Promise<void> {
    const errors: unknown[] = [],
      failed: (() => unknown | Promise<unknown>)[] = []
    for (const resource of this.pending) {
      try {
        await resource()
      } catch (cause) {
        errors.push(cause)
        failed.push(resource)
      }
    }
    this.pending = failed
    if (errors.length)
      throw new AggregateError(errors, '部分工作区资源清理失败，其余资源已完成关闭，可重试失败项')
  }
}

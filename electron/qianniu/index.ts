import type { QianniuAccount } from '../../src/shared/contracts/qianniu'

const unavailable = () => new Error('主要算法未推送：此测试分支不提供客户端接入实现')

/** Public snapshot boundary: no native client launcher or mutation implementation is included. */
export class QianniuIntegration {
  readonly service = {
    available: () => false,
    async connect(): Promise<QianniuAccount[]> {
      throw unavailable()
    },
    async accounts(): Promise<QianniuAccount[]> {
      throw unavailable()
    },
  }
  constructor(_projectDir: string, _dataDir: string) {}
  adapter(_store: unknown): never {
    throw unavailable()
  }
  bind(_storeId: string, _account: QianniuAccount): never {
    throw unavailable()
  }
  isBound(_serviceId: string): boolean {
    return false
  }
  wrap<Manager>(delegate: Manager, _deps: Record<string, unknown>): Manager {
    return delegate
  }
  dispose(): void {
    return
  }
}

import { describe, it, expect } from 'vitest'
import * as contract from '../src/shared/contracts/platform-operations'
const snapshot = () => ({
  workspaceId: 'w',
  rules: [],
  runs: [],
  facts: [
    {
      storeId: 's',
      storeName: '本店',
      accountId: 'account',
      observedAt: 100,
      capabilities: [],
      buyers: [],
      orders: [],
      agents: [{ agentId: 'agent', name: '平台可转接客服', online: null, canTransfer: true }],
    },
  ],
})
describe('接待跨进程输出受限验证', () => {
  it('可转接名单允许在线未知，不伪造在线状态', () => {
    expect(contract.parseReceptionSnapshot(snapshot()).facts[0].agents[0]).toEqual({
      agentId: 'agent',
      name: '平台可转接客服',
      online: null,
      canTransfer: true,
    })
  })
  it('拒绝任何未列入快照的凭据字段', () => {
    expect(() =>
      contract.parseReceptionSnapshot({ ...snapshot(), accessToken: 'must-not-cross-ipc' }),
    ).toThrow()
    const value = snapshot()
    Object.assign(value.facts[0], { cookie: 'must-not-cross-ipc' })
    expect(() => contract.parseReceptionSnapshot(value)).toThrow()
  })
  it('拒绝超出领域上限的快照，而不把巨大数据或任意对象透传', () => {
    expect(() =>
      contract.parseReceptionSnapshot({
        ...snapshot(),
        facts: Array.from({ length: 201 }, () => snapshot().facts[0]),
      }),
    ).toThrow()
  })
})

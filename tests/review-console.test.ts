import { afterEach, describe, expect, it } from 'vitest'
import { ReviewConsole, type SendProposal } from '../electron/review-console'
import { emptySnapshot } from '../src/shared/contracts/backend'

const consoles: ReviewConsole[] = []
function setup() {
  const snap = emptySnapshot()
  snap.stores.push({
    id: 'shop',
    storeName: '甲店',
    platform: 'pdd-web',
    group: '',
    aiEnabled: true,
    runtime: { open: true, online: true },
  })
  const messages = [
    { from: 'buyer' as const, content: '现在多少钱', ts: 100, msgId: 'b1', type: 'text' as const },
  ]
  snap.conversations.push({
    storeId: 'shop',
    uid: 'buyer',
    name: '测试买家',
    status: 'pending',
    messages: [...messages],
  })
  let active = true
  const console = new ReviewConsole(
    () => snap,
    () => {},
  )
  consoles.push(console)
  const proposal: SendProposal = {
    storeId: 'shop',
    uid: 'buyer',
    text: '欢迎，售价100元',
    thread: messages,
    isCurrent: () => active,
    getHistory: async () => ({ known: true, messages: [...snap.conversations[0].messages] }),
  }
  return {
    snap,
    console,
    proposal,
    stop: () => {
      active = false
    },
  }
}
afterEach(() => {
  for (const console of consoles.splice(0)) console.dispose()
})
describe('AI 回复人工确认', () => {
  it('买家卡片区分构造请求与实际提交，并跟踪生成、确认及发送', async () => {
    const { console, snap, proposal } = setup()
    console.sync()
    const context = { storeId: 'shop', uid: 'buyer', buyers: snap.conversations[0].messages }
    const id = console.trace({ type: 'request', reviewContext: context, messages: [], thread: [] })
    const buyer = console.snapshot().logs.find((log) => log.kind === '买家消息')
    expect(buyer?.ai?.submitted).toBe(false)
    console.trace({ type: 'submitted', traceId: id, reviewContext: context })
    expect(buyer?.ai?.submitted).toBe(true)
    console.trace({ type: 'result', traceId: id, reply: '合成回复', reviewContext: context })
    const pending = console.propose(proposal)
    expect(buyer?.ai?.stage).toBe('confirming')
    await console.decide({ id: console.snapshot().replies[0].id, approve: true })
    expect(await pending).toBe(true)
    expect(buyer?.ai?.stage).toBe('sending')
    console.event({ type: 'reply:sent', storeId: 'shop', uid: 'buyer' })
    expect(buyer?.ai?.stage).toBe('sent')
  })
  it('轮询限流不进入日志，实际异常仍保留', () => {
    const { console } = setup()
    for (let i = 0; i < 100; i++)
      console.event({
        type: 'reply:throttled',
        storeId: 'shop',
        uid: 'buyer',
        reason: i % 2 ? 'uid_interval' : 'store_rate',
      })
    expect(console.snapshot().logs).toHaveLength(0)
    console.event({ type: 'reply:error', storeId: 'shop', uid: 'buyer' })
    expect(console.snapshot().logs).toHaveLength(1)
  })
  it('生成耗时记录完成后固定，不随人工确认和发送结果延长', () => {
    const { console } = setup()
    const id = console.trace({
      type: 'request',
      startedAt: Date.now() - 2500,
      messages: [],
      thread: [],
    })
    console.trace({ type: 'result', traceId: id, reply: '正文完成', durationMs: 2500 })
    const row = console.snapshot().traces[0]
    expect(row.durationMs).toBe(2500)
    expect(row.completedAt).toBeTypeOf('number')
    console.event({ type: 'reply:sent', storeId: 'shop', uid: 'buyer' })
    expect(row.durationMs).toBe(2500)
  })
  it('确认前一直等待，明确确认仅放行一次', async () => {
    const { console, proposal } = setup()
    let resolved = false
    const result = console.propose(proposal).then((ok) => {
      resolved = true
      return ok
    })
    await Promise.resolve()
    expect(resolved).toBe(false)
    const row = console.snapshot().replies[0]
    expect(row.text).toBe('欢迎，售价100元')
    await console.decide({ id: row.id, approve: true })
    expect(await result).toBe(true)
    await expect(console.decide({ id: row.id, approve: true })).rejects.toThrow('已处理')
  })
  it('取消不放行，重复确认不生效', async () => {
    const { console, proposal } = setup(),
      result = console.propose(proposal)
    const row = console.snapshot().replies[0]
    await console.decide({ id: row.id, approve: false })
    expect(await result).toBe(false)
    expect(row.status).toBe('rejected')
  })
  it('买家新消息、人工回复和关闭 AI 均使候选失效', async () => {
    for (const change of ['buyer', 'seller', 'stop']) {
      const { console, proposal, snap, stop } = setup(),
        result = console.propose(proposal)
      if (change === 'stop') stop()
      else
        snap.conversations[0].messages.push({
          from: change as 'buyer' | 'seller',
          content: '新消息',
          ts: 200,
          msgId: change,
          type: 'text',
        })
      console.sync()
      expect(await result).toBe(false)
      expect(console.snapshot().replies[0].status).toBe('expired')
    }
  })
  it('平台历史变化即使尚未归档也不能批准', async () => {
    const { console, proposal } = setup()
    proposal.getHistory = async () => ({
      known: true,
      messages: [{ from: 'buyer', content: '又一个问题', ts: 201, msgId: 'new' }],
    })
    const result = console.propose(proposal),
      row = console.snapshot().replies[0]
    await expect(console.decide({ id: row.id, approve: true })).rejects.toThrow('已有新消息')
    expect(await result).toBe(false)
  })
  it('无法核对平台历史时保留候选待重试，退出取消所有候选', async () => {
    const { console, proposal } = setup()
    proposal.getHistory = async () => ({ known: false, messages: [] })
    const result = console.propose(proposal),
      row = console.snapshot().replies[0]
    await expect(console.decide({ id: row.id, approve: true })).rejects.toThrow('暂时读取失败')
    expect(row.status).toBe('pending')
    console.dispose()
    expect(await result).toBe(false)
  })
  it('网页基线不依赖历史接口，消息 ID 和时间补全不使候选失效', async () => {
    const { console, proposal, snap } = setup()
    const page = {
      known: true,
      uid: 'buyer',
      page: 'page-1',
      messages: [{ from: 'buyer', content: '现在多少钱', media: [] }],
    }
    proposal.pageReview = page
    proposal.getPageReview = async () => structuredClone(page)
    proposal.getHistory = async () => {
      throw new Error('不应依赖私有历史 HTTP 接口')
    }
    const result = console.propose(proposal),
      row = console.snapshot().replies[0]
    snap.conversations[0].messages[0].msgId = 'platform-b1'
    snap.conversations[0].messages[0].ts = 100000
    console.sync()
    expect(row.status).toBe('pending')
    await console.decide({ id: row.id, approve: true })
    expect(await result).toBe(true)
  })
  it('网页临时读不到时不发送，恢复后可对同一候选再次明确确认', async () => {
    const { console, proposal } = setup()
    const page = {
      known: true,
      uid: 'buyer',
      page: 'page-1',
      messages: [{ from: 'buyer', content: '现在多少钱', media: [] }],
    }
    let loaded = false
    proposal.pageReview = page
    proposal.getPageReview = async () => (loaded ? page : { ...page, known: false })
    const result = console.propose(proposal),
      row = console.snapshot().replies[0]
    await expect(console.decide({ id: row.id, approve: true })).rejects.toThrow('暂时无法核对')
    expect(row.status).toBe('pending')
    loaded = true
    await console.decide({ id: row.id, approve: true })
    expect(await result).toBe(true)
  })
  it('网页新消息、重复文字的新消息和页面身份变化均阻止旧候选', async () => {
    for (const change of ['new', 'repeat', 'page', 'buyer']) {
      const { console, proposal } = setup()
      const page = {
        known: true,
        uid: 'buyer',
        page: 'page-1',
        messages: [{ from: 'buyer', content: '现在多少钱', media: [] }],
      }
      proposal.pageReview = structuredClone(page)
      proposal.getPageReview = async () => page
      const result = console.propose(proposal),
        row = console.snapshot().replies[0]
      if (change === 'page') page.page = 'page-2'
      else if (change === 'buyer') page.uid = 'other-buyer'
      else
        page.messages.push({
          from: 'buyer',
          content: change === 'repeat' ? '现在多少钱' : '新诉求',
          media: [],
        })
      await expect(console.decide({ id: row.id, approve: true })).rejects.toThrow('网页消息已变化')
      expect(await result).toBe(false)
    }
  })
  it('消息日志去重，保留模型实际上下文及返回值，不接收请求头', () => {
    const { console } = setup()
    console.sync()
    console.sync()
    expect(console.snapshot().logs.filter((l) => l.kind === '买家消息')).toHaveLength(1)
    const traceId = console.trace({
      type: 'request',
      reviewContext: { storeId: 'shop', uid: 'buyer' },
      model: 'custom',
      messages: [{ role: 'system', content: '规则和商品知识' }],
      thread: [],
      headers: { authorization: 'fixture-credential' },
    })
    console.trace({ type: 'result', traceId, reply: '测试回复' })
    expect(console.snapshot().traces[0].messages).toContain('规则和商品知识')
    expect(console.snapshot().traces[0].reply).toBe('测试回复')
    expect(JSON.stringify(console.snapshot())).not.toContain('fixture-credential')
  })
})

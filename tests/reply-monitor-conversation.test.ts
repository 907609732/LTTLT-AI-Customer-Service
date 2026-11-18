import { describe, expect, it } from 'vitest'
import { emptySnapshot } from '../src/shared/contracts/backend'
import type { Conversation } from '../src/shared/contracts/backend'
import type { ReplyReview } from '../src/shared/contracts/review'
import { selectReplyMonitor } from '../src/modules/auxiliary/reply-monitor'

function conversation(
  storeId: string,
  uid: string,
  name: string,
  messages: Conversation['messages'],
): Conversation {
  return { storeId, uid, name, status: 'pending', messages }
}
function reply(overrides: Partial<ReplyReview> = {}): ReplyReview {
  return {
    id: 'candidate',
    at: 100,
    storeId: 'shop-a',
    storeName: '甲店',
    uid: 'buyer',
    buyerName: '买家甲',
    text: '候选回复',
    traceId: '',
    status: 'pending',
    reason: '等待你确认后再发送',
    ...overrides,
  }
}
function fixture() {
  const snapshot = emptySnapshot()
  snapshot.stores = [
    {
      id: 'shop-a',
      storeName: '甲店',
      platform: 'pdd-web',
      group: '',
      aiEnabled: true,
      sendMode: 'review',
      runtime: { open: true, online: true },
    },
    {
      id: 'shop-b',
      storeName: '乙店',
      platform: 'pdd-web',
      group: '',
      aiEnabled: true,
      sendMode: 'review',
      runtime: { open: true, online: true },
    },
  ]
  return snapshot
}

describe('回复监控会话投影', () => {
  it('只按同店铺与同 UID 取会话，不把另一店铺的同 UID 消息拼进来', () => {
    const snapshot = fixture()
    snapshot.conversations = [
      conversation('shop-a', 'buyer', '甲店买家', [
        { from: 'buyer', content: '甲店问题', ts: 10, type: 'text' },
      ]),
      conversation('shop-b', 'buyer', '乙店买家', [
        { from: 'buyer', content: '乙店问题', ts: 11, type: 'text' },
        { from: 'seller', content: '乙店答复', ts: 12, type: 'text' },
      ]),
    ]
    snapshot.review.logs = [
      {
        id: 'log-b',
        at: 12,
        storeId: 'shop-b',
        storeName: '乙店',
        uid: 'buyer',
        buyerName: '乙店买家',
        kind: '买家消息',
        text: '乙店问题',
      },
    ]
    const selected = selectReplyMonitor(snapshot)
    expect(selected.store?.id).toBe('shop-b')
    expect(selected.conversation?.name).toBe('乙店买家')
    expect(selected.bubbles.map((row) => row.text)).toEqual(['乙店问题', '乙店答复'])
    expect(selected.bubbles.some((row) => row.text === '甲店问题')).toBe(false)
  })

  it('买家在左、我方在右，系统与未知来源保持独立不冒充买卖方', () => {
    const snapshot = fixture()
    snapshot.conversations = [
      conversation('shop-a', 'buyer', '买家甲', [
        { from: 'buyer', content: '还有货吗', ts: 10, type: 'text' },
        { from: 'seller', content: '有货', ts: 11, type: 'text' },
        { from: 'system', content: '订单已更新', ts: 12, type: 'text' },
        { from: 'platform', content: '平台提示', ts: 13, type: 'text' },
      ]),
    ]
    snapshot.review.replies = [reply()]
    const selected = selectReplyMonitor(snapshot)
    expect(selected.bubbles.map((row) => [row.side, row.label, row.text])).toEqual([
      ['buyer', '买家', '还有货吗'],
      ['seller', '我方', '有货'],
      ['system', '系统', '订单已更新'],
      ['system', '未识别来源', '平台提示'],
      ['candidate', '候选 · 未发送', '候选回复'],
    ])
  })

  it('未发送候选、发送中、失败和平台已发送保持不同语义，真实回显不重复', () => {
    const snapshot = fixture()
    snapshot.conversations = [
      conversation('shop-a', 'buyer', '买家甲', [
        { from: 'buyer', content: '发货吗', ts: 10, type: 'text' },
        { from: 'seller', content: '候选回复', ts: 130, type: 'text' },
      ]),
    ]
    snapshot.review.replies = [reply({ status: 'sent', at: 20 })]
    const sent = selectReplyMonitor(snapshot)
    expect(sent.bubbles.filter((row) => row.side === 'candidate')).toEqual([])
    expect(sent.bubbles.filter((row) => row.side === 'seller')).toHaveLength(1)

    snapshot.review.replies = [reply({ status: 'pending' })]
    expect(
      selectReplyMonitor(snapshot).bubbles.find((row) => row.side === 'candidate'),
    ).toMatchObject({
      side: 'candidate',
      label: '候选 · 未发送',
      status: 'pending',
    })

    snapshot.review.replies = [reply({ status: 'sending' })]
    expect(
      selectReplyMonitor(snapshot).bubbles.find((row) => row.side === 'candidate')?.label,
    ).toBe('候选 · 等待回执')

    snapshot.review.replies = [reply({ status: 'failed' })]
    const failed = selectReplyMonitor(snapshot)
    expect(failed.bubbles.find((row) => row.side === 'candidate')).toMatchObject({
      side: 'candidate',
      label: '候选 · 发送未确认',
      status: 'failed',
    })
  })

  it('旧候选按生成时间插入，最新买家消息仍在底部', () => {
    const snapshot = fixture()
    snapshot.conversations = [
      conversation('shop-a', 'buyer', '买家甲', [
        { from: 'buyer', content: '第一个问题', ts: 10, type: 'text' },
        { from: 'buyer', content: '刚发的新问题', ts: 50, type: 'text' },
      ]),
    ]
    snapshot.review.replies = [reply({ at: 20 })]
    const selected = selectReplyMonitor(snapshot)
    expect(selected.bubbles.map((row) => [row.side, row.text])).toEqual([
      ['buyer', '第一个问题'],
      ['candidate', '候选回复'],
      ['buyer', '刚发的新问题'],
    ])
    expect(selected.bubbles.at(-1)?.text).toBe('刚发的新问题')
  })

  it('商品卡优先使用候选的同店上下文，缺失时明确未识别且不跨买家复用', () => {
    const snapshot = fixture()
    snapshot.conversations = [
      conversation('shop-a', 'buyer', '买家甲', [
        { from: 'buyer', content: '这个门锁怎么样', ts: 10, type: 'text' },
      ]),
    ]
    snapshot.review.traces = [
      {
        id: 'other-trace',
        at: 20,
        storeId: 'shop-a',
        storeName: '甲店',
        uid: 'other-buyer',
        buyerName: '别的买家',
        model: 'm',
        messages: '',
        thread: '',
        reply: '',
        error: '',
        purpose: 'reply',
        product: { productId: 'other-product', title: '别的商品' },
      },
    ]
    snapshot.review.replies = [reply({ traceId: 'missing-trace' })]
    expect(selectReplyMonitor(snapshot).product).toBeUndefined()

    snapshot.review.replies = [
      reply({
        product: {
          productId: 'door-1',
          title: '静音门锁',
          imageUrl: 'https://img.example/door.jpg',
        },
      }),
    ]
    expect(selectReplyMonitor(snapshot).product).toEqual({
      productId: 'door-1',
      title: '静音门锁',
      imageUrl: 'https://img.example/door.jpg',
    })
  })

  it('没有候选时只采用同店同买家、且不早于最新买家消息的 trace 商品', () => {
    const snapshot = fixture()
    snapshot.conversations = [
      conversation('shop-a', 'buyer', '买家甲', [
        { from: 'buyer', content: '第一款还有吗', ts: 10, type: 'text' },
        { from: 'buyer', content: '那第二款呢', ts: 40, type: 'text' },
      ]),
    ]
    snapshot.review.traces = [
      {
        id: 'trace-old',
        at: 20,
        storeId: 'shop-a',
        storeName: '甲店',
        uid: 'buyer',
        buyerName: '买家甲',
        model: 'm',
        messages: '',
        thread: '',
        reply: '',
        error: '',
        purpose: 'reply',
        product: { productId: 'first', title: '第一款' },
      },
    ]
    expect(selectReplyMonitor(snapshot).product).toBeUndefined()

    snapshot.conversations[0]!.messages.pop()
    expect(selectReplyMonitor(snapshot).product).toEqual({
      productId: 'first',
      title: '第一款',
      imageUrl: '',
    })
  })
})

it('待审会话没有归档时也不显示另一位买家的实时消息', () => {
  const snapshot = fixture()
  snapshot.review.replies = [reply()]
  snapshot.review.logs = [
    {
      id: 'other-log',
      at: 101,
      storeId: 'shop-b',
      storeName: '乙店',
      uid: 'buyer',
      buyerName: '另一店买家',
      kind: '买家消息',
      text: '另一店的咨询',
    },
  ]
  const view = selectReplyMonitor(snapshot)
  expect(view.log).toBeUndefined()
  expect(view.bubbles.map((bubble) => bubble.text)).toEqual(['候选回复'])
})

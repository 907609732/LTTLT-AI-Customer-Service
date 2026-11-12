import { describe, expect, it } from 'vitest'
import {
  MessageDiagnostics,
  aiState,
  type WorkerObservation,
} from '../electron/message-diagnostics'
import { emptySnapshot } from '../src/shared/contracts/backend'
import type { LogEntry } from '../src/shared/contracts/review'

function setup() {
  const snap = emptySnapshot()
  snap.config.reply.enabled = true
  snap.stores.push({
    id: 'shop',
    storeName: '测试店',
    platform: 'pdd-web',
    group: '',
    aiEnabled: true,
    runtime: { open: true, online: true },
  })
  const worker: WorkerObservation = {
    running: true,
    paused: false,
    degraded: false,
    inflight: 0,
    manualSuppressed: new Set(),
    suppressionSources: new Map(),
    processing: new Set(),
    lastSentAt: new Map(),
    lastMerchantAt: new Map(),
    sendWindow: [],
    cfg: { perUidMinIntervalMs: 60000, perStorePerMinuteMax: 20, maxInflight: 6 },
  }
  const tracker = new MessageDiagnostics(
    () => snap,
    () => worker,
  )
  const log = (id: string): LogEntry => ({
    id,
    at: Date.now(),
    storeId: 'shop',
    storeName: '测试店',
    uid: 'buyer',
    buyerName: '合成买家',
    kind: '买家消息',
    text: '重复问题',
  })
  const ref = { msgId: 'message-1', ts: Date.now(), content: '重复问题' }
  return { snap, worker, tracker, log, ref }
}
describe('每条买家消息的 AI 处理证据', () => {
  it('AI 未开时显示设置原因，不伪造模型调用', () => {
    const { snap, tracker, log, ref } = setup()
    snap.stores[0].aiEnabled = false
    const row = log('1')
    tracker.register(row, ref, false)
    expect(row.ai).toMatchObject({ submitted: false, code: 'store_ai_off' })
  })
  it('解释60秒回复间隔，改成0后等待原因随当前配置更新', () => {
    const { worker, tracker, log, ref } = setup()
    worker.lastSentAt.set('buyer', Date.now())
    const row = log('1')
    tracker.register(row, ref, false)
    expect(row.ai?.code).toBe('uid_interval')
    expect(row.ai?.reason).toContain('60 秒')
    worker.cfg.perUidMinIntervalMs = 0
    tracker.refresh([row])
    expect(row.ai?.code).toBe('collected')
  })
  it('明确标出会话暂停来源，历史记录不倒推当时设置', () => {
    const { worker, tracker, log, ref } = setup()
    worker.manualSuppressed.add('buyer')
    worker.suppressionSources.set('buyer', 'review')
    const fresh = log('1')
    tracker.register(fresh, ref, false)
    expect(fresh.ai?.code).toBe('suppressed_review')
    const old = log('2')
    tracker.register(old, { ...ref, msgId: 'older' }, true)
    expect(old.ai).toMatchObject({ submitted: null, code: 'historical_unknown' })
  })
  it('真实请求先于采集日志时仍能关联，不把相同文字的另一条消息算成已提交', () => {
    const { tracker, log, ref } = setup()
    tracker.record(
      'shop',
      'buyer',
      [ref],
      aiState('preparing', 'model_prepared', '准备', false, 'trace'),
    )
    tracker.byTrace('trace', aiState('requesting', 'model_submitted', '请求已发起', true, 'trace'))
    const first = log('1'),
      second = log('2')
    tracker.register(first, ref, false)
    tracker.register(second, { ...ref, msgId: 'message-2', ts: ref.ts + 1000 }, false)
    expect(first.ai?.submitted).toBe(true)
    expect(second.ai?.submitted).toBe(false)
  })
  it('100次轮询更新同一消息状态，不追加日志或抹掉已经发起请求的事实', () => {
    const { tracker, log, ref } = setup()
    const row = log('1')
    tracker.register(row, ref, false)
    for (let i = 0; i < 100; i++)
      tracker.record('shop', 'buyer', [ref], aiState('waiting', 'uid_interval', '等待间隔'))
    tracker.record(
      'shop',
      'buyer',
      [ref],
      aiState('requesting', 'model_submitted', '请求已发起', true, 'trace'),
    )
    tracker.record('shop', 'buyer', [ref], aiState('waiting', 'uid_interval', '等待间隔'))
    expect(row.ai).toMatchObject({ submitted: true, stage: 'requesting' })
  })
})

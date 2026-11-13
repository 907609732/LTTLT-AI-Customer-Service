import type { SimHub } from './sim-hub'
import { SIM_PLATFORM_ID, type SimMessage } from '../src/shared/contracts/simulation'

/**
 * 本机模拟店铺的适配器实现（契约 v2）。
 *
 * 真实适配器把调用转给平台页面 hook，这里把同一组合约方法转给主进程内的 SimHub：
 * 采集监控器拿 drainEvents 增量收消息，回复引擎拿 popPending 认领待回复会话，
 * 确认后的人工发送经 sendText 写回本机线程。
 *
 * 明确不做的事：
 * - 没有平台页面，所以 reviewHistory 明确返回“未知”，不伪造网页复核结论；
 * - 图片/视频消息如实报不支持，不用文字假装替代；
 * - 所有结果都遵循上游契约的失败枚举，避免上游把异常当成“已发送”。
 */

/** 与上游 adapter-contract 的 FAILURE_REASONS 对齐；这里只返回这些值。 */
export type SimFailReason = 'hook_not_ready' | 'input_not_found' | 'input_busy' | 'send_unconfirmed'

export type SimResult = { ok: true } & Record<string, unknown>
export type SimFailure = { ok: false; reason: SimFailReason; detail: string }

const ok = (extra: Record<string, unknown> = {}): SimResult => ({ ok: true, ...extra })
const fail = (reason: SimFailReason, detail: string): SimFailure => ({
  ok: false,
  reason,
  detail: detail.slice(0, 300),
})

/** 适配器工厂拿到的最小店铺信息；只用到 id 与店名。 */
export interface SimAdapterStore {
  id: string
  storeName?: string
  platform?: string
}

export class SimLocalAdapter {
  readonly id = SIM_PLATFORM_ID
  readonly accessMode = 'client-inject'
  readonly platform = SIM_PLATFORM_ID
  readonly platformName = '本机模拟店铺'
  readonly storeId: string
  readonly storeName: string
  readonly #hub: SimHub

  constructor(store: SimAdapterStore, hub: SimHub) {
    this.storeId = String(store.id)
    this.storeName = String(store.storeName || store.id)
    this.#hub = hub
  }

  supports(): SimResult {
    return ok()
  }

  /** 无页面可注，认领前也不需要刷新视图；保持 ok 让引擎按正常链路推进。 */
  async ensure(): Promise<SimResult> {
    this.#hub.attach(this.storeId, this.storeName)
    return ok()
  }

  async preparePending(): Promise<SimResult> {
    return ok()
  }

  async pendingSnapshot(): Promise<SimResult> {
    const snapshot = this.#hub.pendingSnapshot(this.storeId)
    return ok({ count: snapshot.count, uids: snapshot.uids })
  }

  async popPending(): Promise<{
    uid: string
    messages: SimMessage[]
    username: string
    claimedAt: number
  } | null> {
    this.#hub.attach(this.storeId, this.storeName)
    return this.#hub.claim(this.storeId)
  }

  async conversationHistory(
    uid: string,
    options: { limit?: number } = {},
  ): Promise<SimResult | SimFailure> {
    if (!uid) return fail('input_not_found', '缺少模拟顾客身份')
    const limit = Number(options.limit) > 0 ? Math.min(Number(options.limit), 100) : 20
    return ok({ messages: this.#hub.thread(this.storeId, String(uid), limit) })
  }

  async release(uid: string): Promise<SimResult | SimFailure> {
    if (!uid) return fail('input_not_found', '缺少模拟顾客身份')
    this.#hub.release(this.storeId, String(uid))
    return ok({ released: true })
  }

  async discard(uid: string): Promise<SimResult | SimFailure> {
    if (!uid) return fail('input_not_found', '缺少模拟顾客身份')
    this.#hub.discard(this.storeId, String(uid))
    return ok({ discarded: true })
  }

  /** 模拟店铺的人工回复也经统一发送入口写线程，没有额外的“平台侧已发”台账。 */
  async popMerchantSent(): Promise<{ uid: string; message: SimMessage }[]> {
    return this.#hub.popMerchantSent()
  }

  async syncAiEnabled(): Promise<SimResult> {
    return ok()
  }

  async focusConversation(uid: string): Promise<SimResult | SimFailure> {
    if (!uid) return fail('input_not_found', '缺少模拟顾客身份')
    if (!this.#hub.personas(this.storeId).some((persona) => persona.uid === String(uid)))
      return fail('input_not_found', '该模拟顾客不存在')
    return ok()
  }

  /** 人工确认后才会走到这里；写入本机线程即代表“模拟页收到”，不代表真实平台送达。 */
  async sendText(uid: string, text: string): Promise<SimResult | SimFailure> {
    if (!uid) return fail('input_not_found', '缺少模拟顾客身份')
    const content = String(text ?? '').trim()
    if (!content) return fail('input_not_found', '回复内容不能为空')
    try {
      const message = this.#hub.sellerMessage(this.storeId, String(uid), content)
      return ok({ msgId: message.msgId, delivered: '本机模拟页' })
    } catch (error) {
      return fail('input_not_found', error instanceof Error ? error.message : '模拟会话不可用')
    }
  }

  async sendImage(uid: string): Promise<SimFailure> {
    if (!uid) return fail('input_not_found', '缺少模拟顾客身份')
    return fail('input_not_found', '模拟店铺暂不支持图片消息，请改用文字')
  }

  async sendVideo(uid: string): Promise<SimFailure> {
    if (!uid) return fail('input_not_found', '缺少模拟顾客身份')
    return fail('input_not_found', '模拟店铺暂不支持视频消息，请改用文字')
  }

  async drainEvents(sinceSeq = 0): Promise<SimResult> {
    const result = this.#hub.drainEvents(this.storeId, Number(sinceSeq))
    return ok({ seq: result.seq, events: result.events })
  }

  /** 没有平台网页可复核：如实返回“未知”，供后续复核流程显示原因而不是假通过。 */
  async reviewHistory(uid: string): Promise<Record<string, unknown>> {
    return {
      known: false,
      uid: String(uid || ''),
      page: '',
      messages: [],
      reason: '模拟店铺没有平台网页，无法做网页复核',
    }
  }

  async probe(): Promise<SimResult> {
    return ok({ platform: SIM_PLATFORM_ID, accessMode: this.accessMode })
  }
}

export function createSimAdapter(store: SimAdapterStore, hub: SimHub): SimLocalAdapter {
  if (store.platform !== SIM_PLATFORM_ID) throw new Error('该店铺不是本机模拟店铺')
  return new SimLocalAdapter(store, hub)
}

import type { SendProposal } from './review-console'
import { pageReviewFingerprint, pageReviewSchema } from './conversation-review'
import {
  welcomeDelaySchema,
  type WelcomeDelay,
  type WelcomeSetting,
} from '../src/shared/contracts/welcome'

/** 欢迎延迟属于本工程 TypeScript 业务规则；厂商只保存并声明文字、开关、版本和范围。 */
export function parseWelcomeDelay(value: {
  delayMinSeconds?: unknown
  delayMaxSeconds?: unknown
}): WelcomeDelay {
  const parsed = welcomeDelaySchema.safeParse({
    delayMinSeconds: value.delayMinSeconds,
    delayMaxSeconds: value.delayMaxSeconds,
  })
  if (!parsed.success) throw new Error('欢迎延迟范围无效：应为 1～3600 的整数秒，且下限不大于上限')
  return parsed.data
}

/** 每次候选只抽样一次；等于上下限表示固定值，随机值异常时夹取到范围内。 */
export function sampleWelcomeDelayMs(
  delay: WelcomeDelay,
  random: () => number = Math.random,
): number {
  const min = delay.delayMinSeconds * 1000
  const max = delay.delayMaxSeconds * 1000
  if (!Number.isInteger(min) || !Number.isInteger(max) || min < 1000 || max > 3_600_000)
    throw new Error('欢迎延迟范围无效')
  if (max <= min) return min
  const value = Number(random())
  const ratio = Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0
  return Math.min(max, Math.max(min, Math.round(min + ratio * (max - min))))
}

export type WelcomeDelayWaitResult = { ok: true } | { ok: false; reason: string }

/**
 * 使用既有 Node 定时器分块等待；每档最多 100ms 复核当前性，取消后不再等待剩余时间。
 * 随机截止时间在进入等待前确定，这里绝不重新抽样，也不会为普通 AI 回复引入暂停。
 */
export async function waitWelcomeDelay(input: {
  durationMs: number
  checkCurrent: () => string
  verifyFresh?: () => Promise<string>
  signal?: AbortSignal
  tickMs?: number
  freshCheckEveryMs?: number
  now?: () => number
  sleep?: (milliseconds: number) => Promise<void>
}): Promise<WelcomeDelayWaitResult> {
  const now = input.now ?? (() => performance.now())
  const sleep =
    input.sleep ??
    ((milliseconds: number) =>
      new Promise<void>((resolve) => {
        setTimeout(resolve, milliseconds)
      }))
  const tickMs = Math.max(1, Math.min(100, input.tickMs ?? 100))
  const freshEveryMs = Math.max(tickMs, input.freshCheckEveryMs ?? 500)
  const durationMs = Number.isFinite(input.durationMs) ? Math.max(0, input.durationMs) : 0
  const deadline = now() + durationMs
  let nextFreshAt = now() + freshEveryMs
  const current = (): WelcomeDelayWaitResult | null => {
    if (input.signal?.aborted)
      return { ok: false, reason: '本地服务已关闭，欢迎延迟已取消，未发送。' }
    const reason = input.checkCurrent()
    return reason ? { ok: false, reason } : null
  }
  for (;;) {
    const cancelled = current()
    if (cancelled) return cancelled
    if (input.verifyFresh && now() >= nextFreshAt) {
      const reason = await input.verifyFresh()
      if (reason) return { ok: false, reason }
      nextFreshAt = now() + freshEveryMs
      continue
    }
    const remaining = deadline - now()
    if (remaining <= 0) break
    await sleep(Math.min(tickMs, Math.max(1, remaining)))
  }
  const cancelled = current()
  if (cancelled) return cancelled
  if (input.verifyFresh) {
    const reason = await input.verifyFresh()
    if (reason) return { ok: false, reason }
  }
  // A configuration change or shutdown may have happened while the final page read awaited.
  const invalidatedAfterRead = current()
  if (invalidatedAfterRead) return invalidatedAfterRead
  return { ok: true }
}

export interface WelcomeDelayGateOptions {
  /** Begin one synchronous state check; adapters may share one snapshot across the three readers. */
  beginRead?(): void
  readWelcome(storeId: string): WelcomeSetting | undefined
  readStore(storeId: string): { online: boolean; aiEnabled: boolean } | undefined
  conversation(storeId: string, uid: string): { fingerprint: string; lastFrom: string }
  /** 让复核窗口把已批准的候选标为未发送，避免界面一直停在“正在发送”。 */
  cancel(proposal: SendProposal, reason: string): void
  /** PDD 一次性发送租约不能留在延迟取消之后。 */
  releaseSendAuthorization?(storeId: string, uid: string): void
  signal?: AbortSignal
  random?: () => number
  now?: () => number
  sleep?: (milliseconds: number) => Promise<void>
  tickMs?: number
  freshCheckEveryMs?: number
  log?(reason: string): void
}

const attachmentIssue = (setting: WelcomeSetting | undefined, version: number): string => {
  if (!setting?.enabled) return '欢迎已停用，欢迎延迟已取消，未发送。'
  if (setting.version !== version) return '欢迎配置已更新，欢迎延迟已取消，未发送。'
  return ''
}

/**
 * 统一发送门之后的欢迎延迟：只有候选确实附加了欢迎文字（厂商 claim/decorate 元数据）
 * 才进入等待；普通 AI 回复直接放行。停止、接管、新消息、欢迎停用/改版或关闭服务都取消。
 */
export function createWelcomeDelayGate(
  options: WelcomeDelayGateOptions,
): (proposal: SendProposal, approved: boolean) => Promise<boolean> {
  return async (proposal, approved) => {
    if (!approved) return false
    const attached = proposal.welcome
    // 绝不按正文前缀猜测欢迎语：只有厂商明确标记实际附加了欢迎才延迟。
    if (!attached) return true
    const reject = (reason: string) => {
      options.cancel(proposal, reason)
      options.releaseSendAuthorization?.(proposal.storeId, proposal.uid)
      options.log?.(reason)
      return false
    }
    options.beginRead?.()
    const setting = options.readWelcome(proposal.storeId)
    const issue = attachmentIssue(setting, attached.version)
    if (issue || !setting) return reject(issue || '欢迎配置缺失，欢迎延迟已取消，未发送。')
    let durationMs: number
    try {
      durationMs = sampleWelcomeDelayMs(parseWelcomeDelay(setting), options.random)
    } catch {
      return reject('欢迎延迟配置无效，欢迎延迟已取消，未发送。')
    }
    const baseline = options.conversation(proposal.storeId, proposal.uid)
    const pageBaseline = pageReviewFingerprint(proposal.pageReview)
    const verifyFresh =
      proposal.getPageReview && pageBaseline
        ? async () => {
            let latest: unknown
            try {
              latest = await proposal.getPageReview?.(false)
            } catch {
              return '暂时无法核对这位买家的网页消息，欢迎延迟已取消，未发送。'
            }
            const current = pageReviewFingerprint(latest)
            if (!current) return '暂时无法核对这位买家的网页消息，欢迎延迟已取消，未发送。'
            if (current === pageBaseline) return ''
            const parsed = pageReviewSchema.safeParse(latest)
            if (parsed.success && parsed.data.messages.at(-1)?.from === 'buyer')
              proposal.retryNewMessage = true
            return '检测到该买家网页消息已变化，欢迎延迟已取消，未发送。'
          }
        : undefined
    const originalCurrent = proposal.isCurrent.bind(proposal)
    const checkCurrent = () => {
      if (!originalCurrent()) return '会话或店铺状态已变化，欢迎延迟已取消，未发送。'
      options.beginRead?.()
      const store = options.readStore(proposal.storeId)
      if (!store?.online || !store.aiEnabled)
        return '店铺已停止或 AI 已关闭，欢迎延迟已取消，未发送。'
      const currentSetting = options.readWelcome(proposal.storeId)
      if (!currentSetting?.enabled) return '欢迎已停用，欢迎延迟已取消，未发送。'
      if (currentSetting.version !== attached.version)
        return '欢迎配置已更新，欢迎延迟已取消，未发送。'
      const latest = options.conversation(proposal.storeId, proposal.uid)
      if (latest.fingerprint !== baseline.fingerprint) {
        if (latest.lastFrom === 'buyer') proposal.retryNewMessage = true
        return '检测到该买家会话已有新消息，欢迎延迟已取消，未发送。'
      }
      return ''
    }
    // Keep these checks attached through the worker's focus/read and adapter's input/click phases.
    // Capture the original predicate above so the wrapper never recursively calls itself.
    proposal.isCurrent = () => {
      try {
        return !options.signal?.aborted && !checkCurrent()
      } catch {
        return false
      }
    }
    const result = await waitWelcomeDelay({
      durationMs,
      signal: options.signal,
      now: options.now,
      sleep: options.sleep,
      tickMs: options.tickMs,
      freshCheckEveryMs: options.freshCheckEveryMs,
      verifyFresh,
      checkCurrent,
    })
    if (!result.ok) return reject(result.reason)
    return true
  }
}

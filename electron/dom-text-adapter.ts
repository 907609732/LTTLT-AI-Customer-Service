import { z } from 'zod'
import { randomUUID } from 'node:crypto'
import { pageReviewFingerprint, pageReviewSchema } from './conversation-review'

const resultSchema = z.object({
  ok: z.boolean(),
  reason: z.string().optional(),
  detail: z.string().optional(),
  msgId: z.union([z.string(), z.number()]).optional(),
})
interface HookAdapter {
  focusConversation(uid: string): Promise<{ ok: boolean }>
  reviewHistory?: (uid: string, focus?: boolean) => Promise<unknown>
  _wc(): {
    focus(): void
    sendInputEvent(input: {
      type: 'mouseDown' | 'mouseUp'
      x: number
      y: number
      button: 'left'
      clickCount: number
    }): void
  }
  sendText(
    uid: string,
    text: string,
    options?: { timeoutMs?: number; isCurrent?: () => boolean },
  ): Promise<unknown>
  _callHook(
    method: string,
    args: unknown[],
    options: { timeoutMs: number; label: string },
  ): Promise<unknown>
  _sendFailOrThrow(method: string, error: unknown): unknown
}

/** 网页定位 + 浏览器内部按钮事件，不调用系统鼠标，也不降级为回车。 */
export const TYPING_INTERVAL_MS = 0
export function configureDomTextAdapter(
  platform: string,
  value: unknown,
  typingIntervalMs = TYPING_INTERVAL_MS,
  sendAuthorization?: (uid: string, text: string) => (() => boolean) | undefined,
): unknown {
  if (platform !== 'pdd-web') return value
  if (
    !value ||
    typeof value !== 'object' ||
    !['sendText', 'focusConversation', '_callHook', '_sendFailOrThrow', '_wc'].every(
      (key) => typeof Reflect.get(value, key) === 'function',
    )
  )
    throw new Error('拼多多页面操控接口不完整')
  const adapter = value as HookAdapter
  // Keep the internal focus primitive; the public method is coordinated with media operations.
  const focusConversation = adapter.focusConversation.bind(adapter)
  let reviewQueue: Promise<unknown> = Promise.resolve()
  adapter.reviewHistory = (uid, focus = false) => {
    // 多个候选共用同一店铺页面：定位与取快照串行执行，后台检查不抢切买家。
    const result = reviewQueue.then(async () => {
      if (focus && !(await focusConversation(uid)).ok)
        throw new Error('无法定位这位买家，未取得生成前网页消息基线，请打开会话后重试。')
      const deadline = Date.now() + 5000
      let page: string | undefined
      for (;;) {
        const snapshot = await adapter._callHook('reviewHistory', [String(uid)], {
          label: '网页会话复核',
          timeoutMs: Math.max(1, deadline - Date.now()),
        })
        if (!focus) return snapshot
        const parsed = pageReviewSchema.safeParse(snapshot)
        if (parsed.success) {
          if (page && parsed.data.page && parsed.data.page !== page)
            throw new Error('等待网页消息时页面已经切换，请重新打开买家会话后重试。')
          if (parsed.data.page) page = parsed.data.page
          if (parsed.data.uid !== String(uid))
            throw new Error('网页消息属于其他买家，未取得目标买家的生成前基线。')
          if (pageReviewFingerprint(parsed.data)) return parsed.data
        }
        // 定位只代表切换动作已发起；必须等真实消息加载后再允许上游开始生成。
        // 不能在确认阶段补采基线，否则生成期间的新消息会被误当成原始上下文。
        const remaining = deadline - Date.now()
        if (remaining <= 0)
          throw new Error('这位买家的网页消息尚未加载，未开始生成，请等待会话加载后重试。')
        await new Promise<void>((resolve) => setTimeout(resolve, Math.min(250, remaining)))
      }
    })
    reviewQueue = result.catch(() => undefined)
    return result
  }
  let sending = false
  adapter.sendText = async (uid, input, options = {}) => {
    const content = String(input ?? '').trim()
    if (!uid || !content || content.length > 2000)
      throw new Error('网页回复需要有效买家和 1–2000 字正文')
    if (sending) return { ok: false, reason: 'input_busy', detail: 'send_in_progress' }
    const authorization = sendAuthorization?.(String(uid), content)
    const current = options.isCurrent
    // AI 候选的单次授权在入口消费；停止 AI 或切换发送模式后，已开始的填写也必须停止。
    // 显式人工发送没有候选授权，仍按原有会话及网页 guard 校验。
    if (authorization)
      options = { ...options, isCurrent: () => (!current || current()) && authorization() }
    sending = true
    const operationId = randomUUID()
    const interval = Math.max(0, Math.min(150, typingIntervalMs))
    let cancelRequested = false
    const cancellation = options.isCurrent
      ? setInterval(() => {
          if (!cancelRequested && !options.isCurrent?.()) {
            cancelRequested = true
            void adapter
              ._callHook('cancelNativeTextSend', [String(uid), operationId], {
                label: '停止填写回复',
                timeoutMs: 5000,
              })
              .catch(() => {})
          }
        }, 100)
      : undefined
    try {
      if (options.isCurrent && !options.isCurrent()) return { ok: false, reason: 'cancelled' }
      // 引擎的定位与发送是两次独立排队；进入本次店铺写锁后另一位买家可能已切到前台。
      // 因此必须在同一锁内用捕获的原始定位先回到本次 uid，再读取基线/填写/点击。
      const focused = await focusConversation(String(uid))
      if (!focused?.ok)
        return { ok: false, reason: 'conversation_not_found', detail: 'focus_failed' }
      if (options.isCurrent && !options.isCurrent()) return { ok: false, reason: 'cancelled' }
      // 复用页面已有的一次性 setEditor 分支；整段填写前后仍核对消息，不能因提速放过新消息。
      let baseline: string | undefined
      if (interval === 0) {
        const before = await adapter._callHook('reviewHistory', [String(uid)], {
          label: '填写前网页消息核对',
          timeoutMs: 5000,
        })
        const parsed = pageReviewSchema.safeParse(before)
        baseline = pageReviewFingerprint(before)
        if (!baseline || !parsed.success || parsed.data.uid !== String(uid))
          return { ok: false, reason: 'hook_not_ready', detail: 'page_review_unavailable' }
        if (options.isCurrent && !options.isCurrent()) return { ok: false, reason: 'cancelled' }
      }
      const prepared = await adapter._callHook(
        'prepareNativeTextSend',
        [String(uid), content, operationId, { mode: 'button', typeDelayMs: interval }],
        {
          label: 'DOM 点击发送',
          timeoutMs: (options.timeoutMs || 25000) + Array.from(content).length * interval,
        },
      )
      const ready = z
        .object({
          ok: z.literal(true),
          token: z.string(),
          point: z.object({ x: z.number().int().nonnegative(), y: z.number().int().nonnegative() }),
        })
        .safeParse(prepared)
      let raw: unknown = prepared
      if (
        !ready.success &&
        prepared &&
        typeof prepared === 'object' &&
        Reflect.get(prepared, 'ok') === true
      ) {
        return { ok: false, reason: 'send_unconfirmed', detail: 'invalid_button_preparation' }
      }
      if (ready.success) {
        if (interval === 0) {
          const after = await adapter._callHook('reviewHistory', [String(uid)], {
            label: '填写后网页消息核对',
            timeoutMs: 5000,
          })
          if (pageReviewFingerprint(after) !== baseline)
            return {
              ok: false,
              reason: 'conversation_not_found',
              detail: 'conversation_changed_while_filling',
            }
        }
        if (cancelRequested || (options.isCurrent && !options.isCurrent()))
          return { ok: false, reason: 'cancelled' }
        const wc = adapter._wc()
        wc.focus()
        // 坐标来自当前网页按钮，仅进入该 WebContents，不移动桌面指针。
        wc.sendInputEvent({ type: 'mouseDown', ...ready.data.point, button: 'left', clickCount: 1 })
        wc.sendInputEvent({ type: 'mouseUp', ...ready.data.point, button: 'left', clickCount: 1 })
        raw = await adapter._callHook('confirmNativeTextSend', [String(uid), ready.data.token], {
          label: '按钮发送回显确认',
          timeoutMs: options.timeoutMs || 25000,
        })
      }
      const parsed = resultSchema.safeParse(raw)
      // 页面动作发起后，畸形结果也视作不确定，不能再次尝试发送。
      if (!parsed.success)
        return { ok: false, reason: 'send_unconfirmed', detail: 'invalid_dom_result' }
      const result = parsed.data
      if (result.ok)
        return {
          ok: true,
          ...(result.msgId ? { msgId: String(result.msgId) } : {}),
          method: 'dom-click',
        }
      const reason = [
        'input_not_found',
        'input_busy',
        'hook_not_ready',
        'send_unconfirmed',
      ].includes(result.reason || '')
        ? result.reason
        : 'input_not_found'
      return {
        ok: false,
        reason,
        detail: result.detail || result.reason || 'dom_send_failed',
        method: 'dom-click',
      }
    } catch (error) {
      return adapter._sendFailOrThrow('sendText', error)
    } finally {
      clearInterval(cancellation)
      try {
        await adapter._callHook('cancelNativeTextSend', [String(uid), operationId], {
          label: '清理按钮发送状态',
          timeoutMs: 5000,
        })
      } catch {
        /* 超时不能触发重发；页面 guard 也会自行过期。 */
      }
      sending = false
    }
  }
  return adapter
}

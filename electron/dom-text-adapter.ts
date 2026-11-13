import { z } from 'zod'
import { randomUUID } from 'node:crypto'

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
export const TYPING_INTERVAL_MS = 50
export function configureDomTextAdapter(
  platform: string,
  value: unknown,
  typingIntervalMs = TYPING_INTERVAL_MS,
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
  let reviewQueue: Promise<unknown> = Promise.resolve()
  adapter.reviewHistory = (uid, focus = false) => {
    // 多个候选共用同一店铺页面：定位与取快照串行执行，后台检查不抢切买家。
    const result = reviewQueue.then(async () => {
      if (focus && !(await adapter.focusConversation(uid)).ok)
        return { known: false, uid, page: '', messages: [], reason: 'focus_failed' }
      return adapter._callHook('reviewHistory', [String(uid)], {
        label: '网页会话复核',
        timeoutMs: 5000,
      })
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
    sending = true
    const operationId = randomUUID()
    const interval = Math.max(1, Math.min(150, typingIntervalMs))
    let cancelRequested = false
    const cancellation = options.isCurrent
      ? setInterval(() => {
          if (!cancelRequested && !options.isCurrent?.()) {
            cancelRequested = true
            void adapter
              ._callHook('cancelNativeTextSend', [String(uid), operationId], {
                label: '停止逐字输入',
                timeoutMs: 5000,
              })
              .catch(() => {})
          }
        }, 100)
      : undefined
    try {
      if (options.isCurrent && !options.isCurrent()) return { ok: false, reason: 'cancelled' }
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

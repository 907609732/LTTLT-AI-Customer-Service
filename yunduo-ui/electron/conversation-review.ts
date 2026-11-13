import { z } from 'zod'

export const pageReviewSchema = z.object({
  known: z.boolean(),
  uid: z.string(),
  page: z.string(),
  reason: z.string().optional(),
  messages: z.array(
    z.object({
      from: z.enum(['buyer', 'seller']),
      content: z.string(),
      media: z.array(z.string()).default([]),
    }),
  ),
})
/** 网页重绘、补全消息 ID 和秒/毫秒差异不代表新消息；这里只比较当前会话的有序正文与媒体。 */
export function pageReviewFingerprint(input: unknown): string | undefined {
  const parsed = pageReviewSchema.safeParse(input)
  if (
    !parsed.success ||
    !parsed.data.known ||
    !parsed.data.uid ||
    !parsed.data.page ||
    !parsed.data.messages.length
  )
    return
  const value = parsed.data
  return JSON.stringify({
    uid: value.uid,
    page: value.page,
    messages: value.messages.map((m) => ({
      ...m,
      content: m.content.replace(/\r\n?/g, '\n').normalize('NFC'),
    })),
  })
}

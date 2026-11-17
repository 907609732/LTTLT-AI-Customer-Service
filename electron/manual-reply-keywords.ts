/** 客服接管关键词：全局保存，卖家侧消息命中后由既有 reply-engine 取消该会话 AI。 */
export const MANUAL_REPLY_KEYWORDS_SCREEN = 'MANUAL_REPLY_KEYWORDS'
export const MANUAL_REPLY_KEYWORD_MAX_LENGTH = 30
export const MANUAL_REPLY_KEYWORD_MAX_COUNT = 100

/**
 * 主进程保存边界：逐行 trim、丢弃空行、按首次出现去重。
 * 每个词 1–30 个字符、最多 100 个；非法输入整体拒绝，不写入部分结果。
 */
export function normalizeManualReplyKeywords(input: unknown): string[] {
  if (!Array.isArray(input)) throw new Error('客服接管关键词格式无效')
  const keywords: string[] = []
  for (const value of input) {
    if (typeof value !== 'string') throw new Error('客服接管关键词必须为文本')
    const word = value.trim()
    if (!word) continue
    if (word.length > MANUAL_REPLY_KEYWORD_MAX_LENGTH)
      throw new Error(`客服接管关键词每个最多 ${MANUAL_REPLY_KEYWORD_MAX_LENGTH} 个字符`)
    if (!keywords.includes(word)) keywords.push(word)
  }
  if (keywords.length > MANUAL_REPLY_KEYWORD_MAX_COUNT)
    throw new Error(`客服接管关键词最多 ${MANUAL_REPLY_KEYWORD_MAX_COUNT} 个`)
  return keywords
}

'use strict';
/**
 * D-04 自发送台账：发送时记录 (uid, msgId, 归一文本, 发送时刻)。
 * 有 msgId 的入站卖家消息走精确匹配；无 msgId 才走 8 秒文本兜底。
 * 台账只用于回环识别，不能拿来做业务去重（参考实现的三套文本去重不在此复用）。
 */
const DEFAULT_TEXT_TTL_MS = 8000;
const DEFAULT_RETENTION_MS = 10 * 60 * 1000;

function normalizeText(value) {
  return String(value == null ? '' : value)
    .replace(/[\u200b-\u200d\ufeff]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

class SelfSendLedger {
  constructor({ textTtlMs = DEFAULT_TEXT_TTL_MS, retentionMs = DEFAULT_RETENTION_MS, now = Date.now } = {}) {
    this.textTtlMs = Math.max(0, Number(textTtlMs) || 0);
    this.retentionMs = Math.max(0, Number(retentionMs) || 0);
    this.now = typeof now === 'function' ? now : Date.now;
    this.entries = [];
  }

  record({ uid, msgId, text, at } = {}) {
    if (!uid) return null;
    const when = Number(at) || this.now();
    const entry = {
      uid: String(uid),
      msgId: msgId === undefined || msgId === null || msgId === '' ? null : String(msgId),
      text: normalizeText(text),
      at: when,
    };
    this.entries.push(entry);
    this.#prune(when);
    return entry;
  }

  /**
   * @param {{uid:string,msgId?:string,text?:string,ts?:number}} incoming
   * @param {number} [at] 判定时刻（默认 this.now）
   */
  isSelfSent(incoming = {}, at = this.now()) {
    const uid = String(incoming.uid || '');
    if (!uid) return false;
    const now = Number(at) || this.now();
    this.#prune(now);
    const rawMsgId = incoming.msgId;
    const rawHasMsgId = rawMsgId !== undefined && rawMsgId !== null && rawMsgId !== '';
    // 契约允许适配器用 `ts:<ts>` 兜底 msgId；这等价于「平台没给 msgId」，应走文本兜底
    const syntheticMsgId = rawHasMsgId && /^ts:\d+$/.test(String(rawMsgId));
    const hasMsgId = rawHasMsgId && !syntheticMsgId;
    const incomingMsgId = hasMsgId ? String(incoming.msgId) : null;
    const incomingText = normalizeText(incoming.text);
    const messageAt = Number(incoming.ts) || now;

    for (let i = this.entries.length - 1; i >= 0; i -= 1) {
      const entry = this.entries[i];
      if (entry.uid !== uid) continue;
      if (hasMsgId) {
        // 有 msgId 时只认精确匹配，避免同文不同消息被误判
        if (entry.msgId && entry.msgId === incomingMsgId) return true;
        continue;
      }
      if (!entry.text || entry.text !== incomingText) continue;
      if (Math.abs(messageAt - entry.at) <= this.textTtlMs) return true;
    }
    return false;
  }

  size() {
    return this.entries.length;
  }

  clear() {
    this.entries = [];
  }

  #prune(now) {
    if (!this.retentionMs) {
      this.entries = [];
      return;
    }
    const cutoff = now - this.retentionMs;
    let drop = 0;
    while (drop < this.entries.length && this.entries[drop].at < cutoff) drop += 1;
    if (drop) this.entries.splice(0, drop);
  }
}

module.exports = {
  SelfSendLedger,
  normalizeText,
  DEFAULT_TEXT_TTL_MS,
  DEFAULT_RETENTION_MS,
};

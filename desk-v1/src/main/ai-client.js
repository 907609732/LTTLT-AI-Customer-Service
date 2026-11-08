'use strict';
/**
 * AI 回复客户端：OpenAI 兼容 /chat/completions，强制 JSON 输出协议。
 * 作为可注入依赖使用：测试传入同形状的假客户端即可，不联网。
 * 端点与密钥均来自用户配置/本机 secrets，代码内不写死任何服务端地址。
 */
const { getSecret } = require('./secrets');

const ALLOWED_ACTIONS = new Set([
  'agreeModifyAddress',
  'agreeOrderRemarks',
  'appealCashBack',
  'favoriteConversation',
  'sendCouponByName',
]);

const OUTPUT_PROTOCOL = `只输出一个 JSON 对象，不要 markdown 代码块，不要解释：
{"reply":"给买家的中文回复","images":[],"videos":[],"cardActions":[],"couponName":"","handoff":false}
字段说明：
- reply: 必填字符串，口语化，不超过 80 字。
- images / videos: 可选 URL 数组，最多 1 个；不确定留空。
- cardActions: 可选，取值只能是 ${[...ALLOWED_ACTIONS].join(' / ')}；不确定留空。
- couponName: 可选，必须与店铺券名完全一致；不确定留空。
- handoff: true 表示需要人工接手（投诉、纠纷、赔付争议）。`;

function safeUrl(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol === 'https:') return url.toString();
  const local = ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(url.hostname);
  if (url.protocol === 'http:' && local) return url.toString();
  return null;
}

function extractJson(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1].trim() : raw;
  try {
    return JSON.parse(body);
  } catch {
    /* 继续尝试截取首个完整对象 */
  }
  const start = body.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < body.length; i += 1) {
    const ch = body[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        try {
          return JSON.parse(body.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

/** 清洗模型输出为受控结构；越界字段一律丢弃。 */
function normalizeReply(parsed, { maxChars = 200 } = {}) {
  const out = { reply: '', images: [], videos: [], cardActions: [], couponName: '', handoff: false };
  if (typeof parsed === 'string') {
    out.reply = parsed.trim().slice(0, maxChars);
    return out;
  }
  if (!parsed || typeof parsed !== 'object') return out;
  out.reply = String(parsed.reply ?? parsed.content ?? parsed.text ?? '').trim().slice(0, maxChars);
  for (const key of ['images', 'videos']) {
    const list = Array.isArray(parsed[key]) ? parsed[key] : [];
    for (const item of list.slice(0, 1)) {
      const url = safeUrl(String(item || ''));
      if (url) out[key].push(url);
    }
  }
  const actions = Array.isArray(parsed.cardActions) ? parsed.cardActions : [];
  out.cardActions = [...new Set(actions.map(String).filter((a) => ALLOWED_ACTIONS.has(a)))].slice(0, 2);
  out.couponName = String(parsed.couponName ?? '').trim().slice(0, 40);
  out.handoff = parsed.handoff === true;
  return out;
}

function buildMessages({ systemPrompt, thread, goodsTitle, orderId, goodsName }) {
  const lines = [];
  if (goodsTitle) lines.push(`买家咨询商品：${goodsTitle}`);
  if (goodsName && goodsName !== goodsTitle) lines.push(`推荐商品：${goodsName}`);
  if (orderId) lines.push(`相关订单：${orderId}`);
  lines.push('最近对话：');
  for (const m of thread || []) {
    const who = m.from === 'seller' ? '客服' : m.from === 'system' ? '系统' : '买家';
    const body = m.type === 'text' ? m.content : `[${m.type}] ${m.content}`;
    if (body) lines.push(`${who}：${body}`);
  }
  lines.push('');
  lines.push('请只针对买家最后一条诉求给出回复，输出 JSON。');
  return [
    { role: 'system', content: `${systemPrompt}\n\n${OUTPUT_PROTOCOL}` },
    { role: 'user', content: lines.join('\n') },
  ];
}

class AiClient {
  constructor({ getConfig, logger, secretReader = getSecret, fetchImpl = null } = {}) {
    this.getConfig = getConfig;
    this.logger = logger;
    this.secretReader = secretReader;
    this.fetchImpl = fetchImpl || globalThis.fetch;
  }

  get settings() {
    return this.getConfig().ai || {};
  }

  endpoint() {
    const base = String(this.settings.baseUrl || '').trim().replace(/\/+$/, '');
    if (!base) throw new Error('ai_base_url_missing');
    const url = /\/chat\/completions$/.test(base) ? base : `${base}/chat/completions`;
    const checked = safeUrl(url);
    if (!checked) throw new Error('ai_base_url_insecure');
    return checked;
  }

  async complete({ messages, timeoutMs }) {
    const settings = this.settings;
    if (settings.provider === 'echo') {
      const last = [...messages].reverse().find((m) => m.role === 'user');
      const text = String(last?.content || '').split('\n').filter(Boolean).pop() || '';
      return JSON.stringify({ reply: `收到：${text.slice(0, 40)}`, handoff: /投诉|退款|赔/.test(text) });
    }
    const url = this.endpoint();
    const local = /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:|\/|$)/i.test(url);
    const apiKey = this.secretReader('ai.apiKey') || (local ? 'local-no-key' : '');
    if (!apiKey) throw new Error('ai_api_key_missing');

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs ?? settings.timeoutMs ?? 60000);
    if (typeof timer.unref === 'function') timer.unref();
    try {
      const res = await this.fetchImpl(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: settings.model,
          messages,
          temperature: settings.temperature ?? 0.4,
          max_tokens: settings.maxTokens ?? 512,
          stream: false,
        }),
        signal: controller.signal,
      });
      const text = await res.text();
      if (!res.ok) throw new Error(`ai_http_${res.status}:${String(text).slice(0, 200)}`);
      let data;
      try {
        data = JSON.parse(text);
      } catch {
        throw new Error('ai_bad_json');
      }
      const content =
        data?.choices?.[0]?.message?.content ??
        data?.choices?.[0]?.text ??
        (typeof data?.response === 'string' ? data.response : '');
      if (!content) throw new Error('ai_empty_content');
      return String(content);
    } catch (err) {
      if (err?.name === 'AbortError') throw new Error('llm_timeout');
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  /** 端点连通性自检：只取模型列表，不消耗额度。 */
  async probe(timeoutMs = 4000) {
    if (this.settings.provider === 'echo') return { ok: true, provider: 'echo' };
    let url;
    try {
      url = this.endpoint();
    } catch (err) {
      return { ok: false, error: String(err?.message || err) };
    }
    const root = url.replace(/\/chat\/completions$/, '');
    const local = /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:|\/|$)/i.test(root);
    const apiKey = this.secretReader('ai.apiKey') || (local ? 'local-no-key' : '');
    if (!apiKey) return { ok: false, error: 'ai_api_key_missing' };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    if (typeof timer.unref === 'function') timer.unref();
    try {
      const res = await this.fetchImpl(`${root}/models`, {
        headers: { authorization: `Bearer ${apiKey}` },
        signal: controller.signal,
      });
      return { ok: res.ok, status: res.status, endpoint: root };
    } catch (err) {
      return {
        ok: false,
        error: err?.name === 'AbortError' ? 'timeout' : String(err?.message || err),
        endpoint: root,
      };
    } finally {
      clearTimeout(timer);
    }
  }

  /** 生成一条已清洗的回复；失败抛错，由引擎决定归还或放弃。 */
  async reply({ systemPrompt, thread, goodsTitle, orderId, goodsName, timeoutMs }) {
    const messages = buildMessages({ systemPrompt, thread, goodsTitle, orderId, goodsName });
    const raw = await this.complete({ messages, timeoutMs });
    const parsed = extractJson(raw);
    const normalized = normalizeReply(parsed ?? raw, {
      maxChars: this.getConfig().reply?.maxReplyChars ?? 200,
    });
    if (!normalized.reply) throw new Error('ai_empty_reply');
    return { ...normalized, raw };
  }
}

module.exports = {
  AiClient,
  buildMessages,
  normalizeReply,
  extractJson,
  safeUrl,
  ALLOWED_ACTIONS,
  OUTPUT_PROTOCOL,
};

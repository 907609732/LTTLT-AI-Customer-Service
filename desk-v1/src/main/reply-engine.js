'use strict';
/**
 * 回复引擎骨架：轮询适配器 pending 队列 → AI 生成 → 适配器发送。
 *
 * 可靠性约束：
 *  - 同一 uid 永不并发消费；maxInflight 限制单店并发。
 *  - 失败归还队列，成功 discard；send_unconfirmed 不自动重发。
 *  - 人工已回复（popMerchantSent 时间晚于买家最后一条）时 AI 不介入。
 *  - 命中转人工关键词只提示 + 转接话术，不擅自承诺。
 *  - D-04：发送成功写入自发送台账，回环卖家消息不当作人工回复。
 *  - D-05：登录重登后 recoverWindowMs 内补回；超窗只入档并累计 missed。
 *  - D-07：卖家侧消息命中 manualReplyKeywords 即取消该会话 AI 回复。
 *  - D-11：同 uid 最小间隔、发送抖动、单店每分钟上限。
 *  - aiClient / sleep / random 均为注入依赖，测试不联网、不等待。
 */
const { assertAdapterShape, assertResult } = require('../shared/adapter-contract');
const { SelfSendLedger } = require('./self-send-ledger');

const MAX_ATTEMPTS = 3;
const FATAL_AI_ERROR = /^(ai_base_url_missing|ai_base_url_insecure|ai_api_key_missing|ai_http_4\d\d)/;
const DEFAULT_RECOVER_WINDOW_MS = 600000;
const DEFAULT_PER_UID_INTERVAL_MS = 60000;
const DEFAULT_PER_STORE_PER_MINUTE = 20;
const DEFAULT_JITTER_MIN_MS = 500;
const DEFAULT_JITTER_MAX_MS = 2000;

function buyerTexts(messages) {
  return (Array.isArray(messages) ? messages : []).filter((m) => m?.from === 'buyer' && m?.content);
}

function sellerTexts(messages) {
  return (Array.isArray(messages) ? messages : []).filter((m) => m?.from === 'seller' && m?.content);
}

function messageKey(message) {
  if (message?.msgId !== undefined && message?.msgId !== null) return String(message.msgId);
  return `ts:${message?.ts ?? 0}`;
}

function mergeThread(rowMessages, history) {
  const seen = new Set();
  const out = [];
  for (const message of [...(history || []), ...(rowMessages || [])]) {
    if (!message) continue;
    const key = `${message.from}:${messageKey(message)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(message);
  }
  return out.sort((a, b) => (Number(a.ts) || 0) - (Number(b.ts) || 0)).slice(-20);
}

function matchKeyword(text, keywords) {
  const content = String(text == null ? '' : text);
  if (!content) return null;
  return (Array.isArray(keywords) ? keywords : []).find((k) => k && content.includes(k)) || null;
}

function filterBannedWords(text, rules) {
  const input=String(text || '');
  const sorted=(Array.isArray(rules)?rules:[]).filter(r=>typeof r?.word==='string'&&r.word).slice().sort((a,b)=>b.word.length-a.word.length);
  if(!sorted.length)return input;
  let output='';
  for(let i=0;i<input.length;){const match=sorted.find(r=>input.startsWith(r.word,i));if(match){output+=String(match.replacement||'');i+=match.word.length}else{output+=input[i];i++}}
  return sorted.some(r=>output.includes(r.word))?'':output;
}

class StoreWorker {
  constructor({
    store,
    adapter,
    aiClient,
    getConfig,
    logger,
    onEvent = null,
    now = Date.now,
    sleep = null,
    random = Math.random,
    selfSendLedger = null,
    welcomePolicy = null,
  }) {
    if (!store?.id) throw new Error('store_required');
    if (!aiClient || typeof aiClient.reply !== 'function') throw new Error('ai_client_required');
    assertAdapterShape(adapter);
    this.store = store;
    this.adapter = adapter;
    this.aiClient = aiClient;
    this.getConfig = getConfig;
    this.logger = logger;
    this.onEvent = onEvent;
    this.now = now;
    this.sleep =
      typeof sleep === 'function'
        ? sleep
        : (ms) =>
            new Promise((resolve) => {
              const timer = setTimeout(resolve, ms);
              if (typeof timer.unref === 'function') timer.unref();
            });
    this.random = typeof random === 'function' ? random : Math.random;
    this.selfSend = selfSendLedger || new SelfSendLedger({ now });
    this.welcomePolicy = welcomePolicy;

    this.running = false;
    this.generation = 0;
    this.paused = false;
    this.ticking = false;
    this.inflight = 0;
    this.timer = null;
    this.tasks = new Set();
    this.processing = new Set();
    this.replied = new Map();
    this.lastMerchantAt = new Map();
    this.attempts = new Map();
    this.lastSentAt = new Map();
    this.sendWindow = [];
    this.manualSuppressed = new Set();
    this.suppressionSources = new Map();
    this.manualEpoch = new Map();
    this.degraded = false;
    this.recoveredAt = 0;
    this.stats = {
      replied: 0,
      failed: 0,
      transferred: 0,
      skipped: 0,
      fallback: 0,
      missed: 0,
      throttled: 0,
      manualSuppressed: 0,
    };
  }

  get cfg() {
    return this.getConfig()?.reply || {};
  }

  get safety() {
    return this.getConfig()?.safety || {};
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.#schedule();
  }

  stop() {
    this.generation += 1;
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  pause() {
    this.generation += 1;
    this.paused = true;
  }

  resume() {
    this.paused = false;
  }

  /** D-07 的唯一恢复入口：显式清除后 AI 才会重新接管该会话。 */
  takeOver(uid,source='manual') {
    uid=String(uid);const previous=this.manualSuppressed.has(uid)?this.suppressionSources.get(uid)||'manual':null;
    this.manualEpoch.set(uid,(this.manualEpoch.get(uid)||0)+1);this.manualSuppressed.add(uid);
    this.suppressionSources.set(uid,previous==='manual'?'manual':source);
  }

  clearManualSuppression(uid,source) {
    uid=String(uid);if(source&&!this.manualSuppressed.has(uid))return true;
    if(source&&(this.suppressionSources.get(uid)||'manual')!==source)return false;
    this.suppressionSources.delete(uid);return this.manualSuppressed.delete(uid);
  }

  #schedule() {
    if (!this.running) return;
    if (this.timer) clearTimeout(this.timer);
    const ms = Math.max(300, this.cfg.pollIntervalMs ?? 1000);
    this.timer = setTimeout(() => {
      this.tick()
        .catch((err) => this.logger?.warn(`轮询异常：${err?.message || err}`))
        .finally(() => this.#schedule());
    }, ms);
    if (typeof this.timer.unref === 'function') this.timer.unref();
  }

  /** 手动推进一轮（测试与 IPC 的 immediate tick 共用）。 */
  async tick() {
    if (!this.running || this.paused || this.ticking) return { popped: 0 };
    if (!this.store.aiEnabled) return { popped: 0 };
    if (this.cfg.enabled === false) return { popped: 0 };
    const generation = this.generation;
    this.ticking = true;
    let popped = 0;
    try {
      await this.#drainMerchantSent();
      const max = this.cfg.maxInflight ?? 6;
      while (this.inflight < max && this.#active(generation)) {
        let row;
        try {
          row = await this.adapter.popPending();
        } catch (err) {
          // 外部客户端未接入 / 页面重载：不拖垮轮询，记录等待状态后下个 tick 重试
          this.#markDegraded(err);
          break;
        }
        if (!this.#active(generation)) { if(row?.uid) await this.adapter.release(row.uid).catch(()=>null); break; }
        this.#markRecovered();
        if (!row || !row.uid) break;
        if (this.processing.has(row.uid)) {
          // 同一会话在途：归还本轮认领，绝不复用同 uid 并发
          await this.adapter.release(row.uid).catch(() => null);
          break;
        }
        popped += 1;
        this.inflight += 1;
        this.processing.add(row.uid);
        const task = this.#process(row, generation)
          .catch((err) => {
            this.logger?.error(`处理会话 ${row.uid} 异常：${err?.stack || err}`);
            this.onEvent?.({ type: 'reply:error', storeId: this.store.id, uid: row.uid, error: String(err?.message || err) });
          })
          .finally(() => {
            this.inflight -= 1;
            this.processing.delete(row.uid);
            this.tasks.delete(task);
          });
        this.tasks.add(task);
      }
    } finally {
      this.ticking = false;
    }
    return { popped };
  }

  /** 等待当前所有在途会话结束（测试/退出时使用）。 */
  async settle() {
    while (this.tasks.size) {
      await Promise.allSettled([...this.tasks]);
    }
  }

  #markDegraded(error) {
    if (!this.degraded) {
      this.degraded = true;
      this.logger?.warn(`适配器暂不可用，等待恢复：${error?.message || error}`);
      this.onEvent?.({ type: 'store:degraded', storeId: this.store.id, error: String(error?.message || error) });
    }
  }

  #markRecovered() {
    if (!this.degraded) return;
    this.degraded = false;
    this.recoveredAt = this.now();
    this.logger?.info(`适配器已恢复，开始补回窗口内消息`);
    this.onEvent?.({ type: 'store:recovered', storeId: this.store.id, recoveredAt: this.recoveredAt });
  }

  async #drainMerchantSent() {
    let list;
    try {
      list = await this.adapter.popMerchantSent();
    } catch (err) {
      this.logger?.warn(`读取客服已发消息失败：${err?.message || err}`);
      return;
    }
    for (const item of Array.isArray(list) ? list : []) {
      if (!item?.uid || !item?.message) continue;
      const message = item.message;
      const uid = String(item.uid);
      const ts = Number(message.ts) || this.now();

      // D-04：AI 自己发出的消息回环时，不能当成人工回复或关键词取消
      if (this.selfSend.isSelfSent({ uid, msgId: message.msgId, text: message.content, ts }, this.now())) {
        this.onEvent?.({ type: 'merchant:self_send', storeId: this.store.id, uid });
        continue;
      }
      if (message.from && message.from !== 'seller') continue;

      this.lastMerchantAt.set(uid, Math.max(this.lastMerchantAt.get(uid) || 0, ts));
      const manualKeyword = this.#matchManualKeyword(message.content);
      if (manualKeyword) this.#suppressManual(uid, manualKeyword, 'merchant_sent');
      this.onEvent?.({ type: 'merchant:reply', storeId: this.store.id, uid, ts });
    }
  }

  #matchManualKeyword(text) {
    return matchKeyword(text, this.safety.manualReplyKeywords);
  }

  #suppressManual(uid, keyword, source) {
    const first = !this.manualSuppressed.has(uid);
    this.manualSuppressed.add(uid);
    this.suppressionSources.set(uid,'manual');
    if (first) this.stats.manualSuppressed += 1;
    this.logger?.info(`会话 ${uid} 客服手动回复命中关键词「${keyword}」，取消 AI 自动回复`);
    this.onEvent?.({
      type: 'reply:manual_suppress',
      storeId: this.store.id,
      uid,
      keyword,
      source,
      first,
    });
  }

  async #history(uid) {
    try {
      const result = await this.adapter.conversationHistory(uid, { limit: 20 });
      if (result && result.ok === true && Array.isArray(result.messages)) return {messages:result.messages,known:true};
    } catch (err) {
      this.logger?.debug(`读取会话历史失败：${err?.message || err}`);
    }
    return {messages:[],known:false};
  }

  #recoverWindowMs() {
    return Number(this.cfg.recoverWindowMs ?? DEFAULT_RECOVER_WINDOW_MS);
  }

  #inRecoveryGrace() {
    return this.recoveredAt > 0 && this.now() - this.recoveredAt <= this.#recoverWindowMs();
  }

  #active(generation) { return (typeof generation==='object'?generation.run===this.generation && generation.manualEpoch===(this.manualEpoch.get(generation.uid)||0):generation===this.generation) && this.running && !this.paused && this.store.aiEnabled && this.cfg.enabled !== false; }

  async #process(row, generation) {
    const uid = String(row.uid);
    generation={run:generation,uid,manualEpoch:this.manualEpoch.get(uid)||0};
    let claimed = true;
    const dispose = async (fn) => {
      const result = await fn();
      assertResult(result, 'dispose');
      claimed = false;
    };
    try {
      // D-07：卖家侧（可能来自 pending 行）命中手动回复关键词，先取消再谈回复
      const manualHit = sellerTexts(row.messages)
        .map((m) => this.#matchManualKeyword(m.content))
        .find(Boolean);
      if (manualHit) {
        this.#suppressManual(uid, manualHit, 'pending');
        await dispose(() => this.adapter.discard(uid));
        return;
      }
      if (this.manualSuppressed.has(uid)) {
        this.logger?.debug(`会话 ${uid} 已被客服手动回复取消，跳过 AI`);
        this.stats.skipped += 1;
        await dispose(() => this.adapter.discard(uid));
        return;
      }

      const texts = buyerTexts(row.messages);
      if (!texts.length) {
        this.logger?.debug(`会话 ${uid} 无买家文本，丢弃`);
        this.stats.skipped += 1;
        await dispose(() => this.adapter.discard(uid));
        return;
      }
      const latest = texts[texts.length - 1];
      const latestTs = Number(latest.ts) || 0;
      const lastKey = messageKey(latest);

      if (this.replied.get(uid) === lastKey) {
        this.logger?.debug(`会话 ${uid} 该消息已回复过，跳过`);
        this.stats.skipped += 1;
        await dispose(() => this.adapter.discard(uid));
        return;
      }

      if (latestTs) {
        const age = this.now() - latestTs;
        const recoverWindowMs = this.#recoverWindowMs();
        if (this.#inRecoveryGrace()) {
          // D-05：重登后窗口内的积压允许补回，即使超过 staleMs
          if (recoverWindowMs > 0 && age > recoverWindowMs) {
            this.stats.missed += 1;
            this.logger?.warn(`会话 ${uid} 消息超出补回窗口（${age}ms），只入档不回复`);
            this.onEvent?.({
              type: 'reply:missed',
              storeId: this.store.id,
              uid,
              ageMs: age,
              recoverWindowMs,
            });
            await dispose(() => this.adapter.discard(uid));
            return;
          }
        } else {
          const staleMs = this.cfg.staleMs ?? 180000;
          if (staleMs > 0 && latestTs && age > staleMs) {
            this.logger?.info(`会话 ${uid} 消息已过期，跳过`);
            this.stats.skipped += 1;
            await dispose(() => this.adapter.discard(uid));
            return;
          }
        }
      }

      const merchantTs = this.lastMerchantAt.get(uid) || 0;
      if (merchantTs && merchantTs >= latestTs) {
        this.logger?.info(`会话 ${uid} 客服已人工回复，AI 不介入`);
        this.stats.skipped += 1;
        await dispose(() => this.adapter.discard(uid));
        return;
      }

      const hit = texts.map((m) => matchKeyword(m.content, this.safety.handoffKeywords)).find(Boolean);
      if (hit) {
        const outcome = await this.#handoff(uid, hit, generation);
        if (outcome?.throttled) await dispose(() => this.adapter.release(uid));
        else await dispose(() => this.adapter.discard(uid));
        return;
      }

      // Pacing is a queue delay, not a failed delivery or a manual takeover.
      const pacing = this.#sendGate(uid);
      if (!pacing.ok) {
        this.stats.throttled += 1;
        this.onEvent?.({ type: 'reply:throttled', storeId: this.store.id, uid,
          reason: pacing.reason, retryAfterMs: pacing.retryAfterMs });
        await dispose(() => this.adapter.release(uid));
        return;
      }
      await this.adapter.focusConversation(uid).catch(() => null);

      this.logger?.debug(`会话 ${uid} [回复阶段] 正在生成`);
      const generated = await this.#generate(row, latest, generation);
      if (!this.#active(generation)) return;
      if (!generated.ok) {
        this.stats.failed += 1;
        if (generated.fatal) {
          await dispose(() => this.adapter.discard(uid));
          this.onEvent?.({ type: 'reply:failed', storeId: this.store.id, uid, reason: 'ai_config' });
        } else {
          await dispose(() => this.adapter.release(uid));
        }
        return;
      }

      const originalText = String(generated.result.reply || '').trim();
      let text = filterBannedWords(originalText, this.safety.bannedWords).trim().slice(0,this.cfg.maxReplyChars ?? 200).trim();
      if (!text) {
        if(originalText){this.stats.failed+=1;await dispose(()=>this.adapter.discard(uid));this.onEvent?.({type:'reply:failed',storeId:this.store.id,uid,reason:'banned_empty'});this.onEvent?.({type:'reply:needs-manual',storeId:this.store.id,uid,reason:'banned_empty'});return;}
        await dispose(() => this.adapter.release(uid));
        return;
      }
      this.logger?.debug(`会话 ${uid} [回复阶段] 生成完成，准备发送`);
      let sent;
      try{sent=await this.#sendText(uid,text,{generation,decorate:body=>{
        try{const greeting=filterBannedWords(generated.historyKnown?(this.welcomePolicy?.claim({storeId:this.store.id,uid,thread:generated.thread})||''):'',this.safety.bannedWords).trim();text=greeting&&!body.startsWith(greeting)?`${greeting}\n${body}`.slice(0,2000):body;return text;}
        catch{this.logger?.warn('欢迎记录保存失败，本条仅发送正文');return body;}
      }});if(sent.actualText)text=sent.actualText;}
      catch(error){if(typeof this.aiClient.onDeliveryFailure!=='function')throw error;sent={ok:false,reason:'send_unconfirmed'};}
      this.logger?.debug(`会话 ${uid} [回复阶段] 发送结果：${sent.ok?'已确认':sent.reason||'未知'}`);
      if (sent.throttled) {
        if (sent.reason !== 'cancelled') await dispose(() => this.adapter.release(uid));
        return;
      }
      if(!sent.ok&&typeof this.aiClient.onDeliveryFailure==='function'){
        if(sent.reason==='cancelled')return;
        this.stats.failed+=1;
        this.takeOver(uid,'quality');
        // Claim disposition must happen even if storing the review record fails.
        try{this.aiClient.onDeliveryFailure({reason:sent.reason||'send_unconfirmed',throttled:!!sent.throttled,storeId:this.store.id,uid,buyerName:row.username||row.name||'',buyerMessage:latest.content,reply:text});}
        finally{await dispose(()=>sent.reason==='send_unconfirmed'?this.adapter.discard(uid):this.adapter.release(uid));}
        this.onEvent?.({type:'reply:failed',storeId:this.store.id,uid,reason:sent.reason});
        return;
      }
      if (sent.throttled) {
        // 节奏限制不是失败：归还队列，等窗口允许后重试
        await dispose(() => this.adapter.release(uid));
        return;
      }
      if (sent.ok) {
        this.replied.set(uid, lastKey);
        // Only actual manual replies advance lastMerchantAt; a new buyer message
        // may have arrived while this AI reply was being generated.
        this.attempts.delete(uid);
        this.stats.replied += 1;
        await dispose(() => this.adapter.discard(uid));
        this.onEvent?.({ type: 'reply:sent', storeId: this.store.id, uid, text, msgId:sent.msgId, ts:this.now() });
        return;
      }

      this.stats.failed += 1;
      if (sent.reason === 'send_unconfirmed') {
        // 可能已发出，自动重发会造成重复消息，交给人工与去重兜底
        this.logger?.warn(`会话 ${uid} 发送未确认，不自动重发`);
        await dispose(() => this.adapter.discard(uid));
        this.onEvent?.({ type: 'reply:failed', storeId: this.store.id, uid, reason: sent.reason });
        return;
      }
      const attempts = (this.attempts.get(uid) || 0) + 1;
      this.attempts.set(uid, attempts);
      this.logger?.warn(`会话 ${uid} 发送失败(${sent.reason})，第 ${attempts} 次`);
      if (attempts >= MAX_ATTEMPTS) {
        await dispose(() => this.adapter.discard(uid));
        this.onEvent?.({ type: 'reply:failed', storeId: this.store.id, uid, reason: sent.reason });
      } else {
        await dispose(() => this.adapter.release(uid));
      }
    } catch (err) {
      this.logger?.error(`处理会话 ${uid} 异常：${err?.stack || err}`);
      this.onEvent?.({ type: 'reply:error', storeId: this.store.id, uid, error: String(err?.message || err) });
    } finally {
      if (claimed) {
        // 未明确处置的认领必须归还，避免消息永久卡死
        await this.adapter.release(uid).catch(() => null);
      }
    }
  }

  #jitterMs() {
    const min = Math.max(0, Number(this.cfg.sendJitterMinMs ?? DEFAULT_JITTER_MIN_MS));
    const max = Math.max(min, Number(this.cfg.sendJitterMaxMs ?? DEFAULT_JITTER_MAX_MS));
    if (!Number.isFinite(min) || !Number.isFinite(max) || max <= 0) return 0;
    const ratio = Math.min(1, Math.max(0, Number(this.random()) || 0));
    return Math.round(min + ratio * (max - min));
  }

  #pruneSendWindow(now) {
    const cutoff = now - 60000;
    while (this.sendWindow.length && this.sendWindow[0] <= cutoff) this.sendWindow.shift();
  }

  #sendGate(uid, { bypassUidInterval = false } = {}) {
    const now = this.now();
    if (!bypassUidInterval) {
      const interval = Number(this.cfg.perUidMinIntervalMs ?? DEFAULT_PER_UID_INTERVAL_MS);
      const last = this.lastSentAt.get(uid) || 0;
      if (interval > 0 && last && now - last < interval) {
        return { ok: false, reason: 'uid_interval', retryAfterMs: interval - (now - last) };
      }
    }
    this.#pruneSendWindow(now);
    const limit = Number(this.cfg.perStorePerMinuteMax ?? DEFAULT_PER_STORE_PER_MINUTE);
    if (limit > 0 && this.sendWindow.length >= limit) {
      const oldest = this.sendWindow[0] || now;
      return { ok: false, reason: 'store_rate', retryAfterMs: Math.max(0, 60000 - (now - oldest)) };
    }
    return { ok: true };
  }

  /**
   * 统一发送入口：节奏检查 → 抖动 → 适配器发送 → 写台账。
   * bypassUidInterval 只给兜底话术用：D-07 要求兜底与 AI 正文都发，
   * 二者属于同一次应答，不能互相被 60s 间隔挡住；仍受单店分钟上限约束。
   */
  async #sendText(uid, text, { bypassUidInterval = false, jitter = true, generation, decorate } = {}) {
    if (!this.#active(generation)||this.manualSuppressed.has(String(uid))) return {ok:false,throttled:true,reason:"cancelled"};
    const gate = this.#sendGate(uid, { bypassUidInterval });
    if (!gate.ok) {
      this.stats.throttled += 1;
      this.logger?.debug(`会话 ${uid} 发送受限(${gate.reason})，稍后重试`);
      this.onEvent?.({
        type: 'reply:throttled',
        storeId: this.store.id,
        uid,
        reason: gate.reason,
        retryAfterMs: gate.retryAfterMs,
      });
      return { ok: false, throttled: true, reason: gate.reason };
    }
    const jitterMs = jitter ? this.#jitterMs() : 0;
    if (jitterMs > 0) {
      try {
        await this.sleep(jitterMs);
      } catch {
        /* 抖动等待被取消不阻塞发送 */
      }
    }
    if (!this.#active(generation)||this.manualSuppressed.has(String(uid))) return {ok:false,throttled:true,reason:"cancelled"};
    if(decorate)text=decorate(String(text));
    const result = await this.adapter.sendText(uid, String(text));
    assertResult(result, 'sendText');
    if (result.ok || result.reason === 'send_unconfirmed') {
      try{this.welcomePolicy?.noteOutbound?.({storeId:this.store.id,uid});}catch{this.logger?.warn('欢迎去重状态未能写入，请检查磁盘');}
      const at = this.now();
      if (!bypassUidInterval) this.lastSentAt.set(uid, at);
      this.sendWindow.push(at);
      this.selfSend.record({ uid, msgId: result.msgId, text, at });
    }
    return {...result,actualText:String(text)};
  }

  async #generate(row, latest, generation) {
    const cfg = this.cfg;
    let fallbackTimer = null;
    const fallbackMs = cfg.fallbackAfterMs ?? 0;
    if (!this.aiClient.suppressFallback && fallbackMs > 0 && cfg.fallbackText) {
      fallbackTimer = setTimeout(async () => {
        const sent = await this.#sendText(row.uid, cfg.fallbackText, {
          generation,
          bypassUidInterval: true,
          jitter: false,
        }).catch(() => null);
        if (sent?.ok) {
          this.stats.fallback += 1;
          this.onEvent?.({ type: 'reply:fallback', storeId: this.store.id, uid: row.uid });
        }
      }, fallbackMs);
      if (typeof fallbackTimer.unref === 'function') fallbackTimer.unref();
    }
    try {
      const history = await this.#history(row.uid);
      const thread = mergeThread(row.messages, history.messages);
      const systemPrompt = `${this.getConfig()?.ai?.systemPrompt || '你是店铺客服。'}\n当前店铺：${this.store.storeName}`;
      const result = await this.aiClient.reply({
        systemPrompt,
        thread,
        isCurrent:()=>this.#active(generation)&&!this.manualSuppressed.has(String(row.uid)),
        reviewContext:{storeId:this.store.id,uid:row.uid,buyerName:row.username||row.name||'',buyerMessage:latest.content},
        goodsTitle: row.goodsTitle,
        orderId: row.orderId,
        timeoutMs: this.getConfig()?.ai?.timeoutMs ?? 60000,
      });
      if (!result || !result.reply) return { ok: false, fatal: false };
      return { ok: true, result, thread, historyKnown:history.known };
    } catch (err) {
      if(err?.code==='queued_canceled')return {ok:false,fatal:false};
      if(/^vision_/.test(err?.code||''))this.takeOver(row.uid,'vision');
      const message = String(err?.message || err);
      this.aiClient.onGenerationFailure?.(err,{storeId:this.store.id,uid:row.uid,buyerName:row.username||row.name||'',buyerMessage:latest.content});
      this.logger?.warn(`AI 生成失败：${message}`);
      this.onEvent?.({ type: 'reply:error', storeId: this.store.id, uid: row.uid, error: message });
      return { ok: false, fatal: FATAL_AI_ERROR.test(message) };
    } finally {
      if (fallbackTimer) clearTimeout(fallbackTimer);
    }
  }

  async #handoff(uid, keyword, generation) {
    const configured=this.cfg.handoffText;
    const text = !configured || configured==='已收到您的问题，正在为您转接人工客服，请稍候。' ? '已收到您的问题，客服会尽快为您处理，请稍候。' : configured;
    const sent = await this.#sendText(uid, text, {generation}).catch(() => null);
    this.stats.transferred += 1;
    this.logger?.info(`会话 ${uid} 命中转人工关键词「${keyword}」`);
    this.onEvent?.({
      type: 'reply:transfer',
      storeId: this.store.id,
      uid,
      keyword,
      sent: !!sent?.ok,
      throttled: !!sent?.throttled,
    });
    return sent;
  }
}

class ReplyEngine {
  constructor({ registry, adapterFactory, aiClient, getConfig, logger, onEvent = null, now = Date.now, sleep = null, random = Math.random, welcomePolicy = null }) {
    if (typeof adapterFactory !== 'function') throw new Error('adapter_factory_required');
    this.registry = registry;
    this.adapterFactory = adapterFactory;
    this.aiClient = aiClient;
    this.getConfig = getConfig;
    this.logger = logger;
    this.onEvent = onEvent;
    this.now = now;
    this.sleep = sleep;
    this.random = random;
    this.welcomePolicy = welcomePolicy;
    this.workers = new Map();
  }

  /**
   * 启动单店。非 webview 接入允许适配器先返回 hook_not_ready：
   * 外部客户端可能还没连上，浏览器窗口/客户端由用户侧负责，core 只等待。
   */
  async startStore(storeId) {
    if (this.workers.has(storeId)) return this.workers.get(storeId);
    const store = this.registry.get(storeId);
    if (!store) throw new Error(`store_not_found:${storeId}`);

    const adapter = await this.adapterFactory(store);
    assertAdapterShape(adapter);
    const ensured = await adapter.ensure();
    assertResult(ensured, 'ensure');
    if (!ensured.ok) {
      const canAwait = ensured.reason === 'hook_not_ready' && adapter.accessMode !== 'webview';
      if (!canAwait) throw new Error(`adapter_not_ready:${ensured.reason}`);
      this.logger?.info(`店铺 ${storeId} 等待外部客户端接入（${adapter.accessMode}）`);
      this.onEvent?.({ type: 'store:awaiting_client', storeId, accessMode: adapter.accessMode });
    }

    const worker = new StoreWorker({
      store,
      adapter,
      aiClient: this.aiClient,
      getConfig: () => this.getConfig(storeId),
      logger: this.logger?.child?.(store.storeName) || this.logger,
      onEvent: this.onEvent,
      now: this.now,
      sleep: this.sleep,
      random: this.random,
      welcomePolicy: this.welcomePolicy,
    });
    this.workers.set(storeId, worker);
    await adapter.syncAiEnabled(store.aiEnabled !== false).catch((err) => {
      this.logger?.warn(`同步 AI 开关失败：${err?.message || err}`);
    });
    worker.start();
    return worker;
  }

  stopStore(storeId) {
    const worker = this.workers.get(storeId);
    if (!worker) return false;
    worker.stop();
    this.workers.delete(storeId);
    return true;
  }

  stopAll() {
    for (const id of [...this.workers.keys()]) this.stopStore(id);
  }

  worker(storeId) {
    return this.workers.get(storeId) || null;
  }

  pause(storeId) {
    const worker = this.workers.get(storeId);
    if (!worker) return false;
    worker.pause();
    return true;
  }

  resume(storeId) {
    const worker = this.workers.get(storeId);
    if (!worker) return false;
    worker.resume();
    return true;
  }

  /** 客服已接管该会话后，需要显式恢复 AI 时调用。 */
  clearManualSuppression(storeId, uid) {
    const worker = this.workers.get(storeId);
    return worker ? worker.clearManualSuppression(uid) : false;
  }

  status() {
    const out = {};
    for (const [id, worker] of this.workers) {
      out[id] = {
        running: worker.running,
        paused: worker.paused,
        inflight: worker.inflight,
        degraded: worker.degraded,
        recoveredAt: worker.recoveredAt,
        manualSuppressed: worker.manualSuppressed.size,
        ...worker.stats,
      };
    }
    return out;
  }
}

module.exports = {
  ReplyEngine,
  StoreWorker,
  buyerTexts,
  sellerTexts,
  mergeThread,
  messageKey,
  matchKeyword,
  filterBannedWords,
  MAX_ATTEMPTS,
};

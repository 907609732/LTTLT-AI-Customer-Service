'use strict';
/**
 * 消息监控器：纯观测，不 pop、不 claim、不发送。
 *
 * 存在理由：回复引擎在 AI 关闭时整体不消费队列，而 bridge 只把消息放进 pending，
 * 日志里就看不到买家说了什么。监控器走适配器可选扩展 drainEvents({sinceSeq})，
 * 与回复队列完全解耦，因此无论 store.aiEnabled / reply.enabled 是否为 false 都运行。
 *
 * 约束：
 *  - 适配器没有 drainEvents 时静默跳过（外部客户端/旧适配器都合法）。
 *  - 页面重载会让 bridge 的 seq 归零：检测到 seq 回退时从 0 重拉，靠 msgId 去重。
 *  - 只按买家/我方两种格式写日志；不输出 token、URL 或 adapter 原始返回。
 */
const DEFAULT_POLL_INTERVAL_MS = 1500;
const MIN_POLL_INTERVAL_MS = 300;
const DEFAULT_SEEN_LIMIT = 2000;
const DEFAULT_ALERT_INTERVAL_MS = 60_000;

/**
 * 面向用户的失败原因。内部枚举不得原样出现在告警文案里；
 * 未收录的原因保留原值，便于排查适配器新增的失败类型。
 */
const COLLECTION_REASON_TEXT = Object.freeze({
  bridge_missing: '采集桥接失效',
  hook_not_ready: '采集未就绪',
});

function mapCollectionReason(reason) {
  const key = String(reason == null ? '' : reason).trim();
  if (!key) return '未知原因';
  return COLLECTION_REASON_TEXT[key] || key;
}

/**
 * bridge 对「页面重载后桥接丢失」的回报是 reason=hook_not_ready、detail=bridge_missing。
 * detail 更具体，命中已知映射时优先采用；否则退回 reason，避免把自由文本 detail 抛给用户。
 */
function collectionFailureReason(payload) {
  const reason = String(payload?.reason == null ? '' : payload.reason).trim();
  const detail = String(payload?.detail == null ? '' : payload.detail).trim();
  if (COLLECTION_REASON_TEXT[detail]) return detail;
  return reason || detail || 'unknown';
}

function singleLine(value) {
  return String(value == null ? '' : value).replace(/[\r\n]+/g, ' ');
}

/** 日志里只露前 8 位，完整 uid 仍保留在事件与存档中。 */
function shortUid(uid) {
  const value = String(uid || '');
  return value.length > 8 ? `${value.slice(0, 8)}…` : value || '未知';
}

/** 适配器异常可能带 bridge URL/token；观测日志不允许把它们写出去。 */
function scrub(value) {
  return singleLine(value)
    .replace(/[a-z][a-z0-9+.-]*:\/\/\S+/gi, '<url>')
    .replace(/([?&](?:token|apiKey|key)=)[^&\s]+/gi, '$1<redacted>')
    .slice(0, 300);
}

function eventKey(event) {
  if (event?.msgId !== undefined && event?.msgId !== null && String(event.msgId).trim()) {
    return `id:${event.msgId}`;
  }
  // 无 msgId 时用内容指纹兜底；页面重载 seq 会重复，不能把 seq 当唯一键。
  return `fp:${event?.uid}|${event?.from}|${event?.ts}|${event?.content}`;
}

class MessageMonitor {
  constructor({
    registry,
    adapterFactory,
    getConfig = () => ({}),
    logger = null,
    onEvent = null,
    seenLimit = DEFAULT_SEEN_LIMIT,
    now = Date.now,
    alertIntervalMs = DEFAULT_ALERT_INTERVAL_MS,
  }) {
    if (!registry || typeof registry.get !== 'function') throw new Error('registry_required');
    if (typeof adapterFactory !== 'function') throw new Error('adapter_factory_required');
    this.registry = registry;
    this.adapterFactory = adapterFactory;
    this.getConfig = getConfig;
    this.logger = logger;
    this.onEvent = onEvent;
    this.now = now;
    this.alertIntervalMs = Number(alertIntervalMs) > 0 ? Number(alertIntervalMs) : DEFAULT_ALERT_INTERVAL_MS;
    this.seenLimit = Number(seenLimit) > 0 ? Number(seenLimit) : DEFAULT_SEEN_LIMIT;
    this.watchers = new Map();
    // 关闭店铺不丢去重表：重开时 seq 从 0 重放，同一批历史消息不应再刷一遍日志。
    this.retainedSeen = new Map();
  }

  #pollIntervalMs() {
    const value = Number(this.getConfig()?.monitor?.pollIntervalMs);
    return Number.isFinite(value) && value > 0 ? Math.max(MIN_POLL_INTERVAL_MS, value) : DEFAULT_POLL_INTERVAL_MS;
  }

  /**
   * 启动单店监控。返回 watcher；适配器缺失 drainEvents 时返回 null 且不建定时器，
   * 调用方不需要区分「未实现」与「已停止」。
   */
  async start(storeId) {
    if (this.watchers.has(storeId)) return this.watchers.get(storeId);
    const store = this.registry.get(storeId);
    if (!store) return null;

    let adapter;
    try {
      adapter = await this.adapterFactory(store);
    } catch (err) {
      this.logger?.warn(`消息监控启动失败 ${storeId}：${scrub(err?.message || err)}`);
      return null;
    }
    if (!adapter || typeof adapter.drainEvents !== 'function') return null;

    const retained = this.retainedSeen.get(storeId) || { seen: new Set(), order: [] };
    this.retainedSeen.set(storeId, retained);
    const watcher = {
      storeId,
      storeName: store.storeName || storeId,
      adapter,
      running: true,
      timer: null,
      ticking: false,
      lastSeq: 0,
      seen: retained.seen,
      seenOrder: retained.order,
      errors: 0,
      collectionLost: false,
      collectionLostAt: 0,
      lastLossWarnAt: 0,
      lastFailureReason: '',
    };
    this.watchers.set(storeId, watcher);
    this.#schedule(watcher);
    return watcher;
  }

  stop(storeId) {
    const watcher = this.watchers.get(storeId);
    if (!watcher) return false;
    watcher.running = false;
    if (watcher.timer) clearTimeout(watcher.timer);
    watcher.timer = null;
    this.watchers.delete(storeId);
    return true;
  }

  stopAll() {
    for (const id of [...this.watchers.keys()]) this.stop(id);
  }

  isRunning(storeId) {
    return this.watchers.has(storeId);
  }

  status() {
    const out = {};
    for (const [id, w] of this.watchers) {
      out[id] = {
        running: w.running,
        lastSeq: w.lastSeq,
        seen: w.seen.size,
        errors: w.errors,
        collection: {
          lost: !!w.collectionLost,
          reason: w.lastFailureReason || '',
          reasonText: w.collectionLost ? mapCollectionReason(w.lastFailureReason) : '',
          since: w.collectionLostAt || 0,
        },
      };
    }
    return out;
  }

  #schedule(watcher) {
    if (!watcher.running) return;
    watcher.timer = setTimeout(() => {
      this.tick(watcher.storeId)
        .catch((err) => {
          this.logger?.warn(`消息监控轮询异常：${scrub(err?.message || err)}`);
        })
        .finally(() => this.#schedule(watcher));
    }, this.#pollIntervalMs());
    // 不阻止进程退出；before-quit 仍会显式 stopAll。
    if (typeof watcher.timer.unref === 'function') watcher.timer.unref();
  }

  /** 手动推进一轮；IPC 与测试共用。store 已停止时返回 {events:0}。 */
  async tick(storeId) {
    const watcher = this.watchers.get(storeId);
    if (!watcher || !watcher.running || watcher.ticking) return { events: 0 };
    watcher.ticking = true;
    try {
      let result = await this.#drain(watcher, watcher.lastSeq);

      // 页面重载：bridge 的 seq 从头开始。已处理的 msgId 仍在 seen 里，重拉不会刷屏。
      if (watcher.lastSeq > 0 && this.#seqOf(result) < watcher.lastSeq) {
        watcher.lastSeq = 0;
        result = await this.#drain(watcher, 0);
      }
      if (!result) return { events: 0 };
      if (result.ok === false) {
        this.#noteLoss(watcher, result);
        return { events: 0 };
      }
      this.#noteRecovered(watcher);

      const events = Array.isArray(result.events) ? result.events : [];
      let logged = 0;
      for (const event of events) {
        if (this.#accept(watcher, event)) logged += 1;
      }

      const seq = this.#seqOf(result);
      const maxEventSeq = events.reduce((max, ev) => {
        const value = Number(ev?.seq);
        return Number.isFinite(value) && value > max ? value : max;
      }, 0);
      const next = Math.max(seq, maxEventSeq);
      if (next >= watcher.lastSeq) watcher.lastSeq = next;
      return { events: logged };
    } catch (err) {
      // hook 未就绪/页面切换期间会抛异常：只计数，不中断轮询。
      watcher.errors += 1;
      this.logger?.debug(`消息监控拉取失败 ${storeId}：${scrub(err?.message || err)}`);
      this.#noteLoss(watcher, { reason: err?.reason || 'hook_not_ready', detail: err?.detail });
      return { events: 0 };
    } finally {
      watcher.ticking = false;
    }
  }

  /**
   * 采集中断时按店铺限流告警：首次立即告警并通知渲染层，持续失败每 alertIntervalMs 最多重复一次。
   * 这里只做观测与提示，不尝试重注入（桥接恢复属于 platform-hooks 的职责）。
   */
  #noteLoss(watcher, payload) {
    const reason = collectionFailureReason(payload);
    const reasonText = mapCollectionReason(reason);
    watcher.lastFailureReason = reason;
    const now = this.now();
    const first = !watcher.collectionLost;
    if (first) {
      watcher.collectionLost = true;
      watcher.collectionLostAt = now;
    } else if (now - watcher.lastLossWarnAt < this.alertIntervalMs) {
      return;
    }
    watcher.lastLossWarnAt = now;
    this.logger?.warn(`[${watcher.storeName}] 消息采集已断开（${reasonText}），请在客户端刷新页面或重启客户端`);
    if (first) {
      this.onEvent?.({ type: 'collection:lost', storeId: watcher.storeId, reason, reasonText });
    }
  }

  #noteRecovered(watcher) {
    if (!watcher.collectionLost) return;
    const reason = watcher.lastFailureReason;
    watcher.collectionLost = false;
    watcher.collectionLostAt = 0;
    watcher.lastLossWarnAt = 0;
    this.logger?.info(`[${watcher.storeName}] 消息采集已恢复`);
    this.onEvent?.({
      type: 'collection:resumed',
      storeId: watcher.storeId,
      reason,
      reasonText: mapCollectionReason(reason),
    });
  }

  async #drain(watcher, sinceSeq) {
    const result = await watcher.adapter.drainEvents({ sinceSeq });
    return result && typeof result === 'object' ? result : null;
  }

  #seqOf(result) {
    const value = Number(result?.seq);
    if (Number.isFinite(value) && value >= 0) return value;
    return 0;
  }

  #accept(watcher, event) {
    if (!event || typeof event !== 'object') return false;
    const from = String(event.from || '');
    if (from !== 'buyer' && from !== 'seller') return false;
    const uid = String(event.uid == null ? '' : event.uid);
    const key = eventKey(event);
    if (watcher.seen.has(key)) return false;
    watcher.seen.add(key);
    watcher.seenOrder.push(key);
    if (watcher.seenOrder.length > this.seenLimit) {
      const oldest = watcher.seenOrder.shift();
      if (oldest) watcher.seen.delete(oldest);
    }

    const content = singleLine(event.content);
    const username = singleLine(event.username);
    if (from === 'buyer') {
      this.logger?.info(`[${watcher.storeName}] 收消息 买家 ${username || shortUid(uid)}：${content}`);
    } else {
      this.logger?.info(`[${watcher.storeName}] 收消息 我：${content}`);
    }
    this.onEvent?.({
      type: 'message:in',
      storeId: watcher.storeId,
      uid,
      from,
      content,
      messageType:String(event.type||'text').slice(0,30),
      msgId:String(event.msgId||'').slice(0,200),
      username,
      ts: Number(event.ts) || 0,
    });
    return true;
  }
}

module.exports = {
  MessageMonitor,
  DEFAULT_POLL_INTERVAL_MS,
  DEFAULT_ALERT_INTERVAL_MS,
  COLLECTION_REASON_TEXT,
  mapCollectionReason,
  collectionFailureReason,
  eventKey,
};

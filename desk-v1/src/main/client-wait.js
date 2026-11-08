'use strict';
/**
 * 外部客户端等待窗口：店铺打开后先显示「等待客户端」，超过时限仍未连上则转为 error。
 *
 * 纯逻辑、注入计时器，便于单测模拟长时间 hook_not_ready。
 * 只负责状态与事件；探测函数由窗口管理层提供（通常是适配器 ensure()）。
 */
const UiText = require('../shared/ui-text');

const DEFAULT_TIMEOUT_MS = 60000;
const DEFAULT_INTERVAL_MS = 5000;

class ClientWaitController {
  constructor({
    timeoutMs = DEFAULT_TIMEOUT_MS,
    intervalMs = DEFAULT_INTERVAL_MS,
    now = Date.now,
    setTimer = null,
    clearTimer = null,
    onEvent = null,
  } = {}) {
    this.timeoutMs = Math.max(0, Number(timeoutMs) || 0);
    this.intervalMs = Math.max(1, Number(intervalMs) || DEFAULT_INTERVAL_MS);
    this.now = now;
    this.setTimer = setTimer || ((fn, ms) => setTimeout(fn, ms));
    this.clearTimer = clearTimer || ((timer) => clearTimeout(timer));
    this.onEvent = onEvent;
    this.records = new Map();
  }

  /**
   * 开始等待。probe 返回 {ok:true} 表示已连接；其余结果视为未就绪并继续等待。
   * 立即探测一次，之后按 intervalMs 轮询，到 deadline 仍未连上只发一次错误事件。
   */
  wait(storeId, { platformId = '', probe, onReady = null, onExpired = null } = {}) {
    if (typeof probe !== 'function') throw new Error('client_wait_probe_required');
    this.stop(storeId);
    const startedAt = this.now();
    const record = {
      storeId,
      platformId,
      state: 'waiting',
      attempts: 0,
      startedAt,
      deadline: startedAt + this.timeoutMs,
      timer: null,
      probing: false,
      probe,
      onReady,
      onExpired,
    };
    this.records.set(storeId, record);
    this.#schedule(storeId, 0);
    return this.stateOf(storeId);
  }

  stop(storeId) {
    const record = this.records.get(storeId);
    if (!record) return false;
    if (record.timer) this.clearTimer(record.timer);
    record.timer = null;
    this.records.delete(storeId);
    return true;
  }

  stopAll() {
    for (const storeId of [...this.records.keys()]) this.stop(storeId);
  }

  stateOf(storeId) {
    const record = this.records.get(storeId);
    if (!record) return { state: null, attempts: 0 };
    return { state: record.state, attempts: record.attempts, platformId: record.platformId };
  }

  #schedule(storeId, delayMs) {
    const record = this.records.get(storeId);
    if (!record || record.state !== 'waiting') return;
    if (record.timer) this.clearTimer(record.timer);
    record.timer = this.setTimer(() => {
      record.timer = null;
      this.#tick(storeId);
    }, Math.max(0, delayMs));
    if (record.timer && typeof record.timer.unref === 'function') record.timer.unref();
  }

  async #tick(storeId) {
    const record = this.records.get(storeId);
    if (!record || record.state !== 'waiting' || record.probing) return;
    if (this.now() >= record.deadline) {
      this.#expire(record);
      return;
    }

    record.probing = true;
    let result;
    try {
      result = await record.probe();
    } catch (err) {
      result = { ok: false, reason: err?.reason || 'probe_failed' };
    }
    record.probing = false;

    // stop()/重新 wait() 后旧探测结果必须丢弃，避免覆盖新状态。
    if (this.records.get(storeId) !== record || record.state !== 'waiting') return;

    if (result && result.ok) {
      record.state = 'ready';
      record.timer = null;
      record.onReady?.(storeId, result);
      this.onEvent?.({ type: 'client:ready', storeId, platformId: record.platformId });
      return;
    }

    record.attempts += 1;
    const remaining = record.deadline - this.now();
    if (remaining <= 0) this.#expire(record);
    else this.#schedule(storeId, Math.min(this.intervalMs, remaining));
  }

  #expire(record) {
    if (record.state !== 'waiting') return;
    record.state = 'error';
    if (record.timer) this.clearTimer(record.timer);
    record.timer = null;
    const message = UiText.errorFor(record.platformId, UiText.ERRORS.clientUnavailable);
    record.onExpired?.(record.storeId, message);
    this.onEvent?.({
      type: 'client:unavailable',
      storeId: record.storeId,
      platformId: record.platformId,
      message,
    });
  }
}

module.exports = {
  ClientWaitController,
  DEFAULT_TIMEOUT_MS,
  DEFAULT_INTERVAL_MS,
  CLIENT_UNAVAILABLE_MESSAGE: UiText.ERRORS.doudianUnavailable,
};

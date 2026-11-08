'use strict';
/**
 * 抖店本机桥接服务（仅回环）。
 *
 * 拓扑：
 *   抖店 IM 容器页 ──> GET /doudian-bridge.js 取脚本
 *                  ──> 脚本内 window.__DESK_V1_DOUDIAN_WS__ 指向 ws://127.0.0.1:<port>/rpc
 *                  ──> WebSocket 收发 {id, method, params} / {id, ok, result}
 *   core 适配器 ──> deps.doudianBridge.call(method, params) ──> 同一条 WS
 *
 * 设计约束：
 *   - 只监听 127.0.0.1；不提供 0.0.0.0 选项。
 *   - 方法白名单来自 src/injections/doudian-bridge.js 的 dispatch switch（唯一事实来源）。
 *     不提供 eval / execute / 任意表达式通道。
 *   - token 每次启动随机生成，只存在主进程内存：不写日志、不写 config.json、不注入 Electron renderer。
 *     页面必须持有 token 才能调用 RPC，因此 token 由本服务在返回脚本时内联到页面全局
 *     （脚本 URL 可带 ?token=，页面侧从 SCRIPT_SRC 取用；静态 script 标签无 token 时仍然
 *     由服务端在响应体内注入，作为页面静态标签的兼容路径）。
 *   - 端口占用时按配置的 fallbackPorts 顺序回退，回退列表不写死在代码里。
 */
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 42101;
const BRIDGE_PATH = '/doudian-bridge.js';
const RPC_PATH = '/rpc';
const HEALTH_PATH = '/healthz';
const DEFAULT_BRIDGE_ASSET = path.join(__dirname, '..', 'injections', 'doudian-bridge.js');
const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

/** 与 bridge 的 dispatch switch 一一对应；test/doudian-bridge-server.test.js 会校验一致性。 */
const METHOD_WHITELIST = Object.freeze([
  'ensure',
  'preparePending',
  'popPending',
  'pendingSnapshot',
  'conversationHistory',
  // 只读观测：message-monitor 消费；不在契约必填方法表内。
  'drainEvents',
  'sendText',
  'sendImage',
  'release',
  'discard',
  'popMerchantSent',
  'popSent',
  'syncAiEnabled',
  'focusConversation',
  'stats',
  'selfTest',
  'scanNow',
]);

const DEFAULT_BODY_LIMIT = 256 * 1024;
const DEFAULT_FRAME_LIMIT = 512 * 1024;
const DEFAULT_RPC_TIMEOUT_MS = 15000;
const DEFAULT_REQUEST_TIMEOUT_MS = 15000;
const DEFAULT_RATE = Object.freeze({ windowMs: 1000, max: 60 });

const noopLogger = Object.freeze({ debug() {}, info() {}, warn() {}, error() {} });

/** 只认 IPv4/IPv6 回环；::ffff:127.x 视作回环，其余一律拒绝。 */
function isLoopbackAddress(address) {
  const value = String(address || '').trim().toLowerCase();
  if (!value) return false;
  if (value === '::1' || value === '127.0.0.1') return true;
  const mapped = value.startsWith('::ffff:') ? value.slice(7) : value;
  return /^127(?:\.\d{1,3}){3}$/.test(mapped);
}

function secureEqual(a, b) {
  const left = crypto.createHash('sha256').update(String(a == null ? '' : a)).digest();
  const right = crypto.createHash('sha256').update(String(b == null ? '' : b)).digest();
  return crypto.timingSafeEqual(left, right);
}

function normalizePorts(primary, fallbackPorts) {
  const port = Number(primary);
  if (Number.isInteger(port) && port === 0) return [0];
  const list = [port, ...(Array.isArray(fallbackPorts) ? fallbackPorts : [])];
  const seen = new Set();
  const out = [];
  for (const raw of list) {
    const value = Number(raw);
    if (!Number.isInteger(value) || value < 1 || value > 65535) continue;
    if (seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out.length ? out : [DEFAULT_PORT];
}

function encodeFrame(payload, opcode = 0x1) {
  const body = Buffer.isBuffer(payload) ? payload : Buffer.from(String(payload), 'utf8');
  let header;
  if (body.length < 126) {
    header = Buffer.alloc(2);
    header[1] = body.length;
  } else if (body.length < 65536) {
    header = Buffer.alloc(4);
    header[1] = 126;
    header.writeUInt16BE(body.length, 2);
  } else {
    header = Buffer.alloc(10);
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(body.length), 2);
  }
  header[0] = 0x80 | (opcode & 0x0f);
  return Buffer.concat([header, body]);
}

function decodeFrame(buffer, limit) {
  if (buffer.length < 2) return null;
  const b0 = buffer[0];
  const b1 = buffer[1];
  const opcode = b0 & 0x0f;
  const masked = (b1 & 0x80) !== 0;
  let length = b1 & 0x7f;
  let offset = 2;
  if (length === 126) {
    if (buffer.length < 4) return null;
    length = buffer.readUInt16BE(2);
    offset = 4;
  } else if (length === 127) {
    if (buffer.length < 10) return null;
    const big = buffer.readBigUInt64BE(2);
    if (big > BigInt(limit)) return { tooLarge: true, consumed: 10 };
    length = Number(big);
    offset = 10;
  }
  if (length > limit) return { tooLarge: true, consumed: offset };
  const maskLength = masked ? 4 : 0;
  const total = offset + maskLength + length;
  if (buffer.length < total) return null;
  const mask = masked ? buffer.subarray(offset, offset + 4) : null;
  offset += maskLength;
  const payload = Buffer.from(buffer.subarray(offset, offset + length));
  if (mask) {
    for (let i = 0; i < payload.length; i += 1) payload[i] ^= mask[i % 4];
  }
  return { opcode, masked, payload, consumed: total, tooLarge: false };
}

class DoudianBridgeServer {
  constructor(options = {}) {
    this.host = DEFAULT_HOST;
    this.ports = normalizePorts(options.port == null ? DEFAULT_PORT : options.port, options.fallbackPorts);
    this.assetPath = options.assetPath || DEFAULT_BRIDGE_ASSET;
    this.logger = options.logger || noopLogger;
    this.token = String(options.token || crypto.randomBytes(24).toString('base64url'));
    this.bodyLimit = Number(options.bodyLimit) > 0 ? Number(options.bodyLimit) : DEFAULT_BODY_LIMIT;
    this.frameLimit = Number(options.frameLimit) > 0 ? Number(options.frameLimit) : DEFAULT_FRAME_LIMIT;
    this.requestTimeoutMs =
      Number(options.requestTimeoutMs) > 0 ? Number(options.requestTimeoutMs) : DEFAULT_REQUEST_TIMEOUT_MS;
    this.rpcTimeoutMs = Number(options.rpcTimeoutMs) > 0 ? Number(options.rpcTimeoutMs) : DEFAULT_RPC_TIMEOUT_MS;
    const rate = options.rateLimit || {};
    this.rateWindowMs = Number(rate.windowMs) > 0 ? Number(rate.windowMs) : DEFAULT_RATE.windowMs;
    this.rateMax = Number(rate.max) > 0 ? Number(rate.max) : DEFAULT_RATE.max;
    this.allowedMethods = new Set(options.allowedMethods || METHOD_WHITELIST);

    this.server = null;
    this.port = 0;
    this.startedAt = 0;
    this.clients = new Set();
    this.pending = new Map();
    this.rate = new Map();
    this.requestSeq = 0;
  }

  /* ------------------------------------------------------------------ *
   * 生命周期
   * ------------------------------------------------------------------ */
  async start() {
    if (this.server) return this.endpoint();
    let lastError = null;
    for (const port of this.ports) {
      const server = http.createServer((req, res) => this.handleRequest(req, res));
      server.requestTimeout = this.requestTimeoutMs;
      server.headersTimeout = Math.min(this.requestTimeoutMs, 10000);
      server.on('upgrade', (req, socket, head) => this.handleUpgrade(req, socket, head));
      server.on('clientError', (_err, socket) => {
        try {
          socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
        } catch {
          /* 连接已断开时忽略 */
        }
      });
      try {
        await listen(server, port, this.host);
      } catch (err) {
        try {
          server.close();
        } catch {
          /* ignore */
        }
        if (err && (err.code === 'EADDRINUSE' || err.code === 'EACCES')) {
          lastError = err;
          continue;
        }
        throw err;
      }
      this.server = server;
      this.port = server.address().port;
      this.startedAt = Date.now();
      // 只记录启动事实：不回显 URL/端口/token。
      this.logger.info('抖店桥接服务已启动（仅 127.0.0.1）');
      return this.endpoint();
    }
    throw lastError || new Error('bridge_listen_failed');
  }

  async close() {
    const server = this.server;
    this.server = null;
    for (const client of [...this.clients]) this._dropClient(client);
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      this.pending.delete(id);
      pending.resolve({ ok: false, reason: 'hook_not_ready', detail: 'doudian_bridge_closed' });
    }
    this.rate.clear();
    this.port = 0;
    if (!server) return;
    await new Promise((resolve) => {
      try {
        server.close(() => resolve());
        if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
      } catch {
        resolve();
      }
    });
  }

  endpoint() {
    return { host: this.host, port: this.port, scriptUrl: this.scriptUrl(), wsUrl: this.wsUrl() };
  }

  scriptUrl() {
    return `http://${this.host}:${this.port}${BRIDGE_PATH}?token=${encodeURIComponent(this.token)}`;
  }

  wsUrl() {
    return `ws://${this.host}:${this.port}${RPC_PATH}?token=${encodeURIComponent(this.token)}`;
  }

  status() {
    return {
      running: !!this.server,
      port: this.port,
      clients: this.clients.size,
      pending: this.pending.size,
      startedAt: this.startedAt,
    };
  }

  /* ------------------------------------------------------------------ *
   * core -> bridge
   * ------------------------------------------------------------------ */
  async call(method, params = {}, opts = {}) {
    const name = String(method || '');
    if (!this.allowedMethods.has(name)) {
      const err = new Error(`method_not_allowed:${name}`);
      err.code = 'method_not_allowed';
      throw err;
    }
    const client = this._pickClient(opts);
    if (!client) return { ok: false, reason: 'hook_not_ready', detail: 'doudian_bridge_not_connected' };

    const id = `${Date.now().toString(36)}-${++this.requestSeq}`;
    const timeoutMs = Number(opts.timeoutMs) > 0 ? Number(opts.timeoutMs) : this.rpcTimeoutMs;
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        resolve({ ok: false, reason: 'hook_not_ready', detail: 'doudian_bridge_timeout' });
      }, timeoutMs);
      if (typeof timer.unref === 'function') timer.unref();
      this.pending.set(id, { resolve, timer, client });
      try {
        client.send(JSON.stringify({ id, method: name, params: params || {} }));
      } catch (err) {
        clearTimeout(timer);
        this.pending.delete(id);
        resolve({ ok: false, reason: 'hook_not_ready', detail: String((err && err.message) || err) });
      }
    });
  }

  _pickClient(opts = {}) {
    for (const client of this.clients) {
      if (client.closed) continue;
      if (opts.storeId && client.storeId && client.storeId !== String(opts.storeId)) continue;
      return client;
    }
    return null;
  }

  /* ------------------------------------------------------------------ *
   * HTTP
   * ------------------------------------------------------------------ */
  handleRequest(req, res) {
    const remote = req && req.socket ? req.socket.remoteAddress : '';
    if (!isLoopbackAddress(remote)) {
      this._send(res, 403, { ok: false, error: 'loopback_only' });
      return;
    }
    let url;
    try {
      url = new URL(req.url || '/', 'http://127.0.0.1');
    } catch {
      this._send(res, 400, { ok: false, error: 'bad_request' });
      return;
    }

    if (url.pathname === BRIDGE_PATH) {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        this._methodNotAllowed(res);
        return;
      }
      this._serveScript(req, res, url);
      return;
    }
    if (url.pathname === HEALTH_PATH) {
      if (req.method !== 'GET') {
        this._methodNotAllowed(res);
        return;
      }
      this._send(res, 200, { ok: true, clients: this.clients.size });
      return;
    }
    if (url.pathname === RPC_PATH) {
      if (req.method !== 'POST') {
        this._methodNotAllowed(res);
        return;
      }
      this._handleRpc(req, res, url).catch(() => {
        this._send(res, 500, { ok: false, error: 'internal_error' });
      });
      return;
    }
    this._send(res, 404, { ok: false, error: 'not_found' });
  }

  _serveScript(req, res, url) {
    const provided = url.searchParams.get('token');
    if (provided != null && !secureEqual(provided, this.token)) {
      this._send(res, 403, { ok: false, error: 'invalid_token' });
      return;
    }
    let source;
    try {
      source = fs.readFileSync(this.assetPath, 'utf8');
    } catch (err) {
      this._send(res, 500, { ok: false, error: 'bridge_asset_unavailable' });
      return;
    }
    // 随机 token 只在响应时内联，不落盘；同时把 ws 地址交给容器模式，脚本本身不含地址。
    const bootstrap = `/* desk-v1: generated at serve time, not persisted */\nwindow.__DESK_V1_DOUDIAN_WS__=${JSON.stringify(this.wsUrl())};\n`;
    const body = Buffer.from(bootstrap + source, 'utf8');
    res.writeHead(200, {
      'Content-Type': 'text/javascript; charset=utf-8',
      'Content-Length': body.length,
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      Pragma: 'no-cache',
      Expires: '0',
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(req.method === 'HEAD' ? undefined : body);
  }

  async _handleRpc(req, res, url) {
    const token = url.searchParams.get('token') || req.headers['x-desk-bridge-token'];
    if (!token || !secureEqual(token, this.token)) {
      this._send(res, 403, { id: null, ok: false, error: 'invalid_token' });
      return;
    }
    if (this._rateLimited(req.socket && req.socket.remoteAddress)) {
      this._send(res, 429, { id: null, ok: false, error: 'rate_limited' }, { 'Retry-After': '1' });
      return;
    }
    const contentType = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
    if (contentType !== 'application/json') {
      this._send(res, 415, { id: null, ok: false, error: 'content_type_required' });
      return;
    }

    let raw;
    try {
      raw = await this._readBody(req);
    } catch (err) {
      if (err && err.code === 413) {
        this._send(res, 413, { id: null, ok: false, error: 'body_too_large' });
        return;
      }
      this._send(res, 400, { id: null, ok: false, error: 'bad_request' });
      return;
    }

    let message;
    try {
      message = JSON.parse(raw.toString('utf8'));
    } catch {
      this._send(res, 400, { id: null, ok: false, error: 'invalid_json' });
      return;
    }
    if (!message || typeof message !== 'object' || Array.isArray(message)) {
      this._send(res, 400, { id: null, ok: false, error: 'invalid_request' });
      return;
    }
    const id = message.id == null ? null : message.id;
    const method = typeof message.method === 'string' ? message.method : '';
    if (!this.allowedMethods.has(method)) {
      this._send(res, 403, { id, ok: false, reason: 'method_not_allowed', method });
      return;
    }
    const params = message.params == null ? {} : message.params;
    if (typeof params !== 'object' || Array.isArray(params)) {
      this._send(res, 400, { id, ok: false, error: 'invalid_params' });
      return;
    }

    const result = await this.call(method, params);
    this._send(res, 200, { id, ok: !(result && result.ok === false), result });
  }

  _readBody(req) {
    return new Promise((resolve, reject) => {
      let size = 0;
      let tooLarge = false;
      const chunks = [];
      req.on('data', (chunk) => {
        size += chunk.length;
        if (size > this.bodyLimit) {
          tooLarge = true;
          chunks.length = 0;
          return;
        }
        if (!tooLarge) chunks.push(chunk);
      });
      req.on('end', () => {
        if (tooLarge) {
          const err = new Error('body_too_large');
          err.code = 413;
          reject(err);
          return;
        }
        resolve(Buffer.concat(chunks));
      });
      req.on('error', reject);
    });
  }

  _rateLimited(address) {
    const key = String(address || 'unknown');
    const now = Date.now();
    let row = this.rate.get(key);
    if (!row || now > row.resetAt) {
      row = { count: 0, resetAt: now + this.rateWindowMs };
      this.rate.set(key, row);
    }
    row.count += 1;
    return row.count > this.rateMax;
  }

  _methodNotAllowed(res) {
    this._send(res, 405, { ok: false, error: 'method_not_allowed' }, { Allow: 'GET, POST' });
  }

  _send(res, status, payload, extraHeaders = {}) {
    if (!res || res.writableEnded) return;
    const body = Buffer.from(JSON.stringify(payload), 'utf8');
    try {
      res.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': body.length,
        'Cache-Control': 'no-store',
        ...extraHeaders,
      });
      res.end(body);
    } catch {
      /* 客户端提前断开 */
    }
  }

  /* ------------------------------------------------------------------ *
   * WebSocket（bridge 容器模式）
   * ------------------------------------------------------------------ */
  handleUpgrade(req, socket, head) {
    let url;
    try {
      url = new URL(req.url || '/', 'http://127.0.0.1');
    } catch {
      this._rejectUpgrade(socket, 400);
      return;
    }
    if (!isLoopbackAddress(socket.remoteAddress)) {
      this._rejectUpgrade(socket, 403);
      return;
    }
    if (url.pathname !== RPC_PATH) {
      this._rejectUpgrade(socket, 404);
      return;
    }
    const token = url.searchParams.get('token') || req.headers['x-desk-bridge-token'] || '';
    if (!token || !secureEqual(token, this.token)) {
      this._rejectUpgrade(socket, 401);
      return;
    }
    if (String(req.headers.upgrade || '').toLowerCase() !== 'websocket') {
      this._rejectUpgrade(socket, 400);
      return;
    }
    const key = req.headers['sec-websocket-key'];
    if (!key) {
      this._rejectUpgrade(socket, 400);
      return;
    }
    const accept = crypto
      .createHash('sha1')
      .update(String(key) + WS_GUID)
      .digest('base64');
    socket.write(
      [
        'HTTP/1.1 101 Switching Protocols',
        'Upgrade: websocket',
        'Connection: Upgrade',
        `Sec-WebSocket-Accept: ${accept}`,
        '\r\n',
      ].join('\r\n'),
    );
    this._createClient(socket, head);
  }

  _rejectUpgrade(socket, status) {
    const reason = status === 401 ? 'Unauthorized' : status === 403 ? 'Forbidden' : status === 404 ? 'Not Found' : 'Bad Request';
    try {
      socket.end(`HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
    } catch {
      /* ignore */
    }
    try {
      socket.destroy();
    } catch {
      /* ignore */
    }
  }

  _createClient(socket, head) {
    const state = {
      socket,
      buffer: head && head.length ? Buffer.from(head) : Buffer.alloc(0),
      closed: false,
      role: 'unknown',
      storeId: '',
    };
    state.send = (text) => {
      if (state.closed) return;
      try {
        socket.write(encodeFrame(text, 0x1));
      } catch {
        this._dropClient(state);
      }
    };
    this.clients.add(state);
    try {
      socket.setNoDelay(true);
    } catch {
      /* ignore */
    }
    socket.on('data', (chunk) => {
      state.buffer = Buffer.concat([state.buffer, chunk]);
      this._drainFrames(state);
    });
    socket.on('close', () => this._dropClient(state));
    socket.on('error', () => this._dropClient(state));
    if (state.buffer.length) this._drainFrames(state);
    return state;
  }

  _drainFrames(state) {
    while (!state.closed) {
      const frame = decodeFrame(state.buffer, this.frameLimit);
      if (!frame) return;
      if (frame.tooLarge) {
        this._closeClient(state, 1009);
        return;
      }
      state.buffer = state.buffer.subarray(frame.consumed);
      if (frame.opcode === 0x8) {
        this._closeClient(state, 1000);
        return;
      }
      if (frame.opcode === 0x9) {
        try {
          state.socket.write(encodeFrame(frame.payload, 0xa));
        } catch {
          /* ignore */
        }
        continue;
      }
      if (frame.opcode === 0xa) continue;
      if (frame.opcode === 0x0) continue;
      if (frame.opcode !== 0x1) {
        this._closeClient(state, 1003);
        return;
      }
      let message;
      try {
        message = JSON.parse(frame.payload.toString('utf8'));
      } catch {
        continue;
      }
      this._onClientMessage(state, message);
    }
  }

  _onClientMessage(state, message) {
    if (!message || typeof message !== 'object') return;
    if (message.type === 'hi') {
      state.role = String(message.role || 'unknown');
      state.storeId = String(message.storeId || '');
      state.send(JSON.stringify({ type: 'hi-ack', ver: 1 }));
      return;
    }
    if (message.id != null) {
      const pending = this.pending.get(String(message.id));
      if (pending) {
        this.pending.delete(String(message.id));
        clearTimeout(pending.timer);
        const result =
          message.result !== undefined ? message.result : { ok: message.ok !== false, reason: message.reason };
        pending.resolve(result);
        return;
      }
    }
    // bridge 主动上报：当前脚本不发通知帧；保留白名单校验与受控拒绝，绝不执行任意方法。
    if (typeof message.method === 'string') {
      const allowed = this.allowedMethods.has(message.method);
      state.send(
        JSON.stringify({
          id: message.id == null ? null : message.id,
          ok: false,
          reason: allowed ? 'not_implemented' : 'method_not_allowed',
        }),
      );
    }
  }

  _closeClient(state, code) {
    if (state.closed) return;
    try {
      const payload = Buffer.alloc(2);
      payload.writeUInt16BE(code || 1000, 0);
      state.socket.write(encodeFrame(payload, 0x8));
      state.socket.end();
    } catch {
      /* ignore */
    }
    this._dropClient(state);
  }

  _dropClient(state) {
    if (!state || state.closed) return;
    state.closed = true;
    this.clients.delete(state);
    for (const [id, pending] of this.pending) {
      if (pending.client !== state) continue;
      this.pending.delete(id);
      clearTimeout(pending.timer);
      pending.resolve({ ok: false, reason: 'hook_not_ready', detail: 'doudian_bridge_disconnected' });
    }
    try {
      state.socket.destroy();
    } catch {
      /* ignore */
    }
  }
}

function listen(server, port, host) {
  return new Promise((resolve, reject) => {
    const onError = (err) => {
      server.removeListener('listening', onListening);
      reject(err);
    };
    const onListening = () => {
      server.removeListener('error', onError);
      resolve();
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen({ port, host, exclusive: true });
  });
}

module.exports = {
  DoudianBridgeServer,
  METHOD_WHITELIST,
  isLoopbackAddress,
  secureEqual,
  DEFAULT_HOST,
  DEFAULT_PORT,
  BRIDGE_PATH,
  RPC_PATH,
  DEFAULT_BODY_LIMIT,
};

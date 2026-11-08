'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const path = require('node:path');

const { DoudianBridgeServer, METHOD_WHITELIST, isLoopbackAddress } = require('../src/main/doudian-bridge-server');

const BRIDGE_ASSET = path.join(__dirname, '..', 'src', 'injections', 'doudian-bridge.js');
const TOKEN = 'test-token-0123456789';

function silentLogger() {
  return { debug() {}, info() {}, warn() {}, error() {} };
}

async function startServer(extra = {}) {
  const server = new DoudianBridgeServer({
    port: 0,
    token: TOKEN,
    logger: silentLogger(),
    ...extra,
  });
  await server.start();
  return server;
}

function request(server, { method = 'GET', path: reqPath = '/', body, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port: server.port, method, path: reqPath, headers },
      (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () =>
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: Buffer.concat(chunks).toString('utf8'),
          }),
        );
      },
    );
    req.on('error', reject);
    if (body != null) req.write(body);
    req.end();
  });
}

function rpc(server, payload, { token = TOKEN, headers = {} } = {}) {
  const query = token ? `?token=${encodeURIComponent(token)}` : '';
  return request(server, {
    method: 'POST',
    path: `/rpc${query}`,
    body: JSON.stringify(payload),
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

test('isLoopbackAddress 只接受回环地址', () => {
  assert.equal(isLoopbackAddress('127.0.0.1'), true);
  assert.equal(isLoopbackAddress('127.8.9.10'), true);
  assert.equal(isLoopbackAddress('::1'), true);
  assert.equal(isLoopbackAddress('::ffff:127.0.0.1'), true);
  assert.equal(isLoopbackAddress('10.0.0.5'), false);
  assert.equal(isLoopbackAddress('192.168.1.2'), false);
  assert.equal(isLoopbackAddress('::ffff:8.8.8.8'), false);
  assert.equal(isLoopbackAddress('0.0.0.0'), false);
  assert.equal(isLoopbackAddress(''), false);
});

test('白名单与 bridge dispatch 的 case 名严格一致（不臆造方法）', () => {
  const source = fs.readFileSync(BRIDGE_ASSET, 'utf8');
  const names = [...source.matchAll(/case\s+'([A-Za-z0-9_]+)'\s*:/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(names)].sort(), [...METHOD_WHITELIST].sort());
});

test('RPC token 缺失被拒', async () => {
  const server = await startServer();
  try {
    const res = await rpc(server, { id: 1, method: 'ensure' }, { token: '' });
    assert.equal(res.status, 403);
    assert.equal(JSON.parse(res.body).error, 'invalid_token');
  } finally {
    await server.close();
  }
});

test('RPC token 错误被拒', async () => {
  const server = await startServer();
  try {
    const res = await rpc(server, { id: 1, method: 'ensure' }, { token: 'wrong-token' });
    assert.equal(res.status, 403);
    assert.equal(JSON.parse(res.body).error, 'invalid_token');
  } finally {
    await server.close();
  }
});

test('未知方法被拒且返回 method_not_allowed', async () => {
  const server = await startServer();
  try {
    const res = await rpc(server, { id: 2, method: 'execute', params: {} });
    assert.equal(res.status, 403);
    const body = JSON.parse(res.body);
    assert.equal(body.reason, 'method_not_allowed');
    assert.equal(body.ok, false);
  } finally {
    await server.close();
  }
});

test('超大 body 被拒（413），且非 JSON Content-Type 被拒', async () => {
  const server = await startServer({ bodyLimit: 1024 });
  try {
    const big = JSON.stringify({ id: 3, method: 'ensure', params: { pad: 'x'.repeat(2000) } });
    const oversized = await rpc(server, JSON.parse(big));
    assert.equal(oversized.status, 413);
    assert.equal(JSON.parse(oversized.body).error, 'body_too_large');

    const wrongType = await request(server, {
      method: 'POST',
      path: `/rpc?token=${encodeURIComponent(TOKEN)}`,
      body: '{"id":4,"method":"ensure"}',
      headers: { 'Content-Type': 'text/plain' },
    });
    assert.equal(wrongType.status, 415);
  } finally {
    await server.close();
  }
});

test('非 loopback 请求被拒（403）', async () => {
  const server = await startServer();
  try {
    const out = { status: 0, headers: null, body: '' };
    const res = {
      writableEnded: false,
      writeHead(status, headers) {
        out.status = status;
        out.headers = headers;
      },
      end(body) {
        out.body = body ? String(body) : '';
        this.writableEnded = true;
      },
    };
    server.handleRequest(
      { socket: { remoteAddress: '10.1.2.3' }, method: 'GET', url: '/healthz', headers: {} },
      res,
    );
    assert.equal(out.status, 403);
    assert.equal(JSON.parse(out.body).error, 'loopback_only');
  } finally {
    await server.close();
  }
});

test('脚本资产正确返回：Content-Type / no-cache / 原文与 ws 注入', async () => {
  const server = await startServer();
  try {
    const expected = fs.readFileSync(BRIDGE_ASSET, 'utf8');
    const res = await request(server, { path: `/doudian-bridge.js?token=${encodeURIComponent(TOKEN)}` });
    assert.equal(res.status, 200);
    assert.match(String(res.headers['content-type']), /javascript/);
    assert.match(String(res.headers['cache-control']), /no-store|no-cache/);
    assert.ok(res.body.includes(expected.slice(0, 200)));
    assert.ok(res.body.includes(expected.slice(-200)));
    assert.ok(res.body.includes('window.__DESK_V1_DOUDIAN_WS__='));
    assert.ok(res.body.includes(encodeURIComponent(TOKEN)));

    const wrong = await request(server, { path: '/doudian-bridge.js?token=bad' });
    assert.equal(wrong.status, 403);
  } finally {
    await server.close();
  }
});

test('无 bridge 连接时 call 返回受控 hook_not_ready', async () => {
  const server = await startServer();
  try {
    assert.deepEqual(await server.call('ensure', {}), {
      ok: false,
      reason: 'hook_not_ready',
      detail: 'doudian_bridge_not_connected',
    });
    await assert.rejects(() => server.call('eval', {}), (err) => err.code === 'method_not_allowed');
  } finally {
    await server.close();
  }
});

test('WebSocket：token 鉴权 + call 往返 + POST /rpc 转发', async () => {
  const server = await startServer();
  const ws = new WebSocket(server.wsUrl());
  try {
    await new Promise((resolve, reject) => {
      ws.onopen = resolve;
      ws.onerror = () => reject(new Error('ws_connect_failed'));
    });
    ws.send(JSON.stringify({ type: 'hi', role: 'doudian-container', ver: 1 }));
    ws.onmessage = (event) => {
      let msg;
      try {
        msg = JSON.parse(String(event.data));
      } catch {
        return;
      }
      if (msg.type === 'hi-ack') return;
      if (typeof msg.method === 'string') {
        ws.send(JSON.stringify({ id: msg.id, ok: true, result: { ok: true, shopId: '10001', echoed: msg.method } }));
      }
    };
    // 等 hi-ack 抵达，确保服务端已把连接登记进 clients
    await new Promise((resolve) => setTimeout(resolve, 50));

    const viaCall = await server.call('ensure', {});
    assert.deepEqual(viaCall, { ok: true, shopId: '10001', echoed: 'ensure' });

    const viaHttp = await rpc(server, { id: 'r1', method: 'pendingSnapshot', params: {} });
    assert.equal(viaHttp.status, 200);
    const parsed = JSON.parse(viaHttp.body);
    assert.equal(parsed.id, 'r1');
    assert.equal(parsed.ok, true);
    assert.equal(parsed.result.echoed, 'pendingSnapshot');
  } finally {
    try {
      ws.close();
    } catch {
      /* ignore */
    }
    await server.close();
  }
});

test('退出后端口释放，可被重新监听', async () => {
  const server = await startServer();
  const port = server.port;
  assert.ok(port > 0);
  await server.close();
  assert.equal(server.port, 0);

  await new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen({ port, host: '127.0.0.1', exclusive: true }, () => probe.close(resolve));
  });
});

test('端口占用时按配置顺序回退', async () => {
  const first = await startServer();
  let fallbackPort = 0;
  await new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen({ port: 0, host: '127.0.0.1', exclusive: true }, () => {
      fallbackPort = probe.address().port;
      probe.close(resolve);
    });
  });
  const fallback = await startServer({ port: first.port, fallbackPorts: [fallbackPort] });
  try {
    assert.equal(fallback.port, fallbackPort);
    assert.notEqual(fallback.port, first.port);
  } finally {
    await fallback.close();
    await first.close();
  }
});

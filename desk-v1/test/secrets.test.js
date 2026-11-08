'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { SecretStore, maskSecret } = require('../src/main/secrets');
const { Config } = require('../src/main/config');

function tempFile(name = 'secrets.json') {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'desk-secret-')), name);
}

function fakeSafeStorage() {
  return {
    isEncryptionAvailable: () => true,
    encryptString: (value) => Buffer.from(`enc:${value}`, 'utf8'),
    decryptString: (buffer) => buffer.toString('utf8').replace(/^enc:/, ''),
  };
}

test('safeStorage 可用时加密落盘且可读回', () => {
  const file = tempFile();
  const store = new SecretStore({ file, safeStorage: fakeSafeStorage() });
  const result = store.set('ai.apiKey', 'sk-1234567890');
  assert.deepEqual(result, { ok: true, enc: 'dpapi' });
  const raw = fs.readFileSync(file, 'utf8');
  assert.equal(raw.includes('sk-1234567890'), false);
  assert.equal(store.get('ai.apiKey'), 'sk-1234567890');
  assert.equal(store.has('ai.apiKey'), true);
  assert.equal(store.describe('ai.apiKey').enc, 'dpapi');
});

test('无 safeStorage 时降级 b64 并明确标记', () => {
  const file = tempFile();
  const store = new SecretStore({ file, safeStorage: null });
  const result = store.set('ai.apiKey', 'sk-fallback');
  assert.deepEqual(result, { ok: true, enc: 'b64' });
  assert.equal(store.get('ai.apiKey'), 'sk-fallback');
});

test('加密不可用（safeStorage 返回 null）时不丢键', () => {
  const file = tempFile();
  const store = new SecretStore({ file, safeStorage: null });
  store.set('token', 'abc');
  const other = new SecretStore({ file, safeStorage: null });
  assert.equal(other.get('token'), 'abc');
});

test('空值等价删除，remove 可清除', () => {
  const file = tempFile();
  const store = new SecretStore({ file, safeStorage: null });
  store.set('k', 'v');
  assert.deepEqual(store.set('k', ''), { ok: true, cleared: true });
  assert.equal(store.has('k'), false);
  store.set('k', 'v');
  store.remove('k');
  assert.equal(store.get('k'), '');
});

test('密钥文件与 config.json 完全分离', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'desk-secret-'));
  const secretFile = path.join(dir, 'secrets.json');
  const configFile = path.join(dir, 'config.json');
  const store = new SecretStore({ file: secretFile, safeStorage: null });
  const config = new Config({ file: configFile });
  store.set('ai.apiKey', 'sk-separated');
  config.update({ ai: { apiKey: 'sk-separated' } });
  assert.equal(fs.readFileSync(configFile, 'utf8').includes('sk-separated'), false);
  assert.equal(store.get('ai.apiKey'), 'sk-separated');
});

test('maskSecret 不泄漏中段', () => {
  assert.equal(maskSecret(''), '');
  assert.equal(maskSecret('abc'), '***');
  assert.equal(maskSecret('sk-1234567890abcd'), 'sk-1*********abcd');
});

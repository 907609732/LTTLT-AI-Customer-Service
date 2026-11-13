'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { Config, ConfigError, CURRENT_VERSION } = require('../src/main/config');

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'desk-config-'));
}

test('首次启动写入默认配置并带当前版本', () => {
  const file = path.join(tempDir(), 'config.json');
  const config = new Config({ file });
  const value = config.get();
  assert.equal(value.version, CURRENT_VERSION);
  assert.equal(value.reply.maxInflight, 6);
  assert.equal(value.ai.baseUrl, '');
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(raw.version, CURRENT_VERSION);
});

test('update 校验后落盘，重新加载保持一致', () => {
  const file = path.join(tempDir(), 'config.json');
  const config = new Config({ file });
  config.update({ reply: { maxInflight: 3 }, log: { level: 'debug' } });
  const reloaded = new Config({ file });
  assert.equal(reloaded.get().reply.maxInflight, 3);
  assert.equal(reloaded.get().log.level, 'debug');
});

test('非法配置抛 ConfigError 且不落盘', () => {
  const file = path.join(tempDir(), 'config.json');
  const config = new Config({ file });
  assert.throws(() => config.update({ reply: { maxInflight: 0 } }), ConfigError);
  const reloaded = new Config({ file });
  assert.equal(reloaded.get().reply.maxInflight, 6);
});

test('迁移：无版本旧配置升到 v1，并剥离明文 apiKey', () => {
  const file = path.join(tempDir(), 'config.json');
  fs.writeFileSync(
    file,
    JSON.stringify({ ai: { apiKey: 'sk-plain-secret', model: 'legacy-model' }, reply: { maxInflight: 2 } }),
    'utf8',
  );
  const config = new Config({ file });
  assert.equal(config.get().version, CURRENT_VERSION);
  assert.equal(config.get().ai.model, 'legacy-model');
  assert.equal(config.get().reply.maxInflight, 2);
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(raw.ai.apiKey, undefined);
  assert.equal(JSON.stringify(raw).includes('sk-plain-secret'), false);
});

test('update 传入 apiKey 会被剥离，绝不写进 config.json', () => {
  const file = path.join(tempDir(), 'config.json');
  const config = new Config({ file });
  config.update({ ai: { apiKey: 'sk-should-not-persist' } });
  const raw = fs.readFileSync(file, 'utf8');
  assert.equal(raw.includes('sk-should-not-persist'), false);
  assert.equal(JSON.parse(raw).ai.apiKey, undefined);
});

test('AI 配置：端点/模型/温度/超时/提示词可更新并校验', () => {
  const file = path.join(tempDir(), 'config.json');
  const config = new Config({ file });
  config.update({
    ai: {
      baseUrl: 'http://127.0.0.1:11434/v1',
      model: 'qwen2.5:7b-instruct',
      temperature: 0.7,
      timeoutMs: 45000,
      systemPrompt: '你是客服。',
    },
  });

  const reloaded = new Config({ file }).get();
  assert.equal(reloaded.ai.baseUrl, 'http://127.0.0.1:11434/v1');
  assert.equal(reloaded.ai.model, 'qwen2.5:7b-instruct');
  assert.equal(reloaded.ai.temperature, 0.7);
  assert.equal(reloaded.ai.timeoutMs, 45000);
  assert.equal(reloaded.ai.systemPrompt, '你是客服。');
  // 未提交的字段保持不变
  assert.equal(reloaded.ai.maxTokens, 512);
  assert.equal(reloaded.ai.provider, 'openai');

  assert.throws(() => config.update({ ai: { temperature: 2.1 } }), ConfigError);
  assert.throws(() => config.update({ ai: { temperature: Number.NaN } }), ConfigError);
  assert.throws(() => config.update({ ai: { timeoutMs: 500 } }), ConfigError);
  assert.throws(() => config.update({ ai: { model: '' } }), ConfigError);
  assert.throws(() => config.update({ ai: { systemPrompt: 'x'.repeat(8001) } }), ConfigError);

  const after = new Config({ file }).get();
  assert.equal(after.ai.temperature, 0.7);
  assert.equal(after.ai.timeoutMs, 45000);
});

test('配置版本高于程序版本时拒绝加载，避免旧版写坏新配置', () => {
  const file = path.join(tempDir(), 'config.json');
  fs.writeFileSync(file, JSON.stringify({ version: CURRENT_VERSION + 1 }), 'utf8');
  assert.throws(() => new Config({ file }), (err) => {
    assert.ok(err instanceof ConfigError);
    assert.match(err.message, /config_version_ahead/);
    return true;
  });
});

test('第二阶段默认项：补回窗口、发送节奏、手动回复关键词、隐私开关', () => {
  const file = path.join(tempDir(), 'config.json');
  const value = new Config({ file }).get();
  assert.equal(value.reply.recoverWindowMs, 600000);
  assert.equal(value.reply.perUidMinIntervalMs, 60000);
  assert.equal(value.reply.sendJitterMinMs, 500);
  assert.equal(value.reply.sendJitterMaxMs, 2000);
  assert.equal(value.reply.perStorePerMinuteMax, 20);
  assert.deepEqual(value.safety.manualReplyKeywords, []);
  assert.equal(value.privacy.maskPii, false);
  assert.equal(value.monitor.pollIntervalMs, 1500);
});

test('新增配置项可更新并校验范围', () => {
  const file = path.join(tempDir(), 'config.json');
  const config = new Config({ file });
  config.update({
    reply: { recoverWindowMs: 120000, perUidMinIntervalMs: 0, perStorePerMinuteMax: 5 },
    safety: { manualReplyKeywords: ['我来', '转人工'] },
    privacy: { maskPii: true },
    monitor: { pollIntervalMs: 2000 },
  });
  const reloaded = new Config({ file }).get();
  assert.equal(reloaded.reply.recoverWindowMs, 120000);
  assert.equal(reloaded.reply.perUidMinIntervalMs, 0);
  assert.equal(reloaded.reply.perStorePerMinuteMax, 5);
  assert.deepEqual(reloaded.safety.manualReplyKeywords, ['我来', '转人工']);
  assert.equal(reloaded.privacy.maskPii, true);
  assert.equal(reloaded.monitor.pollIntervalMs, 2000);

  assert.throws(() => config.update({ reply: { recoverWindowMs: -1 } }), ConfigError);
  assert.throws(() => config.update({ privacy: { maskPii: 'yes' } }), ConfigError);
  assert.throws(() => config.update({ safety: { manualReplyKeywords: [''] } }), ConfigError);
  assert.throws(() => config.update({ monitor: { pollIntervalMs: 100 } }), ConfigError);
});


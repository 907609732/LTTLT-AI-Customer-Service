'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { ClientLauncher, defaultRegistryInstallDirs } = require('../src/main/client-launcher');

function tempRoot(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'desk-launcher-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

/** 构造 <root>/install/1.2.3/doudian.exe 与 install/launcher_config.json。 */
function makeInstall(t) {
  const root = tempRoot(t);
  const installDir = path.join(root, 'install');
  const versionDir = path.join(installDir, '1.2.3');
  fs.mkdirSync(versionDir, { recursive: true });
  fs.writeFileSync(path.join(versionDir, 'doudian.exe'), '');
  const configPath = path.join(installDir, 'launcher_config.json');
  fs.writeFileSync(configPath, JSON.stringify({ app_name: 'doudian', cur_path: '1.2.3' }));
  return { root, installDir, versionDir, configPath, expectedExe: path.join(versionDir, 'doudian.exe') };
}

function makeLauncher(overrides = {}) {
  return new ClientLauncher({
    logger: null,
    registryReader: () => [],
    standardRoots: [],
    launcherConfigPath: null,
    // 单测不触碰真实进程：默认视为未运行。
    isProcessRunning: async () => false,
    killProcess: async () => false,
    ...overrides,
  });
}

test('注册表 InstallDir 按 GBK 解码中文安装路径', () => {
  // reg query 输出为 GBK；按 utf8 解码会把「抖店工作台」变成乱码导致路径不存在。
  const gbkName = Buffer.from([0xb6, 0xb6, 0xb5, 0xea, 0xb9, 0xa4, 0xd7, 0xf7, 0xcc, 0xa8]);
  const output = Buffer.concat([
    Buffer.from('    InstallDir    REG_SZ    E:\\', 'ascii'),
    gbkName,
    Buffer.from('\r\n', 'ascii'),
  ]);
  const dirs = defaultRegistryInstallDirs({
    platform: 'win32',
    execFileSyncImpl: () => output,
  });
  assert.deepEqual(dirs, ['E:\\抖店工作台']);
});

test('发现安装目录：launcher_config.json 的 cur_path 指向版本目录', (t) => {
  const { configPath, expectedExe } = makeInstall(t);
  const launcher = makeLauncher({ launcherConfigPath: configPath });
  const found = launcher.discover();
  assert.ok(found);
  assert.equal(found.exePath, expectedExe);
  assert.equal(found.source, 'launcher_config');
});

test('发现安装目录：标准路径根目录内读取 launcher_config.json 并回退版本子目录', (t) => {
  const { installDir, expectedExe } = makeInstall(t);
  const launcher = makeLauncher({ standardRoots: [installDir] });
  const found = launcher.discover();
  assert.ok(found);
  assert.equal(found.exePath, expectedExe);
  assert.equal(found.source, 'standard_path');
});

test('发现安装目录：cur_path 失效时回退扫描版本子目录', (t) => {
  const { installDir, versionDir } = makeInstall(t);
  fs.writeFileSync(path.join(installDir, 'launcher_config.json'), JSON.stringify({ cur_path: '9.9.9' }));
  const found = makeLauncher({ standardRoots: [installDir] }).discover();
  assert.ok(found);
  assert.equal(found.exePath, path.join(versionDir, 'doudian.exe'));
});

test('非 doudian-client 平台直接拒绝，不触碰进程与安装目录', async () => {
  let spawned = false;
  let killed = false;
  const launcher = makeLauncher({
    spawnImpl: () => {
      spawned = true;
      return { pid: 1, unref() {} };
    },
    killProcess: async () => {
      killed = true;
      return true;
    },
  });
  const store = { platform: 'pdd-web' };
  assert.deepEqual(await launcher.launch(store), { ok: false, reason: 'unsupported_platform' });
  assert.deepEqual(await launcher.restart(store), { ok: false, reason: 'unsupported_platform' });
  assert.deepEqual(await launcher.ensureRunning(store), { ok: false, reason: 'unsupported_platform' });
  assert.equal(spawned, false);
  assert.equal(killed, false);
});

test('找不到客户端时返回受控错误，不抛异常', async () => {
  const missing = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'desk-launcher-')), 'missing');
  const launcher = makeLauncher({
    launcherConfigPath: path.join(missing, 'launcher_config.json'),
  });
  const store = { platform: 'doudian-client' };
  assert.equal(launcher.discover(), null);
  assert.deepEqual(await launcher.launch(store), { ok: false, reason: 'client_not_found' });
  assert.deepEqual(await launcher.restart(store), { ok: false, reason: 'client_not_found' });
  assert.deepEqual(await launcher.ensureRunning(store), {
    ok: false,
    reason: 'client_not_found',
    running: false,
    launched: false,
  });
});

test('restart 顺序：先 kill，再轮询等待退出，最后 launch', async (t) => {
  const { configPath, expectedExe } = makeInstall(t);
  const calls = [];
  const launcher = makeLauncher({
    launcherConfigPath: configPath,
    killProcess: async () => {
      calls.push('kill');
      return true;
    },
    isProcessRunning: async () => {
      calls.push('probe');
      return false;
    },
    spawnImpl: (exePath, args, options) => {
      calls.push('spawn');
      assert.equal(exePath, expectedExe);
      assert.deepEqual(args, []);
      assert.equal(options.detached, true);
      assert.equal(options.stdio, 'ignore');
      assert.equal(options.cwd, path.dirname(expectedExe));
      return { pid: 4321, unref() {} };
    },
  });

  const result = await launcher.restart({ platform: 'doudian-client' });
  assert.deepEqual(calls, ['kill', 'probe', 'spawn']);
  assert.deepEqual(result, {
    ok: true,
    killed: true,
    launched: true,
    exePath: expectedExe,
  });
});

test('ensureRunning：已运行时不重启、不启动', async (t) => {
  const { configPath } = makeInstall(t);
  let spawned = 0;
  const launcher = makeLauncher({
    launcherConfigPath: configPath,
    isProcessRunning: async () => true,
    spawnImpl: () => {
      spawned += 1;
      return { pid: 1, unref() {} };
    },
  });
  const result = await launcher.ensureRunning({ platform: 'doudian-client' });
  assert.deepEqual(result, { ok: true, running: true, launched: false });
  assert.equal(spawned, 0);
});

test('ensureRunning：未运行时执行 launch', async (t) => {
  const { configPath, expectedExe } = makeInstall(t);
  const launcher = makeLauncher({
    launcherConfigPath: configPath,
    isProcessRunning: async () => false,
    spawnImpl: () => ({ pid: 99, unref() {} }),
  });
  const result = await launcher.ensureRunning({ platform: 'doudian-client' });
  assert.equal(result.ok, true);
  assert.equal(result.launched, true);
  assert.equal(result.exePath, expectedExe);
});


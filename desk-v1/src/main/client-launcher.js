'use strict';
/**
 * 抖店客户端启动器：只负责「发现安装位置 / 启动 / 重启」。
 *
 * 红线约束：
 * - 只读安装目录，不写入、不替换、不备份客户端任何文件。
 * - 只按镜像名 doudian.exe 结束进程，绝不按 PID 误杀。
 * - 日志里不出现完整安装路径；只记录文件名与固定命令。
 *
 * 该模块只服务 doudian-client 平台；其他平台一律返回 unsupported_platform。
 */
const fs = require('node:fs');
const path = require('node:path');
const { execFile, execFileSync, spawn } = require('node:child_process');
const { promisify } = require('node:util');

const PROCESS_NAME = 'doudian.exe';
const PLATFORM_ID = 'doudian-client';
const EXE_NAMES = Object.freeze(['doudian.exe', '抖店工作台.exe']);
const LAUNCHER_CONFIG_NAME = 'launcher_config.json';

const REGISTRY_KEYS = Object.freeze([
  'HKCU\\SOFTWARE\\ByteDance\\抖店工作台',
  'HKLM\\SOFTWARE\\ByteDance\\抖店工作台',
  'HKLM\\SOFTWARE\\WOW6432Node\\ByteDance\\抖店工作台',
]);

/** Windows 控制台输出常为 GBK/OEM 编码；直接按 utf8 解会把中文安装路径变成乱码。 */
function decodeConsoleOutput(raw) {
  if (!Buffer.isBuffer(raw)) return String(raw || '');
  try {
    return new TextDecoder('gbk').decode(raw);
  } catch {
    return raw.toString('utf8');
  }
}

/** 从注册表读 InstallDir；只读查询，失败一律返回空数组。 */
function defaultRegistryInstallDirs({ execFileSyncImpl = execFileSync, platform = process.platform } = {}) {
  if (platform !== 'win32') return [];
  const dirs = [];
  for (const key of REGISTRY_KEYS) {
    try {
      const raw = execFileSyncImpl('reg', ['query', key, '/v', 'InstallDir'], {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      const out = decodeConsoleOutput(raw);
      const match = out.match(/InstallDir\s+REG_SZ\s+(.+)/i);
      if (match) dirs.push(match[1].trim());
    } catch {
      /* 键不存在或权限不足：继续尝试下一项 */
    }
  }
  return [...new Set(dirs.filter(Boolean))];
}

/**
 * 标准安装位置：三个系统目录下的 ByteDance 子目录 + D:\抖店工作台。
 * ByteDance 只枚举一层应用目录，具体 exe 由 findExeInDir 再解析。
 */
function defaultStandardRoots({
  env = process.env,
  fsImpl = fs,
  platform = process.platform,
} = {}) {
  if (platform !== 'win32') return [];
  const roots = [];
  for (const base of [env.ProgramFiles, env['ProgramFiles(x86)'], env.LOCALAPPDATA]) {
    if (!base) continue;
    const byteDance = path.join(base, 'ByteDance');
    let entries = [];
    try {
      entries = fsImpl.readdirSync(byteDance, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) roots.push(path.join(byteDance, entry.name));
    }
  }
  // 安装盘符不固定（常被装到非系统盘），逐个盘符探测常见目录。
  for (let code = 65; code <= 90; code += 1) {
    const drive = `${String.fromCharCode(code)}:\\`;
    try {
      if (!fsImpl.existsSync(drive)) continue;
    } catch {
      continue;
    }
    roots.push(path.join(drive, '抖店工作台'));
    roots.push(path.join(drive, 'doudian'));
    roots.push(path.join(drive, 'Program Files', 'ByteDance'));
    roots.push(path.join(drive, 'Program Files (x86)', 'ByteDance'));
  }
  return [...new Set(roots)];
}

function isFile(fsImpl, filePath) {
  try {
    return fsImpl.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function readLauncherConfig(fsImpl, filePath) {
  try {
    const parsed = JSON.parse(fsImpl.readFileSync(filePath, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

class ClientLauncher {
  constructor({
    logger = null,
    platformId = PLATFORM_ID,
    processName = PROCESS_NAME,
    registryReader = null,
    launcherConfigPath = null,
    standardRoots = null,
    fsImpl = fs,
    execFileImpl = null,
    spawnImpl = spawn,
    isProcessRunning = null,
    killProcess = null,
    now = Date.now,
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    killTimeoutMs = 15000,
    pollIntervalMs = 300,
  } = {}) {
    this.logger = logger;
    this.platformId = platformId;
    this.processName = processName;
    this.fs = fsImpl;
    this.launcherConfigPath = launcherConfigPath || null;
    this.registryReader = registryReader || (() => defaultRegistryInstallDirs({ fsImpl }));
    this.standardRoots = standardRoots || defaultStandardRoots({ fsImpl });
    this.execFile = execFileImpl || promisify(execFile);
    this.spawn = spawnImpl;
    this.now = now;
    this.sleep = sleep;
    this.killTimeoutMs = Math.max(0, Number(killTimeoutMs) || 0);
    this.pollIntervalMs = Math.max(1, Number(pollIntervalMs) || 1);
    this.isProcessRunning = isProcessRunning || (() => this.#probeProcess());
    this.killProcess = killProcess || (() => this.#taskkill());
  }

  #supported(store) {
    return !!store && store.platform === this.platformId;
  }

  /** 只在日志里出现文件名，避免泄露安装路径。 */
  #safeExeName(exePath) {
    return path.basename(String(exePath || '')) || '<unknown>';
  }

  #readConfig(configPath) {
    return readLauncherConfig(this.fs, configPath);
  }

  #directExe(dir) {
    for (const name of EXE_NAMES) {
      const exePath = path.join(dir, name);
      if (isFile(this.fs, exePath)) return exePath;
    }
    return null;
  }

  /**
   * 在目录中找 exe：优先 launcher_config.json 的 cur_path（客户端真正的版本目录），
   * 再看目录本身，最后按版本子目录倒序探测（客户端升级后会留下多个版本目录）。
   * 安装根目录的「抖店工作台.exe」是更新/引导器，不能优先于版本目录里的 doudian.exe。
   */
  #findExeInDir(dir) {
    if (!dir) return null;

    const config = this.#readConfig(path.join(dir, LAUNCHER_CONFIG_NAME));
    const curPath = config && typeof config.cur_path === 'string' ? config.cur_path.trim() : '';
    if (curPath) {
      const versionDir = path.resolve(dir, curPath);
      const versioned = this.#directExe(versionDir);
      if (versioned) return versioned;
    }

    const direct = this.#directExe(dir);
    if (direct) return direct;

    let entries = [];
    try {
      entries = this.fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return null;
    }
    const versionDirs = entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort()
      .reverse();
    for (const name of versionDirs) {
      const found = this.#directExe(path.join(dir, name));
      if (found) return found;
    }
    return null;
  }

  /**
   * 发现安装位置。顺序：注册表 InstallDir → launcher_config.json 的 cur_path → 标准路径。
   * 返回 { exePath, installDir, source }；找不到返回 null。
   */
  discover() {
    const seen = new Set();
    const candidates = [];

    for (const dir of this.registryReader() || []) {
      if (dir) candidates.push({ dir, source: 'registry' });
    }

    if (this.launcherConfigPath) {
      const resolved = path.resolve(this.launcherConfigPath);
      candidates.push({ dir: path.dirname(resolved), source: 'launcher_config', configPath: resolved });
    }

    for (const dir of this.standardRoots || []) {
      if (dir) candidates.push({ dir, source: 'standard_path' });
    }

    for (const candidate of candidates) {
      const key = path.resolve(candidate.dir).toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);

      let exePath = null;
      if (candidate.configPath) {
        // 显式配置优先直接解析 cur_path，配置损坏时再退回目录探测。
        const config = this.#readConfig(candidate.configPath);
        const curPath = config && typeof config.cur_path === 'string' ? config.cur_path.trim() : '';
        if (curPath) {
          const versionDir = path.resolve(path.dirname(candidate.configPath), curPath);
          exePath = this.#directExe(versionDir);
          if (exePath) {
            return { exePath, installDir: path.dirname(versionDir), source: candidate.source };
          }
        }
      }
      exePath = this.#findExeInDir(candidate.dir);
      if (exePath) {
        return { exePath, installDir: path.dirname(exePath), source: candidate.source };
      }
    }
    return null;
  }

  async #probeProcess() {
    try {
      const { stdout } = await this.execFile(
        'tasklist',
        ['/FI', `IMAGENAME eq ${this.processName}`, '/FO', 'CSV', '/NH'],
        { windowsHide: true },
      );
      return String(stdout || '').toLowerCase().includes(this.processName.toLowerCase());
    } catch {
      // 无法确认时按「未运行」处理，避免阻塞用户手动启动。
      return false;
    }
  }

  /** 只按镜像名结束进程；命令参数用数组传入，不走 shell。 */
  async #taskkill() {
    try {
      await this.execFile('taskkill', ['/IM', this.processName, '/F'], { windowsHide: true });
      this.logger?.info(`已请求结束客户端进程 ${this.processName}`);
      return true;
    } catch {
      this.logger?.debug(`客户端进程未运行或结束失败：${this.processName}`);
      return false;
    }
  }

  #spawn(exePath) {
    try {
      const child = this.spawn(exePath, [], {
        cwd: path.dirname(exePath),
        detached: true,
        stdio: 'ignore',
        windowsHide: false,
      });
      // spawn 的 ENOENT/EACCES 是异步 error 事件，不监听会变成未捕获异常。
      if (child && typeof child.once === 'function') {
        child.once('error', (err) => {
          this.logger?.warn(`客户端启动失败 ${this.#safeExeName(exePath)}（${err?.code || 'error'}）`);
        });
      }
      if (child && typeof child.unref === 'function') child.unref();
      this.logger?.info(`已启动客户端 ${this.#safeExeName(exePath)}`);
      return { ok: true, launched: true, exePath, pid: child?.pid ?? null };
    } catch {
      // 不把底层错误直接抛给渲染层；文案由调用方统一处理。
      this.logger?.warn(`客户端启动失败 ${this.#safeExeName(exePath)}`);
      return { ok: false, launched: false, exePath, reason: 'launch_failed' };
    }
  }

  async launch(store) {
    if (!this.#supported(store)) return { ok: false, reason: 'unsupported_platform' };
    const found = this.discover();
    if (!found) {
      this.logger?.warn('未找到抖店客户端安装位置');
      return { ok: false, reason: 'client_not_found' };
    }
    return this.#spawn(found.exePath);
  }

  async #waitForExit() {
    const deadline = this.now() + this.killTimeoutMs;
    for (;;) {
      if (!(await this.isProcessRunning())) return true;
      if (this.now() >= deadline) break;
      await this.sleep(Math.min(this.pollIntervalMs, Math.max(0, deadline - this.now())));
    }
    return !(await this.isProcessRunning());
  }

  async restart(store) {
    if (!this.#supported(store)) return { ok: false, reason: 'unsupported_platform' };
    const found = this.discover();
    if (!found) {
      this.logger?.warn('未找到抖店客户端安装位置，无法重启');
      return { ok: false, reason: 'client_not_found' };
    }

    const killed = await this.killProcess();
    const stopped = await this.#waitForExit();
    if (!stopped) {
      this.logger?.warn(`客户端未在时限内退出，放弃重启 ${this.processName}`);
      return { ok: false, killed, launched: false, exePath: found.exePath, reason: 'client_not_stopped' };
    }

    const launched = this.#spawn(found.exePath);
    return {
      ok: launched.ok,
      killed,
      launched: launched.launched,
      exePath: found.exePath,
      ...(launched.ok ? {} : { reason: launched.reason }),
    };
  }

  /** 打开店铺时调用：未运行就启动，已运行则保持不动（绝不自动重启）。 */
  async ensureRunning(store) {
    if (!this.#supported(store)) return { ok: false, reason: 'unsupported_platform' };
    let running = false;
    try {
      running = !!(await this.isProcessRunning());
    } catch {
      running = false;
    }
    if (running) return { ok: true, running: true, launched: false };
    const result = await this.launch(store);
    return { ...result, running: false, launched: !!result.ok };
  }
}

module.exports = {
  ClientLauncher,
  PROCESS_NAME,
  PLATFORM_ID,
  EXE_NAMES,
  defaultRegistryInstallDirs,
  defaultStandardRoots,
};

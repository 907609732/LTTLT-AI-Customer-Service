import { spawn } from 'node:child_process'
import electron from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

// electron.exe 在 Windows 的管道输出可能被缓冲；验收以退出码和报告为准。
const env = { ...process.env }
// Slow local machines may opt into a bounded longer harness deadline; CI keeps 180s.
// This does not change individual checks, request timeouts or production behavior.
const timeoutMs = Number(process.env.LINGTU_DESKTOP_TIMEOUT_MS || 180000)
if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 180000 || timeoutMs > 600000)
  throw new Error('LINGTU_DESKTOP_TIMEOUT_MS 必须为 180000～600000 的整数毫秒')
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'yunduo-smoke-'))
env.YUNDUO_SMOKE_DATA_DIR = tempRoot
delete env.ELECTRON_RUN_AS_NODE
const child = spawn(electron, ['dist-electron/smoke.cjs'], {
  stdio: 'inherit',
  env,
  windowsHide: true,
})
const timer = setTimeout(() => {
  child.kill()
  process.exitCode = 1
  console.error(`桌面验收超过 ${timeoutMs / 1000} 秒，已停止本次测试进程`)
}, timeoutMs)
child.on('error', (error) => {
  clearTimeout(timer)
  console.error(error)
  process.exitCode = 1
})
child.on('exit', (code) => {
  clearTimeout(timer)
  // 只清理由本脚本创建且确定位于系统临时目录中的隔离工作区。
  if (
    path.dirname(path.resolve(tempRoot)) === path.resolve(os.tmpdir()) &&
    path.basename(tempRoot).startsWith('yunduo-smoke-')
  ) {
    fs.rmSync(tempRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
  process.exitCode = code ?? 1
})

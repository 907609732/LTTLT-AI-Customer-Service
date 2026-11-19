import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const root = fileURLToPath(new URL('../', import.meta.url))
const electron: unknown = createRequire(import.meta.url)('electron')
assert.ok(typeof electron === 'string', '未找到本项目的 Electron 可执行文件')
const executable = electron
const [deliveryArg, ...rest] = process.argv.slice(2)
assert.ok(deliveryArg && !rest.length, '用法：npm run verify:qianniu-offline -- <交付目录>')
const deliveryDir = await fs.realpath(path.resolve(deliveryArg))
const bundles = path.join(root, 'dist-electron')
const output = path.join(root, 'artifacts', `qianniu-offline-${Date.now()}`)
await fs.access(path.join(root, 'dist', 'index.html'))
await fs.access(path.join(bundles, 'preload.cjs'))
await fs.mkdir(output, { recursive: true })

// Keep the check out of normal entry points and installation bundles.
const file = path.join(bundles, 'qianniu-offline-check.cjs')
await build({
  absWorkingDir: root,
  entryPoints: ['electron/qianniu-offline-check.ts'],
  outfile: file,
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  external: ['electron', 'pdfjs-dist', 'mammoth', 'read-excel-file', '@napi-rs/canvas'],
})
const tmp = path.resolve(await fs.realpath(os.tmpdir()))
const isolatedRoot = path.resolve(await fs.mkdtemp(path.join(tmp, 'lingtu-qianniu-offline-')))
try {
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  delete env.VITE_DEV_SERVER_URL
  console.log(`离线报告：${output}`)
  await new Promise<void>((resolve, reject) => {
    const child = spawn(executable, [file, isolatedRoot, deliveryDir, output], {
      cwd: root,
      stdio: 'inherit',
      env,
      windowsHide: true,
    })
    const timer = setTimeout(() => child.kill(), 120000)
    child.once('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.once('exit', (code) => {
      clearTimeout(timer)
      if (code === 0) resolve()
      else reject(Error(`千牛离线验收失败：${code ?? '超时或进程终止'}，报告：${output}`))
    })
  })
} finally {
  assert.equal(path.dirname(isolatedRoot), tmp)
  assert.ok(path.basename(isolatedRoot).startsWith('lingtu-qianniu-offline-'))
  await fs.rm(isolatedRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
}

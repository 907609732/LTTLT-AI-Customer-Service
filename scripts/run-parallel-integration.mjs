import { build } from 'esbuild'
import electron from 'electron'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { createHash } from 'node:crypto'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lingtu-parallel-'))
// Reuse an installed official runtime only if its executable is byte-identical to the locked dependency.
const installed = path.join(
  process.env.LOCALAPPDATA || '',
  'LingtuRuntime',
  'electron-43.8.9',
  'electron.exe',
)
const sha = (file) => createHash('sha256').update(fs.readFileSync(file)).digest('hex')
const executable = process.argv.includes('--project-runtime')
  ? electron
  : fs.existsSync(installed) && sha(installed) === sha(electron)
    ? installed
    : electron
const output = path.resolve('artifacts/parallel-integration')
fs.mkdirSync(output, { recursive: true })
fs.writeFileSync(path.join(output, 'isolated-root.txt'), root)
await build({
  entryPoints: ['electron/parallel-integration-check.ts'],
  outfile: 'dist-electron/parallel-integration-check.cjs',
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  external: ['electron'],
})
for (const phase of ['setup', 'restart', 'scheduler-restart']) {
  const env = { ...process.env, LINGTU_PARALLEL_CHECK_DIR: root }
  delete env.ELECTRON_RUN_AS_NODE
  delete env.VITE_DEV_SERVER_URL
  const code = await new Promise((resolve, reject) => {
    const child = spawn(
      executable,
      ['dist-electron/parallel-integration-check.cjs', `--parallel-phase=${phase}`],
      { env, windowsHide: true, stdio: 'inherit' },
    )
    const timer = setTimeout(() => {
      child.kill()
      reject(Error(`${phase}隔离桌面验收超时`))
    }, 180000)
    child.once('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.once('exit', (code) => {
      clearTimeout(timer)
      resolve(code)
    })
  })
  if (code !== 0) throw Error(`${phase}隔离桌面验收失败，退出码${code}`)
}
console.log('三次独立Electron进程验收完成；合成数据目录已记录，供核对证据。')

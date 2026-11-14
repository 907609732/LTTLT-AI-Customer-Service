// Scoped adaptation of run-desktop.mjs/build-electron.mjs: never overwrite shared dist outputs.
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import electron from 'electron'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const output = path.join(root, 'artifacts', 'knowledge-electron')
const vendorLink = path.join(output, 'vendor')
fs.mkdirSync(path.join(output, 'dist-electron'), { recursive: true })
if (!fs.existsSync(vendorLink))
  fs.symlinkSync(
    path.join(root, 'vendor'),
    vendorLink,
    process.platform === 'win32' ? 'junction' : 'dir',
  )
if (fs.realpathSync(vendorLink) !== fs.realpathSync(path.join(root, 'vendor')))
  throw new Error('验收 vendor 路径不匹配')

async function run(command, args, timeoutMs) {
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  delete env.VITE_DEV_SERVER_URL
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, env, stdio: 'inherit', windowsHide: true })
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error('知识专项验收进程超时'))
    }, timeoutMs)
    child.once('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.once('exit', (code) => {
      clearTimeout(timer)
      if (code === 0) resolve()
      else reject(new Error(`专项命令退出码 ${code}`))
    })
  })
}

// Unminified ESNext is supported by the installed Electron; avoids the current Windows
// large-response esbuild temp-file removal failure without changing release build settings.
if (!process.argv.includes('--reuse-renderer'))
  await run(
    process.execPath,
    [
      path.join(root, 'node_modules/vite/bin/vite.js'),
      'build',
      '--outDir',
      path.join(output, 'dist'),
      '--target',
      'esnext',
      '--minify',
      'false',
    ],
    120000,
  )
if (!fs.existsSync(path.join(output, 'dist/index.html'))) throw new Error('请先构建隔离验收界面')
await build({
  absWorkingDir: root,
  entryPoints: {
    'knowledge-electron-check': 'electron/knowledge-electron-check.ts',
    preload: 'electron/preload.ts',
  },
  outdir: path.join(output, 'dist-electron'),
  outExtension: { '.js': '.cjs' },
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  external: ['electron'],
  sourcemap: true,
})
const electronVersion = createRequire(import.meta.url)('electron/package.json').version
const installedRuntime = process.env.LOCALAPPDATA
  ? path.join(
      process.env.LOCALAPPDATA,
      'LingtuRuntime',
      `electron-${electronVersion}`,
      'electron.exe',
    )
  : ''
const hash = (file) => createHash('sha256').update(fs.readFileSync(file)).digest('hex')
// This machine already runs the same Electron distribution outside its UVCS work volume.
// Reuse it only when the executable hash matches the project's installed version.
const executable =
  installedRuntime && fs.existsSync(installedRuntime) && hash(installedRuntime) === hash(electron)
    ? installedRuntime
    : electron
console.log('Knowledge acceptance Electron:', executable)
await run(executable, [path.join(output, 'dist-electron/knowledge-electron-check.cjs')], 190000)

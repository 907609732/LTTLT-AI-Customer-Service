import { build } from 'esbuild'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import electron from 'electron'
const root = process.cwd(),
  output = path.join(root, 'artifacts/knowledge-manager-check')
fs.mkdirSync(output, { recursive: true })
const link = path.join(output, 'vendor')
if (!fs.existsSync(link)) fs.symlinkSync(path.join(root, 'vendor'), link, 'junction')
if (fs.realpathSync(link) !== fs.realpathSync(path.join(root, 'vendor')))
  throw Error('invalid vendor path')
const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE
delete env.VITE_DEV_SERVER_URL
async function run(executable, args) {
  await new Promise((resolve, reject) => {
    const child = spawn(executable, args, { cwd: root, env, stdio: 'inherit', windowsHide: true })
    const timer = setTimeout(() => {
      child.kill()
      reject(Error('knowledge manager check timeout'))
    }, 150000)
    child.once('error', reject)
    child.once('exit', (code) => {
      clearTimeout(timer)
      if (code === 0) resolve()
      else reject(Error('exit ' + code))
    })
  })
}
if (!process.argv.includes('--reuse-renderer'))
  await run(process.execPath, [
    'node_modules/vite/bin/vite.js',
    'build',
    '--outDir',
    path.join(output, 'dist'),
  ])
await build({
  entryPoints: {
    'knowledge-manager-check': 'electron/knowledge-manager-check.ts',
    preload: 'electron/preload.ts',
  },
  outdir: path.join(output, 'dist-electron'),
  outExtension: { '.js': '.cjs' },
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  external: ['electron'],
})
const version = createRequire(import.meta.url)('electron/package.json').version
const installed = path.join(
  process.env.LOCALAPPDATA || '',
  'LingtuRuntime',
  `electron-${version}`,
  'electron.exe',
)
const hash = (file) => createHash('sha256').update(fs.readFileSync(file)).digest('hex')
const executable =
  fs.existsSync(installed) && hash(installed) === hash(electron) ? installed : electron
let failure
try {
  await run(executable, [
    path.join(output, 'dist-electron/knowledge-manager-check.cjs'),
    ...(process.argv.includes('--inline-progress-only') ? ['--inline-progress-only'] : []),
  ])
} catch (error) {
  failure = error
}
{
  const record = path.join(output, 'evidence/cleanup.json')
  if (fs.existsSync(record)) {
    const directory = path.resolve(JSON.parse(fs.readFileSync(record, 'utf8')).directory)
    if (
      path.dirname(directory) !== path.resolve(os.tmpdir()) ||
      !path.basename(directory).startsWith('knowledge-manager-check-')
    )
      throw Error('unsafe cleanup path')
    fs.rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
  }
}

if (failure) throw failure

import { build } from 'esbuild'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import assert from 'node:assert/strict'
import path from 'node:path'
import electron from 'electron'
import { createHash } from 'node:crypto'

const installed = path.join(
  process.env.LOCALAPPDATA || '',
  'LingtuRuntime',
  'electron-43.8.9',
  'electron.exe',
)
const sha = (file) => createHash('sha256').update(fs.readFileSync(file)).digest('hex')
const executable =
  fs.existsSync(installed) && sha(installed) === sha(electron) ? installed : electron

const output = path.resolve('artifacts/reporting-isolated')
fs.mkdirSync(output, { recursive: true })
const root = fs.mkdtempSync(path.join(output, 'workspace-'))
await build({
  entryPoints: ['electron/reporting-isolated-check.ts'],
  outfile: 'dist-electron/reporting-isolated-check.cjs',
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  external: ['electron'],
})
try {
  for (const stage of ['a-first', 'b', 'a-restart']) {
    const env = {
      ...process.env,
      LINGTU_REPORTING_CHECK_ROOT: root,
      LINGTU_REPORTING_CHECK_OUTPUT: output,
      LINGTU_REPORTING_CHECK_STAGE: stage,
    }
    delete env.ELECTRON_RUN_AS_NODE
    const code = await new Promise((resolve, reject) => {
      // This host terminates Chromium before app readiness with status 0x80000003 under its OS sandbox.
      // Synthetic check only: production settings are unchanged; OS sandbox security is not validated here.
      const child = spawn(
        executable,
        [
          ...(process.env.LINGTU_REPORTING_CHECK_NO_SANDBOX === '1' ? ['--no-sandbox'] : []),
          'dist-electron/reporting-isolated-check.cjs',
        ],
        { env, stdio: 'inherit', windowsHide: true },
      )
      const timer = setTimeout(() => {
        child.kill()
        reject(Error(`${stage} timed out`))
      }, 45000)
      child.on('error', (error) => {
        clearTimeout(timer)
        reject(error)
      })
      child.on('exit', (value) => {
        clearTimeout(timer)
        resolve(value)
      })
    })
    if (code !== 0) throw Error(`${stage} failed (${code}); see ${output}`)
    console.log(`${stage}: passed`)
  }
  const first = JSON.parse(fs.readFileSync(path.join(output, 'a-first.json'), 'utf8'))
  const restarted = JSON.parse(fs.readFileSync(path.join(output, 'a-restart.json'), 'utf8'))
  assert.equal(
    restarted.ledgerFingerprint,
    first.ledgerFingerprint,
    'Account B and process restart must not modify account A event evidence',
  )
  fs.writeFileSync(
    path.join(output, 'summary.json'),
    JSON.stringify(
      {
        passed: true,
        stages: 3,
        accountALedgerUnchangedAcrossAccountBAndProcessRestart: true,
        osSandboxDisabledForCheck: process.env.LINGTU_REPORTING_CHECK_NO_SANDBOX === '1',
      },
      null,
      2,
    ),
  )
} finally {
  // Only this runner's literal mkdtemp child of the dedicated artifact folder is removed.
  if (path.dirname(path.resolve(root)) === output && path.basename(root).startsWith('workspace-'))
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
}

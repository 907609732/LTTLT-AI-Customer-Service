import fs from 'node:fs'
import path from 'node:path'
import net from 'node:net'
import { randomBytes } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'

// Only instances created by this run are accepted. External database DSNs are
// deliberately ignored: the fixtures drop tables and must never reach business data.
const server = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const tools = process.env.LINGTU_DB_TOOLS_ROOT || 'E:/DeveloperTools/Databases'
const mysqlBin = path.join(tools, 'mysql-8.4.13-winx64', 'bin')
const pgBin = path.join(tools, 'postgresql-18.7-1', 'pgsql', 'bin')
const dataRoot =
  process.env.LINGTU_DB_TEST_ROOT ||
  path.join(process.env.LOCALAPPDATA || path.dirname(server), 'Lingtu', 'DatabaseMatrix')
fs.mkdirSync(dataRoot, { recursive: true })
const runDirectory = fs.mkdtempSync(path.join(dataRoot, 'run-'))
const artifact = path.join(server, 'artifacts', 'database-matrix')
fs.mkdirSync(artifact, { recursive: true })
const mysqlData = path.join(runDirectory, 'mysql')
const pgData = path.join(runDirectory, 'postgres')
const passwords = [randomBytes(24).toString('hex'), randomBytes(24).toString('hex')]
const [adminPassword, testPassword] = passwords
const focus = process.argv.find((arg) => arg.startsWith('--focus='))?.slice('--focus='.length)
const results: {
  name: string
  code: number
  passed: number
  skipped: number
  failures: string[]
}[] = []
let mysqlProcess: ChildProcess | undefined
let mysqlOwned = false
let postgresStarted = false
let mysqlPort = 0
let pgPort = 0
let cleaned = false
let stopped = false
const cleanupErrors: string[] = []
const mysqlInitFile = path.join(runDirectory, 'mysql-bootstrap.sql')
const mysqlPIDFile = path.join(runDirectory, 'mysql.pid')
const ownedPIDs = new Set<number>()
fs.writeFileSync(
  path.join(artifact, 'verification.json'),
  JSON.stringify({ status: 'running', runDirectory }) + '\n',
)

function redact(text: string): string {
  return passwords.reduce((value, secret) => value.replaceAll(secret, '[redacted]'), text)
}
function command(executable: string, args: string[], env: NodeJS.ProcessEnv = {}, input?: string) {
  return spawnSync(executable, args, {
    env: { ...process.env, ...env },
    encoding: 'utf8',
    input,
    windowsHide: true,
    maxBuffer: 128 * 1024 * 1024,
    timeout: 600000,
  })
}
function checked(
  executable: string,
  args: string[],
  env: NodeJS.ProcessEnv = {},
  input?: string,
): string {
  const result = command(executable, args, env, input)
  if (result.error || result.status !== 0) {
    throw new Error(
      redact(
        `${path.basename(executable)} failed: ${result.error?.message || result.stderr || result.stdout}`,
      ).slice(-4000),
    )
  }
  return result.stdout.trim()
}
function mysql(input: string, password = adminPassword): string {
  return checked(
    path.join(mysqlBin, 'mysql.exe'),
    [
      '--no-defaults',
      '--protocol=TCP',
      '-h',
      '127.0.0.1',
      '-P',
      String(mysqlPort),
      '-u',
      'root',
      '--batch',
      '--skip-column-names',
    ],
    { MYSQL_PWD: password },
    input,
  )
}
function postgres(input: string): string {
  return checked(
    path.join(pgBin, 'psql.exe'),
    [
      '--no-psqlrc',
      '-h',
      '127.0.0.1',
      '-p',
      String(pgPort),
      '-U',
      'postgres',
      '-d',
      'postgres',
      '-v',
      'ON_ERROR_STOP=1',
      '-At',
    ],
    {
      PGPASSWORD: adminPassword,
      PGSERVICE: undefined,
      PGSERVICEFILE: undefined,
      PGOPTIONS: undefined,
      PGSSLMODE: 'disable',
    },
    input,
  )
}
function sameDirectory(actual: string, expected: string): boolean {
  return fs.realpathSync(actual).toLowerCase() === fs.realpathSync(expected).toLowerCase()
}
async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const listener = net.createServer()
    listener.once('error', reject)
    listener.listen(0, '127.0.0.1', () => {
      const address = listener.address()
      if (!address || typeof address === 'string') {
        listener.close()
        reject(new Error('No loopback port'))
        return
      }
      listener.close((error) => (error ? reject(error) : resolve(address.port)))
    })
  })
}
function cleanup() {
  if (cleaned) return
  cleaned = true
  if (postgresStarted) {
    const status = command(path.join(pgBin, 'pg_ctl.exe'), ['-D', pgData, 'status']).status
    if (status !== 0 && status !== 3)
      cleanupErrors.push('PostgreSQL shutdown status could not be established')
    if (
      status === 0 &&
      command(path.join(pgBin, 'pg_ctl.exe'), [
        '-D',
        pgData,
        '-m',
        'fast',
        '-w',
        '-t',
        '20',
        'stop',
      ]).status !== 0
    )
      cleanupErrors.push('PostgreSQL shutdown failed')
  }
  let mysqlShutdown = false
  if (mysqlOwned) {
    mysqlShutdown =
      command(
        path.join(mysqlBin, 'mysqladmin.exe'),
        [
          '--no-defaults',
          '--protocol=TCP',
          '-h',
          '127.0.0.1',
          '-P',
          String(mysqlPort),
          '-u',
          'root',
          'shutdown',
        ],
        { MYSQL_PWD: adminPassword },
      ).status === 0
    if (!mysqlShutdown) cleanupErrors.push('MySQL shutdown failed')
  }
  if (!mysqlShutdown && mysqlProcess && mysqlProcess.exitCode === null) mysqlProcess.kill()
  if (fs.existsSync(mysqlInitFile)) fs.unlinkSync(mysqlInitFile)
  if (cleanupErrors.length) process.exitCode = 1
}
function rememberPID(file: string) {
  if (!fs.existsSync(file)) return
  const pid = Number(fs.readFileSync(file, 'utf8').split(/\r?\n/)[0])
  if (Number.isSafeInteger(pid) && pid > 0) ownedPIDs.add(pid)
}
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== 'ESRCH'
  }
}
async function portOpen(port: number): Promise<boolean> {
  if (!port) return false
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: '127.0.0.1', port })
    const done = (open: boolean) => {
      socket.destroy()
      resolve(open)
    }
    socket.once('connect', () => done(true))
    socket.once('error', (error: NodeJS.ErrnoException) => done(error.code !== 'ECONNREFUSED'))
    socket.setTimeout(200, () => done(true))
  })
}
async function confirmShutdown(): Promise<boolean> {
  for (let attempt = 0; attempt < 100; attempt++) {
    const ports = await Promise.all([portOpen(mysqlPort), portOpen(pgPort)])
    if (![...ownedPIDs].some(alive) && ports.every((open) => !open)) return true
    await delay(100)
  }
  return false
}
process.once('exit', cleanup)
process.once('SIGINT', () => process.exit(130))
process.once('SIGTERM', () => process.exit(143))

function test(name: string, args: string[], env: NodeJS.ProcessEnv, required: string[] = []) {
  console.log(`Running ${name}`)
  const result = spawnSync(
    'go',
    [
      'test',
      ...args,
      ...(focus && name.startsWith('managed-') ? ['-run', focus] : []),
      '-count=1',
      '-timeout=600s',
      '-json',
    ],
    {
      cwd: path.join(server, '.upstream'),
      env: { ...process.env, ...env },
      encoding: 'utf8',
      windowsHide: true,
      maxBuffer: 128 * 1024 * 1024,
    },
  )
  const output = redact((result.stdout || '') + (result.stderr || ''))
  fs.writeFileSync(path.join(artifact, `${name}.jsonl`), output)
  const events: { Action?: string; Test?: string; Package?: string }[] = []
  for (const line of (result.stdout || '').split(/\r?\n/)) {
    if (line.trim()) events.push(JSON.parse(line))
  }
  const failures = events
    .filter((entry) => entry.Action === 'fail')
    .map((entry) => entry.Test || entry.Package || 'package')
  if (!events.some((entry) => entry.Action === 'pass' && entry.Test))
    failures.push('No tests executed')
  const skippedTests = events
    .filter((entry) => entry.Action === 'skip')
    .map((entry) => entry.Test || entry.Package || 'package')
  // This existing test exercises MySQL REPEATABLE READ specifically. It must
  // pass on MySQL; its PostgreSQL skip is an inapplicable dialect, not lost coverage.
  const allowedSkips =
    name === 'managed-postgres' ? ['TestTrialIdentityMySQLExistingSnapshotReadsCurrentClaim'] : []
  for (const item of skippedTests)
    if (!allowedSkips.includes(item)) failures.push(`Unexpected skipped test: ${item}`)
  for (const item of required) {
    if (!events.some((entry) => entry.Test === item && entry.Action === 'pass'))
      failures.push(`Required matrix did not pass: ${item}`)
  }
  const summary = {
    name,
    code: failures.length || result.error ? 1 : (result.status ?? 1),
    passed: events.filter((entry) => entry.Action === 'pass' && entry.Test).length,
    skipped: skippedTests.length,
    failures,
  }
  results.push(summary)
  console.log(JSON.stringify(summary))
}

try {
  if (process.platform !== 'win32')
    throw new Error('This native database launcher targets Windows.')
  for (const executable of [path.join(mysqlBin, 'mysqld.exe'), path.join(pgBin, 'postgres.exe')]) {
    if (!fs.existsSync(executable))
      throw new Error(`Install the pinned official database tools first: ${executable}`)
  }
  console.log(checked(path.join(mysqlBin, 'mysqld.exe'), ['--version']))
  console.log(checked(path.join(pgBin, 'postgres.exe'), ['--version']))
  checked(process.execPath, [path.join(server, 'scripts', 'prepare.mjs')])
  mysqlPort = await freePort()
  pgPort = await freePort()
  console.log('Initializing isolated MySQL instance')
  checked(path.join(mysqlBin, 'mysqld.exe'), [
    '--no-defaults',
    '--initialize-insecure',
    `--basedir=${path.dirname(mysqlBin)}`,
    `--datadir=${mysqlData}`,
    '--console',
  ])
  // With name resolution disabled, localhost and 127.0.0.1 are distinct grant
  // hosts. Bootstrap the loopback account before accepting client connections.
  fs.writeFileSync(
    mysqlInitFile,
    `CREATE USER 'root'@'127.0.0.1' IDENTIFIED BY '${adminPassword}';\nGRANT ALL PRIVILEGES ON *.* TO 'root'@'127.0.0.1' WITH GRANT OPTION;\nALTER USER 'root'@'localhost' IDENTIFIED BY '${adminPassword}';\n`,
    { mode: 0o600 },
  )
  const mysqlLog = fs.openSync(path.join(runDirectory, 'mysql.log'), 'a')
  mysqlProcess = spawn(
    path.join(mysqlBin, 'mysqld.exe'),
    [
      '--no-defaults',
      '--console',
      `--init-file=${mysqlInitFile}`,
      `--pid-file=${mysqlPIDFile}`,
      `--basedir=${path.dirname(mysqlBin)}`,
      `--datadir=${mysqlData}`,
      '--bind-address=127.0.0.1',
      `--port=${mysqlPort}`,
      '--mysqlx=OFF',
      '--skip-name-resolve',
      '--skip-log-bin',
      '--character-set-server=utf8mb4',
      '--collation-server=utf8mb4_unicode_ci',
    ],
    { windowsHide: true, stdio: ['ignore', mysqlLog, mysqlLog] },
  )
  fs.closeSync(mysqlLog)
  if (mysqlProcess.pid) ownedPIDs.add(mysqlProcess.pid)
  mysqlProcess.on('error', (error) => console.error(error.message))
  for (let attempt = 0; ; attempt++) {
    try {
      const directory = mysql('SELECT @@datadir;')
      if (!sameDirectory(directory, mysqlData)) throw new Error('MySQL instance identity mismatch')
      mysqlOwned = true
      rememberPID(mysqlPIDFile)
      break
    } catch {
      if (attempt >= 120 || mysqlProcess.exitCode !== null)
        throw new Error(`MySQL did not start; inspect ${path.join(runDirectory, 'mysql.log')}`)
      await delay(250)
    }
  }
  fs.unlinkSync(mysqlInitFile)
  mysql(`CREATE USER 'lingtu_matrix'@'127.0.0.1' IDENTIFIED BY '${testPassword}';`)
  for (const database of ['lingtu_test', 'lingtu_service_test', 'lingtu_service_test_log']) {
    mysql(
      `CREATE DATABASE ${database} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci; GRANT ALL ON ${database}.* TO 'lingtu_matrix'@'127.0.0.1';`,
    )
  }
  const pwfile = path.join(runDirectory, 'postgres-password')
  console.log('Initializing isolated PostgreSQL instance')
  fs.writeFileSync(pwfile, adminPassword, { mode: 0o600 })
  try {
    checked(path.join(pgBin, 'initdb.exe'), [
      '-D',
      pgData,
      '-U',
      'postgres',
      '--encoding=UTF8',
      '--locale=C',
      '--auth=scram-sha-256',
      `--pwfile=${pwfile}`,
    ])
  } finally {
    fs.unlinkSync(pwfile)
  }
  fs.appendFileSync(
    path.join(pgData, 'postgresql.conf'),
    `\nlisten_addresses = '127.0.0.1'\nport = ${pgPort}\nunix_socket_directories = ''\n`,
  )
  postgresStarted = true
  // On Windows the detached server can inherit pg_ctl's pipe handles. A file
  // prevents spawnSync from waiting for pipe EOF until the server shuts down.
  const pgStartLog = fs.openSync(path.join(runDirectory, 'postgres-control.log'), 'a')
  const pgStart = spawnSync(
    path.join(pgBin, 'pg_ctl.exe'),
    ['-D', pgData, '-l', path.join(runDirectory, 'postgres.log'), '-w', '-t', '60', 'start'],
    { windowsHide: true, stdio: ['ignore', pgStartLog, pgStartLog], timeout: 70000 },
  )
  fs.closeSync(pgStartLog)
  if (pgStart.status !== 0 || pgStart.error)
    throw new Error('PostgreSQL startup failed; inspect postgres-control.log')
  rememberPID(path.join(pgData, 'postmaster.pid'))
  if (!sameDirectory(postgres('SHOW data_directory;'), pgData))
    throw new Error('PostgreSQL instance identity mismatch')
  postgres(`CREATE ROLE lingtu_matrix LOGIN PASSWORD '${testPassword}';`)
  for (const database of ['lingtu_test', 'lingtu_service_test', 'lingtu_service_test_log'])
    postgres(`CREATE DATABASE ${database} OWNER lingtu_matrix;`)
  const mysqlDSN = (database: string) =>
    `lingtu_matrix:${testPassword}@tcp(127.0.0.1:${mysqlPort})/${database}?charset=utf8mb4&parseTime=True&loc=UTC`
  const postgresDSN = (database: string) =>
    `host=127.0.0.1 port=${pgPort} user=lingtu_matrix password=${testPassword} dbname=${database} sslmode=disable`
  const empty = {
    LINGTU_TEST_ENGINE: '',
    LINGTU_TEST_DSN: '',
    TEST_FIXED_MYSQL_DSN: '',
    TEST_FIXED_MYSQL_LOG_DSN: '',
    TEST_FIXED_POSTGRES_DSN: '',
    TEST_FIXED_POSTGRES_LOG_DSN: '',
  }
  test(
    'service-all-databases',
    ['./service'],
    {
      ...empty,
      TEST_FIXED_MYSQL_DSN: mysqlDSN('lingtu_service_test'),
      TEST_FIXED_MYSQL_LOG_DSN: mysqlDSN('lingtu_service_test_log'),
      TEST_FIXED_POSTGRES_DSN: postgresDSN('lingtu_service_test'),
      TEST_FIXED_POSTGRES_LOG_DSN: postgresDSN('lingtu_service_test_log'),
    },
    ['TestFixedPriceBillingDatabaseMatrix/mysql', 'TestFixedPriceBillingDatabaseMatrix/postgres'],
  )
  if (!process.argv.includes('--service-only')) {
    // The packages share a disposable lingtu_test database, so never run them concurrently.
    test(
      'managed-mysql',
      ['-p', '1', './lingtu', './lingtuhost'],
      {
        ...empty,
        LINGTU_TEST_ENGINE: 'mysql',
        LINGTU_TEST_DSN: mysqlDSN('lingtu_test'),
      },
      focus ? [] : ['TestTrialIdentityMySQLExistingSnapshotReadsCurrentClaim'],
    )
    test('managed-postgres', ['-p', '1', './lingtu', './lingtuhost'], {
      ...empty,
      LINGTU_TEST_ENGINE: 'postgres',
      LINGTU_TEST_DSN: postgresDSN('lingtu_test'),
    })
  }
  if (results.some((entry) => entry.code !== 0)) process.exitCode = 1
} catch (error) {
  console.error(redact(error instanceof Error ? error.message : String(error)))
  process.exitCode = 1
} finally {
  rememberPID(mysqlPIDFile)
  rememberPID(path.join(pgData, 'postmaster.pid'))
  cleanup()
  stopped = await confirmShutdown()
  if (!stopped) {
    cleanupErrors.push('Owned process or loopback listener remains after shutdown')
    process.exitCode = 1
  }
  fs.writeFileSync(
    path.join(artifact, 'verification.json'),
    JSON.stringify(
      {
        status: process.exitCode ? 'failed' : 'passed',
        checkedAt: new Date().toISOString(),
        tools,
        scope: process.argv.includes('--service-only')
          ? 'service-only'
          : focus
            ? 'focused'
            : 'full',
        runDirectory,
        results,
        stopped,
        cleanupErrors,
      },
      null,
      2,
    ) + '\n',
  )
}

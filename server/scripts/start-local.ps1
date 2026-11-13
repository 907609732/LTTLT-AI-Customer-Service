# Local preview only: persist its own SQLite/keys and never inherit a production DSN.
$ErrorActionPreference = 'Stop'
$serverRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$runtimeDir = Join-Path $serverRoot 'runtime/local-http'
$executable = Join-Path $serverRoot 'bin/lingtu-managed.exe'
$configFile = Join-Path $runtimeDir 'private.json'
if (-not (Test-Path -LiteralPath $executable)) { throw 'Build the Windows server first; see server/README.md.' }
New-Item -ItemType Directory -Force -Path $runtimeDir | Out-Null
# Restrict plaintext bootstrap credentials and encryption keys to this Windows user and SYSTEM.
$userSid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
& icacls.exe $runtimeDir '/inheritance:r' '/grant:r' "*${userSid}:(OI)(CI)F" '*S-1-5-18:(OI)(CI)F' | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Cannot restrict local runtime permissions.' }
function New-Secret {
    $bytes = New-Object byte[] 32
    $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
    try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
    return [Convert]::ToBase64String($bytes)
}
if (-not (Test-Path -LiteralPath $configFile)) {
    if (Test-Path -LiteralPath (Join-Path $runtimeDir 'managed.db')) { throw 'Existing database has no bootstrap metadata. Preserve it and investigate.' }
    $private = [ordered]@{ username = 'admin'; password = (New-Secret); sessionSecret = (New-Secret); masterKey = (New-Secret) }
    $private | ConvertTo-Json | Set-Content -LiteralPath $configFile -Encoding UTF8
} else { $private = Get-Content -LiteralPath $configFile -Raw | ConvertFrom-Json }
$masterFile = Join-Path $runtimeDir 'master.key'
if (-not (Test-Path -LiteralPath $masterFile)) { [IO.File]::WriteAllBytes($masterFile, [Convert]::FromBase64String($private.masterKey)) }
$origin = 'http://127.0.0.1:3000'
$listening = Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue
if ($listening) {
    $owner = Get-CimInstance Win32_Process -Filter "ProcessId=$($listening[0].OwningProcess)"
    if ($owner.ExecutablePath -ne $executable) { throw 'Port 3000 is already occupied by another application.' }
    if ($listening | Where-Object { $_.LocalAddress -ne '127.0.0.1' }) { throw 'Existing server is not bound exclusively to loopback.' }
    Write-Output "Local server is already running: $origin/lingtu/admin"
    return
}
# Child-process-only configuration; do not change global Windows environment variables.
foreach ($name in @('SQL_DSN', 'LOG_SQL_DSN', 'REDIS_CONN_STRING', 'FRONTEND_BASE_URL', 'SESSION_COOKIE_TRUSTED_URL', 'TRUSTED_PROXIES')) {
    Remove-Item -LiteralPath "Env:$name" -ErrorAction SilentlyContinue
}
$env:LINGTU_LOCAL_HTTP = '1'
$env:LINGTU_LISTEN_HOST = '127.0.0.1'
$env:LINGTU_API_ORIGIN = $origin
$env:LINGTU_PORTAL_ORIGIN = $origin
$env:SESSION_COOKIE_SECURE = 'false'
$env:SESSION_SECRET = $private.sessionSecret
$env:LINGTU_MASTER_KEY_FILE = $masterFile
$env:SQLITE_PATH = Join-Path $runtimeDir 'managed.db'
$env:PORT = '3000'
$env:GIN_MODE = 'release'
$process = Start-Process -FilePath $executable -WorkingDirectory $runtimeDir -WindowStyle Hidden -RedirectStandardOutput (Join-Path $runtimeDir 'stdout.log') -RedirectStandardError (Join-Path $runtimeDir 'stderr.log') -PassThru
$process.Id | Set-Content -LiteralPath (Join-Path $runtimeDir 'server.pid')
$ready = $false
for ($attempt = 0; $attempt -lt 120; $attempt++) {
    if ($process.HasExited) { throw 'Local server exited. Check runtime/local-http/stderr.log.' }
    try {
        $setup = Invoke-RestMethod "$origin/api/setup" -TimeoutSec 2
        if ($setup.success) { $ready = $true; break }
    } catch { Start-Sleep -Milliseconds 500 }
}
if (-not $ready) { throw 'Local server did not become ready within the startup deadline.' }
if (-not $setup.data.status) {
    if ($setup.data.root_init) { throw 'Existing administrator found; will not reset credentials.' }
    $body = @{ username = $private.username; password = $private.password; confirmPassword = $private.password; SelfUseModeEnabled = $false; DemoSiteEnabled = $false } | ConvertTo-Json
    $result = Invoke-RestMethod "$origin/api/setup" -Method Post -ContentType 'application/json' -Headers @{ Origin = $origin } -Body $body
    if (-not $result.success) { throw "Local initialization failed: $($result.message)" }
}
Write-Output "Local server ready: $origin/lingtu/admin (PID $($process.Id)); credentials are in the protected runtime/local-http/private.json."

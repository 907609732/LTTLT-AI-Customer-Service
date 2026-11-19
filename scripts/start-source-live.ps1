function Invoke-SourceWithoutBuild {
    param(
        [Parameter(Mandatory = $true)][string]$ProjectRoot,
        [Parameter(Mandatory = $true)][string]$NodePath,
        [Parameter(Mandatory = $true)][string]$ElectronPath
    )

    # Reuse the application's default legacy profile. Never supply a new user-data
    # directory, install dependencies or refresh the existing main-process build.
    foreach ($relative in @('node_modules/vite/bin/vite.js', 'dist-electron/main.cjs', 'dist-electron/preload.cjs')) {
        if (-not (Test-Path -LiteralPath (Join-Path $ProjectRoot $relative) -PathType Leaf)) {
            throw "缺少运行文件：$relative。此入口不会安装依赖或构建，请先准备好运行文件。"
        }
    }
    if (-not (Test-Path -LiteralPath $ElectronPath -PathType Leaf)) {
        throw '缺少 Electron，请先准备好项目依赖。此入口不会安装依赖。'
    }
    # Never connect this desktop to an unidentified server or stop another launch.
    if (Get-NetTCPConnection -State Listen -LocalPort 5173 -ErrorAction SilentlyContinue) {
        throw '5173 端口已被占用，请先关闭原源码开发控制台，再重新双击。'
    }

    $viteProcess = $null
    $desktopProcess = $null
    $previousUrl = $env:VITE_DEV_SERVER_URL
    $previousNodeMode = $env:ELECTRON_RUN_AS_NODE
    $logDirectory = Join-Path $ProjectRoot ('artifacts/source-live/' + (Get-Date -Format 'yyyyMMdd-HHmmss-fff'))
    New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null
    Write-Host '不构建、不打包；使用现有桌面运行文件。' -ForegroundColor Cyan
    Write-Host "运行日志：$logDirectory"
    try {
        # File-backed handles survive console log pipes disconnecting (EPIPE).
        $viteProcess = Start-Process -FilePath $NodePath -ArgumentList @('node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '5173', '--strictPort') -WorkingDirectory $ProjectRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $logDirectory 'vite-stdout.log') -RedirectStandardError (Join-Path $logDirectory 'vite-stderr.log') -PassThru
        $deadline = (Get-Date).AddSeconds(25)
        $ready = $false
        while ((Get-Date) -lt $deadline) {
            $viteProcess.Refresh()
            if ($viteProcess.HasExited) { throw "源码服务未能启动，请查看 $logDirectory 中的日志。" }
            try {
                $response = Invoke-WebRequest -Uri 'http://127.0.0.1:5173/' -UseBasicParsing -TimeoutSec 1
                $listener = Get-NetTCPConnection -State Listen -LocalPort 5173 -ErrorAction SilentlyContinue
                if ($response.StatusCode -eq 200 -and @($listener | Where-Object { $_.OwningProcess -eq $viteProcess.Id }).Count -gt 0) {
                    $ready = $true
                    break
                }
            } catch {
                # The owned Vite process may still be starting; wait within a bound.
            }
            Start-Sleep -Milliseconds 250
        }
        if (-not $ready) { throw "源码服务启动超时，请查看 $logDirectory 中的日志。" }
        $env:VITE_DEV_SERVER_URL = 'http://127.0.0.1:5173'
        $env:ELECTRON_RUN_AS_NODE = $null
        $desktopProcess = Start-Process -FilePath $ElectronPath -ArgumentList '.' -WorkingDirectory $ProjectRoot -WindowStyle Normal -RedirectStandardOutput (Join-Path $logDirectory 'electron-stdout.log') -RedirectStandardError (Join-Path $logDirectory 'electron-stderr.log') -PassThru
        Write-Host '源码版已启动；关闭此控制台将停止本次程序。' -ForegroundColor Green
        $desktopProcess.WaitForExit()
        if ($desktopProcess.ExitCode -ne 0) { throw "程序异常退出，退出码：$($desktopProcess.ExitCode)。请查看 $logDirectory 中的日志。" }
    } finally {
        # Only stop processes created by this invocation. The parent launcher's
        # kill-on-close job also owns descendants if the console is closed abruptly.
        foreach ($owned in @($desktopProcess, $viteProcess)) {
            if ($null -ne $owned) {
                $owned.Refresh()
                if (-not $owned.HasExited) { Stop-Process -Id $owned.Id -ErrorAction SilentlyContinue }
            }
        }
        $env:VITE_DEV_SERVER_URL = $previousUrl
        $env:ELECTRON_RUN_AS_NODE = $previousNodeMode
    }
}

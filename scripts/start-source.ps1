$ErrorActionPreference = 'Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)

try {
    # A Windows job owns this launcher and every descendant, including npm workers
    # and Electron helpers. Closing the console releases the last job handle and
    # kills only this launch's process tree; unrelated Node/Electron apps survive.
    Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Diagnostics;
using System.Runtime.InteropServices;
public static class SourceConsoleLifetime {
    [StructLayout(LayoutKind.Sequential)]
    struct BasicLimits {
        public long ProcessTime, JobTime;
        public uint Flags;
        public UIntPtr MinWorkingSet, MaxWorkingSet;
        public uint ActiveProcesses;
        public UIntPtr Affinity;
        public uint Priority, Scheduling;
    }
    [StructLayout(LayoutKind.Sequential)]
    struct IoCounters { public ulong ReadOps, WriteOps, OtherOps, ReadBytes, WriteBytes, OtherBytes; }
    [StructLayout(LayoutKind.Sequential)]
    struct ExtendedLimits {
        public BasicLimits Basic;
        public IoCounters Io;
        public UIntPtr ProcessMemory, JobMemory, PeakProcessMemory, PeakJobMemory;
    }
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern IntPtr CreateJobObject(IntPtr attributes, string name);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool SetInformationJobObject(IntPtr job, int infoClass, ref ExtendedLimits info, uint size);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
    // Intentionally retain this non-inheritable handle until the launcher exits.
    static IntPtr job;
    public static void Attach() {
        job = CreateJobObject(IntPtr.Zero, null);
        if (job == IntPtr.Zero) throw new Win32Exception();
        var limits = new ExtendedLimits();
        limits.Basic.Flags = 0x2000; // JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
        if (!SetInformationJobObject(job, 9, ref limits, (uint)Marshal.SizeOf(limits)))
            throw new Win32Exception();
        if (!AssignProcessToJobObject(job, Process.GetCurrentProcess().Handle))
            throw new Win32Exception();
    }
}
'@
    [SourceConsoleLifetime]::Attach()

    Write-Host '灵兔AI电商客服 · 源码运行' -ForegroundColor Cyan
    Write-Host '关闭此控制台或按 Ctrl+C，将停止本次启动的程序。'
    Write-Host ''
    if (-not (Get-Command node.exe -ErrorAction SilentlyContinue)) {
        throw '未找到 Node.js，请安装 Node.js 24 后重新启动。'
    }
    $electron = Join-Path (Get-Location).Path 'node_modules\electron\dist\electron.exe'
    $existing = Get-Process electron -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $electron }
    if ($existing) { throw '源码版已在运行，请先退出现有源码版，再双击此脚本。' }

    if (-not (Test-Path 'node_modules\vite\bin\vite.js') -or -not (Test-Path $electron)) {
        Write-Host '[1/4] 正在安装项目依赖…'
        & npm.cmd ci
        if ($LASTEXITCODE -ne 0) { throw '依赖安装失败，请检查网络和上方错误后重试。' }
    } else {
        Write-Host '[1/4] 项目依赖已就绪。'
    }
    Write-Host '[2/4] 正在构建界面…'
    & node.exe node_modules/vite/bin/vite.js build
    if ($LASTEXITCODE -ne 0) { throw '界面构建失败。' }
    Write-Host '[3/4] 正在构建桌面程序…'
    & node.exe scripts/build-electron.mjs
    if ($LASTEXITCODE -ne 0) { throw '桌面程序构建失败。' }
    Write-Host '[4/4] 正在运行，以下显示程序日志。' -ForegroundColor Green
    $app = Start-Process -FilePath $electron -ArgumentList '.' -NoNewWindow -Wait -PassThru
    if ($app.ExitCode -ne 0) { throw "程序异常退出，退出码：$($app.ExitCode)" }
    Write-Host '程序已停止。'
    exit 0
} catch {
    Write-Host "错误：$($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

import { spawn } from 'node:child_process'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { z } from 'zod'

export const windowsOcrEngine = 'Windows.Media.Ocr/zh-Hans-CN/v1'
const resultSchema = z
  .object({
    text: z.string().max(30000),
    lines: z.array(z.string().max(30000)).max(10000),
    language: z.literal('zh-Hans-CN'),
  })
  .strict()
export type ImageOcrResult = z.infer<typeof resultSchema>
export function parseWindowsOcrResult(raw: string): ImageOcrResult {
  if (Buffer.byteLength(raw, 'utf8') > 1024 * 1024) throw Error('OCR结果超出容量，未采用截断文字')
  return resultSchema.parse(JSON.parse(raw.replace(/^\uFEFF/, '').trim()))
}

// Bind the installed Microsoft WinRT OCR API; this script has no network or shell-input evaluation.
const script = String.raw`
$ErrorActionPreference='Stop'
[Console]::OutputEncoding=New-Object System.Text.UTF8Encoding($false)
[Console]::InputEncoding=New-Object System.Text.UTF8Encoding($false)
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null=[Windows.Storage.StorageFile,Windows.Storage,ContentType=WindowsRuntime]
$null=[Windows.Graphics.Imaging.BitmapDecoder,Windows.Foundation,ContentType=WindowsRuntime]
$null=[Windows.Media.Ocr.OcrEngine,Windows.Foundation,ContentType=WindowsRuntime]
$null=[Windows.Globalization.Language,Windows.Globalization,ContentType=WindowsRuntime]
$asTask=[System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {$_.Name -eq 'AsTask' -and $_.IsGenericMethod -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq ('IAsyncOperation'+[char]96+'1')} | Select-Object -First 1
function Await($operation,$type) { $task=$asTask.MakeGenericMethod($type).Invoke($null,@($operation));$task.GetAwaiter().GetResult() }
$inputData=[Console]::In.ReadToEnd() | ConvertFrom-Json
$engine=[Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage([Windows.Globalization.Language]::new('zh-Hans-CN'))
if($null -eq $engine){throw 'Windows简体中文OCR语言包不可用'}
$file=Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($inputData.path)) ([Windows.Storage.StorageFile])
$stream=Await ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
try {
  $decoder=Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
  $bitmap=Await ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
  try {
    $ocr=Await ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])
    $lines=@($ocr.Lines | ForEach-Object {$_.Text})
    @{text=($lines -join [Environment]::NewLine);lines=$lines;language='zh-Hans-CN'} | ConvertTo-Json -Depth 5 -Compress
  } finally {$bitmap.Dispose()}
} finally {$stream.Dispose()}
`

export async function recognizeWindowsImage(
  bytes: Uint8Array,
  signal?: AbortSignal,
): Promise<ImageOcrResult> {
  if (process.platform !== 'win32') throw Error('本机OCR当前需要Windows及简体中文识别语言包')
  signal?.throwIfAborted()
  if (!bytes.byteLength || bytes.byteLength > 10 * 1024 * 1024) throw Error('OCR图片字节超出容量')
  const directory = await mkdtemp(join(tmpdir(), 'lingtu-ocr-'))
  try {
    const path = join(directory, 'tile.png')
    await writeFile(path, bytes)
    const executable = join(
      process.env.SystemRoot || 'C:\\Windows',
      'System32',
      'WindowsPowerShell',
      'v1.0',
      'powershell.exe',
    )
    const raw = await new Promise<string>((resolve, reject) => {
      const child = spawn(
        executable,
        [
          '-NoLogo',
          '-NoProfile',
          '-NonInteractive',
          '-EncodedCommand',
          Buffer.from(script, 'utf16le').toString('base64'),
        ],
        {
          windowsHide: true,
          shell: false,
          signal,
          timeout: 30000,
          stdio: ['pipe', 'pipe', 'pipe'],
        },
      )
      const output: Buffer[] = [],
        errors: Buffer[] = []
      let size = 0,
        overflow = false
      let processError: Error | undefined
      child.stdout.on('data', (data: Buffer) => {
        size += data.length
        if (size > 1024 * 1024) {
          overflow = true
          child.kill()
        } else output.push(data)
      })
      child.stderr.on('data', (data: Buffer) => {
        if (errors.reduce((n, b) => n + b.length, 0) < 16000) errors.push(data)
      })
      child.on('error', (error) => {
        processError = error
      })
      child.on('close', (code) =>
        code === 0 && !overflow && !processError
          ? resolve(Buffer.concat(output).toString('utf8'))
          : reject(
              Error(
                processError?.message ||
                  (overflow
                    ? 'OCR输出超出容量'
                    : `本机OCR失败：${Buffer.concat(errors).toString('utf8').slice(0, 1200) || '进程超时或退出'}`),
              ),
            ),
      )
      child.stdin.on('error', () => {})
      child.stdin.end(JSON.stringify({ path }))
    })
    signal?.throwIfAborted()
    return parseWindowsOcrResult(raw)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

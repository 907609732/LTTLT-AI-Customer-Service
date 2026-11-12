import {spawn,spawnSync} from 'node:child_process';
import fs from 'node:fs';import path from 'node:path';
const literal=value=>"'"+String(value).replaceAll("'","''")+"'";
export const shouldOpenSourceConsole=(platform,argv)=>platform==='win32'&&!argv.includes('--console-child')&&!argv.includes('--no-console');
export function buildSourceConsoleCommand({entry,cwd,nodePath=process.execPath}){
 const script=`$Host.UI.RawUI.WindowTitle = '灵兔客服 · 源码控制台'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$OutputEncoding = [Console]::OutputEncoding
Set-Location -LiteralPath ${literal(cwd)}
Write-Host '实时日志与接待状态。关闭此终端可能同时结束源码程序。' -ForegroundColor Cyan
& ${literal(nodePath)} ${literal(entry)} '--console-child'
Write-Host ('源码程序已退出，退出码：' + $LASTEXITCODE) -ForegroundColor Yellow`;
 const encoded=Buffer.from(script,'utf16le').toString('base64');
 return {script,encoded,args:['-w','new','new-tab','--title','灵兔客服 · 源码控制台','--startingDirectory',cwd,'powershell.exe','-NoProfile','-NoExit','-EncodedCommand',encoded]};
}
export function findTerminal(env=process.env){
 if(env.LINGTU_TERMINAL_EXE&&fs.existsSync(env.LINGTU_TERMINAL_EXE))return env.LINGTU_TERMINAL_EXE;
 const base=path.join(env.LOCALAPPDATA||'', 'Programs','WindowsTerminal');
 if(fs.existsSync(base)){
  const versions=fs.readdirSync(base,{withFileTypes:true}).filter(e=>e.isDirectory()).map(e=>e.name).sort((a,b)=>b.localeCompare(a,undefined,{numeric:true}));
  for(const version of versions){const dir=path.join(base,version);for(const candidate of [path.join(dir,'WindowsTerminal.exe'),...fs.readdirSync(dir,{withFileTypes:true}).filter(e=>e.isDirectory()).map(e=>path.join(dir,e.name,'WindowsTerminal.exe'))])if(fs.existsSync(candidate)){const cli=path.join(path.dirname(candidate),'wt.exe');return fs.existsSync(cli)?cli:candidate;}}
 }
 return null;
}
export async function openSourceConsole(options){
 const {args,encoded}=buildSourceConsoleCommand(options),terminal=findTerminal();
 if(terminal){await new Promise((resolve,reject)=>{const child=spawn(terminal,args,{detached:true,stdio:'ignore',windowsHide:false});child.once('error',reject);child.once('spawn',()=>{child.unref();resolve()})});}
 else{
  const bootstrap=`$ErrorActionPreference='Stop'; Start-Process powershell.exe -ArgumentList '-NoProfile -NoExit -EncodedCommand ${encoded}' -WorkingDirectory ${literal(options.cwd)} -WindowStyle Normal`;
  const result=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(bootstrap,'utf16le').toString('base64')],{windowsHide:true,encoding:'utf8'});
  if(result.error||result.status!==0)throw result.error||Error(result.stderr||'控制台启动失败');
 }
 console.log('已启动独立源码控制台。');
}

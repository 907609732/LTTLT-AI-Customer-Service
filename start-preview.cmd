@echo off
chcp 65001 >nul
cd /d "%~dp0"
if not exist node_modules\electron\dist\electron.exe (
 echo Please run npm install in this folder first.
 pause
 exit /b 1
)
if not exist dist\index.html (
 call npm.cmd run build
 if errorlevel 1 (
  pause
  exit /b 1
 )
)
set ELECTRON_RUN_AS_NODE=
call npm.cmd start
